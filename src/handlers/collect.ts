/**
 * Event collection handler - main ingestion endpoint
 */

import {
  generateId,
  hashVisitorId,
  getDailySalt,
  type AnalyticsEvent,
} from '../index'
import type { Session as SessionType } from '../../src/types'
import {
  PageView as PageViewModel,
  Session as SessionModel,
  CustomEvent as CustomEventModel,
  HeatmapClick,
  HeatmapMovement,
  HeatmapScroll,
} from '../../src/models/orm'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { getSQSProducer, isSQSEnabled } from '../lib/sqs'
import { checkAndRecordConversions } from '../lib/goals'
import { getSession, setSession } from '../utils/cache'
import { parseUserAgent, isBot } from '../utils/user-agent'
import { getCountryFromHeaders, getCountryFromIP, getRegionFromHeaders, getCityFromHeaders, parseReferrerSource, isSpamReferrer } from '../utils/geolocation'
import { jsonResponse, errorResponse } from '../utils/response'
import { getLambdaEvent, getClientIP, getUserAgent, getHeaders } from '../../deploy/lambda-adapter'
import { ensureSiteExists } from './misc'

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
    const payload = await request.json() as Record<string, any>

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
      return new Response(null, { status: 204 })
    }

    // Ensure site exists (auto-create if first event)
    await ensureSiteExists(payload.s, parsedUrlForSite.hostname)

    const event = getLambdaEvent(request)
    const ip = getClientIP(request)
    const headers = getHeaders(request)

    // SQS Fast Path - Queue events for async processing
    if (isSQSEnabled()) {
      try {
        const producer = await getSQSProducer()
        if (producer) {
          const timestamp = new Date()
          const salt = getDailySalt()
          const visitorId = await hashVisitorId(ip, userAgent, payload.s, salt)

          const deviceInfo = parseUserAgent(userAgent)
          const browser = payload.br || deviceInfo.browser
          const referrerSource = parseReferrerSource(payload.r)

          let parsedUrl: URL
          try {
            parsedUrl = new URL(payload.u)
          }
catch {
            return jsonResponse({ error: 'Invalid URL' }, 400)
          }

          const country = getCountryFromHeaders(headers)
          const region = getRegionFromHeaders(headers)
          const city = getCityFromHeaders(headers)

          const analyticsEvent: AnalyticsEvent = {
            type: payload.e === 'pageview' ? 'pageview' : 'event',
            siteId: payload.s,
            timestamp: timestamp.toISOString(),
            data: {
              id: generateId(),
              siteId: payload.s,
              visitorId,
              sessionId: payload.sid,
              path: parsedUrl.pathname,
              hostname: parsedUrl.hostname,
              title: payload.t,
              referrer: payload.r,
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
              isUnique: true,
              isBounce: true,
              timestamp,
              ...(payload.e === 'event' && payload.p && {
                name: payload.p.name || 'unnamed',
                value: payload.p.value,
                properties: payload.p,
              }),
            },
          }

          await producer.sendEvent(analyticsEvent)
          console.log(`[Collect] Queued ${payload.e} event to SQS for site ${payload.s}`)

          return new Response(null, { status: 204 })
        }
      }
catch (sqsError) {
        console.error('[Collect] SQS send failed, falling back to direct write:', sqsError)
      }
    }

    // Direct Write Path
    console.log(`[Collect] IP: ${ip}, UA: ${userAgent?.substring(0, 50)}...`)
    const salt = getDailySalt()
    const visitorId = await hashVisitorId(ip, userAgent, payload.s, salt)

    let parsedUrl: URL
    try {
      parsedUrl = new URL(payload.u)
    }
catch {
      return jsonResponse({ error: 'Invalid URL' }, 400)
    }

    const timestamp = new Date()
    const sessionId = payload.sid

    const sessionKey = `${payload.s}:${sessionId}`
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

    const isNewSession = !session

    if (payload.e === 'pageview') {
      const deviceInfo = parseUserAgent(userAgent)
      const browser = payload.br || deviceInfo.browser
      const referrerSource = parseReferrerSource(payload.r)

      let country = getCountryFromHeaders(headers)
      if (!country) {
        country = await getCountryFromIP(ip)
      }
      const region = getRegionFromHeaders(headers)
      const city = getCityFromHeaders(headers)

      await PageViewModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        path: parsedUrl.pathname,
        hostname: parsedUrl.hostname,
        title: payload.t,
        referrer: payload.r,
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
        isUnique: isNewSession,
        isBounce: isNewSession,
        timestamp,
      })

      if (session) {
        session.pageViewCount += 1
        session.exitPath = parsedUrl.pathname
        session.endedAt = timestamp
        session.isBounce = false
        const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt)
        session.duration = timestamp.getTime() - startedAt.getTime()
      }
else {
        session = {
          id: sessionId,
          siteId: payload.s,
          visitorId,
          entryPath: parsedUrl.pathname,
          exitPath: parsedUrl.pathname,
          referrer: payload.r,
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
      }

      await SessionModel.upsert(session)
      setSession(sessionKey, session)

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

      await CustomEventModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        name: eventName,
        value: eventValue,
        path: parsedUrl.pathname,
        timestamp,
      })

      if (session) {
        session.eventCount += 1
        session.endedAt = timestamp
        const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt)
        session.duration = timestamp.getTime() - startedAt.getTime()

        await SessionModel.upsert(session)
        setSession(sessionKey, session)
      }

      await checkAndRecordConversions(
        payload.s,
        visitorId,
        sessionId,
        { path: parsedUrl.pathname, eventName },
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

        await SessionModel.upsert(session)
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

        await SessionModel.upsert(session)
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
        await HeatmapMovement.record({
          id: generateId(),
          siteId: payload.s,
          sessionId,
          visitorId,
          path: payload.u,
          points: props.points,
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
        scrollDepths: props.depths || {},
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
else if (payload.e === 'error') {
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)
      const browser = payload.br || deviceInfo.browser

      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshall({
          pk: `SITE#${payload.s}`,
          sk: `ERROR#${timestamp.toISOString()}#${generateId()}`,
          siteId: payload.s,
          sessionId,
          visitorId,
          path: parsedUrl.pathname,
          message: String(props.message || '').slice(0, 500),
          source: props.source || '',
          line: props.line || 0,
          col: props.col || 0,
          stack: String(props.stack || '').slice(0, 2000),
          deviceType: deviceInfo.deviceType,
          browser,
          os: deviceInfo.os,
          timestamp: timestamp.toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        }),
      })
    }

    return new Response(null, { status: 204 })
  }
catch (error) {
    console.error('Collect error:', error)
    return errorResponse('Internal server error')
  }
}
