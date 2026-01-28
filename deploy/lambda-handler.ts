/**
 * AWS Lambda Handler for ts-analytics API (Bun Runtime)
 *
 * Uses bun-lambda layer for native Bun runtime on AWS Lambda.
 * Exports Bun server format: { fetch(request): Response }
 *
 * All handlers are organized in the handlers/ directory.
 */

import { router } from '../src/router'

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers)

  if (!headers.has('Access-Control-Allow-Origin')) {
    headers.set('Access-Control-Allow-Origin', '*')
  }
  if (!headers.has('Access-Control-Allow-Methods')) {
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  }
  if (!headers.has('Access-Control-Allow-Headers')) {
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Bun server export for bun-lambda
 *
 * The bun-lambda runtime automatically converts Lambda events
 * to standard Request objects and Response back to Lambda format.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    // Log request for debugging (can be disabled in production)
    if (process.env.DEBUG_REQUESTS === 'true') {
      const url = new URL(request.url)
      console.log('Incoming request:', {
        path: url.pathname,
        method: request.method,
        search: url.search,
      })
    }

    // Handle OPTIONS (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }

    try {
      const response = await router.handleRequest(request)
      return addCorsHeaders(response)
    }
    catch (error) {
      console.error('Lambda handler error:', error)

      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        },
      )
    }
  },
}
