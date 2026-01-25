/**
 * API response and utility tests
 * Tests CORS headers, error responses, URL parsing, and rate limiting
 */

import { describe, expect, it } from 'bun:test'

// ============================================================================
// CORS Header Tests
// ============================================================================

describe('CORS Headers', () => {
  describe('getCorsHeaders', () => {
    it('should return standard CORS headers', () => {
      const headers = getCorsHeaders('https://example.com')

      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com')
      expect(headers['Access-Control-Allow-Methods']).toContain('GET')
      expect(headers['Access-Control-Allow-Methods']).toContain('POST')
      expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type')
    })

    it('should return * for wildcard origins', () => {
      const headers = getCorsHeaders('*')

      expect(headers['Access-Control-Allow-Origin']).toBe('*')
    })
  })
})

function getCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

// ============================================================================
// Error Response Tests
// ============================================================================

describe('Error Responses', () => {
  describe('createErrorResponse', () => {
    it('should create 400 bad request response', () => {
      const response = createErrorResponse(400, 'Bad Request')

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.body).error).toBe('Bad Request')
    })

    it('should create 404 not found response', () => {
      const response = createErrorResponse(404, 'Not Found')

      expect(response.statusCode).toBe(404)
      expect(JSON.parse(response.body).error).toBe('Not Found')
    })

    it('should create 500 internal error response', () => {
      const response = createErrorResponse(500, 'Internal Server Error')

      expect(response.statusCode).toBe(500)
      expect(JSON.parse(response.body).error).toBe('Internal Server Error')
    })

    it('should include CORS headers', () => {
      const response = createErrorResponse(400, 'Error')

      expect(response.headers['Access-Control-Allow-Origin']).toBeDefined()
    })
  })
})

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

function createErrorResponse(statusCode: number, message: string): LambdaResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify({ error: message }),
  }
}

// ============================================================================
// Success Response Tests
// ============================================================================

describe('Success Responses', () => {
  describe('createSuccessResponse', () => {
    it('should create JSON response with data', () => {
      const data = { users: [{ id: 1, name: 'Test' }] }
      const response = createSuccessResponse(data)

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual(data)
      expect(response.headers['Content-Type']).toBe('application/json')
    })

    it('should create 204 no content response', () => {
      const response = createSuccessResponse(null, 204)

      expect(response.statusCode).toBe(204)
      expect(response.body).toBe('')
    })

    it('should include CORS headers', () => {
      const response = createSuccessResponse({ ok: true })

      expect(response.headers['Access-Control-Allow-Origin']).toBeDefined()
    })
  })
})

function createSuccessResponse(data: unknown, statusCode = 200): LambdaResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: data === null ? '' : JSON.stringify(data),
  }
}

// ============================================================================
// URL Path Extraction Tests
// ============================================================================

describe('URL Path Extraction', () => {
  describe('extractPath', () => {
    it('should extract path from full URL', () => {
      expect(extractPath('https://example.com/blog/post-1')).toBe('/blog/post-1')
      expect(extractPath('https://example.com/')).toBe('/')
      expect(extractPath('https://example.com')).toBe('/')
    })

    it('should preserve query parameters if requested', () => {
      expect(extractPath('https://example.com/search?q=test', true)).toBe('/search?q=test')
    })

    it('should remove query parameters by default', () => {
      expect(extractPath('https://example.com/search?q=test')).toBe('/search')
    })

    it('should handle URLs with hash', () => {
      expect(extractPath('https://example.com/page#section')).toBe('/page')
    })

    it('should return / for invalid URLs', () => {
      expect(extractPath('not-a-url')).toBe('/')
    })
  })

  describe('extractPathAdvanced', () => {
    it('should handle encoded characters', () => {
      expect(extractPathAdvanced('https://example.com/path%20with%20spaces')).toBe('/path with spaces')
    })

    it('should handle unicode paths', () => {
      expect(extractPathAdvanced('https://example.com/日本語')).toBe('/日本語')
    })

    it('should handle multiple slashes', () => {
      expect(extractPathAdvanced('https://example.com//double//slashes')).toBe('//double//slashes')
    })

    it('should handle trailing slashes', () => {
      expect(extractPathAdvanced('https://example.com/path/')).toBe('/path/')
    })

    it('should handle ports in URL', () => {
      expect(extractPathAdvanced('https://example.com:8080/path')).toBe('/path')
    })

    it('should handle authentication in URL', () => {
      expect(extractPathAdvanced('https://user:pass@example.com/path')).toBe('/path')
    })

    it('should preserve fragment when requested', () => {
      expect(extractPathAdvanced('https://example.com/path#section', false, true)).toBe('/path#section')
    })

    it('should handle data URLs', () => {
      expect(extractPathAdvanced('data:text/html,<h1>Hello</h1>')).toBe('text/html,<h1>Hello</h1>')
    })
  })
})

function extractPath(url: string, includeQuery = false): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname || '/'
    if (includeQuery && parsed.search) {
      return path + parsed.search
    }
    return path
  } catch {
    return '/'
  }
}

function extractPathAdvanced(url: string, includeQuery = false, includeHash = false): string {
  try {
    const parsed = new URL(url)
    let path = decodeURIComponent(parsed.pathname) || '/'
    if (includeQuery && parsed.search) path += parsed.search
    if (includeHash && parsed.hash) path += parsed.hash
    return path
  } catch {
    return '/'
  }
}

// ============================================================================
// Rate Limiting Tests
// ============================================================================

describe('Rate Limiting', () => {
  describe('isRateLimited', () => {
    it('should not rate limit within threshold', () => {
      const requests = [Date.now() - 1000, Date.now() - 500]
      expect(isRateLimited(requests, 10, 60000)).toBe(false)
    })

    it('should rate limit when threshold exceeded', () => {
      const now = Date.now()
      const requests = Array(15).fill(0).map((_, i) => now - i * 100)
      expect(isRateLimited(requests, 10, 60000)).toBe(true)
    })

    it('should not count old requests', () => {
      const now = Date.now()
      const oldRequests = Array(20).fill(0).map((_, i) => now - 120000 - i * 100)
      expect(isRateLimited(oldRequests, 10, 60000)).toBe(false)
    })
  })
})

function isRateLimited(requestTimes: number[], maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const recentRequests = requestTimes.filter(t => now - t < windowMs)
  return recentRequests.length >= maxRequests
}

// ============================================================================
// Query String Parsing Tests
// ============================================================================

describe('Query String Parsing', () => {
  describe('parseQueryString', () => {
    it('should parse basic key-value pairs', () => {
      expect(parseQueryString('?foo=bar&baz=qux')).toEqual({ foo: 'bar', baz: 'qux' })
    })

    it('should handle empty values', () => {
      expect(parseQueryString('?foo=&bar=baz')).toEqual({ foo: '', bar: 'baz' })
    })

    it('should handle keys without values', () => {
      expect(parseQueryString('?foo&bar=baz')).toEqual({ foo: '', bar: 'baz' })
    })

    it('should decode URL-encoded values', () => {
      expect(parseQueryString('?name=John%20Doe&city=New%20York')).toEqual({
        name: 'John Doe',
        city: 'New York',
      })
    })

    it('should handle plus signs as spaces', () => {
      expect(parseQueryString('?query=hello+world')).toEqual({ query: 'hello world' })
    })

    it('should handle duplicate keys (last wins)', () => {
      expect(parseQueryString('?foo=1&foo=2&foo=3')).toEqual({ foo: '3' })
    })

    it('should handle empty query string', () => {
      expect(parseQueryString('')).toEqual({})
      expect(parseQueryString('?')).toEqual({})
    })

    it('should handle special characters', () => {
      expect(parseQueryString('?email=user%40example.com')).toEqual({ email: 'user@example.com' })
    })
  })
})

function parseQueryString(queryString: string): Record<string, string> {
  const result: Record<string, string> = {}
  const query = queryString.startsWith('?') ? queryString.slice(1) : queryString

  if (!query) return result

  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=')
    if (key) {
      result[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '))
    }
  }

  return result
}

// ============================================================================
// Cookie Parsing Tests
// ============================================================================

describe('Cookie Parsing', () => {
  describe('parseCookies', () => {
    it('should parse simple cookies', () => {
      expect(parseCookies('foo=bar; baz=qux')).toEqual({ foo: 'bar', baz: 'qux' })
    })

    it('should handle URL-encoded values', () => {
      expect(parseCookies('name=John%20Doe')).toEqual({ name: 'John Doe' })
    })

    it('should handle cookies with special characters in values', () => {
      expect(parseCookies('json={"key":"value"}')).toEqual({ json: '{"key":"value"}' })
    })

    it('should handle empty cookie string', () => {
      expect(parseCookies('')).toEqual({})
    })

    it('should trim whitespace', () => {
      expect(parseCookies('  foo = bar  ;  baz = qux  ')).toEqual({ foo: 'bar', baz: 'qux' })
    })

    it('should handle cookies with = in value', () => {
      expect(parseCookies('equation=a=b+c')).toEqual({ equation: 'a=b+c' })
    })
  })
})

function parseCookies(cookieString: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieString) return cookies

  for (const pair of cookieString.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value)
      } catch {
        cookies[key] = value
      }
    }
  }

  return cookies
}
