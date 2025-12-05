/**
 * Cloudflare Workers Integration for Analytics
 *
 * Edge-optimized analytics handler for Cloudflare Workers.
 * Uses Cloudflare D1, KV, or external DynamoDB for storage.
 *
 * @example
 * ```ts
 * import { createAnalyticsHandler } from '@stacksjs/analytics/integrations/cloudflare'
 *
 * export default {
 *   fetch: createAnalyticsHandler({
 *     storage: env.D1_DATABASE,
 *     sessionKV: env.SESSIONS_KV,
 *   }),
 * }
 * ```
 */

import type { AggregationPeriod, PageView, Session } from '../types'
import { getConfig, setConfig } from '../config'
import {
  generateId,
  getDailySalt,
  getPeriodStart,
  hashVisitorId,
  KeyPatterns,
} from '../dynamodb'

// ============================================================================
// Types
// ============================================================================

export interface CloudflareEnv {
  /** DynamoDB endpoint (for external DynamoDB) */
  DYNAMODB_ENDPOINT?: string
  /** AWS Region */
  AWS_REGION?: string
  /** AWS Access Key ID */
  AWS_ACCESS_KEY_ID?: string
  /** AWS Secret Access Key */
  AWS_SECRET_ACCESS_KEY?: string
  /** KV Namespace for sessions */
  SESSIONS_KV?: KVNamespace
  /** D1 Database (optional, for D1 storage) */
  D1_DATABASE?: D1Database
  /** Table name */
  TABLE_NAME?: string
}

interface KVNamespace {
  get: (key: string, options?: { type?: string }) => Promise<string | null>
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>
  delete: (key: string) => Promise<void>
}

interface D1Database {
  prepare: (sql: string) => D1PreparedStatement
  exec: (sql: string) => Promise<D1ExecResult>
  batch: <T>(statements: D1PreparedStatement[]) => Promise<D1Result<T>[]>
}

interface D1PreparedStatement {
  bind: (...values: unknown[]) => D1PreparedStatement
  first: <T>() => Promise<T | null>
  all: <T>() => Promise<D1Result<T>>
  run: () => Promise<D1Result<unknown>>
}

interface D1Result<T> {
  results?: T[]
  success: boolean
  meta?: Record<string, unknown>
}

interface D1ExecResult {
  count: number
  duration: number
}

export interface CloudflareHandlerOptions {
  /** CORS allowed origins */
  corsOrigins?: string[]
  /** Base path for analytics routes */
  basePath?: string
  /** Session TTL in seconds */
  sessionTtl?: number
  /** Custom storage adapter */
  storage?: StorageAdapter
}

export interface StorageAdapter {
  putItem: (tableName: string, item: Record<string, unknown>) => Promise<void>
  query: (tableName: string, params: QueryParams) => Promise<QueryResult>
}

interface QueryParams {
  pk: string
  skPrefix?: string
  skStart?: string
  skEnd?: string
  indexName?: string
  limit?: number
}

interface QueryResult {
  items: Record<string, unknown>[]
  lastKey?: string
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
// Main Handler
// ============================================================================

/**
 * Create a Cloudflare Workers fetch handler for analytics
 */
export function createAnalyticsHandler(options: CloudflareHandlerOptions = {}): (
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContext,
) => Promise<Response> {
  const corsOrigins = options.corsOrigins ?? ['*']
  const basePath = options.basePath ?? '/api/analytics'
  const sessionTtl = options.sessionTtl ?? 1800

  return async (request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(corsOrigins, request)
    }

    // Set up config from environment
    setConfig({
      table: { tableName: env.TABLE_NAME ?? 'AnalyticsTable' },
      region: env.AWS_REGION ?? 'us-east-1',
      endpoint: env.DYNAMODB_ENDPOINT,
    })

    const storage = options.storage ?? createDynamoDBAdapter(env)
    const sessionStore = env.SESSIONS_KV ? createKVSessionStore(env.SESSIONS_KV, sessionTtl) : null

    // Route handling
    if (path === `${basePath}/collect` && request.method === 'POST') {
      return handleCollect(request, env, storage, sessionStore)
    }

    if (path.startsWith(`${basePath}/sites/`) && path.endsWith('/stats') && request.method === 'GET') {
      const siteId = extractSiteId(path, basePath, '/stats')
      return handleStats(url, siteId, storage)
    }

    if (path.startsWith(`${basePath}/sites/`) && path.endsWith('/realtime') && request.method === 'GET') {
      const siteId = extractSiteId(path, basePath, '/realtime')
      return handleRealtime(url, siteId, storage)
    }

    if (path.startsWith(`${basePath}/sites/`) && path.endsWith('/script') && request.method === 'GET') {
      const siteId = extractSiteId(path, basePath, '/script')
      return handleScript(url, siteId, basePath)
    }

    if (path === `${basePath}/sites` && request.method === 'GET') {
      return handleListSites(url, storage)
    }

    if (path === `${basePath}/sites` && request.method === 'POST') {
      return handleCreateSite(request, storage)
    }

    return new Response('Not Found', { status: 404 })
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

async function handleCollect(
  request: Request,
  env: CloudflareEnv,
  storage: StorageAdapter,
  sessionStore: SessionStore | null,
): Promise<Response> {
  try {
    const payload = await request.json<CollectPayload>()

    if (!payload?.s || !payload?.e || !payload?.u) {
      return jsonResponse({ error: 'Missing required fields: s, e, u' }, 400)
    }

    const config = getConfig()
    const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown'
    const userAgent = request.headers.get('User-Agent') ?? 'unknown'
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
      await storage.putItem(config.table.tableName, {
        pk: KeyPatterns.pageView.pk(pageView.siteId),
        sk: KeyPatterns.pageView.sk(pageView.timestamp, pageView.id),
        ...pageView,
        timestamp: pageView.timestamp.toISOString(),
      })

      // Update session
      if (session) {
        session.pageViewCount += 1
        session.exitPath = parsedUrl.pathname
        session.endedAt = timestamp
        session.isBounce = false
        session.duration = timestamp.getTime() - new Date(session.startedAt).getTime()
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
      await storage.putItem(config.table.tableName, {
        pk: KeyPatterns.session.pk(session.siteId),
        sk: KeyPatterns.session.sk(session.id),
        ...session,
        startedAt: session.startedAt instanceof Date ? session.startedAt.toISOString() : session.startedAt,
        endedAt: session.endedAt instanceof Date ? session.endedAt.toISOString() : session.endedAt,
      })

      if (sessionStore) {
        await sessionStore.set(`${payload.s}:${sessionId}`, session)
      }
    }

    return new Response(null, { status: 204 })
  }
  catch (error) {
    console.error('Collect error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

async function handleStats(
  url: URL,
  siteId: string,
  storage: StorageAdapter,
): Promise<Response> {
  try {
    if (!siteId) {
      return jsonResponse({ error: 'Missing siteId' }, 400)
    }

    const config = getConfig()
    const start = url.searchParams.get('start')
    const end = url.searchParams.get('end')

    const startDate = start ? new Date(start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const endDate = end ? new Date(end) : new Date()
    const period = determinePeriod(startDate, endDate)

    const result = await storage.query(config.table.tableName, {
      pk: KeyPatterns.site.pk(siteId),
      skPrefix: `STATS#${period.toUpperCase()}`,
    })

    return jsonResponse({
      stats: result.items,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        period,
      },
    })
  }
  catch (error) {
    console.error('Stats error:', error)
    return jsonResponse({ error: 'Failed to get stats' }, 500)
  }
}

async function handleRealtime(
  url: URL,
  siteId: string,
  storage: StorageAdapter,
): Promise<Response> {
  try {
    if (!siteId) {
      return jsonResponse({ error: 'Missing siteId' }, 400)
    }

    const config = getConfig()
    const minutes = Number.parseInt(url.searchParams.get('minutes') ?? '5', 10)

    const now = new Date()
    const startMinute = new Date(now.getTime() - minutes * 60 * 1000)

    const result = await storage.query(config.table.tableName, {
      pk: KeyPatterns.site.pk(siteId),
      skStart: KeyPatterns.realtime.sk(startMinute.toISOString().slice(0, 16)),
      skEnd: KeyPatterns.realtime.sk(now.toISOString().slice(0, 16)),
    })

    return jsonResponse({
      realtime: result.items,
      timestamp: now.toISOString(),
    })
  }
  catch (error) {
    console.error('Realtime error:', error)
    return jsonResponse({ error: 'Failed to get realtime stats' }, 500)
  }
}

function handleScript(url: URL, siteId: string, basePath: string): Response {
  if (!siteId) {
    return jsonResponse({ error: 'Missing siteId' }, 400)
  }

  const apiEndpoint = url.searchParams.get('api') ?? `${url.origin}${basePath}`
  const script = generateTrackingScript(siteId, apiEndpoint)

  return new Response(script, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

async function handleListSites(url: URL, storage: StorageAdapter): Promise<Response> {
  try {
    const config = getConfig()
    const ownerId = url.searchParams.get('ownerId') ?? 'default'

    const result = await storage.query(config.table.tableName, {
      pk: `OWNER#${ownerId}`,
      indexName: 'gsi1',
    })

    return jsonResponse({ sites: result.items })
  }
  catch (error) {
    console.error('List sites error:', error)
    return jsonResponse({ error: 'Failed to list sites' }, 500)
  }
}

async function handleCreateSite(request: Request, storage: StorageAdapter): Promise<Response> {
  try {
    const config = getConfig()
    const body = await request.json<{ name: string, domains: string[], ownerId?: string }>()

    if (!body.name || !body.domains?.length) {
      return jsonResponse({ error: 'Missing required fields: name, domains' }, 400)
    }

    const siteId = generateId()
    const now = new Date()

    const site = {
      pk: KeyPatterns.site.pk(siteId),
      sk: KeyPatterns.site.sk(siteId),
      gsi1pk: KeyPatterns.site.gsi1pk(body.ownerId ?? 'default'),
      gsi1sk: KeyPatterns.site.gsi1sk(siteId),
      id: siteId,
      name: body.name,
      domains: body.domains,
      timezone: 'UTC',
      isActive: true,
      ownerId: body.ownerId ?? 'default',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    await storage.putItem(config.table.tableName, site)

    return jsonResponse({ site }, 201)
  }
  catch (error) {
    console.error('Create site error:', error)
    return jsonResponse({ error: 'Failed to create site' }, 500)
  }
}

// ============================================================================
// Storage Adapters
// ============================================================================

interface SessionStore {
  get: (key: string) => Promise<Session | null>
  set: (key: string, session: Session) => Promise<void>
}

function createKVSessionStore(kv: KVNamespace, ttl: number): SessionStore {
  return {
    async get(key: string): Promise<Session | null> {
      const data = await kv.get(key, { type: 'text' })
      if (!data) return null
      return JSON.parse(data) as Session
    },
    async set(key: string, session: Session): Promise<void> {
      await kv.put(key, JSON.stringify(session), { expirationTtl: ttl })
    },
  }
}

function createDynamoDBAdapter(env: CloudflareEnv): StorageAdapter {
  // Simple fetch-based DynamoDB adapter for Cloudflare Workers
  const endpoint = env.DYNAMODB_ENDPOINT ?? `https://dynamodb.${env.AWS_REGION ?? 'us-east-1'}.amazonaws.com`
  const region = env.AWS_REGION ?? 'us-east-1'

  return {
    async putItem(tableName: string, item: Record<string, unknown>): Promise<void> {
      const marshaledItem = marshalItem(item)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.0',
          'X-Amz-Target': 'DynamoDB_20120810.PutItem',
        },
        body: JSON.stringify({
          TableName: tableName,
          Item: marshaledItem,
        }),
      })

      if (!response.ok) {
        throw new Error(`DynamoDB PutItem failed: ${response.status}`)
      }
    },

    async query(tableName: string, params: QueryParams): Promise<QueryResult> {
      const expressionValues: Record<string, unknown> = {
        ':pk': { S: params.pk },
      }

      let keyCondition = 'pk = :pk'

      if (params.skPrefix) {
        keyCondition += ' AND begins_with(sk, :skPrefix)'
        expressionValues[':skPrefix'] = { S: params.skPrefix }
      }
      else if (params.skStart && params.skEnd) {
        keyCondition += ' AND sk BETWEEN :skStart AND :skEnd'
        expressionValues[':skStart'] = { S: params.skStart }
        expressionValues[':skEnd'] = { S: params.skEnd }
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.0',
          'X-Amz-Target': 'DynamoDB_20120810.Query',
        },
        body: JSON.stringify({
          TableName: tableName,
          KeyConditionExpression: keyCondition,
          ExpressionAttributeValues: expressionValues,
          ...(params.indexName && { IndexName: params.indexName }),
          ...(params.limit && { Limit: params.limit }),
        }),
      })

      if (!response.ok) {
        throw new Error(`DynamoDB Query failed: ${response.status}`)
      }

      const result = await response.json() as { Items?: Record<string, unknown>[], LastEvaluatedKey?: Record<string, unknown> }
      return {
        items: (result.Items ?? []).map(unmarshalItem),
        lastKey: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : undefined,
      }
    },
  }
}

/**
 * Create a D1 storage adapter for SQLite-based storage
 */
export function createD1Adapter(db: D1Database): StorageAdapter {
  return {
    async putItem(tableName: string, item: Record<string, unknown>): Promise<void> {
      const keys = Object.keys(item)
      const values = Object.values(item)
      const placeholders = keys.map(() => '?').join(', ')

      await db.prepare(
        `INSERT OR REPLACE INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
      ).bind(...values.map(v => typeof v === 'object' ? JSON.stringify(v) : v)).run()
    },

    async query(tableName: string, params: QueryParams): Promise<QueryResult> {
      let sql = `SELECT * FROM ${tableName} WHERE pk = ?`
      const bindings: unknown[] = [params.pk]

      if (params.skPrefix) {
        sql += ' AND sk LIKE ?'
        bindings.push(`${params.skPrefix}%`)
      }
      else if (params.skStart && params.skEnd) {
        sql += ' AND sk >= ? AND sk <= ?'
        bindings.push(params.skStart, params.skEnd)
      }

      if (params.limit) {
        sql += ' LIMIT ?'
        bindings.push(params.limit)
      }

      const result = await db.prepare(sql).bind(...bindings).all<Record<string, unknown>>()

      return {
        items: result.results ?? [],
      }
    },
  }
}

// ============================================================================
// Helpers
// ============================================================================

function handleCors(origins: string[], request: Request): Response {
  const origin = request.headers.get('Origin')
  const allowedOrigin = origins.includes('*') ? '*' : (origin && origins.includes(origin) ? origin : origins[0])

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin ?? '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function extractSiteId(path: string, basePath: string, suffix: string): string {
  const prefix = `${basePath}/sites/`
  const start = path.indexOf(prefix) + prefix.length
  const end = path.indexOf(suffix)
  return path.slice(start, end)
}

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

function marshalItem(item: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (value === undefined || value === null) continue
    result[key] = marshalValue(value)
  }
  return result
}

function marshalValue(value: unknown): unknown {
  if (typeof value === 'string') return { S: value }
  if (typeof value === 'number') return { N: String(value) }
  if (typeof value === 'boolean') return { BOOL: value }
  if (Array.isArray(value)) return { L: value.map(marshalValue) }
  if (value instanceof Date) return { S: value.toISOString() }
  if (typeof value === 'object') {
    const m: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      m[k] = marshalValue(v)
    }
    return { M: m }
  }
  return { S: String(value) }
}

function unmarshalItem(item: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    result[key] = unmarshalValue(value as Record<string, unknown>)
  }
  return result
}

function unmarshalValue(value: Record<string, unknown>): unknown {
  if ('S' in value) return value.S
  if ('N' in value) return Number(value.N)
  if ('BOOL' in value) return value.BOOL
  if ('L' in value) return (value.L as Record<string, unknown>[]).map(unmarshalValue)
  if ('M' in value) return unmarshalItem(value.M as Record<string, unknown>)
  if ('NULL' in value) return null
  return value
}

// Cloudflare Workers types
interface ExecutionContext {
  waitUntil: (promise: Promise<unknown>) => void
  passThroughOnException: () => void
}
