/**
 * Performance & Web Vitals handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * GET /api/sites/{siteId}/vitals
 */
export async function handleGetVitals(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `VITAL#${startDate.toISOString()}` },
        ':end': { S: `VITAL#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const vitals = (result.Items || []).map(unmarshall)

    // Aggregate vitals by metric
    const metrics: Record<string, { values: number[]; paths: Record<string, number[]> }> = {
      LCP: { values: [], paths: {} },
      FID: { values: [], paths: {} },
      CLS: { values: [], paths: {} },
      FCP: { values: [], paths: {} },
      TTFB: { values: [], paths: {} },
      INP: { values: [], paths: {} },
    }

    for (const vital of vitals) {
      const metric = vital.metric || vital.name
      if (metrics[metric]) {
        metrics[metric].values.push(vital.value)
        const path = vital.path || '/'
        if (!metrics[metric].paths[path]) {
          metrics[metric].paths[path] = []
        }
        metrics[metric].paths[path].push(vital.value)
      }
    }

    // Calculate percentiles
    const calculatePercentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      const idx = Math.ceil((p / 100) * sorted.length) - 1
      return sorted[Math.max(0, idx)]
    }

    const getRating = (metric: string, value: number): 'good' | 'needs-improvement' | 'poor' => {
      const thresholds: Record<string, [number, number]> = {
        LCP: [2500, 4000],
        FID: [100, 300],
        CLS: [0.1, 0.25],
        FCP: [1800, 3000],
        TTFB: [800, 1800],
        INP: [200, 500],
      }
      const [good, poor] = thresholds[metric] || [0, 0]
      if (value <= good) return 'good'
      if (value <= poor) return 'needs-improvement'
      return 'poor'
    }

    const summary = Object.entries(metrics).map(([name, data]) => ({
      name,
      p50: calculatePercentile(data.values, 50),
      p75: calculatePercentile(data.values, 75),
      p95: calculatePercentile(data.values, 95),
      count: data.values.length,
      rating: getRating(name, calculatePercentile(data.values, 75)),
    }))

    // Get worst performing pages
    const worstPages: Array<{ path: string; metric: string; p75: number; rating: string }> = []
    for (const [metric, data] of Object.entries(metrics)) {
      for (const [path, values] of Object.entries(data.paths)) {
        const p75 = calculatePercentile(values, 75)
        const rating = getRating(metric, p75)
        if (rating === 'poor' || rating === 'needs-improvement') {
          worstPages.push({ path, metric, p75, rating })
        }
      }
    }
    worstPages.sort((a, b) => (b.rating === 'poor' ? 1 : 0) - (a.rating === 'poor' ? 1 : 0))

    return jsonResponse({
      vitals: summary,
      worstPages: worstPages.slice(0, 10),
      totalMeasurements: vitals.length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Get vitals error:', error)
    return errorResponse('Failed to fetch vitals')
  }
}

/**
 * GET /api/sites/{siteId}/vitals-trends
 */
export async function handleGetVitalsTrends(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const metric = query.metric || 'LCP'

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `VITAL#${startDate.toISOString()}` },
        ':end': { S: `VITAL#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const vitals = (result.Items || []).map(unmarshall)
      .filter(v => (v.metric || v.name) === metric)

    // Group by day
    const dailyData: Record<string, number[]> = {}
    for (const vital of vitals) {
      const day = vital.timestamp.slice(0, 10)
      if (!dailyData[day]) dailyData[day] = []
      dailyData[day].push(vital.value)
    }

    const calculatePercentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      const idx = Math.ceil((p / 100) * sorted.length) - 1
      return sorted[Math.max(0, idx)]
    }

    const trends = Object.entries(dailyData)
      .map(([date, values]) => ({
        date,
        p50: calculatePercentile(values, 50),
        p75: calculatePercentile(values, 75),
        p95: calculatePercentile(values, 95),
        count: values.length,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return jsonResponse({
      metric,
      trends,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Get vitals trends error:', error)
    return errorResponse('Failed to fetch vitals trends')
  }
}

/**
 * POST /api/sites/{siteId}/performance-budgets
 */
export async function handleCreatePerformanceBudget(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.metric || body.threshold === undefined) {
      return jsonResponse({ error: 'Missing required fields: metric, threshold' }, 400)
    }

    const validMetrics = ['LCP', 'FID', 'CLS', 'FCP', 'TTFB', 'INP']
    if (!validMetrics.includes(body.metric)) {
      return jsonResponse({ error: `Invalid metric. Must be one of: ${validMetrics.join(', ')}` }, 400)
    }

    const budgetId = generateId()
    const budget = {
      pk: `SITE#${siteId}`,
      sk: `BUDGET#${budgetId}`,
      id: budgetId,
      siteId,
      metric: body.metric,
      threshold: body.threshold,
      path: body.path || '*',
      alertOnViolation: body.alertOnViolation ?? true,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(budget),
    })

    return jsonResponse({ budget }, 201)
  } catch (error) {
    console.error('Create performance budget error:', error)
    return errorResponse('Failed to create performance budget')
  }
}

/**
 * GET /api/sites/{siteId}/performance-budgets
 */
export async function handleGetPerformanceBudgets(request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'BUDGET#' },
      },
    }) as { Items?: any[] }

    const budgets = (result.Items || []).map(unmarshall)

    return jsonResponse({ budgets })
  } catch (error) {
    console.error('Get performance budgets error:', error)
    return errorResponse('Failed to fetch performance budgets')
  }
}

/**
 * DELETE /api/sites/{siteId}/performance-budgets/{budgetId}
 */
export async function handleDeletePerformanceBudget(_request: Request, siteId: string, budgetId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `BUDGET#${budgetId}`,
      }),
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Delete performance budget error:', error)
    return errorResponse('Failed to delete performance budget')
  }
}

/**
 * GET /api/sites/{siteId}/performance-budgets/check
 */
export async function handleCheckPerformanceBudgets(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    // Get budgets
    const budgetsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'BUDGET#' },
      },
    }) as { Items?: any[] }

    const budgets = (budgetsResult.Items || []).map(unmarshall)

    if (budgets.length === 0) {
      return jsonResponse({ budgets: [], violations: [] })
    }

    // Get vitals
    const vitalsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `VITAL#${startDate.toISOString()}` },
        ':end': { S: `VITAL#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const vitals = (vitalsResult.Items || []).map(unmarshall)

    // Check each budget
    const violations: Array<{
      budgetId: string
      metric: string
      threshold: number
      currentP75: number
      path: string
      violationCount: number
    }> = []

    const calculatePercentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      const idx = Math.ceil((p / 100) * sorted.length) - 1
      return sorted[Math.max(0, idx)]
    }

    for (const budget of budgets) {
      const relevantVitals = vitals.filter(v => {
        const metric = v.metric || v.name
        if (metric !== budget.metric) return false
        if (budget.path && budget.path !== '*') {
          return v.path === budget.path
        }
        return true
      })

      if (relevantVitals.length === 0) continue

      const values = relevantVitals.map(v => v.value)
      const p75 = calculatePercentile(values, 75)
      const violatingValues = values.filter(v => v > budget.threshold)

      if (p75 > budget.threshold) {
        violations.push({
          budgetId: budget.id,
          metric: budget.metric,
          threshold: budget.threshold,
          currentP75: p75,
          path: budget.path || '*',
          violationCount: violatingValues.length,
        })
      }
    }

    return jsonResponse({
      budgets: budgets.map(b => ({
        ...b,
        hasViolation: violations.some(v => v.budgetId === b.id),
      })),
      violations,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Check performance budgets error:', error)
    return errorResponse('Failed to check performance budgets')
  }
}
