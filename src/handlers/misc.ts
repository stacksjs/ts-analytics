/**
 * Miscellaneous handlers (health, sites list, revenue, site management)
 */

import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * GET /health
 */
export async function handleHealth(_request: Request): Promise<Response> {
  return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() })
}

/**
 * POST /api/sites - Create a new site
 */
export async function handleCreateSite(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { name?: string; domain?: string; domains?: string[] }

    if (!body.name) {
      return jsonResponse({ error: 'Site name is required' }, 400)
    }

    const siteId = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const domains = body.domains || (body.domain ? [body.domain] : [])
    const now = new Date().toISOString()

    // Check if site already exists
    const existing = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: 'SITES' },
        sk: { S: `SITE#${siteId}` },
      },
    })

    if (existing.Item) {
      return jsonResponse({ error: 'Site already exists', siteId }, 409)
    }

    // Create the site
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: 'SITES',
        sk: `SITE#${siteId}`,
        id: siteId,
        siteId,
        name: body.name,
        domains,
        createdAt: now,
        updatedAt: now,
      }),
    })

    return jsonResponse({
      success: true,
      site: {
        id: siteId,
        name: body.name,
        domains,
        createdAt: now,
      },
    }, 201)
  } catch (error) {
    console.error('Create site error:', error)
    return errorResponse('Failed to create site')
  }
}

/**
 * Ensure a site exists (auto-create if not) - used by collect handler
 */
export async function ensureSiteExists(siteId: string, hostname?: string): Promise<void> {
  try {
    // Check if site exists
    const existing = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: 'SITES' },
        sk: { S: `SITE#${siteId}` },
      },
    })

    if (!existing.Item) {
      const now = new Date().toISOString()
      const domains = hostname ? [hostname] : []

      // Auto-create the site
      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshall({
          pk: 'SITES',
          sk: `SITE#${siteId}`,
          id: siteId,
          siteId,
          name: siteId, // Use siteId as name, can be updated later
          domains,
          createdAt: now,
          updatedAt: now,
          autoCreated: true,
        }),
      })
      console.log(`[ensureSiteExists] Auto-created site: ${siteId}`)
    }
  } catch (error) {
    // Log but don't fail - site creation is best-effort
    console.error('[ensureSiteExists] Error:', error)
  }
}

/**
 * GET /api/sites
 */
export async function handleGetSites(_request: Request): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: 'SITES' },
      },
    }) as { Items?: any[] }

    const sites = (result.Items || []).map(unmarshall).map((s: any) => ({
      id: s.id || s.siteId,
      name: s.name,
      domains: s.domains || [],
      createdAt: s.createdAt,
    }))

    sites.sort((a: any, b: any) => a.name.localeCompare(b.name))

    return jsonResponse({
      sites,
      total: sites.length,
    })
  } catch (error) {
    console.error('Get sites error:', error)
    return errorResponse('Failed to fetch sites')
  }
}

/**
 * GET /api/sites/{siteId}/revenue
 */
export async function handleGetRevenue(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    // Query events with revenue data
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `EVENT#${startDate.toISOString()}` },
        ':end': { S: `EVENT#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const events = (result.Items || []).map(unmarshall)
      .filter(e => e.revenue !== undefined || e.eventName === 'purchase' || e.eventName === 'conversion')

    // Calculate revenue metrics
    let totalRevenue = 0
    let transactionCount = 0
    const revenueByDay: Record<string, number> = {}
    const revenueBySource: Record<string, number> = {}

    for (const event of events) {
      const revenue = event.revenue || event.value || 0
      totalRevenue += revenue
      transactionCount++

      const day = event.timestamp.slice(0, 10)
      revenueByDay[day] = (revenueByDay[day] || 0) + revenue

      const source = event.utmSource || event.referrerSource || 'direct'
      revenueBySource[source] = (revenueBySource[source] || 0) + revenue
    }

    const avgOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0

    const dailyRevenue = Object.entries(revenueByDay)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const revenueBySourceList = Object.entries(revenueBySource)
      .map(([source, revenue]) => ({ source, revenue }))
      .sort((a, b) => b.revenue - a.revenue)

    return jsonResponse({
      totalRevenue,
      transactionCount,
      avgOrderValue,
      dailyRevenue,
      revenueBySource: revenueBySourceList,
      currency: 'USD',
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Get revenue error:', error)
    return errorResponse('Failed to fetch revenue')
  }
}
