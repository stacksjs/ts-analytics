/**
 * Goal CRUD handlers
 */

import { generateId } from '../../src/index'
import { Goal, Conversion } from '../../src/models/orm'
import { dynamodb, TABLE_NAME, unmarshall } from '../lib/dynamodb'
import { invalidateGoalCache } from '../utils/cache'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../lambda-adapter'

/**
 * POST /api/sites/{siteId}/goals
 */
export async function handleCreateGoal(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.name || !body.type) {
      return jsonResponse({ error: 'Missing required fields: name, type' }, 400)
    }

    if (!['pageview', 'event', 'duration'].includes(body.type)) {
      return jsonResponse({ error: 'Invalid type. Must be: pageview, event, or duration' }, 400)
    }

    if ((body.type === 'pageview' || body.type === 'event') && !body.pattern) {
      return jsonResponse({ error: 'Pattern is required for pageview and event goals' }, 400)
    }

    if (body.type === 'duration' && (!body.durationMinutes || body.durationMinutes < 1)) {
      return jsonResponse({ error: 'durationMinutes is required for duration goals (min: 1)' }, 400)
    }

    const goal = await Goal.create({
      id: generateId(),
      siteId,
      name: body.name,
      type: body.type,
      pattern: body.pattern || '',
      matchType: body.matchType || 'exact',
      durationMinutes: body.durationMinutes,
      value: body.value,
      isActive: body.isActive ?? true,
    })

    invalidateGoalCache(siteId)
    return jsonResponse({ goal }, 201)
  } catch (error) {
    console.error('Create goal error:', error)
    return errorResponse('Failed to create goal')
  }
}

/**
 * GET /api/sites/{siteId}/goals
 */
export async function handleGetGoals(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const includeInactive = query.includeInactive === 'true'
    const { startDate, endDate } = parseDateRange(query)

    const queryBuilder = Goal.forSite(siteId)
    if (!includeInactive) {
      queryBuilder.active()
    }
    const goals = await queryBuilder.get()

    const goalsWithStats = await Promise.all(goals.map(async (goal) => {
      let conversions: Conversion[] = []
      try {
        conversions = await Conversion.forGoal(siteId, goal.id)
          .since(startDate)
          .until(endDate)
          .get()
      } catch (e) {
        console.log('[GetGoals] Conversion query failed:', e)
      }

      const uniqueVisitors = new Set(conversions.map(c => c.visitorId)).size
      const totalValue = conversions.reduce((sum, c) => sum + (c.value || 0), 0)

      return {
        id: goal.id,
        name: goal.name,
        type: goal.type,
        pattern: goal.pattern,
        matchType: goal.matchType,
        durationMinutes: goal.durationMinutes,
        value: goal.value,
        isActive: goal.isActive,
        conversions: conversions.length,
        uniqueConversions: uniqueVisitors,
        totalValue,
        createdAt: goal.createdAt,
      }
    }))

    return jsonResponse({ goals: goalsWithStats })
  } catch (error) {
    console.error('Get goals error:', error)
    return errorResponse('Failed to fetch goals')
  }
}

/**
 * PUT /api/sites/{siteId}/goals/{goalId}
 */
export async function handleUpdateGoal(request: Request, siteId: string, goalId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (body.type && !['pageview', 'event', 'duration'].includes(body.type)) {
      return jsonResponse({ error: 'Invalid type. Must be: pageview, event, or duration' }, 400)
    }

    const goal = await Goal.update(siteId, goalId, {
      name: body.name,
      type: body.type,
      pattern: body.pattern,
      matchType: body.matchType,
      durationMinutes: body.durationMinutes,
      value: body.value,
      isActive: body.isActive,
    })

    invalidateGoalCache(siteId)
    return jsonResponse({ goal })
  } catch (error) {
    console.error('Update goal error:', error)
    return errorResponse('Failed to update goal')
  }
}

/**
 * DELETE /api/sites/{siteId}/goals/{goalId}
 */
export async function handleDeleteGoal(_request: Request, siteId: string, goalId: string): Promise<Response> {
  try {
    await Goal.delete(siteId, goalId)
    invalidateGoalCache(siteId)
    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Delete goal error:', error)
    return errorResponse('Failed to delete goal')
  }
}

/**
 * GET /api/sites/{siteId}/goals/stats
 */
export async function handleGetGoalStats(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    const goals = await Goal.forSite(siteId).get()

    const sessionsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
      Select: 'COUNT',
    }) as { Count?: number }
    const totalSessions = sessionsResult.Count || 0

    const goalStats = await Promise.all(goals.map(async (goal) => {
      const conversions = await Conversion.forGoal(siteId, goal.id)
        .since(startDate)
        .until(endDate)
        .get()

      const uniqueVisitors = new Set(conversions.map(c => c.visitorId)).size
      const totalValue = conversions.reduce((sum, c) => sum + (c.value || 0), 0)

      return {
        goalId: goal.id,
        goalName: goal.name,
        goalType: goal.type,
        conversions: conversions.length,
        uniqueConversions: uniqueVisitors,
        conversionRate: totalSessions > 0
          ? Math.round((uniqueVisitors / totalSessions) * 10000) / 100
          : 0,
        totalValue,
        isActive: goal.isActive,
      }
    }))

    const totalConversions = goalStats.reduce((sum, g) => sum + g.conversions, 0)
    const totalValue = goalStats.reduce((sum, g) => sum + g.totalValue, 0)

    return jsonResponse({
      goals: goalStats,
      summary: {
        totalGoals: goals.length,
        activeGoals: goals.filter(g => g.isActive).length,
        totalConversions,
        totalValue,
        totalSessions,
      },
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
    })
  } catch (error) {
    console.error('Get goal stats error:', error)
    return errorResponse('Failed to fetch goal stats')
  }
}
