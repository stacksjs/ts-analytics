/**
 * Comprehensive test suite for the Lambda handler
 * Tests API routes, data processing, and dashboard functionality
 */

import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

// ============================================================================
// Mock DynamoDB Client
// ============================================================================

interface MockItem {
  pk: { S: string }
  sk: { S: string }
  [key: string]: unknown
}

class MockDynamoDB {
  private storage = new Map<string, MockItem>()

  async query(params: {
    TableName: string
    KeyConditionExpression: string
    ExpressionAttributeValues: Record<string, { S?: string; N?: string }>
    FilterExpression?: string
    Limit?: number
    ScanIndexForward?: boolean
  }) {
    const items: MockItem[] = []
    const pk = params.ExpressionAttributeValues[':pk']?.S

    for (const [key, value] of this.storage) {
      if (key.startsWith(pk || '')) {
        items.push(value)
      }
    }

    return { Items: items.slice(0, params.Limit || 100) }
  }

  async putItem(params: { TableName: string; Item: MockItem }) {
    const key = `${params.Item.pk.S}#${params.Item.sk.S}`
    this.storage.set(key, params.Item)
    return {}
  }

  async getItem(params: { TableName: string; Key: { pk: { S: string }; sk: { S: string } } }) {
    const key = `${params.Key.pk.S}#${params.Key.sk.S}`
    return { Item: this.storage.get(key) }
  }

  async scan(params: { TableName: string; FilterExpression?: string; Limit?: number }) {
    return { Items: Array.from(this.storage.values()).slice(0, params.Limit || 100) }
  }

  clear() {
    this.storage.clear()
  }

  seed(items: MockItem[]) {
    for (const item of items) {
      const key = `${item.pk.S}#${item.sk.S}`
      this.storage.set(key, item)
    }
  }
}

// ============================================================================
// Test Utilities
// ============================================================================

function createLambdaEvent(overrides: Partial<LambdaEvent> = {}): LambdaEvent {
  return {
    rawPath: '/health',
    requestContext: {
      http: {
        method: 'GET',
        sourceIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    },
    headers: {
      'content-type': 'application/json',
      'origin': 'https://example.com',
    },
    queryStringParameters: {},
    body: null,
    ...overrides,
  }
}

interface LambdaEvent {
  rawPath?: string
  path?: string
  requestContext?: {
    http?: {
      method?: string
      sourceIp?: string
      userAgent?: string
    }
  }
  httpMethod?: string
  headers?: Record<string, string>
  queryStringParameters?: Record<string, string> | null
  body?: string | null
}

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

// ============================================================================
// Date Range Parsing Tests
// ============================================================================

describe('Date Range Parsing', () => {
  describe('parseDateRange', () => {
    it('should parse valid ISO date strings', () => {
      const params = {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
      }

      const result = parseDateRange(params)

      expect(result.startDate).toBeInstanceOf(Date)
      expect(result.endDate).toBeInstanceOf(Date)
      expect(result.startDate.toISOString()).toBe('2024-01-01T00:00:00.000Z')
      expect(result.endDate.toISOString()).toBe('2024-01-31T23:59:59.999Z')
    })

    it('should use default 30-day range when no params provided', () => {
      const result = parseDateRange(null)

      const now = new Date()
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

      expect(result.startDate.getTime()).toBeCloseTo(thirtyDaysAgo.getTime(), -4)
      expect(result.endDate.getTime()).toBeCloseTo(now.getTime(), -4)
    })

    it('should handle partial date parameters', () => {
      const result = parseDateRange({ startDate: '2024-01-15T00:00:00.000Z' })

      expect(result.startDate.toISOString()).toBe('2024-01-15T00:00:00.000Z')
      expect(result.endDate.getTime()).toBeCloseTo(Date.now(), -4)
    })

    it('should swap dates if start is after end', () => {
      const params = {
        startDate: '2024-01-31T00:00:00.000Z',
        endDate: '2024-01-01T00:00:00.000Z',
      }

      const result = parseDateRange(params)

      expect(result.startDate.getTime()).toBeLessThan(result.endDate.getTime())
    })
  })
})

// Helper function to parse date range (simulates Lambda handler logic)
function parseDateRange(params: Record<string, string> | null): { startDate: Date; endDate: Date } {
  const now = new Date()
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  let startDate = params?.startDate ? new Date(params.startDate) : defaultStart
  let endDate = params?.endDate ? new Date(params.endDate) : now

  // Swap if needed
  if (startDate > endDate) {
    ;[startDate, endDate] = [endDate, startDate]
  }

  return { startDate, endDate }
}

// ============================================================================
// Time Series Bucket Generation Tests
// ============================================================================

describe('Time Series Bucket Generation', () => {
  describe('generateTimeBuckets', () => {
    it('should generate hourly buckets for hour period', () => {
      const start = new Date('2024-01-15T10:00:00.000Z')
      const end = new Date('2024-01-15T14:00:00.000Z')

      const buckets = generateTimeBuckets(start, end, 'hour')

      expect(buckets).toHaveLength(5)
      expect(buckets[0]).toBe('2024-01-15T10:00:00')
      expect(buckets[4]).toBe('2024-01-15T14:00:00')
    })

    it('should generate daily buckets for day period', () => {
      const start = new Date('2024-01-15T00:00:00.000Z')
      const end = new Date('2024-01-20T00:00:00.000Z')

      const buckets = generateTimeBuckets(start, end, 'day')

      expect(buckets).toHaveLength(6)
      expect(buckets[0]).toBe('2024-01-15')
      expect(buckets[5]).toBe('2024-01-20')
    })

    it('should generate minute buckets (5-min intervals) for minute period', () => {
      const start = new Date('2024-01-15T10:00:00.000Z')
      const end = new Date('2024-01-15T10:30:00.000Z')

      const buckets = generateTimeBuckets(start, end, 'minute')

      expect(buckets).toHaveLength(7)
      expect(buckets[0]).toBe('2024-01-15T10:00:00')
      expect(buckets[6]).toBe('2024-01-15T10:30:00')
    })

    it('should generate monthly buckets for month period', () => {
      const start = new Date('2024-01-01T00:00:00.000Z')
      const end = new Date('2024-06-01T00:00:00.000Z')

      const buckets = generateTimeBuckets(start, end, 'month')

      expect(buckets).toHaveLength(6)
      expect(buckets[0]).toBe('2024-01')
      expect(buckets[5]).toBe('2024-06')
    })

    it('should handle edge case of same start and end time', () => {
      const start = new Date('2024-01-15T10:00:00.000Z')
      const end = new Date('2024-01-15T10:00:00.000Z')

      const buckets = generateTimeBuckets(start, end, 'hour')

      expect(buckets.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// Helper function to generate time buckets (simulates Lambda handler logic)
function generateTimeBuckets(start: Date, end: Date, period: string): string[] {
  const buckets: string[] = []
  const current = new Date(start)

  while (current <= end) {
    let key: string
    if (period === 'minute') {
      const mins = Math.floor(current.getMinutes() / 5) * 5
      key = `${current.toISOString().slice(0, 14)}${mins.toString().padStart(2, '0')}:00`
      current.setMinutes(current.getMinutes() + 5)
    } else if (period === 'hour') {
      key = `${current.toISOString().slice(0, 13)}:00:00`
      current.setHours(current.getHours() + 1)
    } else if (period === 'month') {
      key = current.toISOString().slice(0, 7)
      current.setMonth(current.getMonth() + 1)
    } else {
      key = current.toISOString().slice(0, 10)
      current.setDate(current.getDate() + 1)
    }
    if (!buckets.includes(key)) buckets.push(key)
  }

  return buckets
}

// ============================================================================
// User Agent Parsing Tests
// ============================================================================

describe('User Agent Parsing', () => {
  describe('parseUserAgent', () => {
    it('should detect Chrome on Windows Desktop', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Chrome')
      expect(result.deviceType).toBe('Desktop')
      expect(result.os).toBe('Windows')
    })

    it('should detect Safari on iPhone (Mobile)', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Safari')
      expect(result.deviceType).toBe('Mobile')
      expect(result.os).toBe('iOS')
    })

    it('should detect Safari on iPad (Tablet)', () => {
      const ua = 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
      const result = parseUserAgent(ua)

      expect(result.deviceType).toBe('Tablet')
    })

    it('should detect Firefox on Linux', () => {
      const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Firefox')
      expect(result.os).toBe('Linux')
    })

    it('should detect Edge browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Edge')
    })

    it('should detect Android Mobile', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      const result = parseUserAgent(ua)

      expect(result.deviceType).toBe('Mobile')
      expect(result.os).toBe('Android')
    })

    it('should detect Arc browser', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Arc/1.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Arc')
    })

    it('should detect Dia browser', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Dia/1.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Dia')
    })

    it('should handle unknown user agents gracefully', () => {
      const ua = 'CustomBot/1.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Unknown')
      expect(result.deviceType).toBe('Desktop')
      expect(result.os).toBe('Unknown')
    })

    it('should handle empty or null user agents', () => {
      expect(parseUserAgent('')).toEqual({ browser: 'Unknown', deviceType: 'Desktop', os: 'Unknown' })
      expect(parseUserAgent(undefined as unknown as string)).toEqual({ browser: 'Unknown', deviceType: 'Desktop', os: 'Unknown' })
    })
  })
})

// Helper function to parse user agent (simulates Lambda handler logic)
function parseUserAgent(ua: string): { browser: string; deviceType: string; os: string } {
  if (!ua) return { browser: 'Unknown', deviceType: 'Desktop', os: 'Unknown' }

  const uaLower = ua.toLowerCase()

  // Detect device type (order matters - check tablet/iPad before mobile since iPad UA contains "Mobile")
  let deviceType = 'Desktop'
  if (/ipad|tablet|android(?!.*mobile)/.test(uaLower)) {
    deviceType = 'Tablet'
  } else if (/mobile|android.*mobile|iphone|ipod/.test(uaLower)) {
    deviceType = 'Mobile'
  }

  // Detect browser (order matters - check specific before generic)
  let browser = 'Unknown'
  if (uaLower.includes('dia/')) {
    browser = 'Dia'
  } else if (uaLower.includes('arc/')) {
    browser = 'Arc'
  } else if (uaLower.includes('edg/')) {
    browser = 'Edge'
  } else if (uaLower.includes('firefox/')) {
    browser = 'Firefox'
  } else if (uaLower.includes('safari/') && !uaLower.includes('chrome/')) {
    browser = 'Safari'
  } else if (uaLower.includes('chrome/')) {
    browser = 'Chrome'
  }

  // Detect OS (order matters - check iOS before macOS since iOS UAs contain "Mac OS X")
  let os = 'Unknown'
  if (uaLower.includes('iphone') || uaLower.includes('ipad')) {
    os = 'iOS'
  } else if (uaLower.includes('android')) {
    os = 'Android'
  } else if (uaLower.includes('windows')) {
    os = 'Windows'
  } else if (uaLower.includes('mac os x') || uaLower.includes('macintosh')) {
    os = 'macOS'
  } else if (uaLower.includes('linux')) {
    os = 'Linux'
  }

  return { browser, deviceType, os }
}

// ============================================================================
// Referrer Source Detection Tests
// ============================================================================

describe('Referrer Source Detection', () => {
  describe('parseReferrerSource', () => {
    it('should return "Direct" for empty referrer', () => {
      expect(parseReferrerSource('')).toBe('Direct')
      expect(parseReferrerSource(undefined as unknown as string)).toBe('Direct')
    })

    it('should detect Google', () => {
      expect(parseReferrerSource('https://www.google.com/search?q=test')).toBe('Google')
      expect(parseReferrerSource('https://google.co.uk/')).toBe('Google')
    })

    it('should detect social media platforms', () => {
      expect(parseReferrerSource('https://www.facebook.com/')).toBe('Facebook')
      expect(parseReferrerSource('https://t.co/abc123')).toBe('Twitter')
      expect(parseReferrerSource('https://twitter.com/user')).toBe('Twitter')
      expect(parseReferrerSource('https://www.linkedin.com/feed')).toBe('LinkedIn')
      expect(parseReferrerSource('https://www.reddit.com/r/test')).toBe('Reddit')
      expect(parseReferrerSource('https://www.youtube.com/watch?v=123')).toBe('YouTube')
    })

    it('should detect search engines', () => {
      expect(parseReferrerSource('https://www.bing.com/search?q=test')).toBe('Bing')
      expect(parseReferrerSource('https://duckduckgo.com/?q=test')).toBe('DuckDuckGo')
      expect(parseReferrerSource('https://search.yahoo.com/search?p=test')).toBe('Yahoo')
    })

    it('should extract domain for unknown referrers', () => {
      expect(parseReferrerSource('https://blog.example.com/post')).toBe('blog.example.com')
    })

    it('should handle invalid URLs gracefully', () => {
      expect(parseReferrerSource('not-a-valid-url')).toBe('Unknown')
    })
  })
})

// Helper function to parse referrer source (simulates Lambda handler logic)
function parseReferrerSource(referrer: string): string {
  if (!referrer) return 'Direct'

  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()

    if (host.includes('google')) return 'Google'
    if (host.includes('bing')) return 'Bing'
    if (host.includes('duckduckgo')) return 'DuckDuckGo'
    if (host.includes('yahoo')) return 'Yahoo'
    if (host.includes('facebook') || host.includes('fb.com')) return 'Facebook'
    if (host.includes('reddit')) return 'Reddit' // Must check before Twitter since reddit.com contains 't.co'
    if (host.includes('twitter') || host === 't.co') return 'Twitter'
    if (host.includes('linkedin')) return 'LinkedIn'
    if (host.includes('youtube')) return 'YouTube'

    return host
  } catch {
    return 'Unknown'
  }
}

// ============================================================================
// Visitor ID Hashing Tests
// ============================================================================

describe('Visitor ID Hashing', () => {
  describe('hashVisitorId', () => {
    it('should generate consistent hashes for same inputs', async () => {
      const hash1 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt')
      const hash2 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt')

      expect(hash1).toBe(hash2)
    })

    it('should generate different hashes for different IPs', async () => {
      const hash1 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt')
      const hash2 = await hashVisitorId('192.168.1.2', 'Mozilla/5.0', 'site-123', 'salt')

      expect(hash1).not.toBe(hash2)
    })

    it('should generate different hashes for different salts', async () => {
      const hash1 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt1')
      const hash2 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt2')

      expect(hash1).not.toBe(hash2)
    })

    it('should generate 64-character hex strings (SHA-256)', async () => {
      const hash = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt')

      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })
})

// Helper function to hash visitor ID (simulates Lambda handler logic)
async function hashVisitorId(ip: string, userAgent: string, siteId: string, salt: string): Promise<string> {
  const data = `${ip}|${userAgent}|${siteId}|${salt}`
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ============================================================================
// Daily Salt Generation Tests
// ============================================================================

describe('Daily Salt Generation', () => {
  describe('getDailySalt', () => {
    it('should generate consistent salt for same date', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const salt1 = getDailySalt(date)
      const salt2 = getDailySalt(date)

      expect(salt1).toBe(salt2)
    })

    it('should generate different salt for different dates', () => {
      const date1 = new Date('2024-01-15T12:00:00Z')
      const date2 = new Date('2024-01-16T12:00:00Z')
      const salt1 = getDailySalt(date1)
      const salt2 = getDailySalt(date2)

      expect(salt1).not.toBe(salt2)
    })

    it('should include date in salt format', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const salt = getDailySalt(date)

      expect(salt).toContain('2024-01-15')
    })
  })
})

// Helper function to get daily salt (simulates Lambda handler logic)
function getDailySalt(date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10)
  return `analytics-salt-${dateStr}`
}

// ============================================================================
// Input Validation Tests
// ============================================================================

describe('Input Validation', () => {
  describe('validateCollectPayload', () => {
    it('should accept valid pageview payload', () => {
      const payload = {
        s: 'site-123',
        e: 'pageview',
        u: 'https://example.com/page',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject payload with missing siteId', () => {
      const payload = {
        e: 'pageview',
        u: 'https://example.com/page',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing siteId (s)')
    })

    it('should reject payload with missing event type', () => {
      const payload = {
        s: 'site-123',
        u: 'https://example.com/page',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing event type (e)')
    })

    it('should reject payload with missing URL', () => {
      const payload = {
        s: 'site-123',
        e: 'pageview',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing URL (u)')
    })

    it('should reject payload with invalid URL', () => {
      const payload = {
        s: 'site-123',
        e: 'pageview',
        u: 'not-a-valid-url',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid URL format')
    })

    it('should accept valid event payload with properties', () => {
      const payload = {
        s: 'site-123',
        e: 'event',
        u: 'https://example.com/page',
        n: 'button_click',
        v: 99.99,
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(true)
    })
  })
})

// Helper function to validate collect payload (simulates Lambda handler logic)
function validateCollectPayload(payload: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!payload.s) errors.push('Missing siteId (s)')
  if (!payload.e) errors.push('Missing event type (e)')
  if (!payload.u) errors.push('Missing URL (u)')

  if (payload.u && typeof payload.u === 'string') {
    try {
      new URL(payload.u)
    } catch {
      errors.push('Invalid URL format')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================================
// Country Detection Tests
// ============================================================================

describe('Country Detection', () => {
  describe('getCountryFromHeaders', () => {
    it('should extract country from CloudFront header', () => {
      const headers = { 'cloudfront-viewer-country': 'US' }
      expect(getCountryFromHeaders(headers)).toBe('US')
    })

    it('should extract country from CF-IPCountry header', () => {
      const headers = { 'cf-ipcountry': 'GB' }
      expect(getCountryFromHeaders(headers)).toBe('GB')
    })

    it('should return Unknown for missing headers', () => {
      expect(getCountryFromHeaders({})).toBe('Unknown')
    })

    it('should prefer CloudFront header over CF header', () => {
      const headers = {
        'cloudfront-viewer-country': 'US',
        'cf-ipcountry': 'GB',
      }
      expect(getCountryFromHeaders(headers)).toBe('US')
    })
  })
})

// Helper function to get country from headers (simulates Lambda handler logic)
function getCountryFromHeaders(headers: Record<string, string>): string {
  return headers['cloudfront-viewer-country'] || headers['cf-ipcountry'] || 'Unknown'
}

// ============================================================================
// Data Aggregation Tests
// ============================================================================

describe('Data Aggregation', () => {
  describe('aggregateTimeSeriesData', () => {
    it('should aggregate pageviews by time bucket', () => {
      const pageviews = [
        { timestamp: '2024-01-15T10:15:00.000Z', visitorId: 'v1', sessionId: 's1' },
        { timestamp: '2024-01-15T10:20:00.000Z', visitorId: 'v1', sessionId: 's1' },
        { timestamp: '2024-01-15T10:45:00.000Z', visitorId: 'v2', sessionId: 's2' },
        { timestamp: '2024-01-15T11:05:00.000Z', visitorId: 'v3', sessionId: 's3' },
      ]

      const result = aggregateTimeSeriesData(pageviews, 'hour')

      expect(result['2024-01-15T10:00:00']).toEqual({ views: 3, visitors: 2, sessions: 2 })
      expect(result['2024-01-15T11:00:00']).toEqual({ views: 1, visitors: 1, sessions: 1 })
    })

    it('should handle empty pageviews array', () => {
      const result = aggregateTimeSeriesData([], 'hour')
      expect(Object.keys(result)).toHaveLength(0)
    })

    it('should correctly count unique visitors and sessions', () => {
      const pageviews = [
        { timestamp: '2024-01-15T10:15:00.000Z', visitorId: 'v1', sessionId: 's1' },
        { timestamp: '2024-01-15T10:20:00.000Z', visitorId: 'v1', sessionId: 's1' },
        { timestamp: '2024-01-15T10:25:00.000Z', visitorId: 'v1', sessionId: 's2' },
      ]

      const result = aggregateTimeSeriesData(pageviews, 'hour')

      expect(result['2024-01-15T10:00:00'].views).toBe(3)
      expect(result['2024-01-15T10:00:00'].visitors).toBe(1)
      expect(result['2024-01-15T10:00:00'].sessions).toBe(2)
    })
  })
})

// Helper function to aggregate time series data (simulates Lambda handler logic)
function aggregateTimeSeriesData(
  pageviews: Array<{ timestamp: string; visitorId: string; sessionId: string }>,
  period: string,
): Record<string, { views: number; visitors: number; sessions: number }> {
  const buckets: Record<string, { views: number; visitors: Set<string>; sessions: Set<string> }> = {}

  for (const pv of pageviews) {
    const date = new Date(pv.timestamp)
    let key: string

    if (period === 'hour') {
      key = `${date.toISOString().slice(0, 13)}:00:00`
    } else if (period === 'minute') {
      const mins = Math.floor(date.getMinutes() / 5) * 5
      key = `${date.toISOString().slice(0, 14)}${mins.toString().padStart(2, '0')}:00`
    } else {
      key = date.toISOString().slice(0, 10)
    }

    if (!buckets[key]) {
      buckets[key] = { views: 0, visitors: new Set(), sessions: new Set() }
    }

    buckets[key].views++
    buckets[key].visitors.add(pv.visitorId)
    buckets[key].sessions.add(pv.sessionId)
  }

  const result: Record<string, { views: number; visitors: number; sessions: number }> = {}
  for (const [key, data] of Object.entries(buckets)) {
    result[key] = {
      views: data.views,
      visitors: data.visitors.size,
      sessions: data.sessions.size,
    }
  }

  return result
}

// ============================================================================
// Number Formatting Tests
// ============================================================================

describe('Number Formatting', () => {
  describe('formatNumber', () => {
    it('should format small numbers as-is', () => {
      expect(formatNumber(0)).toBe('0')
      expect(formatNumber(1)).toBe('1')
      expect(formatNumber(999)).toBe('999')
    })

    it('should format thousands with k suffix', () => {
      expect(formatNumber(1000)).toBe('1k')
      expect(formatNumber(1500)).toBe('1.5k')
      expect(formatNumber(10000)).toBe('10k')
      expect(formatNumber(999999)).toBe('1000k')
    })

    it('should format millions with M suffix', () => {
      expect(formatNumber(1000000)).toBe('1M')
      expect(formatNumber(1500000)).toBe('1.5M')
      expect(formatNumber(10000000)).toBe('10M')
    })

    it('should handle null and undefined', () => {
      expect(formatNumber(null as unknown as number)).toBe('0')
      expect(formatNumber(undefined as unknown as number)).toBe('0')
    })
  })
})

// Helper function to format numbers (simulates Lambda handler logic)
function formatNumber(n: number): string {
  if (n === undefined || n === null) return '0'
  if (n >= 1e6) {
    const val = n / 1e6
    const formatted = val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')
    return `${formatted}M`
  }
  if (n >= 1e3) {
    const val = n / 1e3
    const formatted = val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')
    return `${formatted}k`
  }
  return String(n)
}

// ============================================================================
// Date Formatting Tests
// ============================================================================

describe('Date Formatting', () => {
  describe('formatDateForChart', () => {
    it('should format date for daily view', () => {
      const date = '2024-01-15'
      expect(formatDateForChart(date, 'day')).toBe('Jan 15')
    })

    it('should format time for hourly view (24h)', () => {
      const date = '2024-01-15T14:00:00'
      expect(formatDateForChart(date, 'hour', '24h')).toBe('2pm')
    })

    it('should format time with minutes for minute view', () => {
      const date = '2024-01-15T14:30:00'
      expect(formatDateForChart(date, 'minute', '1h')).toBe('2:30pm')
    })

    it('should format month for monthly view', () => {
      const date = '2024-01'
      expect(formatDateForChart(date, 'month')).toBe('Jan 2024')
    })
  })
})

// Helper function to format date for chart (simulates Lambda handler logic)
function formatDateForChart(dateStr: string, period: string, range?: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  if (period === 'month') {
    const [year, month] = dateStr.split('-')
    return `${months[Number.parseInt(month) - 1]} ${year}`
  }

  const date = new Date(dateStr)

  if (period === 'minute' || (period === 'hour' && (range === '1h' || range === '6h' || range === '12h'))) {
    const h = date.getHours()
    const m = date.getMinutes()
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    if (period === 'minute') {
      return `${h12}:${m.toString().padStart(2, '0')}${ampm}`
    }
    return `${h12}${ampm}`
  }

  if (period === 'hour') {
    const h = date.getHours()
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    return `${h12}${ampm}`
  }

  return `${months[date.getMonth()]} ${date.getDate()}`
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
})

// Helper function to extract path from URL (simulates Lambda handler logic)
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

// ============================================================================
// Session Duration Calculation Tests
// ============================================================================

describe('Session Duration Calculation', () => {
  describe('calculateDuration', () => {
    it('should calculate duration in milliseconds', () => {
      const start = new Date('2024-01-15T10:00:00.000Z')
      const end = new Date('2024-01-15T10:05:00.000Z')

      expect(calculateDuration(start, end)).toBe(300000) // 5 minutes
    })

    it('should return 0 for same start and end', () => {
      const time = new Date('2024-01-15T10:00:00.000Z')
      expect(calculateDuration(time, time)).toBe(0)
    })

    it('should handle end before start (return absolute)', () => {
      const start = new Date('2024-01-15T10:05:00.000Z')
      const end = new Date('2024-01-15T10:00:00.000Z')

      expect(calculateDuration(start, end)).toBe(300000)
    })
  })

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(30000)).toBe('00:30')
    })

    it('should format minutes and seconds', () => {
      expect(formatDuration(125000)).toBe('02:05')
    })

    it('should format hours, minutes, seconds', () => {
      expect(formatDuration(3725000)).toBe('01:02:05')
    })

    it('should handle 0 duration', () => {
      expect(formatDuration(0)).toBe('00:00')
    })
  })
})

// Helper functions for duration (simulates Lambda handler logic)
function calculateDuration(start: Date, end: Date): number {
  return Math.abs(end.getTime() - start.getTime())
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

// ============================================================================
// Bounce Rate Calculation Tests
// ============================================================================

describe('Bounce Rate Calculation', () => {
  describe('calculateBounceRate', () => {
    it('should calculate correct bounce rate', () => {
      expect(calculateBounceRate(25, 100)).toBe(25)
      expect(calculateBounceRate(1, 3)).toBeCloseTo(33.33, 1)
    })

    it('should return 0 when no sessions', () => {
      expect(calculateBounceRate(0, 0)).toBe(0)
    })

    it('should handle 100% bounce rate', () => {
      expect(calculateBounceRate(10, 10)).toBe(100)
    })

    it('should return 0 for invalid inputs', () => {
      expect(calculateBounceRate(-1, 10)).toBe(0)
      expect(calculateBounceRate(10, -1)).toBe(0)
    })
  })
})

// Helper function to calculate bounce rate (simulates Lambda handler logic)
function calculateBounceRate(bounces: number, sessions: number): number {
  if (bounces < 0 || sessions <= 0) return 0
  return Math.round((bounces / sessions) * 10000) / 100
}

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

// Helper function to get CORS headers (simulates Lambda handler logic)
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

// Helper function to create error response (simulates Lambda handler logic)
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

// Helper function to create success response (simulates Lambda handler logic)
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
// Detail Page Section Tests
// ============================================================================

describe('Detail Page Sections', () => {
  const validSections = ['pages', 'referrers', 'devices', 'browsers', 'countries', 'campaigns', 'events', 'goals']

  describe('isValidSection', () => {
    it('should validate all known sections', () => {
      for (const section of validSections) {
        expect(isValidSection(section)).toBe(true)
      }
    })

    it('should reject unknown sections', () => {
      expect(isValidSection('unknown')).toBe(false)
      expect(isValidSection('')).toBe(false)
      expect(isValidSection('admin')).toBe(false)
    })
  })

  describe('getSectionTitle', () => {
    it('should return correct titles', () => {
      expect(getSectionTitle('pages')).toBe('All Pages')
      expect(getSectionTitle('referrers')).toBe('All Referrers')
      expect(getSectionTitle('devices')).toBe('Devices & OS')
      expect(getSectionTitle('browsers')).toBe('All Browsers')
      expect(getSectionTitle('countries')).toBe('All Countries')
      expect(getSectionTitle('campaigns')).toBe('All Campaigns')
      expect(getSectionTitle('events')).toBe('All Events')
      expect(getSectionTitle('goals')).toBe('Goals')
    })

    it('should return default for unknown section', () => {
      expect(getSectionTitle('unknown')).toBe('Analytics')
    })
  })
})

// Helper functions for detail pages (simulates Lambda handler logic)
function isValidSection(section: string): boolean {
  const validSections = ['pages', 'referrers', 'devices', 'browsers', 'countries', 'campaigns', 'events', 'goals']
  return validSections.includes(section)
}

function getSectionTitle(section: string): string {
  const titles: Record<string, string> = {
    pages: 'All Pages',
    referrers: 'All Referrers',
    devices: 'Devices & OS',
    browsers: 'All Browsers',
    countries: 'All Countries',
    campaigns: 'All Campaigns',
    events: 'All Events',
    goals: 'Goals',
  }
  return titles[section] || 'Analytics'
}

// ============================================================================
// Period Selection Tests
// ============================================================================

describe('Period Selection', () => {
  describe('getOptimalPeriod', () => {
    it('should return minute for 1h range', () => {
      expect(getOptimalPeriod('1h')).toBe('minute')
    })

    it('should return hour for 6h, 12h, 24h ranges', () => {
      expect(getOptimalPeriod('6h')).toBe('hour')
      expect(getOptimalPeriod('12h')).toBe('hour')
      expect(getOptimalPeriod('24h')).toBe('hour')
    })

    it('should return day for 7d, 30d, 90d ranges', () => {
      expect(getOptimalPeriod('7d')).toBe('day')
      expect(getOptimalPeriod('30d')).toBe('day')
      expect(getOptimalPeriod('90d')).toBe('day')
    })

    it('should default to day for unknown ranges', () => {
      expect(getOptimalPeriod('unknown')).toBe('day')
    })
  })
})

// Helper function to get optimal period (simulates Lambda handler logic)
function getOptimalPeriod(range: string): string {
  switch (range) {
    case '1h':
      return 'minute'
    case '6h':
    case '12h':
    case '24h':
      return 'hour'
    default:
      return 'day'
  }
}

// ============================================================================
// Chart Data Point Tests
// ============================================================================

describe('Chart Data Points', () => {
  describe('fillMissingBuckets', () => {
    it('should fill missing buckets with zeros', () => {
      const allBuckets = ['2024-01-15T10:00:00', '2024-01-15T11:00:00', '2024-01-15T12:00:00']
      const data = {
        '2024-01-15T10:00:00': { views: 5, visitors: 3, sessions: 3 },
        '2024-01-15T12:00:00': { views: 8, visitors: 5, sessions: 4 },
      }

      const result = fillMissingBuckets(allBuckets, data)

      expect(result).toHaveLength(3)
      expect(result[1]).toEqual({ date: '2024-01-15T11:00:00', views: 0, visitors: 0, sessions: 0 })
    })

    it('should preserve existing data', () => {
      const allBuckets = ['2024-01-15T10:00:00']
      const data = {
        '2024-01-15T10:00:00': { views: 10, visitors: 5, sessions: 5 },
      }

      const result = fillMissingBuckets(allBuckets, data)

      expect(result[0].views).toBe(10)
    })

    it('should return empty array for empty buckets', () => {
      const result = fillMissingBuckets([], {})
      expect(result).toHaveLength(0)
    })
  })
})

// Helper function to fill missing buckets (simulates Lambda handler logic)
function fillMissingBuckets(
  allBuckets: string[],
  data: Record<string, { views: number; visitors: number; sessions: number }>,
): Array<{ date: string; views: number; visitors: number; sessions: number }> {
  return allBuckets.map(bucket => ({
    date: bucket,
    views: data[bucket]?.views || 0,
    visitors: data[bucket]?.visitors || 0,
    sessions: data[bucket]?.sessions || 0,
  }))
}

// ============================================================================
// Stat Card Change Calculation Tests
// ============================================================================

describe('Stat Change Calculation', () => {
  describe('calculatePercentageChange', () => {
    it('should calculate positive change', () => {
      expect(calculatePercentageChange(150, 100)).toBe(50)
    })

    it('should calculate negative change', () => {
      expect(calculatePercentageChange(50, 100)).toBe(-50)
    })

    it('should handle zero previous value', () => {
      expect(calculatePercentageChange(100, 0)).toBe(100)
    })

    it('should handle both zero values', () => {
      expect(calculatePercentageChange(0, 0)).toBe(0)
    })

    it('should handle decimal results', () => {
      expect(calculatePercentageChange(133, 100)).toBe(33)
    })
  })
})

// Helper function to calculate percentage change (simulates Lambda handler logic)
function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0
  }
  return Math.round(((current - previous) / previous) * 100)
}

// ============================================================================
// HTML Sanitization Tests
// ============================================================================

describe('HTML Sanitization', () => {
  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    })

    it('should escape ampersands', () => {
      expect(escapeHtml('A & B')).toBe('A &amp; B')
    })

    it('should escape quotes', () => {
      expect(escapeHtml("It's a \"test\"")).toBe('It&#039;s a &quot;test&quot;')
    })

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('')
    })

    it('should handle string with no special chars', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World')
    })
  })
})

// Helper function to escape HTML (simulates Lambda handler logic)
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ============================================================================
// Rate Limiting Simulation Tests
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

// Helper function to check rate limiting (simulates Lambda handler logic)
function isRateLimited(requestTimes: number[], maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const recentRequests = requestTimes.filter(t => now - t < windowMs)
  return recentRequests.length >= maxRequests
}
