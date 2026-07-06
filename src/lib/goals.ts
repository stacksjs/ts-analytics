/**
 * Goal matching and conversion logic
 */

import { generateId } from '../../src/index'
import { Goal, Conversion } from '../../src/models/orm'
import { getCachedGoals, setCachedGoals, hasConverted, markConverted } from '../utils/cache'
import { dynamodb, TABLE_NAME, isConditionalCheckFailed } from './dynamodb'

/**
 * Get goals for a site (with caching)
 */
export async function getGoalsForSite(siteId: string): Promise<Goal[]> {
  const cached = getCachedGoals(siteId)
  if (cached) {
    return cached
  }

  try {
    const goals = await Goal.forSite(siteId).active().get()
    setCachedGoals(siteId, goals)
    return goals
  }
catch (err) {
    console.error('[Goals] Failed to fetch goals:', err)
    return []
  }
}

/**
 * Context for goal matching
 */
export interface GoalMatchContext {
  path: string
  eventName?: string
  /**
   * The triggering event's value — used as the conversion value for
   * variable-price goals (e.g. a purchase), falling back to the goal's static
   * value when the event carries none (#132).
   */
  eventValue?: number
  sessionDurationMinutes?: number
}

/**
 * Check if a goal matches the given context
 */
export function matchGoal(goal: Goal, context: GoalMatchContext): boolean {
  if (!goal.isActive) return false

  switch (goal.type) {
    case 'pageview':
      return matchPattern(goal.pattern, context.path, goal.matchType)

    case 'event':
      if (!context.eventName) return false
      return matchPattern(goal.pattern, context.eventName, goal.matchType)

    case 'duration':
      if (context.sessionDurationMinutes === undefined) return false
      const threshold = goal.durationMinutes || 0
      return context.sessionDurationMinutes >= threshold

    default:
      return false
  }
}

/**
 * Match a pattern against a value
 */
function matchPattern(pattern: string, value: string, matchType: string): boolean {
  if (!pattern || !value) return false

  switch (matchType) {
    case 'exact':
      return value === pattern

    case 'contains':
      return value.includes(pattern)

    case 'regex':
      try {
        const regex = new RegExp(pattern)
        return regex.test(value)
      }
catch {
        console.warn(`[Goals] Invalid regex pattern: ${pattern}`)
        return false
      }

    default:
      return value === pattern
  }
}

/**
 * Metadata for conversion attribution
 */
export interface ConversionMetadata {
  referrerSource?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}


/**
 * Durable once-per-session conversion claim (#174). The in-process
 * hasConverted Map dedupes only within one instance (capped at 1,000 sessions
 * with arbitrary eviction) — on Lambda the same session converted once per
 * concurrent instance, inflating a revenue-grade metric. A conditional put on
 * a CONVLOCK item makes exactly one instance win; the Map stays as a cheap
 * fast-path.
 */
async function claimConversionLock(siteId: string, sessionId: string, goalId: string): Promise<boolean> {
  try {
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: {
        pk: { S: `SITE#${siteId}` },
        sk: { S: `CONVLOCK#${sessionId}#${goalId}` },
        // Sessions idle out after 30 minutes — 24h is generous headroom.
        ttl: { N: String(Math.floor(Date.now() / 1000) + 24 * 60 * 60) },
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    })
    return true
  }
  catch (e) {
    if (isConditionalCheckFailed(e))
      return false
    throw e
  }
}

/**
 * Check and record conversions for all matching goals
 */
export async function checkAndRecordConversions(
  siteId: string,
  visitorId: string,
  sessionId: string,
  context: GoalMatchContext,
  metadata: ConversionMetadata
): Promise<void> {
  try {
    const goals = await getGoalsForSite(siteId)
    if (goals.length === 0) return

    const timestamp = new Date()

    for (const goal of goals) {
      // Skip if already converted in this session
      if (hasConverted(siteId, sessionId, goal.id)) continue

      if (matchGoal(goal, context)) {
        // Durable claim first — exactly one instance records this conversion.
        const claimed = await claimConversionLock(siteId, sessionId, goal.id)
        if (!claimed) {
          markConverted(siteId, sessionId, goal.id)
          continue
        }
        // Record conversion
        await Conversion.record({
          id: generateId(),
          siteId,
          goalId: goal.id,
          visitorId,
          sessionId,
          // Use the event's actual value for variable-price goals; fall back to
          // the goal's configured static value otherwise (#132).
          value: context.eventValue ?? goal.value,
          path: context.path,
          referrerSource: metadata.referrerSource,
          utmSource: metadata.utmSource,
          utmMedium: metadata.utmMedium,
          utmCampaign: metadata.utmCampaign,
          timestamp,
        })

        markConverted(siteId, sessionId, goal.id)
        console.log(`[Goals] Conversion recorded: ${goal.name} for session ${sessionId}`)
      }
    }
  }
catch (err) {
    console.error('[Goals] Error checking conversions:', err)
  }
}

/**
 * Calculate conversion rate
 */
export function calculateConversionRate(conversions: number, totalVisitors: number): number {
  if (totalVisitors === 0) return 0
  return (conversions / totalVisitors) * 100
}

/**
 * Format conversion rate for display
 */
export function formatConversionRate(rate: number): string {
  return `${rate.toFixed(2)}%`
}
