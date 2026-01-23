/**
 * AWS Lambda Handler for ts-analytics API
 *
 * This handler wraps the analytics API for deployment to AWS Lambda.
 * It uses API Gateway for HTTP routing.
 */

import {
  generateTrackingScript,
  generateMinimalTrackingScript,
  generateId,
  hashVisitorId,
  getDailySalt,
} from '../src/index'
import type { PageView, Session, AggregationPeriod } from '../src/types'

// Configuration
const TABLE_NAME = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'
const REGION = process.env.AWS_REGION || 'us-east-1'

// Import crypto for signing
import * as crypto from 'node:crypto'

// AWS SigV4 signed DynamoDB client for Lambda
class SignedDynamoDBClient {
  private endpoint = `https://dynamodb.${REGION}.amazonaws.com`
  private service = 'dynamodb'

  private getCredentials() {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    }
  }

  private sign(key: Buffer | string, message: string): Buffer {
    return crypto.createHmac('sha256', key).update(message).digest()
  }

  private hash(message: string): string {
    return crypto.createHash('sha256').update(message).digest('hex')
  }

  async request(action: string, input: Record<string, unknown>) {
    const creds = this.getCredentials()
    const body = JSON.stringify(input)
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': `DynamoDB_20120810.${action}`,
      'X-Amz-Date': amzDate,
      'Host': `dynamodb.${REGION}.amazonaws.com`,
    }

    if (creds.sessionToken) {
      headers['X-Amz-Security-Token'] = creds.sessionToken
    }

    // Create canonical request
    const signedHeaders = Object.keys(headers).map(k => k.toLowerCase()).sort().join(';')
    const canonicalHeaders = Object.keys(headers)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(k => `${k.toLowerCase()}:${headers[k]}`)
      .join('\n') + '\n'

    const payloadHash = this.hash(body)
    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256'
    const credentialScope = `${dateStamp}/${REGION}/${this.service}/aws4_request`
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      this.hash(canonicalRequest),
    ].join('\n')

    // Calculate signature
    const kDate = this.sign(`AWS4${creds.secretAccessKey}`, dateStamp)
    const kRegion = this.sign(kDate, REGION)
    const kService = this.sign(kRegion, this.service)
    const kSigning = this.sign(kService, 'aws4_request')
    const signature = this.sign(kSigning, stringToSign).toString('hex')

    const authHeader = `${algorithm} Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    headers['Authorization'] = authHeader

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DynamoDB error: ${error}`)
    }

    return response.json()
  }

  async putItem(input: Record<string, unknown>) {
    return this.request('PutItem', input)
  }

  async getItem(input: Record<string, unknown>) {
    return this.request('GetItem', input)
  }

  async query(input: Record<string, unknown>) {
    return this.request('Query', input)
  }

  async updateItem(input: Record<string, unknown>) {
    return this.request('UpdateItem', input)
  }
}

const dynamodb = new SignedDynamoDBClient()

// In-memory session cache (resets on cold start)
const sessionCache = new Map<string, { session: Session; expires: number }>()

// Helper functions
function getSession(key: string): Session | null {
  const cached = sessionCache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.session
  }
  sessionCache.delete(key)
  return null
}

function setSession(key: string, session: Session, ttlSeconds = 1800): void {
  sessionCache.set(key, {
    session,
    expires: Date.now() + ttlSeconds * 1000,
  })
}

function parseUserAgent(ua: string) {
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

function marshalPageView(pv: PageView): Record<string, { S: string } | { N: string } | { BOOL: boolean }> {
  return {
    pk: { S: `SITE#${pv.siteId}` },
    sk: { S: `PAGEVIEW#${pv.timestamp.toISOString()}#${pv.id}` },
    gsi1pk: { S: `SITE#${pv.siteId}#DATE#${pv.timestamp.toISOString().slice(0, 10)}` },
    gsi1sk: { S: `PATH#${pv.path}` },
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
    pk: { S: `SITE#${s.siteId}` },
    sk: { S: `SESSION#${s.id}` },
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

// Response helper
function response(body: unknown, statusCode = 200, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }
}

// Route handlers
async function handleCollect(event: LambdaEvent) {
  try {
    const payload = JSON.parse(event.body || '{}')

    if (!payload?.s || !payload?.e || !payload?.u) {
      return response({ error: 'Missing required fields: s, e, u' }, 400)
    }

    // Support both v1 and v2 formats for source IP
    const ip = event.requestContext?.http?.sourceIp || event.headers?.['x-forwarded-for']?.split(',')[0] || 'unknown'
    const userAgent = event.requestContext?.http?.userAgent || event.headers?.['user-agent'] || 'unknown'
    const salt = getDailySalt()
    const visitorId = await hashVisitorId(ip, userAgent, payload.s, salt)

    let parsedUrl: URL
    try {
      parsedUrl = new URL(payload.u)
    }
    catch {
      return response({ error: 'Invalid URL' }, 400)
    }

    const timestamp = new Date()
    const sessionId = payload.sid

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
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        screenWidth: payload.sw,
        screenHeight: payload.sh,
        isUnique: isNewSession,
        isBounce: isNewSession,
        timestamp,
      }

      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshalPageView(pageView),
      })

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
          deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
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

      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshalSession(session),
      })

      setSession(sessionKey, session)
    }

    return response(null, 204)
  }
  catch (error) {
    console.error('Collect error:', error)
    return response({ error: 'Internal server error' }, 500)
  }
}

async function handleHealth() {
  return response({ status: 'ok', timestamp: new Date().toISOString() })
}

async function handleScript(event: LambdaEvent) {
  // Extract siteId from path (v2 format: /sites/{siteId}/script)
  const path = event.rawPath || event.path || ''
  const pathMatch = path.match(/\/sites\/([^/]+)\/script/)
  const siteId = event.pathParameters?.siteId || (pathMatch ? pathMatch[1] : null)
  const apiEndpoint = event.queryStringParameters?.api || `https://${event.requestContext?.domainName}`
  const minimal = event.queryStringParameters?.minimal === 'true'

  if (!siteId) {
    return response({ error: 'Missing siteId' }, 400)
  }

  const script = minimal
    ? generateMinimalTrackingScript({ siteId, apiEndpoint, honorDnt: true })
    : generateTrackingScript({ siteId, apiEndpoint, honorDnt: true, trackOutboundLinks: true })

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
    body: script,
  }
}

// Types for API Gateway HTTP API (v2) format
interface LambdaEvent {
  version?: string
  routeKey?: string
  rawPath?: string
  rawQueryString?: string
  headers?: Record<string, string>
  queryStringParameters?: Record<string, string>
  pathParameters?: Record<string, string>
  body?: string
  isBase64Encoded?: boolean
  requestContext?: {
    accountId?: string
    apiId?: string
    domainName?: string
    domainPrefix?: string
    http?: {
      method: string
      path: string
      protocol: string
      sourceIp: string
      userAgent: string
    }
    requestId?: string
    routeKey?: string
    stage?: string
    time?: string
    timeEpoch?: number
  }
  // Legacy v1 format support
  httpMethod?: string
  path?: string
  resource?: string
}

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

// Main Lambda handler - supports both API Gateway v1 and v2 formats
export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  console.log('Event:', JSON.stringify(event))

  // Determine method and path (v2 vs v1 format)
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET'
  const path = event.rawPath || event.path || event.resource || '/'

  // Handle OPTIONS (CORS preflight)
  if (method === 'OPTIONS') {
    return response(null, 204)
  }

  // Route handling
  if (path === '/health' && method === 'GET') {
    return handleHealth()
  }

  if (path === '/collect' && method === 'POST') {
    return handleCollect(event)
  }

  if (path.match(/\/sites\/[^/]+\/script/) && method === 'GET') {
    return handleScript(event)
  }

  return response({ error: 'Not found' }, 404)
}
