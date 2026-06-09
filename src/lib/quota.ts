/**
 * Per-project monthly event quota for error ingest.
 *
 * A coarse cap (separate from the per-key rate limit in lib/rate-limit) that
 * bounds total events per project per calendar month. Backed by a DynamoDB
 * counter so it holds across instances. Disabled by default (no quota set).
 */
import { dynamodb, TABLE_NAME, unmarshall } from './dynamodb'

/** Monthly event cap per project (env ANALYTICS_MONTHLY_EVENT_QUOTA; 0 = unlimited). */
export const MONTHLY_EVENT_QUOTA = Number(process.env.ANALYTICS_MONTHLY_EVENT_QUOTA) || 0

/** Current month bucket key (YYYY-MM). */
export function monthKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 7)
}

/** True when the running count has passed the limit (limit <= 0 means unlimited). */
export function quotaExceeded(count: number, limit: number): boolean {
  return limit > 0 && count > limit
}

/**
 * Atomically increment a project's monthly event counter and report whether it
 * is still within quota. Fails open (returns true) on errors so a quota glitch
 * never drops events; a no-op (true) when no quota is configured.
 */
export async function recordEventWithinQuota(siteId: string): Promise<boolean> {
  if (MONTHLY_EVENT_QUOTA <= 0) return true
  try {
    const res = await dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: `SITE#${siteId}` }, sk: { S: `QUOTA#${monthKey()}` } },
      UpdateExpression: 'ADD #c :one SET #t = if_not_exists(#t, :ttl)',
      ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
      ExpressionAttributeValues: { ':one': { N: '1' }, ':ttl': { N: String(Math.floor(Date.now() / 1000) + 70 * 24 * 3600) } },
      ReturnValues: 'UPDATED_NEW',
    }) as { Attributes?: Record<string, unknown> }
    const count = res.Attributes ? (unmarshall(res.Attributes).count as number) : 0
    return !quotaExceeded(count, MONTHLY_EVENT_QUOTA)
  }
catch (e) {
    console.error('Quota check failed:', (e as Error).message)
    return true
  }
}
