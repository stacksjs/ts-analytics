/**
 * ts-analytics API Server
 *
 * A Bun-powered analytics API using bun-router.
 * Provides endpoints for collecting analytics events and querying stats.
 */

import { Router, cors } from 'bun-router'
// Import DynamoDB client directly from ts-cloud source
import { DynamoDBClient } from '../../ts-cloud/packages/ts-cloud/src/aws/dynamodb'
import {
  generateTrackingScript,
  generateMinimalTrackingScript,
  generateId,
  hashVisitorId,
  getDailySalt,
  getPeriodStart,
} from '../src/index'
import type { PageView, Session, AggregationPeriod } from '../src/types'

// Helper: Create JSON response (avoid bun-router Response.json issues)
function jsonResponse(data: unknown, options?: { status?: number }): Response {
  return new Response(JSON.stringify(data), {
    status: options?.status || 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Configuration from environment
const TABLE_NAME = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'
const REGION = process.env.AWS_REGION || 'us-east-1'
const PORT = Number.parseInt(process.env.PORT || '3001', 10)
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || ['*']

// Initialize DynamoDB client
const dynamodb = new DynamoDBClient(REGION)

// In-memory session cache (use Redis in production)
const sessionCache = new Map<string, { session: Session; expires: number }>()

// Helper: Execute DynamoDB command
async function executeCommand(cmd: { command: string; input: Record<string, unknown> }): Promise<unknown> {
  const method = cmd.command.toLowerCase() as keyof DynamoDBClient
  if (typeof dynamodb[method] === 'function') {
    return (dynamodb[method] as (input: Record<string, unknown>) => Promise<unknown>)(cmd.input)
  }
  throw new Error(`Unknown DynamoDB command: ${cmd.command}`)
}

// Helper: Get session from cache
function getSession(key: string): Session | null {
  const cached = sessionCache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.session
  }
  sessionCache.delete(key)
  return null
}

// Helper: Set session in cache
function setSession(key: string, session: Session, ttlSeconds: number = 1800): void {
  sessionCache.set(key, {
    session,
    expires: Date.now() + ttlSeconds * 1000,
  })
}

// Helper: Parse user agent
function parseUserAgent(ua: string): { deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown'; browser: string; os: string } {
  const deviceType = /mobile/i.test(ua) ? 'mobile' : /tablet/i.test(ua) ? 'tablet' : 'desktop'

  let browser = 'Unknown'
  if (ua.includes('Chrome') && !ua.includes('Edge')) browser = 'Chrome'
  else if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari'
  else if (ua.includes('Edge')) browser = 'Edge'

  let os = 'Unknown'
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac')) os = 'macOS'
  else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'

  return { deviceType, browser, os }
}

// Helper: Parse referrer source
function parseReferrerSource(referrer?: string): string {
  if (!referrer) return 'direct'
  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()
    if (host.includes('google')) return 'google'
    if (host.includes('bing')) return 'bing'
    if (host.includes('twitter') || host.includes('x.com')) return 'twitter'
    if (host.includes('facebook')) return 'facebook'
    if (host.includes('linkedin')) return 'linkedin'
    if (host.includes('github')) return 'github'
    return host
  }
  catch {
    return 'unknown'
  }
}

// Helper: Determine aggregation period
function determinePeriod(startDate: Date, endDate: Date): AggregationPeriod {
  const diffMs = endDate.getTime() - startDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  if (diffDays <= 2) return 'hour'
  if (diffDays <= 90) return 'day'
  return 'month'
}

// Helper: Marshal page view for DynamoDB
function marshalPageView(pv: PageView): Record<string, { S: string } | { N: string } | { BOOL: boolean }> {
  return {
    pk: { S: `SITE#${pv.siteId}` },
    sk: { S: `PAGEVIEW#${pv.timestamp.toISOString()}#${pv.id}` },
    gsi1pk: { S: `SITE#${pv.siteId}#DATE#${pv.timestamp.toISOString().slice(0, 10)}` },
    gsi1sk: { S: `PATH#${pv.path}` },
    gsi2pk: { S: `SITE#${pv.siteId}#VISITOR#${pv.visitorId}` },
    gsi2sk: { S: pv.timestamp.toISOString() },
    id: { S: pv.id },
    siteId: { S: pv.siteId },
    visitorId: { S: pv.visitorId },
    sessionId: { S: pv.sessionId },
    path: { S: pv.path },
    hostname: { S: pv.hostname },
    ...(pv.title && { title: { S: pv.title } }),
    ...(pv.referrer && { referrer: { S: pv.referrer } }),
    ...(pv.referrerSource && { referrerSource: { S: pv.referrerSource } }),
    ...(pv.utmSource && { utmSource: { S: pv.utmSource } }),
    ...(pv.utmMedium && { utmMedium: { S: pv.utmMedium } }),
    ...(pv.utmCampaign && { utmCampaign: { S: pv.utmCampaign } }),
    ...(pv.deviceType && { deviceType: { S: pv.deviceType } }),
    ...(pv.browser && { browser: { S: pv.browser } }),
    ...(pv.os && { os: { S: pv.os } }),
    ...(pv.screenWidth && { screenWidth: { N: String(pv.screenWidth) } }),
    ...(pv.screenHeight && { screenHeight: { N: String(pv.screenHeight) } }),
    isUnique: { BOOL: pv.isUnique },
    isBounce: { BOOL: pv.isBounce },
    timestamp: { S: pv.timestamp.toISOString() },
  }
}

// Helper: Marshal session for DynamoDB
function marshalSession(s: Session): Record<string, { S: string } | { N: string } | { BOOL: boolean }> {
  return {
    pk: { S: `SITE#${s.siteId}` },
    sk: { S: `SESSION#${s.id}` },
    gsi1pk: { S: `SITE#${s.siteId}#SESSIONS#${s.startedAt.toISOString().slice(0, 10)}` },
    gsi1sk: { S: s.id },
    id: { S: s.id },
    siteId: { S: s.siteId },
    visitorId: { S: s.visitorId },
    entryPath: { S: s.entryPath },
    exitPath: { S: s.exitPath },
    ...(s.referrer && { referrer: { S: s.referrer } }),
    ...(s.referrerSource && { referrerSource: { S: s.referrerSource } }),
    ...(s.utmSource && { utmSource: { S: s.utmSource } }),
    ...(s.utmMedium && { utmMedium: { S: s.utmMedium } }),
    ...(s.utmCampaign && { utmCampaign: { S: s.utmCampaign } }),
    ...(s.deviceType && { deviceType: { S: s.deviceType } }),
    ...(s.browser && { browser: { S: s.browser } }),
    ...(s.os && { os: { S: s.os } }),
    pageViewCount: { N: String(s.pageViewCount) },
    eventCount: { N: String(s.eventCount) },
    isBounce: { BOOL: s.isBounce },
    duration: { N: String(s.duration) },
    startedAt: { S: s.startedAt.toISOString() },
    endedAt: { S: s.endedAt.toISOString() },
  }
}

// Create router
const router = new Router({ verbose: true })

// Add CORS middleware
await router.use(cors({
  origin: CORS_ORIGINS.includes('*') ? '*' : CORS_ORIGINS,
  methods: ['GET', 'POST', 'OPTIONS'],
  headers: ['Content-Type', 'Authorization'],
}))

// Health check
await router.get('/health', async () => {
  return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() })
})

// POST /collect - Receive tracking events
await router.post('/collect', async (req) => {
  try {
    const payload = await req.json() as {
      s: string // siteId
      sid: string // sessionId
      e: 'pageview' | 'event' | 'outbound'
      p?: Record<string, unknown>
      u: string // url
      r?: string // referrer
      t?: string // title
      sw?: number // screen width
      sh?: number // screen height
    }

    if (!payload?.s || !payload?.e || !payload?.u) {
      return jsonResponse({ error: 'Missing required fields: s, e, u' }, { status: 400 })
    }

    // Get visitor ID (privacy-preserving hash)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('cf-connecting-ip') || 'unknown'
    const userAgent = req.headers.get('user-agent') || 'unknown'
    const salt = getDailySalt()
    const visitorId = await hashVisitorId(ip, userAgent, payload.s, salt)

    // Parse URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(payload.u)
    }
    catch {
      return jsonResponse({ error: 'Invalid URL' }, { status: 400 })
    }

    const timestamp = new Date()
    const sessionId = payload.sid

    // Get or create session
    const sessionKey = `${payload.s}:${sessionId}`
    let session = getSession(sessionKey)
    const isNewSession = !session

    if (payload.e === 'pageview') {
      const deviceInfo = parseUserAgent(userAgent)
      const referrerSource = parseReferrerSource(payload.r)

      const pageView: PageView = {
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        path: parsedUrl.pathname,
        hostname: parsedUrl.hostname,
        title: payload.t,
        referrer: payload.r,
        referrerSource,
        utmSource: parsedUrl.searchParams.get('utm_source') || undefined,
        utmMedium: parsedUrl.searchParams.get('utm_medium') || undefined,
        utmCampaign: parsedUrl.searchParams.get('utm_campaign') || undefined,
        utmContent: parsedUrl.searchParams.get('utm_content') || undefined,
        utmTerm: parsedUrl.searchParams.get('utm_term') || undefined,
        deviceType: deviceInfo.deviceType,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        screenWidth: payload.sw,
        screenHeight: payload.sh,
        isUnique: isNewSession,
        isBounce: isNewSession,
        timestamp,
      }

      // Store page view
      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshalPageView(pageView),
      })

      // Update session
      if (session) {
        session.pageViewCount += 1
        session.exitPath = parsedUrl.pathname
        session.endedAt = timestamp
        session.isBounce = false
        session.duration = timestamp.getTime() - session.startedAt.getTime()
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
          utmSource: parsedUrl.searchParams.get('utm_source') || undefined,
          utmMedium: parsedUrl.searchParams.get('utm_medium') || undefined,
          utmCampaign: parsedUrl.searchParams.get('utm_campaign') || undefined,
          deviceType: deviceInfo.deviceType,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          pageViewCount: 1,
          eventCount: 0,
          isBounce: true,
          duration: 0,
          startedAt: timestamp,
          endedAt: timestamp,
        }
      }

      // Store session
      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshalSession(session),
      })

      setSession(sessionKey, session)

      // Update realtime stats
      const minute = timestamp.toISOString().slice(0, 16)
      const ttl = Math.floor(Date.now() / 1000) + 600 // 10 min TTL

      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: {
          pk: { S: `SITE#${payload.s}` },
          sk: { S: `REALTIME#${minute}` },
        },
        UpdateExpression: 'SET pageViews = if_not_exists(pageViews, :zero) + :one, #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':zero': { N: '0' },
          ':one': { N: '1' },
          ':ttl': { N: String(ttl) },
        },
      })
    }
    else if (payload.e === 'event') {
      // Custom event
      const eventProps = payload.p || {}
      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: {
          pk: { S: `SITE#${payload.s}` },
          sk: { S: `EVENT#${timestamp.toISOString()}#${generateId()}` },
          gsi1pk: { S: `SITE#${payload.s}#EVENTNAME#${String(eventProps.name || 'unknown')}` },
          gsi1sk: { S: timestamp.toISOString() },
          siteId: { S: payload.s },
          visitorId: { S: visitorId },
          sessionId: { S: sessionId },
          name: { S: String(eventProps.name || 'unknown') },
          ...(eventProps.value && { value: { N: String(eventProps.value) } }),
          path: { S: parsedUrl.pathname },
          timestamp: { S: timestamp.toISOString() },
        },
      })

      if (session) {
        session.eventCount += 1
        session.endedAt = timestamp
        await dynamodb.putItem({
          TableName: TABLE_NAME,
          Item: marshalSession(session),
        })
        setSession(sessionKey, session)
      }
    }

    return new Response(null, { status: 204 })
  }
  catch (error) {
    console.error('Collect error:', error)
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
})

// GET /sites/:siteId/stats - Get dashboard stats
await router.get('/sites/{siteId}/stats', async (req) => {
  try {
    const siteId = req.params.siteId
    const url = new URL(req.url)
    const start = url.searchParams.get('start')
    const end = url.searchParams.get('end')

    if (!siteId) {
      return jsonResponse({ error: 'Missing siteId' }, { status: 400 })
    }

    const startDate = start ? new Date(start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const endDate = end ? new Date(end) : new Date()
    const period = determinePeriod(startDate, endDate)

    // Query aggregated stats
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: `STATS#${period.toUpperCase()}` },
      },
    })

    return jsonResponse({
      stats: result.Items?.map(item => DynamoDBClient.unmarshal(item)) || [],
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        period,
      },
    })
  }
  catch (error) {
    console.error('Stats error:', error)
    return jsonResponse({ error: 'Failed to get stats' }, { status: 500 })
  }
})

// GET /sites/:siteId/realtime - Get realtime stats
await router.get('/sites/{siteId}/realtime', async (req) => {
  try {
    const siteId = req.params.siteId
    const url = new URL(req.url)
    const minutes = Number.parseInt(url.searchParams.get('minutes') || '5', 10)

    if (!siteId) {
      return jsonResponse({ error: 'Missing siteId' }, { status: 400 })
    }

    const now = new Date()
    const startMinute = new Date(now.getTime() - minutes * 60 * 1000)

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :skStart AND :skEnd',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skStart': { S: `REALTIME#${startMinute.toISOString().slice(0, 16)}` },
        ':skEnd': { S: `REALTIME#${now.toISOString().slice(0, 16)}` },
      },
    })

    // Aggregate realtime data
    let totalPageViews = 0
    const items = result.Items || []
    for (const item of items) {
      const unmarshalled = DynamoDBClient.unmarshal(item)
      totalPageViews += unmarshalled.pageViews || 0
    }

    return jsonResponse({
      currentVisitors: Math.min(totalPageViews, items.length * 2), // Rough estimate
      pageViews: totalPageViews,
      timestamp: now.toISOString(),
      minutes,
    })
  }
  catch (error) {
    console.error('Realtime error:', error)
    return jsonResponse({ error: 'Failed to get realtime stats' }, { status: 500 })
  }
})

// GET /sites/:siteId/script - Get tracking script
await router.get('/sites/{siteId}/script', async (req) => {
  const siteId = req.params.siteId
  const url = new URL(req.url)
  const apiEndpoint = url.searchParams.get('api') || `${url.protocol}//${url.host}`
  const minimal = url.searchParams.get('minimal') === 'true'

  if (!siteId) {
    return jsonResponse({ error: 'Missing siteId' }, { status: 400 })
  }

  const script = minimal
    ? generateMinimalTrackingScript({
        siteId,
        apiEndpoint: apiEndpoint.startsWith('http') ? apiEndpoint : `https://${apiEndpoint}`,
        honorDnt: true,
      })
    : generateTrackingScript({
        siteId,
        apiEndpoint: apiEndpoint.startsWith('http') ? apiEndpoint : `https://${apiEndpoint}`,
        honorDnt: true,
        trackOutboundLinks: true,
      })

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
    },
  })
})

// GET /sites - List sites
await router.get('/sites', async (req) => {
  try {
    const url = new URL(req.url)
    const ownerId = url.searchParams.get('ownerId') || 'default'

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `OWNER#${ownerId}` },
      },
    })

    return jsonResponse({
      sites: result.Items?.map(item => DynamoDBClient.unmarshal(item)) || [],
    })
  }
  catch (error) {
    console.error('List sites error:', error)
    return jsonResponse({ error: 'Failed to list sites' }, { status: 500 })
  }
})

// POST /sites - Create a site
await router.post('/sites', async (req) => {
  try {
    const body = await req.json() as { name: string; domains: string[]; ownerId?: string }

    if (!body.name || !body.domains?.length) {
      return jsonResponse({ error: 'Missing required fields: name, domains' }, { status: 400 })
    }

    const siteId = generateId()
    const now = new Date()
    const ownerId = body.ownerId || 'default'

    const site = {
      id: siteId,
      name: body.name,
      domains: body.domains,
      timezone: 'UTC',
      isActive: true,
      ownerId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: {
        pk: { S: `SITE#${siteId}` },
        sk: { S: `SITE#${siteId}` },
        gsi1pk: { S: `OWNER#${ownerId}` },
        gsi1sk: { S: `SITE#${siteId}` },
        id: { S: siteId },
        name: { S: body.name },
        domains: { L: body.domains.map(d => ({ S: d })) },
        timezone: { S: 'UTC' },
        isActive: { BOOL: true },
        ownerId: { S: ownerId },
        createdAt: { S: now.toISOString() },
        updatedAt: { S: now.toISOString() },
      },
    })

    return jsonResponse({ site }, { status: 201 })
  }
  catch (error) {
    console.error('Create site error:', error)
    return jsonResponse({ error: 'Failed to create site' }, { status: 500 })
  }
})

// GET /sites/:siteId - Get site details
await router.get('/sites/{siteId}', async (req) => {
  try {
    const siteId = req.params.siteId

    if (!siteId) {
      return jsonResponse({ error: 'Missing siteId' }, { status: 400 })
    }

    const result = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: `SITE#${siteId}` },
        sk: { S: `SITE#${siteId}` },
      },
    })

    if (!result.Item) {
      return jsonResponse({ error: 'Site not found' }, { status: 404 })
    }

    return jsonResponse({ site: DynamoDBClient.unmarshal(result.Item) })
  }
  catch (error) {
    console.error('Get site error:', error)
    return jsonResponse({ error: 'Failed to get site' }, { status: 500 })
  }
})

// Start server
console.log(`Starting ts-analytics API server...`)
console.log(`Table: ${TABLE_NAME}`)
console.log(`Region: ${REGION}`)
console.log(`Port: ${PORT}`)
console.log(`CORS: ${CORS_ORIGINS.join(', ')}`)

await router.serve({ port: PORT })
console.log(`\nts-analytics API running at http://localhost:${PORT}`)
