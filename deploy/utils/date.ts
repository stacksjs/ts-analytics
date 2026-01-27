/**
 * Date utilities for the analytics API
 */

/**
 * Parse date range from query parameters
 */
export function parseDateRange(query: Record<string, string> | undefined): { startDate: Date; endDate: Date } {
  const now = new Date()
  const endDate = query?.endDate ? new Date(query.endDate) : now
  let startDate: Date

  if (query?.startDate) {
    startDate = new Date(query.startDate)
  } else {
    // Default to last 30 days
    startDate = new Date(now)
    startDate.setDate(startDate.getDate() - 30)
  }

  return { startDate, endDate }
}

/**
 * Parse date range from dateRange string (e.g., '6h', '24h', '7d', '30d')
 */
export function parseDateRangeString(dateRange: string | undefined): { startDate: Date; endDate: Date } {
  const now = new Date()
  const endDate = now
  let startDate = new Date(now)

  const range = dateRange || '30d'
  const value = parseInt(range.slice(0, -1))
  const unit = range.slice(-1)

  switch (unit) {
    case 'h':
      startDate.setHours(startDate.getHours() - value)
      break
    case 'd':
      startDate.setDate(startDate.getDate() - value)
      break
    case 'w':
      startDate.setDate(startDate.getDate() - value * 7)
      break
    case 'm':
      startDate.setMonth(startDate.getMonth() - value)
      break
    case 'y':
      startDate.setFullYear(startDate.getFullYear() - value)
      break
    default:
      startDate.setDate(startDate.getDate() - 30)
  }

  return { startDate, endDate }
}

/**
 * Format duration in mm:ss format
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Format duration in human readable format
 */
export function formatDurationHuman(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/**
 * Get ISO date string for a date (YYYY-MM-DD)
 */
export function toISODateString(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Get start of day for a date
 */
export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Get end of day for a date
 */
export function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

/**
 * Get the appropriate time interval for aggregation based on date range
 */
export function getTimeInterval(startDate: Date, endDate: Date): 'hour' | 'day' | 'week' | 'month' {
  const diffMs = endDate.getTime() - startDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  if (diffDays <= 2) return 'hour'
  if (diffDays <= 60) return 'day'
  if (diffDays <= 180) return 'week'
  return 'month'
}
