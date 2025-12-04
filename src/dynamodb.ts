/**
 * DynamoDB Utilities for Analytics
 *
 * Integrates with dynamodb-tooling for DynamoDB operations.
 * Provides analytics-specific helpers for single-table design.
 */

import type { AnalyticsConfig } from './config'
import { getConfig } from './config'
import type { AggregationPeriod, AnalyticsEntityType, AnalyticsKeyPatterns } from './types'

// Re-export dynamodb-tooling utilities when available
// Note: The npm package (0.3.2) has limited exports. When updated,
// uncomment and use the full utilities:
// export { config as dynamodbConfig } from 'dynamodb-tooling'

// ============================================================================
// Key Builders
// ============================================================================

/**
 * Build a partition key for an analytics entity
 */
export function buildPK(entityType: AnalyticsEntityType, id: string): string {
  return `${entityType}#${id}`
}

/**
 * Build a sort key for an analytics entity
 */
export function buildSK(entityType: AnalyticsEntityType, ...parts: string[]): string {
  return [entityType, ...parts].join('#')
}

/**
 * Build a composite key with timestamp
 */
export function buildTimestampKey(
  prefix: string,
  timestamp: Date,
  id?: string,
): string {
  const ts = timestamp.toISOString()
  return id ? `${prefix}#${ts}#${id}` : `${prefix}#${ts}`
}

/**
 * Build GSI1 partition key
 */
export function buildGSI1PK(siteId: string, dimension: string, value: string): string {
  return `SITE#${siteId}#${dimension}#${value}`
}

/**
 * Build period-based sort key for aggregates
 */
export function buildPeriodSK(
  prefix: string,
  period: AggregationPeriod,
  periodStart: string,
  ...additionalParts: string[]
): string {
  const parts = [prefix, period.toUpperCase(), periodStart, ...additionalParts]
  return parts.join('#')
}

// ============================================================================
// Key Patterns (matching Analytics.ts patterns)
// ============================================================================

/**
 * Analytics key patterns for single-table design
 */
export const KeyPatterns = {
  site: {
    pk: (siteId: string): string => `SITE#${siteId}`,
    sk: (siteId: string): string => `SITE#${siteId}`,
    gsi1pk: (ownerId: string): string => `OWNER#${ownerId}`,
    gsi1sk: (siteId: string): string => `SITE#${siteId}`,
  },

  pageView: {
    pk: (siteId: string): string => `SITE#${siteId}`,
    sk: (timestamp: Date, id: string): string => `PV#${timestamp.toISOString()}#${id}`,
    gsi1pk: (siteId: string, date: string): string => `SITE#${siteId}#DATE#${date}`,
    gsi1sk: (path: string, id: string): string => `PATH#${path}#${id}`,
  },

  session: {
    pk: (siteId: string): string => `SITE#${siteId}`,
    sk: (sessionId: string): string => `SESSION#${sessionId}`,
  },

  event: {
    pk: (siteId: string): string => `SITE#${siteId}`,
    sk: (timestamp: Date, id: string): string => `EVENT#${timestamp.toISOString()}#${id}`,
  },

  goal: {
    pk: (siteId: string): string => `SITE#${siteId}`,
    sk: (goalId: string): string => `GOAL#${goalId}`,
  },

  stats: {
    pk: (siteId: string): string => `SITE#${siteId}`,
    sk: (period: AggregationPeriod, periodStart: string): string =>
      `STATS#${period.toUpperCase()}#${periodStart}`,
  },

  pageStats: {
    pk: (siteId: string): string => `SITE#${siteId}`,
    sk: (period: AggregationPeriod, periodStart: string, path: string): string =>
      `PAGESTATS#${period.toUpperCase()}#${periodStart}#${encodeURIComponent(path)}`,
  },

  realtime: {
    pk: (siteId: string): string => `SITE#${siteId}`,
    sk: (minute: string): string => `REALTIME#${minute}`,
  },
} as const

// ============================================================================
// DynamoDB Item Helpers
// ============================================================================

/**
 * Convert a JavaScript value to DynamoDB AttributeValue
 */
export function toDynamoValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { NULL: true }
  }
  if (typeof value === 'string') {
    return { S: value }
  }
  if (typeof value === 'number') {
    return { N: String(value) }
  }
  if (typeof value === 'boolean') {
    return { BOOL: value }
  }
  if (value instanceof Date) {
    return { S: value.toISOString() }
  }
  if (Array.isArray(value)) {
    return { L: value.map(toDynamoValue) }
  }
  if (typeof value === 'object') {
    const map: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      map[k] = toDynamoValue(v)
    }
    return { M: map }
  }
  return { S: String(value) }
}

/**
 * Convert DynamoDB AttributeValue to JavaScript value
 */
export function fromDynamoValue(attr: Record<string, unknown>): unknown {
  if ('S' in attr) return attr.S
  if ('N' in attr) return Number(attr.N)
  if ('BOOL' in attr) return attr.BOOL
  if ('NULL' in attr) return null
  if ('L' in attr) return (attr.L as Record<string, unknown>[]).map(fromDynamoValue)
  if ('M' in attr) {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(attr.M as Record<string, unknown>)) {
      result[k] = fromDynamoValue(v as Record<string, unknown>)
    }
    return result
  }
  if ('SS' in attr) return attr.SS
  if ('NS' in attr) return (attr.NS as string[]).map(Number)
  return attr
}

/**
 * Marshal a JavaScript object to DynamoDB Item
 */
export function marshal(obj: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const item: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      item[key] = toDynamoValue(value)
    }
  }
  return item
}

/**
 * Unmarshal a DynamoDB Item to JavaScript object
 */
export function unmarshal(item: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    result[key] = fromDynamoValue(value)
  }
  return result
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Build a query for items by site and sort key prefix
 */
export function buildSiteQuery(
  siteId: string,
  skPrefix: string,
  config?: AnalyticsConfig,
): {
  TableName: string
  KeyConditionExpression: string
  ExpressionAttributeValues: Record<string, Record<string, string>>
} {
  const cfg = config ?? getConfig()

  return {
    TableName: cfg.table.tableName,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: KeyPatterns.site.pk(siteId) },
      ':skPrefix': { S: skPrefix },
    },
  }
}

/**
 * Build a query for items in a time range
 */
export function buildTimeRangeQuery(
  siteId: string,
  skPrefix: string,
  startTime: Date,
  endTime: Date,
  config?: AnalyticsConfig,
): {
  TableName: string
  KeyConditionExpression: string
  ExpressionAttributeValues: Record<string, Record<string, string>>
} {
  const cfg = config ?? getConfig()

  return {
    TableName: cfg.table.tableName,
    KeyConditionExpression: 'pk = :pk AND sk BETWEEN :skStart AND :skEnd',
    ExpressionAttributeValues: {
      ':pk': { S: KeyPatterns.site.pk(siteId) },
      ':skStart': { S: `${skPrefix}#${startTime.toISOString()}` },
      ':skEnd': { S: `${skPrefix}#${endTime.toISOString()}` },
    },
  }
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique ID (ULID-like)
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}${random}`
}

/**
 * Generate a session ID
 */
export function generateSessionId(): string {
  return `sess_${generateId()}`
}

/**
 * Hash a visitor ID for privacy
 */
export async function hashVisitorId(
  ip: string,
  userAgent: string,
  siteId: string,
  salt: string,
): Promise<string> {
  const data = `${ip}|${userAgent}|${siteId}|${salt}`

  // Use Web Crypto API
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

  return hashHex.substring(0, 16) // Return first 16 chars
}

// ============================================================================
// Period Utilities
// ============================================================================

/**
 * Get the start of a period
 */
export function getPeriodStart(date: Date, period: AggregationPeriod): string {
  const d = new Date(date)

  switch (period) {
    case 'hour':
      d.setMinutes(0, 0, 0)
      return d.toISOString().slice(0, 13) // YYYY-MM-DDTHH
    case 'day':
      d.setHours(0, 0, 0, 0)
      return d.toISOString().slice(0, 10) // YYYY-MM-DD
    case 'month':
      d.setDate(1)
      d.setHours(0, 0, 0, 0)
      return d.toISOString().slice(0, 7) // YYYY-MM
    default:
      return d.toISOString().slice(0, 10)
  }
}

/**
 * Get the appropriate period for a date range
 */
export function determinePeriod(startDate: Date, endDate: Date): AggregationPeriod {
  const diffMs = endDate.getTime() - startDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  if (diffDays <= 2) return 'hour'
  if (diffDays <= 90) return 'day'
  return 'month'
}

/**
 * Get daily salt for visitor ID hashing (rotates daily for privacy)
 */
export function getDailySalt(): string {
  const today = new Date().toISOString().slice(0, 10)
  return `analytics-${today}`
}
