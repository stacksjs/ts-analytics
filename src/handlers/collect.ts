/**
 * Event collection handler - main ingestion endpoint
 */

import {
  generateId,
  generateSessionId,
  hashVisitorId,
  getSharedDailySalt,
  getConfig,
} from '../index'
import type { Session as SessionType } from '../../src/types'
import { randomToken } from '../lib/crypto-random'
import { rateLimitAllow } from '../lib/rate-limit'
import {
  PageView as PageViewModel,
  Session as SessionModel,
  CustomEvent as CustomEventModel,
  HeatmapClick,
  HeatmapMovement,
  HeatmapScroll,
} from '../../src/models/orm'
import { dynamodb, TABLE_NAME, unmarshall, marshall, isConditionalCheckFailed } from '../lib/dynamodb'
import { accountEventWithinQuota } from '../lib/plans'
import { checkAndRecordConversions } from '../lib/goals'
import { getSession, setSession } from '../utils/cache'
import { parseUserAgent, isBot } from '../utils/user-agent'
import { getCountryFromHeaders, getCountryFromIP, getRegionFromHeaders, getCityFromHeaders, parseReferrerSource, isSpamReferrer, anonymizeIp } from '../utils/geolocation'
import { getCountryFromTimezone } from '../utils/timezone-country'
import { jsonResponse, errorResponse, noContentResponse } from '../utils/response'
import { getClientIP, getUserAgent, getHeaders } from '../../deploy/lambda-adapter'
import { ensureSiteExists } from './misc'

/** Max ingest requests per minute per IP on /collect + /t (429 beyond this). */
const COLLECT_RATE_LIMIT_PER_MIN = 1200

/**
 * A client-supplied session id is only trusted if it looks like one our tracker
 * emits — otherwise a missing id collapses every hit to SESSION#undefined and a
 * crafted id can corrupt session counts / keys (#147).
 */
function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{6,64}$/.test(value)
}

/**
 * Whether an event should be dropped per the configured exclusions: IPs by
 * exact match, paths by regex (falling back to exact match if the pattern is
 * invalid). Lets deployments exclude internal traffic / admin paths (#159).
 */
function isExcluded(ip: string, path: string, ips?: string[], paths?: string[]): boolean {
  if (ips && ips.length > 0 && ips.includes(ip))
    return true
  if (paths) {
    for (const pattern of paths) {
      try {
        if (new RegExp(pattern).test(path))
          return true
      }
      catch {
        if (pattern === path)
          return true
      }
    }
  }
  return false
}

/**
 * Keep only valid scroll buckets (integer depth 0-100 → finite ms), so a crafted
 * payload can't bloat the item — and, since keys are bounded to 0-100, the
 * cross-request merge in HeatmapScroll.upsert stays bounded too (#150).
 */
function clampScrollDepths(depths: unknown): Record<number, number> {
  const out: Record<number, number> = {}
  if (!depths || typeof depths !== 'object')
    return out
  for (const [k, v] of Object.entries(depths as Record<string, unknown>)) {
    const d = Number(k)
    if (Number.isInteger(d) && d >= 0 && d <= 100 && typeof v === 'number' && Number.isFinite(v))
      out[d] = Math.max(0, Math.min(v, 24 * 60 * 60 * 1000))
  }
  return out
}

/**
 * Extract UTM parameters and ad click IDs from a request URL.
 */
function extractUtm(url: URL): {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  gclid?: string
  fbclid?: string
} {
  const g = (k: string): string | undefined => url.searchParams.get(k) || undefined
  return {
    utmSource: g('utm_source'),
    utmMedium: g('utm_medium'),
    utmCampaign: g('utm_campaign'),
    utmContent: g('utm_content'),
    utmTerm: g('utm_term'),
    gclid: g('gclid'),
    fbclid: g('fbclid'),
  }
}

/**
 * Filterable visitor dimensions copied from the session onto click/engagement
 * records, so those reports can be sliced by the dashboard filters. Only defined
 * values are included (marshall stores undefined as NULL otherwise).
 */
function filterDims(session: SessionType | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!session) return out
  const keys = ['deviceType', 'browser', 'os', 'country', 'region', 'city', 'referrerSource', 'utmSource', 'utmMedium', 'utmCampaign'] as const
  for (const k of keys) {
    const v = (session as Record<string, any>)[k]
    if (v) out[k] = v
  }
  return out
}

/**
 * POST /collect or /t
 */
export async function handleCollect(request: Request): Promise<Response> {
  try {
    // Reject oversized bodies before parsing (#173): a multi-MB payload both
    // memory-amplifies and 500s against DynamoDB's 400KB item limit (losing
    // the event). Legit beacons are <2KB.
    const MAX_BODY_BYTES = 16 * 1024
    const rawBody = await request.text()
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Payload too large' }, 413)
    }
    let payload: Record<string, any>
    try {
      payload = JSON.parse(rawBody) as Record<string, any>
    }
    catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400)
    }

    if (!payload?.s || !payload?.e || !payload?.u) {
      return jsonResponse({ error: 'Missing required fields: s, e, u' }, 400)
    }

    // Parse URL early to get hostname for site creation
    let parsedUrlForSite: URL
    try {
      parsedUrlForSite = new URL(payload.u)
    }
catch {
      return jsonResponse({ error: 'Invalid URL' }, 400)
    }

    const userAgent = getUserAgent(request)

    // Drop bot/crawler traffic and known referral-spam before any writes
    // (no site auto-create, no records).
    if (isBot(userAgent) || isSpamReferrer(payload.r)) {
      return noContentResponse(request)
    }

    // Ensure site exists (auto-create if first event; gated in production, #170)
    const site = await ensureSiteExists(payload.s, parsedUrlForSite.hostname)
    if (!site) {
      // Unknown site and auto-provisioning disabled — drop silently (a 4xx
      // would only help someone probing for valid ids).
      return noContentResponse(request)
    }

    // Domain firewall (#170): when the site has domains configured, only
    // accept events whose page hostname matches (exact, subdomain, or '*').
    // An empty domains list keeps the open behavior for unconfigured sites.
    const allowedDomains: string[] = Array.isArray(site.domains) ? site.domains.filter(Boolean) : []
    if (allowedDomains.length > 0) {
      const host = parsedUrlForSite.hostname.toLowerCase()
      const allowed = allowedDomains.some((d: string) => {
        const dom = String(d).toLowerCase().replace(/^www\./, '')
        if (dom === '*') return true
        const h = host.replace(/^www\./, '')
        return h === dom || h.endsWith(`.${dom}`)
      })
      if (!allowed)
        return noContentResponse(request)
    }

    // Account plan quota (#62): events across all of an owner's projects count
    // against the owner's monthly plan limit. Unowned (auto-created) sites and
    // quota errors fail open — a billing glitch never drops events.
    if (site?.ownerId && !(await accountEventWithinQuota(site.ownerId))) {
      return jsonResponse({ error: 'Monthly event quota exceeded for this account' }, 429)
    }

    const ip = getClientIP(request)

    // Per-IP rate limit on the public ingest endpoint to cap event-spam / DoS
    // (#158). Deliberately generous (20/s) so heavy SPA usage and shared NAT
    // aren't throttled while single-source floods are. In-memory per process.
    if (!rateLimitAllow(`collect:${ip}`, COLLECT_RATE_LIMIT_PER_MIN, 60_000)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Honor configured IP/path exclusions (internal traffic, admin paths) (#159).
    const tracking = getConfig().tracking
    if (isExcluded(ip, parsedUrlForSite.pathname, tracking.excludedIps, tracking.excludedPaths)) {
      return noContentResponse(request)
    }

    // Idempotency (#169): the tracker mints a per-event id (eid); a replayed
    // delivery (Lambda retry, network retransmit, SQS at-least-once) carries
    // the same eid, so a conditional put on an EIDLOCK item lets exactly one
    // delivery through. Fails OPEN on non-conditional errors — a DynamoDB
    // hiccup must never drop events (degrades to today's at-least-once).
    const eid = typeof payload.eid === 'string' && /^[\w-]{8,64}$/.test(payload.eid) ? payload.eid : null
    if (eid) {
      try {
        await dynamodb.putItem({
          TableName: TABLE_NAME,
          Item: {
            pk: { S: `SITE#${payload.s}` },
            sk: { S: `EIDLOCK#${eid}` },
            ttl: { N: String(Math.floor(Date.now() / 1000) + 24 * 60 * 60) },
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        })
      }
      catch (e) {
        if (isConditionalCheckFailed(e))
          return noContentResponse(request)
      }
    }

    const headers = getHeaders(request)

    // Ingest is cleanly direct (#97). The old SQS "fast path" was removed: it
    // intercepted every event type but coerced clicks/engagement/vitals into
    // EVENT# items and skipped session creation entirely, silently breaking
    // bounce rates and session-derived breakdowns whenever it was enabled.
    // The sqs-buffering library + deploy/sqs-consumer-handler.ts remain as
    // standalone opt-in infrastructure for spike-buffered pipelines.
    // Raw IP+UA are PII — never stream them to production logs (the privacy
    // docs promise the hash inputs are discarded). Opt in per run for local
    // debugging only.
    if (process.env.ANALYTICS_DEBUG === 'true')
      console.log(`[Collect] IP: ${ip}, UA: ${userAgent?.substring(0, 50)}...`)
    const salt = await getSharedDailySalt()
    // When neither IP nor UA carries any signal, hashVisitorId would collapse
    // every such hit to one identical hash — under-counting uniques and letting a
    // client hide by omitting both. Use a per-hit anonymous id instead (#148).
    const hasVisitorSignal = (!!ip && ip !== 'unknown') || (!!userAgent && userAgent !== 'unknown')
    const visitorId = hasVisitorSignal
      ? await hashVisitorId(ip, userAgent, payload.s, salt)
      : `anon_${randomToken(24)}`

    let parsedUrl: URL
    try {
      parsedUrl = new URL(payload.u)
    }
catch {
      return jsonResponse({ error: 'Invalid URL' }, 400)
    }

    const timestamp = new Date()
    // Reject a missing/malformed client session id (would collapse to
    // SESSION#undefined / allow crafted keys); mint a server-side one (#147).
    let sessionId = isValidSessionId(payload.sid) ? payload.sid : generateSessionId()

    let sessionKey = `${payload.s}:${sessionId}`
    let session = getSession(sessionKey)

    // Load session from DynamoDB if not in cache
    if (!session) {
      try {
        const sessionResult = await dynamodb.getItem({
          TableName: TABLE_NAME,
          Key: {
            pk: { S: `SITE#${payload.s}` },
            sk: { S: `SESSION#${sessionId}` },
          },
        })
        if (sessionResult.Item) {
          session = unmarshall(sessionResult.Item) as SessionType
          if (typeof session.startedAt === 'string') {
            session.startedAt = new Date(session.startedAt)
          }
          setSession(sessionKey, session)
        }
      }
catch (e) {
        console.log('[Collect] Failed to load session from DB:', e)
      }
    }

    // Session timeout (#135): the client keeps its sessionStorage sid for the
    // tab's whole life, so without a server-side idle cutoff a tab left open
    // across days stays ONE session (skewing duration/bounce) and stale sids
    // are replayable forever. Match Fathom's ~30-minute semantics: when the
    // loaded session has been idle past the cutoff, mint a fresh server-side
    // session id and treat this hit as a new session.
    const SESSION_IDLE_MS = 30 * 60 * 1000
    if (session) {
      const lastActivity = new Date((session.endedAt || session.startedAt) as Date | string).getTime()
      if (Number.isFinite(lastActivity) && Date.now() - lastActivity > SESSION_IDLE_MS) {
        session = null
        sessionId = generateSessionId()
        sessionKey = `${payload.s}:${sessionId}`
      }
    }


    if (payload.e === 'pageview') {
      const deviceInfo = parseUserAgent(userAgent)
      const browser = payload.br || deviceInfo.browser
      // Self-referrals (SPA restores, same-site openers) are Direct traffic —
      // don't let a site show up as its own top referrer.
      let externalReferrer = typeof payload.r === 'string' ? payload.r.slice(0, 1024) : undefined
      try {
        if (externalReferrer && new URL(externalReferrer).hostname === parsedUrl.hostname)
          externalReferrer = undefined
      }
      catch {}
      const referrerSource = parseReferrerSource(externalReferrer)

      let country = getCountryFromHeaders(headers)
      // Fathom-privacy fallback: derive the country from the browser timezone
      // the tracker sends (`tz`). No IP is used and nothing goes to a third
      // party; the raw timezone is discarded — only the country is stored.
      if (!country)
        country = getCountryFromTimezone(payload.tz)
      // Only fall back to a third-party geo lookup when geolocation is enabled
      // (off by default) and send an anonymized IP per config (#144).
      if (!country && getConfig().privacy.collectGeolocation) {
        const geoIp = anonymizeIp(ip, getConfig().privacy.ipAnonymization)
        if (geoIp)
          country = await getCountryFromIP(geoIp)
      }
      const region = getRegionFromHeaders(headers)
      const city = getCityFromHeaders(headers)

      // Settle the session FIRST and derive the pageview's isUnique/isBounce
      // from the actual outcome (#145): flags were previously persisted from
      // the pre-write session read, so two concurrent first hits both stored
      // isUnique=true — inflating entry-page uniques and bounce entries.
      let wasNewSession = false

      if (session) {
        session.pageViewCount += 1
        session.exitPath = parsedUrl.pathname
        session.endedAt = timestamp
        session.isBounce = false
        const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt)
        session.duration = timestamp.getTime() - startedAt.getTime()
        // Atomic increment so concurrent pageviews don't lose the count (#161).
        await SessionModel.incrementMetrics(payload.s, sessionId, {
          incPageViews: 1,
          exitPath: parsedUrl.pathname,
          endedAt: timestamp,
          duration: session.duration,
          isBounce: false,
          countryIfAbsent: country,
        })
      }
else {
        session = {
          id: sessionId,
          siteId: payload.s,
          visitorId,
          entryPath: parsedUrl.pathname,
          exitPath: parsedUrl.pathname,
          referrer: externalReferrer,
          referrerSource,
          ...extractUtm(parsedUrl),
          deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
          browser,
          os: deviceInfo.os,
          country,
          region,
          city,
          pageViewCount: 1,
          eventCount: 0,
          isBounce: true,
          duration: 0,
          startedAt: timestamp,
          endedAt: timestamp,
        }
        // Conditional create; if a concurrent request already created this
        // session, count this pageview atomically instead of clobbering it (#161).
        const created = await SessionModel.createIfAbsent(session)
        wasNewSession = created
        if (!created) {
          await SessionModel.incrementMetrics(payload.s, sessionId, {
            incPageViews: 1,
            exitPath: parsedUrl.pathname,
            endedAt: timestamp,
            duration: 0,
            isBounce: false,
            countryIfAbsent: country,
          })
        }
      }

      setSession(sessionKey, session)

      await PageViewModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        path: parsedUrl.pathname,
        hostname: parsedUrl.hostname,
        title: typeof payload.t === 'string' ? payload.t.slice(0, 512) : payload.t,
        referrer: externalReferrer,
        referrerSource,
        ...extractUtm(parsedUrl),
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        browser,
        os: deviceInfo.os,
        country,
        region,
        city,
        screenWidth: payload.sw,
        screenHeight: payload.sh,
        isUnique: wasNewSession,
        isBounce: wasNewSession,
        timestamp,
      })

      await checkAndRecordConversions(
        payload.s,
        visitorId,
        sessionId,
        { path: parsedUrl.pathname },
        {
          referrerSource,
          utmSource: parsedUrl.searchParams.get('utm_source') || undefined,
          utmMedium: parsedUrl.searchParams.get('utm_medium') || undefined,
          utmCampaign: parsedUrl.searchParams.get('utm_campaign') || undefined,
        }
      )
    }
else if (payload.e === 'event') {
      const props = payload.p || {}
      const eventName = props.name || 'unnamed'
      const eventValue = typeof props.value === 'number' ? props.value : undefined

      // Keep only primitive custom props; exclude the reserved name/value keys.
      // Cap the count and string length so a crafted payload can't bloat the
      // item toward the DynamoDB 400KB limit (#134).
      const MAX_PROPS = 50
      const MAX_PROP_LEN = 1024
      const customProps: Record<string, string | number | boolean> = {}
      for (const [k, v] of Object.entries(props)) {
        if (k === 'name' || k === 'value') continue
        if (Object.keys(customProps).length >= MAX_PROPS) break
        if (typeof v === 'string') customProps[k.slice(0, 256)] = v.slice(0, MAX_PROP_LEN)
        else if (typeof v === 'number' || typeof v === 'boolean') customProps[k.slice(0, 256)] = v
      }

      await CustomEventModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        ...filterDims(session),
        name: eventName,
        value: eventValue,
        properties: Object.keys(customProps).length > 0 ? customProps : undefined,
        path: parsedUrl.pathname,
        timestamp,
      })

      if (session) {
        session.eventCount += 1
        session.endedAt = timestamp
        const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt)
        session.duration = timestamp.getTime() - startedAt.getTime()

        // Atomic increment so concurrent events don't lose the count (#161).
        await SessionModel.incrementMetrics(payload.s, sessionId, {
          incEvents: 1,
          endedAt: timestamp,
          duration: session.duration,
        })
        setSession(sessionKey, session)
      }

      await checkAndRecordConversions(
        payload.s,
        visitorId,
        sessionId,
        { path: parsedUrl.pathname, eventName, eventValue },
        {
          referrerSource: session?.referrerSource,
          utmSource: session?.utmSource,
          utmMedium: session?.utmMedium,
          utmCampaign: session?.utmCampaign,
        }
      )
    }
else if (payload.e === 'outbound') {
      const props = payload.p || {}

      await CustomEventModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        name: 'outbound',
        properties: { url: props.url || '' },
        path: parsedUrl.pathname,
        timestamp,
      })

      if (session) {
        session.eventCount += 1
        session.endedAt = timestamp
        const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt)
        session.duration = timestamp.getTime() - startedAt.getTime()

        // Atomic increment so concurrent events don't lose the count (#161).
        await SessionModel.incrementMetrics(payload.s, sessionId, {
          incEvents: 1,
          endedAt: timestamp,
          duration: session.duration,
        })
        setSession(sessionKey, session)
      }
    }
else if (payload.e === 'click') {
      const props = payload.p || {}
      const kind = ['outbound', 'internal', 'download', 'mailto', 'tel'].includes(props.kind)
        ? props.kind
        : 'outbound'

      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshall({
          pk: `SITE#${payload.s}`,
          sk: `CLICK#${timestamp.toISOString()}#${generateId()}`,
          siteId: payload.s,
          sessionId,
          visitorId,
          ...filterDims(session),
          path: parsedUrl.pathname,
          url: String(props.url || '').slice(0, 1000),
          kind,
          text: String(props.text || '').slice(0, 200),
          timestamp: timestamp.toISOString(),
          _et: 'LinkClick',
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        }),
      })

      if (session) {
        session.eventCount += 1
        session.endedAt = timestamp
        const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt)
        session.duration = timestamp.getTime() - startedAt.getTime()

        // Atomic increment so concurrent events don't lose the count (#161).
        await SessionModel.incrementMetrics(payload.s, sessionId, {
          incEvents: 1,
          endedAt: timestamp,
          duration: session.duration,
        })
        setSession(sessionKey, session)
      }
    }
else if (payload.e === 'engagement') {
      const props = payload.p || {}
      const scrollDepth = Math.max(0, Math.min(100, Math.round(Number(props.scrollDepth) || 0)))
      const timeOnPage = Math.max(0, Math.round(Number(props.timeOnPage) || 0))

      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshall({
          pk: `SITE#${payload.s}`,
          sk: `ENGAGEMENT#${timestamp.toISOString()}#${generateId()}`,
          siteId: payload.s,
          sessionId,
          visitorId,
          ...filterDims(session),
          path: parsedUrl.pathname,
          scrollDepth,
          timeOnPage,
          timestamp: timestamp.toISOString(),
          _et: 'Engagement',
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        }),
      })

      // Fold real engaged time into the session (#167): avg time on site was
      // last-hit-minus-first-hit, so every bounce counted as 0s. Departure
      // pings carry the truth — accumulate it atomically on the session.
      if (timeOnPage > 0 && session) {
        await SessionModel.incrementMetrics(payload.s, sessionId, {
          addActiveMs: Math.min(timeOnPage, 6 * 60 * 60) * 1000,
          endedAt: timestamp,
        })
      }
    }
else if (payload.e === 'hm_click') {
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      await HeatmapClick.record({
        id: generateId(),
        siteId: payload.s,
        sessionId,
        visitorId,
        path: payload.u,
        viewportX: props.vx || 0,
        viewportY: props.vy || 0,
        documentX: props.dx || 0,
        documentY: props.dy || 0,
        viewportWidth: props.vw || 0,
        viewportHeight: props.vh || 0,
        selector: props.selector || '',
        elementTag: props.tag || '',
        elementText: props.text,
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        timestamp,
      })
    }
else if (payload.e === 'hm_move') {
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      if (props.points && Array.isArray(props.points) && props.points.length > 0) {
        // Cap points so one request can't exceed the DynamoDB 400KB item limit
        // (write failures / amplification DoS) (#149).
        const MAX_POINTS = 500
        await HeatmapMovement.record({
          id: generateId(),
          siteId: payload.s,
          sessionId,
          visitorId,
          path: payload.u,
          points: props.points.slice(0, MAX_POINTS),
          viewportWidth: props.vw || 0,
          viewportHeight: props.vh || 0,
          deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
          timestamp,
        })
      }
    }
else if (payload.e === 'hm_scroll') {
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      await HeatmapScroll.upsert({
        id: `${sessionId}-${encodeURIComponent(payload.u)}`,
        siteId: payload.s,
        sessionId,
        visitorId,
        path: payload.u,
        maxScrollDepth: props.maxDepth || 0,
        scrollDepths: clampScrollDepths(props.depths),
        documentHeight: props.docHeight || 0,
        viewportHeight: props.vh || 0,
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        timestamp,
      })
    }
else if (payload.e === 'vitals') {
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)
      const browser = payload.br || deviceInfo.browser

      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshall({
          pk: `SITE#${payload.s}`,
          sk: `VITAL#${timestamp.toISOString()}#${generateId()}`,
          siteId: payload.s,
          sessionId,
          visitorId,
          path: parsedUrl.pathname,
          metric: props.metric || 'unknown',
          value: props.value || 0,
          rating: props.rating || 'unknown',
          deviceType: deviceInfo.deviceType,
          browser,
          timestamp: timestamp.toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        }),
      })
    }
    return noContentResponse(request)
  }
catch (error) {
    console.error('Collect error:', error)
    return errorResponse('Internal server error')
  }
}
