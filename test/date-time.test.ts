/**
 * Date and Time handling tests
 * Tests date range parsing, time series buckets, duration formatting, and chart labels
 */

import { describe, expect, it } from 'bun:test'

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

function parseDateRange(params: Record<string, string> | null): { startDate: Date; endDate: Date } {
  const now = new Date()
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  let startDate = params?.startDate ? new Date(params.startDate) : defaultStart
  let endDate = params?.endDate ? new Date(params.endDate) : now

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
// Duration Formatting Tests
// ============================================================================

describe('Duration Formatting', () => {
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

    it('should handle very large durations', () => {
      expect(formatDuration(25 * 60 * 60 * 1000)).toBe('25:00:00')
    })

    it('should handle negative durations', () => {
      expect(formatDuration(-5000)).toBe('00:00')
    })

    it('should handle sub-second durations', () => {
      expect(formatDuration(500)).toBe('00:00')
    })

    it('should handle exact minute boundaries', () => {
      expect(formatDuration(60000)).toBe('01:00')
      expect(formatDuration(120000)).toBe('02:00')
    })

    it('should handle 59:59 edge case', () => {
      expect(formatDuration(59 * 60 * 1000 + 59 * 1000)).toBe('59:59')
    })
  })

  describe('calculateDuration', () => {
    it('should calculate duration in milliseconds', () => {
      const start = new Date('2024-01-15T10:00:00.000Z')
      const end = new Date('2024-01-15T10:05:00.000Z')

      expect(calculateDuration(start, end)).toBe(300000)
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
})

function formatDuration(ms: number): string {
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

function calculateDuration(start: Date, end: Date): number {
  return Math.abs(end.getTime() - start.getTime())
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

    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`
  })
}

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

function getDailySalt(date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10)
  return `analytics-salt-${dateStr}`
}
