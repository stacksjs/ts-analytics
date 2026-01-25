/**
 * Data aggregation and calculation tests
 * Tests time series aggregation, statistics, and pagination
 */

import { describe, expect, it } from 'bun:test'

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

      expect(duration).toBeLessThan(100)
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

function calculateBounceRate(bounces: number, sessions: number): number {
  if (bounces < 0 || sessions <= 0) return 0
  return Math.round((bounces / sessions) * 10000) / 100
}

// ============================================================================
// Percentage Edge Cases Tests
// ============================================================================

describe('Percentage Calculation Edge Cases', () => {
  describe('calculatePercentageExtended', () => {
    it('should handle very small percentages', () => {
      expect(calculatePercentage(1, 10000)).toBe(0.01)
    })

    it('should handle percentages over 100%', () => {
      expect(calculatePercentage(150, 100)).toBe(150)
    })

    it('should round to 2 decimal places', () => {
      expect(calculatePercentage(1, 3)).toBe(33.33)
    })

    it('should handle infinity cases', () => {
      expect(calculatePercentage(100, 0)).toBe(100)
      expect(calculatePercentage(0, 0)).toBe(0)
    })

    it('should handle very large numbers', () => {
      expect(calculatePercentage(1e10, 1e12)).toBe(1)
    })
  })
})

function calculatePercentage(value: number, total: number): number {
  if (total <= 0) return value > 0 ? 100 : 0
  return Math.round((value / total) * 10000) / 100
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

function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0
  }
  return Math.round(((current - previous) / previous) * 100)
}

// ============================================================================
// Pagination Tests
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
