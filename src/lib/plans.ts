/**
 * Account plans & limits (#62) — billing foundation.
 *
 * Every account has a plan (USER# record `plan` field, default 'free') with
 * three limits: projects, monthly events across all owned projects, and max
 * retention days. 0 means unlimited. Enforcement points:
 *   - project create  → maxProjects (hard 403)
 *   - ingest          → monthlyEvents via an atomic per-account month counter
 *                       (USER#{ownerId} / QUOTA#{YYYY-MM}); fails open
 *   - retention update → retentionDays clamp
 * All plans are effectively generous-free until billing exists; the checks and
 * storage are what this scaffolds.
 */
import { dynamodb, TABLE_NAME, unmarshall } from './dynamodb'
import { monthKey, quotaExceeded } from './quota'

export interface PlanLimits {
  /** Max owned projects (0 = unlimited). */
  maxProjects: number
  /** Max events per calendar month across all owned projects (0 = unlimited). */
  monthlyEvents: number
  /** Max data retention in days (0 = unlimited). */
  retentionDays: number
}

export const PLANS: Record<string, PlanLimits> = {
  free: { maxProjects: 25, monthlyEvents: 1_000_000, retentionDays: 365 },
  pro: { maxProjects: 100, monthlyEvents: 10_000_000, retentionDays: 1095 },
  unlimited: { maxProjects: 0, monthlyEvents: 0, retentionDays: 0 },
}

/** Limits for a plan name; unknown/missing plans resolve to free. Pure — unit tested. */
export function planLimits(plan?: string | null): PlanLimits {
  return PLANS[plan || 'free'] || PLANS.free
}

// Plan lookups happen on the ingest hot path → small in-memory cache.
const planCache = new Map<string, { plan: string, expires: number }>()
const PLAN_CACHE_TTL = 5 * 60_000

/** The account's plan name (USER# record `plan`, default 'free'). */
export async function getUserPlan(userId: string): Promise<string> {
  const hit = planCache.get(userId)
  if (hit && hit.expires > Date.now())
    return hit.plan
  let plan = 'free'
  try {
    const res = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: `USER#${userId}` }, sk: { S: `USER#${userId}` } },
    }) as { Item?: Record<string, any> }
    if (res.Item) {
      const user = unmarshall(res.Item)
      if (user.plan && PLANS[user.plan])
        plan = user.plan
    }
  }
  catch (e) {
    console.error('Plan lookup failed:', (e as Error).message)
  }
  planCache.set(userId, { plan, expires: Date.now() + PLAN_CACHE_TTL })
  return plan
}

/**
 * Atomically count an event against the owner's monthly account quota and
 * report whether it is still within plan. Fails open on errors; no-op (true)
 * when the plan is unlimited.
 */
export async function accountEventWithinQuota(ownerId: string): Promise<boolean> {
  const limits = planLimits(await getUserPlan(ownerId))
  if (limits.monthlyEvents <= 0)
    return true
  try {
    const res = await dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: `USER#${ownerId}` }, sk: { S: `QUOTA#${monthKey()}` } },
      UpdateExpression: 'ADD #c :one SET #t = if_not_exists(#t, :ttl)',
      ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
      ExpressionAttributeValues: { ':one': { N: '1' }, ':ttl': { N: String(Math.floor(Date.now() / 1000) + 70 * 24 * 3600) } },
      ReturnValues: 'UPDATED_NEW',
    }) as { Attributes?: Record<string, unknown> }
    const count = res.Attributes ? (unmarshall(res.Attributes).count as number) : 0
    return !quotaExceeded(count, limits.monthlyEvents)
  }
  catch (e) {
    console.error('Account quota check failed:', (e as Error).message)
    return true
  }
}
