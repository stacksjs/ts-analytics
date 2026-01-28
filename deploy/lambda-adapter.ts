/**
 * AWS Lambda Adapter for bun-router
 *
 * Converts AWS Lambda events to standard Request objects
 * and Response objects back to Lambda format.
 */

import type { Router } from 'bun-router'

// Types for API Gateway HTTP API (v2) format
export interface LambdaEvent {
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

export interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  isBase64Encoded?: boolean
}

export interface LambdaContext {
  awsRequestId: string
  functionName: string
  functionVersion: string
  invokedFunctionArn: string
  memoryLimitInMB: string
  logGroupName: string
  logStreamName: string
  getRemainingTimeInMillis(): number
}

/**
 * Convert Lambda event to standard Request object
 */
export function eventToRequest(event: LambdaEvent): Request {
  // Determine method and path (v2 vs v1 format)
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET'
  const path = event.rawPath || event.path || event.resource || '/'
  const queryString = event.rawQueryString || ''

  // Build full URL
  const domain = event.requestContext?.domainName || 'localhost'
  const url = `https://${domain}${path}${queryString ? `?${queryString}` : ''}`

  // Convert headers to Headers object
  const headers = new Headers()
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      if (value) headers.set(key, value)
    }
  }

  // Handle body
  let body: string | undefined
  if (event.body) {
    body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body
  }

  // Attach event to request for handlers that need raw event data
  const request = new Request(url, {
    method,
    headers,
    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
  })

  // Store original event for handlers that need it
  ;(request as any)._lambdaEvent = event

  return request
}

/**
 * Convert Response object to Lambda response format
 */
export async function responseToLambda(response: Response): Promise<LambdaResponse> {
  const body = await response.text()
  const headers: Record<string, string> = {}

  response.headers.forEach((value, key) => {
    headers[key] = value
  })

  // Ensure CORS headers are always present
  if (!headers['Access-Control-Allow-Origin']) {
    headers['Access-Control-Allow-Origin'] = '*'
  }
  if (!headers['Access-Control-Allow-Methods']) {
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
  }
  if (!headers['Access-Control-Allow-Headers']) {
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
  }

  return {
    statusCode: response.status,
    headers,
    body,
    isBase64Encoded: false,
  }
}

/**
 * Main adapter function - handles Lambda event using bun-router
 */
export async function handleLambdaEvent(
  router: Router,
  event: LambdaEvent,
  _context?: LambdaContext
): Promise<LambdaResponse> {
  // Handle OPTIONS (CORS preflight) before routing
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET'
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    }
  }

  try {
    const request = eventToRequest(event)
    const response = await router.handleRequest(request)
    return responseToLambda(response)
  } catch (error) {
    console.error('Lambda handler error:', error)
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    }
  }
}

/**
 * Get Lambda event from request (for handlers that need raw event access)
 */
export function getLambdaEvent(request: Request): LambdaEvent | undefined {
  return (request as any)._lambdaEvent
}

/**
 * Get query parameters from Lambda event or request URL
 */
export function getQueryParams(request: Request): Record<string, string> {
  const event = getLambdaEvent(request)
  if (event?.queryStringParameters) {
    return event.queryStringParameters
  }
  const url = new URL(request.url)
  const params: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    params[key] = value
  })
  return params
}

/**
 * Get client IP from Lambda event
 */
export function getClientIP(request: Request): string {
  const event = getLambdaEvent(request)
  return event?.requestContext?.http?.sourceIp || 'unknown'
}

/**
 * Get user agent from request
 */
export function getUserAgent(request: Request): string {
  return request.headers.get('user-agent') || 'unknown'
}

/**
 * Get all headers as record
 */
export function getHeaders(request: Request): Record<string, string> {
  const event = getLambdaEvent(request)
  if (event?.headers) {
    return event.headers
  }
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}
