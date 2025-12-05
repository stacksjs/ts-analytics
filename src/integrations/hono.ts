/**
 * Hono Integration for Analytics
 *
 * Middleware and route handlers for Hono framework.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { analyticsMiddleware, analyticsRoutes } from '@stacksjs/analytics/integrations/hono'
 *
 * const app = new Hono()
 * app.use('*', analyticsMiddleware())
 * app.route('/api/analytics', analyticsRoutes())
 * ```
 */

import type { AnalyticsConfig } from '../config'
import { getConfig } from '../config'
import {
  generateId,
  getDailySalt,
  getPeriodStart,
  hashVisitorId,
  KeyPatterns,
} from '../dynamodb'
import type { AggregationPeriod, PageView, Session } from '../types'

// ============================================================================
// Types
// ============================================================================

interface HonoContext {
  req: {
    url: string
    method: string
    header: (name: string) => string | undefined
    param: (name: string) => string | undefined
    query: (name: string) => string | undefined
    json: <T>() => Promise<T>
  }
  json: (data: unknown, status?: number) => Response
  text: (data: string, status?: number) => Response
  body: (data: unknown, status?: number) => Response
  set: (name: string, value: string) => void
  get: (name: string) => unknown
}

type HonoMiddleware = (c: HonoContext, next: () => Promise<void>) => Promise<Response | void>

interface HonoApp {
  use: (path: string, ...handlers: HonoMiddleware[]) => void
  get: (path: string, handler: (c: HonoContext) => Promise<Response> | Response) => void
  post: (path: string, handler: (c: HonoContext) => Promise<Response> | Response) => void
  options: (path: string, handler: (c: HonoContext) => Promise<Response> | Response) => void
}

export interface AnalyticsMiddlewareOptions {
  /** Skip analytics for certain paths */
  skipPaths?: string[]
  /** Custom visitor ID generator */
  getVisitorId?: (c: HonoContext) => Promise<string>
  /** Store for sessions */
  sessionStore?: SessionStore
  /** DynamoDB command executor */
  executeCommand: (cmd: DynamoCommand) => Promise<unknown>
}

interface SessionStore {
  get: (key: string) => Promise<Session | null>
  set: (key: string, session: Session, ttlSeconds?: number) => Promise<void>
}

interface DynamoCommand {
  command: string
  input: Record<string, unknown>
}

interface CollectPayload {
  s: string // siteId
  sid: string // sessionId
  e: 'pageview' | 'event' | 'outbound'
  p?: Record<string, unknown> // properties
  u: string // url
  r?: string // referrer
  t?: string // title
  sw?: number // screen width
  sh?: number // screen height
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Create analytics middleware for Hono
 *
 * Adds analytics context to requests and handles CORS.
 */
export function analyticsMiddleware(options?: Partial<AnalyticsMiddlewareOptions>): HonoMiddleware {
  const config = getConfig()

  return async (c, next) => {
    // Add CORS headers
    const origin = c.req.header('Origin')
    const allowedOrigin = config.api.corsOrigins.includes('*')
      ? '*'
      : (origin && config.api.corsOrigins.includes(origin) ? origin : config.api.corsOrigins[0])

    c.set('Access-Control-Allow-Origin', allowedOrigin || '*')
    c.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    c.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    // Handle preflight
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204)
    }

    // Skip certain paths
    if (options?.skipPaths) {
      const url = new URL(c.req.url)
      for (const skipPath of options.skipPaths) {
        if (url.pathname.startsWith(skipPath)) {
          return next()
        }
      }
    }

    // Add analytics context
    c.set('analyticsConfig', config)
    c.set('analyticsSalt', getDailySalt())

    await next()
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * Create analytics routes for Hono
 */
export function createAnalyticsRoutes(options: AnalyticsMiddlewareOptions): {
  collect: (c: HonoContext) => Promise<Response>
  stats: (c: HonoContext) => Promise<Response>
  realtime: (c: HonoContext) => Promise<Response>
  script: (c: HonoContext) => Response
  sites: (c: HonoContext) => Promise<Response>
  createSite: (c: HonoContext) => Promise<Response>
} {
  const config = getConfig()
  const { executeCommand, sessionStore } = options

  return {
    /**
     * POST /collect - Receive tracking events
     */
    async collect(c) {
      try {
        const payload = await c.req.json<CollectPayload>()

        if (!payload?.s || !payload?.e || !payload?.u) {
          return c.json({ error: 'Missing required fields: s, e, u' }, 400)
        }

        // Get visitor ID
        const ip = c.req.header('X-Forwarded-For') || c.req.header('CF-Connecting-IP') || 'unknown'
        const userAgent = c.req.header('User-Agent') || 'unknown'
        const salt = getDailySalt()

        const visitorId = options.getVisitorId
          ? await options.getVisitorId(c)
          : await hashVisitorId(ip, userAgent, payload.s, salt)

        // Parse URL
        let parsedUrl: URL
        try {
          parsedUrl = new URL(payload.u)
        }
        catch {
          return c.json({ error: 'Invalid URL' }, 400)
        }

        const timestamp = new Date()
        const sessionId = payload.sid

        // Get or create session
        let session = sessionStore ? await sessionStore.get(`${payload.s}:${sessionId}`) : null
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
          await executeCommand({
            command: 'PutItem',
            input: {
              TableName: config.table.tableName,
              Item: marshalPageView(pageView),
            },
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
          await executeCommand({
            command: 'PutItem',
            input: {
              TableName: config.table.tableName,
              Item: marshalSession(session),
            },
          })

          if (sessionStore) {
            await sessionStore.set(`${payload.s}:${sessionId}`, session, 1800)
          }
        }

        return c.body(null, 204)
      }
      catch (error) {
        console.error('Collect error:', error)
        return c.json({ error: 'Internal server error' }, 500)
      }
    },

    /**
     * GET /sites/:siteId/stats - Get dashboard stats
     */
    async stats(c) {
      try {
        const siteId = c.req.param('siteId')
        const start = c.req.query('start')
        const end = c.req.query('end')

        if (!siteId) {
          return c.json({ error: 'Missing siteId' }, 400)
        }

        const startDate = start ? new Date(start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const endDate = end ? new Date(end) : new Date()
        const period = determinePeriod(startDate, endDate)
        const periodStart = getPeriodStart(endDate, period)

        const result = await executeCommand({
          command: 'Query',
          input: {
            TableName: config.table.tableName,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
            ExpressionAttributeValues: {
              ':pk': { S: KeyPatterns.site.pk(siteId) },
              ':skPrefix': { S: `STATS#${period.toUpperCase()}` },
            },
          },
        }) as { Items?: unknown[] }

        return c.json({
          stats: result.Items || [],
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            period,
          },
        })
      }
      catch (error) {
        console.error('Stats error:', error)
        return c.json({ error: 'Failed to get stats' }, 500)
      }
    },

    /**
     * GET /sites/:siteId/realtime - Get realtime stats
     */
    async realtime(c) {
      try {
        const siteId = c.req.param('siteId')
        const minutes = Number.parseInt(c.req.query('minutes') || '5', 10)

        if (!siteId) {
          return c.json({ error: 'Missing siteId' }, 400)
        }

        const now = new Date()
        const startMinute = new Date(now.getTime() - minutes * 60 * 1000)

        const result = await executeCommand({
          command: 'Query',
          input: {
            TableName: config.table.tableName,
            KeyConditionExpression: 'pk = :pk AND sk BETWEEN :skStart AND :skEnd',
            ExpressionAttributeValues: {
              ':pk': { S: KeyPatterns.site.pk(siteId) },
              ':skStart': { S: KeyPatterns.realtime.sk(startMinute.toISOString().slice(0, 16)) },
              ':skEnd': { S: KeyPatterns.realtime.sk(now.toISOString().slice(0, 16)) },
            },
          },
        }) as { Items?: unknown[] }

        return c.json({
          realtime: result.Items || [],
          timestamp: now.toISOString(),
        })
      }
      catch (error) {
        console.error('Realtime error:', error)
        return c.json({ error: 'Failed to get realtime stats' }, 500)
      }
    },

    /**
     * GET /sites/:siteId/script - Get tracking script
     */
    script(c) {
      const siteId = c.req.param('siteId')
      const apiEndpoint = c.req.query('api') || `${c.req.header('Host')}${config.api.basePath}`

      if (!siteId) {
        return c.json({ error: 'Missing siteId' }, 400)
      }

      const script = generateTrackingScript(siteId, apiEndpoint)

      c.set('Content-Type', 'text/html')
      c.set('Cache-Control', 'public, max-age=3600')
      return c.text(script)
    },

    /**
     * GET /sites - List sites
     */
    async sites(c) {
      try {
        const ownerId = c.req.query('ownerId') || 'default'

        const result = await executeCommand({
          command: 'Query',
          input: {
            TableName: config.table.tableName,
            IndexName: 'gsi1',
            KeyConditionExpression: 'gsi1pk = :pk',
            ExpressionAttributeValues: {
              ':pk': { S: `OWNER#${ownerId}` },
            },
          },
        }) as { Items?: unknown[] }

        return c.json({ sites: result.Items || [] })
      }
      catch (error) {
        console.error('List sites error:', error)
        return c.json({ error: 'Failed to list sites' }, 500)
      }
    },

    /**
     * POST /sites - Create a site
     */
    async createSite(c) {
      try {
        const body = await c.req.json<{ name: string, domains: string[], ownerId?: string }>()

        if (!body.name || !body.domains?.length) {
          return c.json({ error: 'Missing required fields: name, domains' }, 400)
        }

        const siteId = generateId()
        const now = new Date()

        const site = {
          id: siteId,
          name: body.name,
          domains: body.domains,
          timezone: 'UTC',
          isActive: true,
          ownerId: body.ownerId || 'default',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }

        await executeCommand({
          command: 'PutItem',
          input: {
            TableName: config.table.tableName,
            Item: {
              pk: { S: KeyPatterns.site.pk(siteId) },
              sk: { S: KeyPatterns.site.sk(siteId) },
              gsi1pk: { S: KeyPatterns.site.gsi1pk(site.ownerId) },
              gsi1sk: { S: KeyPatterns.site.gsi1sk(siteId) },
              ...marshalSite(site),
            },
          },
        })

        return c.json({ site }, 201)
      }
      catch (error) {
        console.error('Create site error:', error)
        return c.json({ error: 'Failed to create site' }, 500)
      }
    },
  }
}

/**
 * Mount analytics routes on a Hono app
 */
export function mountAnalyticsRoutes(app: HonoApp, basePath: string, options: AnalyticsMiddlewareOptions): void {
  const routes = createAnalyticsRoutes(options)

  app.post(`${basePath}/collect`, routes.collect)
  app.get(`${basePath}/sites/:siteId/stats`, routes.stats)
  app.get(`${basePath}/sites/:siteId/realtime`, routes.realtime)
  app.get(`${basePath}/sites/:siteId/script`, routes.script)
  app.get(`${basePath}/sites`, routes.sites)
  app.post(`${basePath}/sites`, routes.createSite)
}

// ============================================================================
// Helpers
// ============================================================================

function determinePeriod(startDate: Date, endDate: Date): AggregationPeriod {
  const diffMs = endDate.getTime() - startDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  if (diffDays <= 2) return 'hour'
  if (diffDays <= 90) return 'day'
  return 'month'
}

function parseUserAgent(ua: string): { deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown', browser: string, os: string } {
  const deviceType = /mobile/i.test(ua) ? 'mobile' : /tablet/i.test(ua) ? 'tablet' : 'desktop'

  let browser = 'Unknown'
  if (ua.includes('Chrome')) browser = 'Chrome'
  else if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Safari')) browser = 'Safari'
  else if (ua.includes('Edge')) browser = 'Edge'

  let os = 'Unknown'
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac')) os = 'macOS'
  else if (ua.includes('Linux')) os = 'Linux'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iOS') || ua.includes('iPhone')) os = 'iOS'

  return { deviceType, browser, os }
}

function parseReferrerSource(referrer?: string): string | undefined {
  if (!referrer) return 'direct'
  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()
    if (host.includes('google')) return 'google'
    if (host.includes('bing')) return 'bing'
    if (host.includes('twitter') || host.includes('x.com')) return 'twitter'
    if (host.includes('facebook')) return 'facebook'
    if (host.includes('linkedin')) return 'linkedin'
    return host
  }
  catch {
    return undefined
  }
}

function generateTrackingScript(siteId: string, apiEndpoint: string): string {
  return `<script>
(function(w,d,s,a){
  w.analytics=w.analytics||function(){(w.analytics.q=w.analytics.q||[]).push(arguments)};
  var f=d.getElementsByTagName(s)[0],j=d.createElement(s);
  j.async=1;j.src='${apiEndpoint}/sites/${siteId}/script.js';
  f.parentNode.insertBefore(j,f);
})(window,document,'script');
analytics('init','${siteId}');
analytics('track','pageview');
</script>`
}

function marshalPageView(pv: PageView): Record<string, { S: string } | { N: string } | { BOOL: boolean }> {
  return {
    pk: { S: KeyPatterns.pageView.pk(pv.siteId) },
    sk: { S: KeyPatterns.pageView.sk(pv.timestamp, pv.id) },
    id: { S: pv.id },
    siteId: { S: pv.siteId },
    visitorId: { S: pv.visitorId },
    sessionId: { S: pv.sessionId },
    path: { S: pv.path },
    hostname: { S: pv.hostname },
    ...(pv.title && { title: { S: pv.title } }),
    ...(pv.referrer && { referrer: { S: pv.referrer } }),
    ...(pv.referrerSource && { referrerSource: { S: pv.referrerSource } }),
    ...(pv.deviceType && { deviceType: { S: pv.deviceType } }),
    ...(pv.browser && { browser: { S: pv.browser } }),
    ...(pv.os && { os: { S: pv.os } }),
    isUnique: { BOOL: pv.isUnique },
    isBounce: { BOOL: pv.isBounce },
    timestamp: { S: pv.timestamp.toISOString() },
  }
}

function marshalSession(s: Session): Record<string, { S: string } | { N: string } | { BOOL: boolean }> {
  return {
    pk: { S: KeyPatterns.session.pk(s.siteId) },
    sk: { S: KeyPatterns.session.sk(s.id) },
    id: { S: s.id },
    siteId: { S: s.siteId },
    visitorId: { S: s.visitorId },
    entryPath: { S: s.entryPath },
    exitPath: { S: s.exitPath },
    ...(s.referrer && { referrer: { S: s.referrer } }),
    ...(s.referrerSource && { referrerSource: { S: s.referrerSource } }),
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

function marshalSite(site: Record<string, unknown>): Record<string, { S: string } | { L: Array<{ S: string }> } | { BOOL: boolean }> {
  return {
    id: { S: site.id as string },
    name: { S: site.name as string },
    domains: { L: (site.domains as string[]).map(d => ({ S: d })) },
    timezone: { S: site.timezone as string },
    isActive: { BOOL: site.isActive as boolean },
    ownerId: { S: site.ownerId as string },
    createdAt: { S: site.createdAt as string },
    updatedAt: { S: site.updatedAt as string },
  }
}
