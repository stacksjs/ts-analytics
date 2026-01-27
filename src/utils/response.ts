/**
 * Response utilities for the analytics API
 */

export interface ApiResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

/**
 * Create a standardized JSON response
 */
export function jsonResponse(body: unknown, statusCode = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers,
    },
  })
}

/**
 * Create an HTML response
 */
export function htmlResponse(body: string, statusCode = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...headers,
    },
  })
}

/**
 * Create a JavaScript response
 */
export function jsResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      ...headers,
    },
  })
}

/**
 * Create an error response
 */
export function errorResponse(message: string, statusCode = 500): Response {
  return jsonResponse({ error: message }, statusCode)
}

/**
 * Create a not found response
 */
export function notFoundResponse(message = 'Not found'): Response {
  return jsonResponse({ error: message }, 404)
}

/**
 * Legacy response helper for backwards compatibility during migration
 * Returns the old format expected by the Lambda handler
 */
export function legacyResponse(body: unknown, statusCode = 200, headers: Record<string, string> = {}): ApiResponse {
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
