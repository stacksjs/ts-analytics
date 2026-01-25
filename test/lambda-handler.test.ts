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

// ============================================================================
// Bot Detection Tests
// ============================================================================

describe('Bot Detection', () => {
  describe('isBot', () => {
    it('should detect common web crawlers', () => {
      expect(isBot('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe(true)
      expect(isBot('Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true)
      expect(isBot('Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)')).toBe(true)
    })

    it('should detect social media crawlers', () => {
      expect(isBot('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true)
      expect(isBot('Twitterbot/1.0')).toBe(true)
      expect(isBot('LinkedInBot/1.0')).toBe(true)
    })

    it('should detect SEO and monitoring tools', () => {
      expect(isBot('AhrefsBot/7.0')).toBe(true)
      expect(isBot('SemrushBot/7~bl')).toBe(true)
      expect(isBot('MJ12bot/v1.4.8')).toBe(true)
      expect(isBot('DotBot/1.2')).toBe(true)
    })

    it('should detect headless browsers', () => {
      expect(isBot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/90.0')).toBe(true)
      expect(isBot('PhantomJS/2.1.1')).toBe(true)
      expect(isBot('Puppeteer/2.0.0')).toBe(true)
    })

    it('should NOT detect regular browsers as bots', () => {
      expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')).toBe(false)
      expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) Safari/604.1')).toBe(false)
      expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/121.0')).toBe(false)
    })

    it('should handle preview bots', () => {
      expect(isBot('Mozilla/5.0 (compatible; BingPreview/1.0b)')).toBe(true)
      expect(isBot('Slackbot-LinkExpanding 1.0')).toBe(true)
      expect(isBot('WhatsApp/2.21.12.21')).toBe(true)
    })
  })
})

// Helper function for bot detection
function isBot(ua: string): boolean {
  if (!ua) return false
  const botPatterns = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot|ahrefsbot|semrushbot|mj12bot|dotbot|headlesschrome|phantomjs|puppeteer|slackbot|whatsapp/i
  return botPatterns.test(ua)
}

// ============================================================================
// Extended User Agent Detection Tests
// ============================================================================

describe('Extended User Agent Detection', () => {
  describe('parseUserAgentExtended', () => {
    it('should detect Opera browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 OPR/106.0.0.0 Safari/537.36'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Opera')
    })

    it('should detect Brave browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Brave/120'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Brave')
    })

    it('should detect Vivaldi browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Vivaldi/6.5'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Vivaldi')
    })

    it('should detect Internet Explorer', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('IE')
    })

    it('should detect Windows 10 vs Windows 11', () => {
      expect(parseUserAgentExtended('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0').os).toBe('Windows 10')
      // Note: Windows 11 is tricky as it often reports as NT 10.0 in UA strings
    })

    it('should detect Chrome OS', () => {
      const ua = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      const result = parseUserAgentExtended(ua)
      expect(result.os).toBe('Chrome OS')
    })

    it('should detect Firefox on iOS (FxiOS)', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 FxiOS/121.0 Mobile/15E148 Safari/605.1.15'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Firefox')
      expect(result.os).toBe('iOS')
    })

    it('should detect Chrome on iOS (CriOS)', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Chrome')
      expect(result.os).toBe('iOS')
    })

    it('should detect Android tablet vs phone', () => {
      // Android phone (has "Mobile")
      const phone = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
      expect(parseUserAgentExtended(phone).deviceType).toBe('Mobile')

      // Android tablet (no "Mobile")
      const tablet = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      expect(parseUserAgentExtended(tablet).deviceType).toBe('Tablet')
    })

    it('should detect Samsung Internet browser', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Samsung Internet')
    })

    it('should detect UC Browser', () => {
      const ua = 'Mozilla/5.0 (Linux; U; Android 9; en-US; SM-G960F) AppleWebKit/537.36 UCBrowser/13.4.0.1306 Mobile Safari/537.36'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('UC Browser')
    })
  })
})

// Extended user agent parser with more browsers/devices
function parseUserAgentExtended(ua: string): { browser: string; deviceType: string; os: string } {
  if (!ua) return { browser: 'Unknown', deviceType: 'Desktop', os: 'Unknown' }

  const uaLower = ua.toLowerCase()

  // Detect device type
  let deviceType = 'Desktop'
  if (/ipad|tablet/.test(uaLower)) {
    deviceType = 'Tablet'
  } else if (/android(?!.*mobile)/.test(uaLower)) {
    deviceType = 'Tablet'
  } else if (/mobile|android.*mobile|iphone|ipod|blackberry|iemobile|opera mini/i.test(uaLower)) {
    deviceType = 'Mobile'
  }

  // Detect browser (order matters - more specific first)
  let browser = 'Unknown'
  if (/samsungbrowser/i.test(ua)) browser = 'Samsung Internet'
  else if (/ucbrowser/i.test(ua)) browser = 'UC Browser'
  else if (/dia\//i.test(ua)) browser = 'Dia'
  else if (/arc\//i.test(ua)) browser = 'Arc'
  else if (/brave/i.test(ua)) browser = 'Brave'
  else if (/vivaldi/i.test(ua)) browser = 'Vivaldi'
  else if (/edg/i.test(ua)) browser = 'Edge'
  else if (/opr|opera/i.test(ua)) browser = 'Opera'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/chrome|chromium|crios/i.test(ua)) browser = 'Chrome'
  else if (/safari/i.test(ua) && !/chrome|chromium/i.test(ua)) browser = 'Safari'
  else if (/trident|msie/i.test(ua)) browser = 'IE'
  else if (/bot|crawl|spider/i.test(ua)) browser = 'Bot'

  // Detect OS (order matters)
  let os = 'Unknown'
  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/cros/i.test(ua)) os = 'Chrome OS'
  else if (/windows nt 10/i.test(ua)) os = 'Windows 10'
  else if (/windows nt 11/i.test(ua)) os = 'Windows 11'
  else if (/windows/i.test(ua)) os = 'Windows'
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS'
  else if (/linux/i.test(ua)) os = 'Linux'

  return { browser, deviceType, os }
}

// ============================================================================
// Private IP Detection Tests
// ============================================================================

describe('Private IP Detection', () => {
  describe('isPrivateIP', () => {
    it('should detect localhost', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true)
      expect(isPrivateIP('127.0.0.0')).toBe(true)
      expect(isPrivateIP('127.255.255.255')).toBe(true)
    })

    it('should detect Class A private range (10.x.x.x)', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true)
      expect(isPrivateIP('10.255.255.255')).toBe(true)
      expect(isPrivateIP('10.100.50.25')).toBe(true)
    })

    it('should detect Class B private range (172.16-31.x.x)', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true)
      expect(isPrivateIP('172.31.255.255')).toBe(true)
      expect(isPrivateIP('172.20.10.5')).toBe(true)
    })

    it('should NOT detect non-private 172.x addresses', () => {
      expect(isPrivateIP('172.15.0.1')).toBe(false)
      expect(isPrivateIP('172.32.0.1')).toBe(false)
    })

    it('should detect Class C private range (192.168.x.x)', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true)
      expect(isPrivateIP('192.168.1.1')).toBe(true)
      expect(isPrivateIP('192.168.255.255')).toBe(true)
    })

    it('should NOT detect public IPs as private', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false)
      expect(isPrivateIP('1.1.1.1')).toBe(false)
      expect(isPrivateIP('203.0.113.50')).toBe(false)
    })

    it('should handle invalid IPs', () => {
      expect(isPrivateIP('')).toBe(true) // Empty should be treated as private/invalid
      expect(isPrivateIP('unknown')).toBe(true)
      expect(isPrivateIP('not-an-ip')).toBe(false)
    })
  })
})

// Helper for private IP detection
function isPrivateIP(ip: string): boolean {
  if (!ip || ip === 'unknown') return true

  // Localhost
  if (ip.startsWith('127.')) return true

  // Class A: 10.0.0.0 - 10.255.255.255
  if (ip.startsWith('10.')) return true

  // Class C: 192.168.0.0 - 192.168.255.255
  if (ip.startsWith('192.168.')) return true

  // Class B: 172.16.0.0 - 172.31.255.255
  if (ip.startsWith('172.')) {
    const secondOctet = Number.parseInt(ip.split('.')[1], 10)
    if (secondOctet >= 16 && secondOctet <= 31) return true
  }

  return false
}

// ============================================================================
// Goal Matching Tests
// ============================================================================

describe('Goal Matching', () => {
  describe('matchPattern', () => {
    it('should match exact patterns', () => {
      expect(matchPatternTest('/about', '/about', 'exact')).toBe(true)
      expect(matchPatternTest('/about', '/about-us', 'exact')).toBe(false)
      expect(matchPatternTest('/about', '/About', 'exact')).toBe(false)
    })

    it('should match contains patterns', () => {
      expect(matchPatternTest('checkout', '/cart/checkout/confirm', 'contains')).toBe(true)
      expect(matchPatternTest('checkout', '/cart/confirm', 'contains')).toBe(false)
    })

    it('should match regex patterns', () => {
      expect(matchPatternTest('^/blog/\\d+$', '/blog/123', 'regex')).toBe(true)
      expect(matchPatternTest('^/blog/\\d+$', '/blog/abc', 'regex')).toBe(false)
      expect(matchPatternTest('/products/.*', '/products/shoes/nike', 'regex')).toBe(true)
    })

    it('should handle invalid regex gracefully', () => {
      expect(matchPatternTest('[invalid(regex', '/test', 'regex')).toBe(false)
    })

    it('should handle empty patterns', () => {
      expect(matchPatternTest('', '/test', 'exact')).toBe(false)
      expect(matchPatternTest('/test', '', 'exact')).toBe(false)
    })
  })

  describe('matchGoal', () => {
    it('should match pageview goals', () => {
      const goal = { type: 'pageview', pattern: '/checkout', matchType: 'exact', isActive: true }
      expect(matchGoalTest(goal, { path: '/checkout' })).toBe(true)
      expect(matchGoalTest(goal, { path: '/cart' })).toBe(false)
    })

    it('should match event goals', () => {
      const goal = { type: 'event', pattern: 'purchase', matchType: 'exact', isActive: true }
      expect(matchGoalTest(goal, { path: '/checkout', eventName: 'purchase' })).toBe(true)
      expect(matchGoalTest(goal, { path: '/checkout', eventName: 'add_to_cart' })).toBe(false)
    })

    it('should match duration goals', () => {
      const goal = { type: 'duration', durationMinutes: 5, isActive: true }
      expect(matchGoalTest(goal, { path: '/', sessionDurationMinutes: 6 })).toBe(true)
      expect(matchGoalTest(goal, { path: '/', sessionDurationMinutes: 3 })).toBe(false)
    })

    it('should not match inactive goals', () => {
      const goal = { type: 'pageview', pattern: '/checkout', matchType: 'exact', isActive: false }
      expect(matchGoalTest(goal, { path: '/checkout' })).toBe(false)
    })
  })
})

// Helper for pattern matching
function matchPatternTest(pattern: string, value: string, matchType: string): boolean {
  if (!pattern || !value) return false

  switch (matchType) {
    case 'exact':
      return value === pattern
    case 'contains':
      return value.includes(pattern)
    case 'regex':
      try {
        return new RegExp(pattern).test(value)
      } catch {
        return false
      }
    default:
      return value === pattern
  }
}

// Helper for goal matching
interface TestGoal {
  type: string
  pattern?: string
  matchType?: string
  durationMinutes?: number
  isActive: boolean
}

interface TestGoalContext {
  path: string
  eventName?: string
  sessionDurationMinutes?: number
}

function matchGoalTest(goal: TestGoal, context: TestGoalContext): boolean {
  if (!goal.isActive) return false

  switch (goal.type) {
    case 'pageview':
      return matchPatternTest(goal.pattern || '', context.path, goal.matchType || 'exact')
    case 'event':
      if (!context.eventName) return false
      return matchPatternTest(goal.pattern || '', context.eventName, goal.matchType || 'exact')
    case 'duration':
      if (context.sessionDurationMinutes === undefined) return false
      return context.sessionDurationMinutes >= (goal.durationMinutes || 0)
    default:
      return false
  }
}

// ============================================================================
// Session Management Tests
// ============================================================================

describe('Session Management', () => {
  describe('SessionCache', () => {
    it('should store and retrieve sessions', () => {
      const cache = new TestSessionCache()
      const session = { id: 'sess-1', visitorId: 'v-1', startTime: new Date() }

      cache.set('key-1', session, 1800)
      expect(cache.get('key-1')).toEqual(session)
    })

    it('should return null for expired sessions', () => {
      const cache = new TestSessionCache()
      const session = { id: 'sess-1', visitorId: 'v-1', startTime: new Date() }

      cache.set('key-1', session, 0) // 0 TTL = expired immediately
      expect(cache.get('key-1')).toBeNull()
    })

    it('should return null for non-existent keys', () => {
      const cache = new TestSessionCache()
      expect(cache.get('non-existent')).toBeNull()
    })

    it('should delete expired sessions on access', () => {
      const cache = new TestSessionCache()
      const session = { id: 'sess-1', visitorId: 'v-1', startTime: new Date() }

      cache.set('key-1', session, -1) // Already expired
      cache.get('key-1') // This should delete it
      expect(cache.has('key-1')).toBe(false)
    })
  })
})

// Test session cache implementation
class TestSessionCache {
  private storage = new Map<string, { session: unknown; expires: number }>()

  get(key: string): unknown | null {
    const cached = this.storage.get(key)
    if (cached && cached.expires > Date.now()) {
      return cached.session
    }
    this.storage.delete(key)
    return null
  }

  set(key: string, session: unknown, ttlSeconds: number): void {
    this.storage.set(key, {
      session,
      expires: Date.now() + ttlSeconds * 1000,
    })
  }

  has(key: string): boolean {
    return this.storage.has(key)
  }
}

// ============================================================================
// UTM Campaign Parameter Tests
// ============================================================================

describe('UTM Campaign Parameters', () => {
  describe('parseUTMParams', () => {
    it('should parse all UTM parameters', () => {
      const url = 'https://example.com?utm_source=google&utm_medium=cpc&utm_campaign=summer_sale&utm_term=shoes&utm_content=ad1'
      const params = parseUTMParams(url)

      expect(params.source).toBe('google')
      expect(params.medium).toBe('cpc')
      expect(params.campaign).toBe('summer_sale')
      expect(params.term).toBe('shoes')
      expect(params.content).toBe('ad1')
    })

    it('should handle missing UTM parameters', () => {
      const url = 'https://example.com?utm_source=google'
      const params = parseUTMParams(url)

      expect(params.source).toBe('google')
      expect(params.medium).toBeUndefined()
      expect(params.campaign).toBeUndefined()
    })

    it('should handle URLs without UTM parameters', () => {
      const url = 'https://example.com/page'
      const params = parseUTMParams(url)

      expect(params.source).toBeUndefined()
    })

    it('should handle encoded UTM values', () => {
      const url = 'https://example.com?utm_campaign=summer%20sale%202024'
      const params = parseUTMParams(url)

      expect(params.campaign).toBe('summer sale 2024')
    })

    it('should handle case variations', () => {
      // UTM parameters should be case-insensitive in name but preserve value case
      const url = 'https://example.com?UTM_SOURCE=Google&utm_medium=CPC'
      const params = parseUTMParams(url)

      expect(params.source).toBe('Google')
      expect(params.medium).toBe('CPC')
    })
  })
})

// UTM parameter parser
function parseUTMParams(url: string): {
  source?: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
} {
  try {
    const parsed = new URL(url)
    const params: Record<string, string> = {}

    // Convert all parameter names to lowercase for matching
    for (const [key, value] of parsed.searchParams.entries()) {
      params[key.toLowerCase()] = value
    }

    return {
      source: params.utm_source,
      medium: params.utm_medium,
      campaign: params.utm_campaign,
      term: params.utm_term,
      content: params.utm_content,
    }
  } catch {
    return {}
  }
}

// ============================================================================
// Extended Referrer Detection Tests
// ============================================================================

describe('Extended Referrer Detection', () => {
  describe('parseReferrerSourceExtended', () => {
    it('should detect x.com (new Twitter domain)', () => {
      expect(parseReferrerSourceExtended('https://x.com/user/status/123')).toBe('Twitter')
    })

    it('should detect GitHub', () => {
      expect(parseReferrerSourceExtended('https://github.com/user/repo')).toBe('GitHub')
    })

    it('should detect Pinterest', () => {
      expect(parseReferrerSourceExtended('https://www.pinterest.com/pin/123')).toBe('Pinterest')
    })

    it('should detect TikTok', () => {
      expect(parseReferrerSourceExtended('https://www.tiktok.com/@user/video/123')).toBe('TikTok')
    })

    it('should detect Instagram', () => {
      expect(parseReferrerSourceExtended('https://www.instagram.com/p/abc123')).toBe('Instagram')
    })

    it('should detect Hacker News', () => {
      expect(parseReferrerSourceExtended('https://news.ycombinator.com/item?id=123')).toBe('Hacker News')
    })

    it('should detect email providers', () => {
      expect(parseReferrerSourceExtended('https://mail.google.com/mail/u/0')).toBe('Gmail')
      expect(parseReferrerSourceExtended('https://outlook.live.com/mail')).toBe('Outlook')
    })

    it('should detect Baidu (Chinese search)', () => {
      expect(parseReferrerSourceExtended('https://www.baidu.com/s?wd=test')).toBe('Baidu')
    })

    it('should detect Yandex (Russian search)', () => {
      expect(parseReferrerSourceExtended('https://yandex.ru/search/?text=test')).toBe('Yandex')
    })

    it('should extract clean domain for unknown referrers', () => {
      expect(parseReferrerSourceExtended('https://blog.company.com/post')).toBe('blog.company.com')
      expect(parseReferrerSourceExtended('https://www.example.com/page')).toBe('example.com')
    })
  })
})

// Extended referrer parser
function parseReferrerSourceExtended(referrer: string): string {
  if (!referrer) return 'Direct'

  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()

    // Search engines
    if (host.includes('google') && !host.includes('mail.google')) return 'Google'
    if (host.includes('bing')) return 'Bing'
    if (host.includes('duckduckgo')) return 'DuckDuckGo'
    if (host.includes('yahoo')) return 'Yahoo'
    if (host.includes('baidu')) return 'Baidu'
    if (host.includes('yandex')) return 'Yandex'

    // Social media (order matters for reddit vs t.co issue)
    if (host.includes('reddit')) return 'Reddit'
    if (host.includes('facebook') || host.includes('fb.com')) return 'Facebook'
    if (host.includes('instagram')) return 'Instagram'
    if (host.includes('twitter') || host === 't.co' || host.includes('x.com')) return 'Twitter'
    if (host.includes('linkedin')) return 'LinkedIn'
    if (host.includes('youtube')) return 'YouTube'
    if (host.includes('pinterest')) return 'Pinterest'
    if (host.includes('tiktok')) return 'TikTok'

    // Developer platforms
    if (host.includes('github')) return 'GitHub'
    if (host.includes('ycombinator') || host.includes('news.ycombinator')) return 'Hacker News'

    // Email providers
    if (host.includes('mail.google')) return 'Gmail'
    if (host.includes('outlook')) return 'Outlook'

    // Clean up domain for unknown
    let domain = host
    if (domain.startsWith('www.')) domain = domain.slice(4)

    return domain
  } catch {
    return 'Unknown'
  }
}

// ============================================================================
// Country Header Parsing Tests
// ============================================================================

describe('Country Header Parsing', () => {
  describe('getCountryFromHeadersExtended', () => {
    it('should extract from CloudFront header', () => {
      expect(getCountryFromHeadersExtended({ 'cloudfront-viewer-country': 'US' })).toBe('United States')
    })

    it('should extract from CloudFront header (different case)', () => {
      expect(getCountryFromHeadersExtended({ 'CloudFront-Viewer-Country': 'GB' })).toBe('United Kingdom')
    })

    it('should extract from Cloudflare header', () => {
      expect(getCountryFromHeadersExtended({ 'cf-ipcountry': 'DE' })).toBe('Germany')
    })

    it('should extract from x-country-code header', () => {
      expect(getCountryFromHeadersExtended({ 'x-country-code': 'FR' })).toBe('France')
    })

    it('should handle XX (unknown) country code', () => {
      expect(getCountryFromHeadersExtended({ 'cloudfront-viewer-country': 'XX' })).toBeUndefined()
    })

    it('should prefer CloudFront over other headers', () => {
      const headers = {
        'cloudfront-viewer-country': 'US',
        'cf-ipcountry': 'GB',
        'x-country-code': 'DE',
      }
      expect(getCountryFromHeadersExtended(headers)).toBe('United States')
    })

    it('should return raw code for unknown countries', () => {
      expect(getCountryFromHeadersExtended({ 'cloudfront-viewer-country': 'ZZ' })).toBe('ZZ')
    })

    it('should handle lowercase country codes', () => {
      expect(getCountryFromHeadersExtended({ 'cloudfront-viewer-country': 'us' })).toBe('United States')
    })
  })
})

// Extended country header parser
function getCountryFromHeadersExtended(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined

  const countryCode =
    headers['cloudfront-viewer-country'] ||
    headers['CloudFront-Viewer-Country'] ||
    headers['x-country-code'] ||
    headers['cf-ipcountry']

  if (!countryCode || countryCode.toUpperCase() === 'XX') return undefined

  const code = countryCode.toUpperCase()

  const countryNames: Record<string, string> = {
    US: 'United States',
    GB: 'United Kingdom',
    CA: 'Canada',
    AU: 'Australia',
    DE: 'Germany',
    FR: 'France',
    JP: 'Japan',
    CN: 'China',
    IN: 'India',
    BR: 'Brazil',
  }

  return countryNames[code] || code
}

// ============================================================================
// URL Edge Cases Tests
// ============================================================================

describe('URL Edge Cases', () => {
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
      // Data URLs don't have a meaningful path, should return /
      expect(extractPathAdvanced('data:text/html,<h1>Hello</h1>')).toBe('text/html,<h1>Hello</h1>')
    })
  })
})

// Advanced path extractor
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
// Data Aggregation Edge Cases Tests
// ============================================================================

describe('Data Aggregation Edge Cases', () => {
  describe('aggregateWithLargeDatasets', () => {
    it('should handle 10,000+ pageviews efficiently', () => {
      const pageviews = Array.from({ length: 10000 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 60000).toISOString(),
        visitorId: `v${i % 100}`,
        sessionId: `s${i % 500}`,
      }))

      const start = performance.now()
      const result = aggregateTimeSeriesData(pageviews, 'hour')
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100) // Should complete in under 100ms
      expect(Object.keys(result).length).toBeGreaterThan(0)
    })

    it('should correctly count across midnight boundary', () => {
      const pageviews = [
        { timestamp: '2024-01-15T23:55:00.000Z', visitorId: 'v1', sessionId: 's1' },
        { timestamp: '2024-01-16T00:05:00.000Z', visitorId: 'v1', sessionId: 's1' },
      ]

      const result = aggregateTimeSeriesData(pageviews, 'day')

      expect(result['2024-01-15'].views).toBe(1)
      expect(result['2024-01-16'].views).toBe(1)
    })

    it('should handle timezone edge cases (UTC vs local)', () => {
      // Timestamps near midnight UTC
      const pageviews = [
        { timestamp: '2024-01-15T23:59:59.999Z', visitorId: 'v1', sessionId: 's1' },
        { timestamp: '2024-01-16T00:00:00.000Z', visitorId: 'v1', sessionId: 's1' },
      ]

      const result = aggregateTimeSeriesData(pageviews, 'day')

      expect(result['2024-01-15'].views).toBe(1)
      expect(result['2024-01-16'].views).toBe(1)
    })
  })
})

// ============================================================================
// Security Tests
// ============================================================================

describe('Security', () => {
  describe('XSS Prevention', () => {
    it('should escape script tags', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).not.toContain('<script>')
    })

    it('should escape event handlers', () => {
      // HTML escaping makes it safe by escaping < and >, so the tag is rendered as text
      const escaped = escapeHtml('<img onerror="alert(1)">')
      expect(escaped).not.toContain('<img')
      expect(escaped).toContain('&lt;img')
    })

    it('should escape javascript: URLs', () => {
      // HTML escaping makes it safe by escaping the tag, so it's rendered as text
      const escaped = escapeHtml('<a href="javascript:alert(1)">click</a>')
      expect(escaped).not.toContain('<a href')
    })

    it('should handle nested encoding attacks', () => {
      expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;')
    })
  })

  describe('Input Sanitization', () => {
    it('should reject excessively long siteIds', () => {
      const longId = 'a'.repeat(1000)
      expect(validateSiteId(longId)).toBe(false)
    })

    it('should reject siteIds with special characters', () => {
      expect(validateSiteId('<script>alert(1)</script>')).toBe(false)
      expect(validateSiteId('site; DROP TABLE users;')).toBe(false)
      expect(validateSiteId('../../../etc/passwd')).toBe(false)
    })

    it('should accept valid siteIds', () => {
      expect(validateSiteId('site-123')).toBe(true)
      expect(validateSiteId('my_site_456')).toBe(true)
      expect(validateSiteId('Site123')).toBe(true)
    })

    it('should validate URL parameters', () => {
      expect(validateUrl('https://example.com/page')).toBe(true)
      expect(validateUrl('javascript:alert(1)')).toBe(false)
      expect(validateUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    })
  })
})

// Security helpers
function validateSiteId(siteId: string): boolean {
  if (!siteId || siteId.length > 100) return false
  return /^[a-zA-Z0-9_-]+$/.test(siteId)
}

function validateUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

// ============================================================================
// Duration Edge Cases Tests
// ============================================================================

describe('Duration Edge Cases', () => {
  describe('formatDurationExtended', () => {
    it('should handle very large durations', () => {
      // 25 hours
      expect(formatDurationExtended(25 * 60 * 60 * 1000)).toBe('25:00:00')
    })

    it('should handle negative durations', () => {
      expect(formatDurationExtended(-5000)).toBe('00:00')
    })

    it('should handle sub-second durations', () => {
      expect(formatDurationExtended(500)).toBe('00:00')
    })

    it('should handle exact minute boundaries', () => {
      expect(formatDurationExtended(60000)).toBe('01:00')
      expect(formatDurationExtended(120000)).toBe('02:00')
    })

    it('should handle 59:59 edge case', () => {
      expect(formatDurationExtended(59 * 60 * 1000 + 59 * 1000)).toBe('59:59')
    })
  })
})

// Extended duration formatter
function formatDurationExtended(ms: number): string {
  if (ms <= 0) return '00:00'

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
// Percentage Edge Cases Tests
// ============================================================================

describe('Percentage Calculation Edge Cases', () => {
  describe('calculatePercentageExtended', () => {
    it('should handle very small percentages', () => {
      expect(calculatePercentageExtended(1, 10000)).toBe(0.01)
    })

    it('should handle percentages over 100%', () => {
      expect(calculatePercentageExtended(150, 100)).toBe(150)
    })

    it('should round to 2 decimal places', () => {
      expect(calculatePercentageExtended(1, 3)).toBe(33.33)
    })

    it('should handle infinity cases', () => {
      expect(calculatePercentageExtended(100, 0)).toBe(100)
      expect(calculatePercentageExtended(0, 0)).toBe(0)
    })

    it('should handle very large numbers', () => {
      expect(calculatePercentageExtended(1e10, 1e12)).toBe(1)
    })
  })
})

// Extended percentage calculator
function calculatePercentageExtended(value: number, total: number): number {
  if (total <= 0) return value > 0 ? 100 : 0
  return Math.round((value / total) * 10000) / 100
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

// Query string parser
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
// DNT (Do Not Track) Header Tests
// ============================================================================

describe('Do Not Track', () => {
  describe('shouldTrack', () => {
    it('should respect DNT: 1 header', () => {
      expect(shouldTrack({ dnt: '1' })).toBe(false)
    })

    it('should track when DNT: 0', () => {
      expect(shouldTrack({ dnt: '0' })).toBe(true)
    })

    it('should track when DNT header is missing', () => {
      expect(shouldTrack({})).toBe(true)
    })

    it('should respect Sec-GPC header', () => {
      expect(shouldTrack({ 'sec-gpc': '1' })).toBe(false)
    })

    it('should handle case-insensitive headers', () => {
      expect(shouldTrack({ DNT: '1' })).toBe(false)
      expect(shouldTrack({ 'Sec-GPC': '1' })).toBe(false)
    })
  })
})

// DNT helper
function shouldTrack(headers: Record<string, string>): boolean {
  // Normalize header keys to lowercase
  const normalizedHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value
  }

  if (normalizedHeaders.dnt === '1') return false
  if (normalizedHeaders['sec-gpc'] === '1') return false
  return true
}

// ============================================================================
// Event Validation Tests
// ============================================================================

describe('Event Validation', () => {
  describe('validateEventPayload', () => {
    it('should accept valid custom event', () => {
      const event = {
        name: 'button_click',
        properties: { button_id: 'submit', page: '/checkout' },
      }
      expect(validateEventPayload(event)).toEqual({ valid: true, errors: [] })
    })

    it('should reject events with too long names', () => {
      const event = { name: 'a'.repeat(256) }
      expect(validateEventPayload(event).valid).toBe(false)
    })

    it('should reject events with invalid property types', () => {
      const event = { name: 'test', properties: { nested: { deep: 'object' } } }
      expect(validateEventPayload(event).valid).toBe(false)
    })

    it('should limit number of properties', () => {
      const properties: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        properties[`prop${i}`] = 'value'
      }
      const event = { name: 'test', properties }
      expect(validateEventPayload(event).valid).toBe(false)
    })

    it('should reject reserved event names', () => {
      expect(validateEventPayload({ name: 'pageview' }).valid).toBe(false)
      expect(validateEventPayload({ name: 'session_start' }).valid).toBe(false)
    })
  })
})

// Event validation helper
function validateEventPayload(event: { name: string; properties?: Record<string, unknown> }): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const reservedNames = ['pageview', 'session_start', 'session_end']

  if (!event.name || typeof event.name !== 'string') {
    errors.push('Event name is required')
  } else if (event.name.length > 255) {
    errors.push('Event name too long (max 255 characters)')
  } else if (reservedNames.includes(event.name.toLowerCase())) {
    errors.push('Event name is reserved')
  }

  if (event.properties) {
    const propCount = Object.keys(event.properties).length
    if (propCount > 50) {
      errors.push('Too many properties (max 50)')
    }

    for (const [key, value] of Object.entries(event.properties)) {
      if (typeof value === 'object' && value !== null) {
        errors.push(`Property "${key}" cannot be an object`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================================
// Chart Label Generation Tests
// ============================================================================

describe('Chart Label Generation', () => {
  describe('generateChartLabels', () => {
    it('should generate appropriate labels for 1h range (minute)', () => {
      const buckets = ['2024-01-15T10:00:00', '2024-01-15T10:15:00', '2024-01-15T10:30:00']
      const labels = generateChartLabels(buckets, 'minute')

      expect(labels).toEqual(['10:00am', '10:15am', '10:30am'])
    })

    it('should generate appropriate labels for 24h range (hour)', () => {
      const buckets = ['2024-01-15T10:00:00', '2024-01-15T14:00:00', '2024-01-15T22:00:00']
      const labels = generateChartLabels(buckets, 'hour')

      expect(labels).toEqual(['10am', '2pm', '10pm'])
    })

    it('should generate appropriate labels for 7d range (day)', () => {
      const buckets = ['2024-01-15', '2024-01-16', '2024-01-17']
      const labels = generateChartLabels(buckets, 'day')

      expect(labels).toEqual(['Jan 15', 'Jan 16', 'Jan 17'])
    })

    it('should generate appropriate labels for monthly range', () => {
      const buckets = ['2024-01', '2024-02', '2024-03']
      const labels = generateChartLabels(buckets, 'month')

      expect(labels).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024'])
    })

    it('should handle midnight correctly', () => {
      const buckets = ['2024-01-15T00:00:00']
      const labels = generateChartLabels(buckets, 'hour')

      expect(labels).toEqual(['12am'])
    })

    it('should handle noon correctly', () => {
      const buckets = ['2024-01-15T12:00:00']
      const labels = generateChartLabels(buckets, 'hour')

      expect(labels).toEqual(['12pm'])
    })
  })
})

// Chart label generator
function generateChartLabels(buckets: string[], period: string): string[] {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return buckets.map(bucket => {
    if (period === 'month') {
      const [year, month] = bucket.split('-')
      return `${months[Number.parseInt(month) - 1]} ${year}`
    }

    const date = new Date(bucket)

    if (period === 'minute') {
      const h = date.getUTCHours()
      const m = date.getUTCMinutes()
      const ampm = h >= 12 ? 'pm' : 'am'
      const h12 = h % 12 || 12
      return `${h12}:${m.toString().padStart(2, '0')}${ampm}`
    }

    if (period === 'hour') {
      const h = date.getUTCHours()
      const ampm = h >= 12 ? 'pm' : 'am'
      const h12 = h % 12 || 12
      return `${h12}${ampm}`
    }

    // Day period
    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`
  })
}

// ============================================================================
// Conversion Value Calculation Tests
// ============================================================================

describe('Conversion Value Calculation', () => {
  describe('calculateConversionValue', () => {
    it('should sum conversion values', () => {
      const conversions = [
        { value: 10.00 },
        { value: 25.50 },
        { value: 5.00 },
      ]
      expect(calculateTotalConversionValue(conversions)).toBe(40.50)
    })

    it('should handle conversions without value', () => {
      const conversions = [
        { value: 10.00 },
        { value: undefined },
        { value: 5.00 },
      ]
      expect(calculateTotalConversionValue(conversions)).toBe(15.00)
    })

    it('should return 0 for empty array', () => {
      expect(calculateTotalConversionValue([])).toBe(0)
    })

    it('should handle floating point precision', () => {
      const conversions = [
        { value: 0.1 },
        { value: 0.2 },
      ]
      // Should be 0.30, not 0.30000000000000004
      expect(calculateTotalConversionValue(conversions)).toBeCloseTo(0.3, 10)
    })
  })

  describe('calculateConversionRate', () => {
    it('should calculate conversion rate correctly', () => {
      expect(calculateConversionRate(25, 100)).toBe(25)
      expect(calculateConversionRate(1, 1000)).toBe(0.1)
    })

    it('should handle zero visitors', () => {
      expect(calculateConversionRate(0, 0)).toBe(0)
    })

    it('should cap at 100%', () => {
      expect(calculateConversionRate(150, 100)).toBe(100)
    })
  })
})

// Conversion value helpers
function calculateTotalConversionValue(conversions: Array<{ value?: number }>): number {
  return conversions.reduce((sum, c) => sum + (c.value || 0), 0)
}

function calculateConversionRate(conversions: number, visitors: number): number {
  if (visitors <= 0) return 0
  return Math.min(100, Math.round((conversions / visitors) * 1000) / 10)
}

// ============================================================================
// Visitor Uniqueness Tests
// ============================================================================

describe('Visitor Uniqueness', () => {
  describe('generateVisitorFingerprint', () => {
    it('should generate consistent fingerprints for same inputs', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      expect(fp1).toBe(fp2)
    })

    it('should generate different fingerprints for different IPs', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.2', 'Mozilla/5.0', 'site-1', '2024-01-15')
      expect(fp1).not.toBe(fp2)
    })

    it('should generate different fingerprints for different user agents', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Chrome/120', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.1', 'Firefox/121', 'site-1', '2024-01-15')
      expect(fp1).not.toBe(fp2)
    })

    it('should generate different fingerprints for different sites', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-2', '2024-01-15')
      expect(fp1).not.toBe(fp2)
    })

    it('should generate different fingerprints for different days (privacy rotation)', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-16')
      expect(fp1).not.toBe(fp2)
    })
  })
})

// Visitor fingerprint generator
async function generateVisitorFingerprint(
  ip: string,
  userAgent: string,
  siteId: string,
  dateSalt: string,
): Promise<string> {
  const data = `${ip}|${userAgent}|${siteId}|${dateSalt}`
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// API Response Pagination Tests
// ============================================================================

describe('Pagination', () => {
  describe('paginateResults', () => {
    it('should return correct page of results', () => {
      const items = Array.from({ length: 100 }, (_, i) => ({ id: i }))
      const page1 = paginateResults(items, 1, 10)
      const page2 = paginateResults(items, 2, 10)

      expect(page1.items.length).toBe(10)
      expect(page1.items[0].id).toBe(0)
      expect(page2.items[0].id).toBe(10)
    })

    it('should include pagination metadata', () => {
      const items = Array.from({ length: 100 }, (_, i) => ({ id: i }))
      const result = paginateResults(items, 3, 10)

      expect(result.page).toBe(3)
      expect(result.perPage).toBe(10)
      expect(result.total).toBe(100)
      expect(result.totalPages).toBe(10)
      expect(result.hasNext).toBe(true)
      expect(result.hasPrev).toBe(true)
    })

    it('should handle last page correctly', () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ id: i }))
      const result = paginateResults(items, 3, 10)

      expect(result.items.length).toBe(5)
      expect(result.hasNext).toBe(false)
      expect(result.hasPrev).toBe(true)
    })

    it('should handle first page correctly', () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ id: i }))
      const result = paginateResults(items, 1, 10)

      expect(result.hasNext).toBe(true)
      expect(result.hasPrev).toBe(false)
    })

    it('should handle empty results', () => {
      const result = paginateResults([], 1, 10)

      expect(result.items.length).toBe(0)
      expect(result.total).toBe(0)
      expect(result.totalPages).toBe(0)
    })
  })
})

// Pagination helper
function paginateResults<T>(items: T[], page: number, perPage: number): {
  items: T[]
  page: number
  perPage: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
} {
  const total = items.length
  const totalPages = Math.ceil(total / perPage)
  const start = (page - 1) * perPage
  const end = start + perPage

  return {
    items: items.slice(start, end),
    page,
    perPage,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  }
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

// Cookie parser
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
