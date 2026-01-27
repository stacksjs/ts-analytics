/**
 * Goal matching and conversion logic
 */

import { generateId } from '../../src/index'
import { Goal, Conversion } from '../../src/models/orm'
import { getCachedGoals, setCachedGoals, hasConverted, markConverted } from '../utils/cache'

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
  } catch (err) {
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
      } catch {
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
        // Record conversion
        await Conversion.record({
          id: generateId(),
          siteId,
          goalId: goal.id,
          visitorId,
          sessionId,
          value: goal.value,
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
  } catch (err) {
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
