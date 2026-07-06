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
 * 204 No Content with CORS — for the public collect / tracking endpoints, which
 * every host site POSTs to cross-origin. Without Access-Control-Allow-Origin the
 * browser blocks the beacon (and logs a CORS error) even though the write
 * succeeded, so the bare `new Response(null, { status: 204 })` must not be used.
 */
export function noContentResponse(request?: Request, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsOriginHeaders(request),
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
 * Create a JavaScript response.
 *
 * Carries an ETag (#179) so tracker updates roll out on the next
 * revalidation instead of a hard 1-hour cache-expiry wait: pass the request
 * and a matching If-None-Match short-circuits to 304.
 * stale-while-revalidate keeps page loads fast while the check happens in
 * the background. Cache-bust hard with a ?v= query when needed.
 */
export function jsResponse(body: string, headers: Record<string, string> = {}, request?: Request): Response {
  const etag = `W/"${Bun.hash(body).toString(36)}"`
  const baseHeaders = {
    'Content-Type': 'application/javascript',
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    'Access-Control-Allow-Origin': '*',
    'ETag': etag,
    ...headers,
  }
  if (request?.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: baseHeaders })
  }
  return new Response(body, { status: 200, headers: baseHeaders })
}

/**
 * CORS origin headers for the public collect endpoints. sendBeacon always
 * sends with credentials mode 'include' (per spec), and credentialed CORS
 * rejects the wildcard — so when the request carries an Origin, echo it and
 * allow credentials; fall back to '*' otherwise.
 */
export function corsOriginHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers?.get?.('origin')
  if (!origin)
    return { 'Access-Control-Allow-Origin': '*' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  }
}

/**
 * CORS preflight response for the public collect endpoints (#86).
 *
 * Cross-domain installs preflight every beacon: the tracker posts JSON
 * (non-simple content type) and the error SDK adds X-Analytics-Token, so the
 * browser sends OPTIONS first. Without this, preflights 404 and the browser
 * silently drops the POST. The origin is echoed (not wildcarded) because
 * sendBeacon requests are always credentialed.
 */
export function preflightResponse(request?: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsOriginHeaders(request),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Analytics-Token',
      'Access-Control-Max-Age': '86400',
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
