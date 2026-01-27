/**
 * Uptime monitoring handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * POST /api/sites/{siteId}/uptime
 */
export async function handleCreateUptimeMonitor(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.url) {
      return jsonResponse({ error: 'Missing required field: url' }, 400)
    }

    const monitorId = generateId()
    const monitor = {
      pk: `SITE#${siteId}`,
      sk: `UPTIME#${monitorId}`,
      id: monitorId,
      siteId,
      url: body.url,
      name: body.name || body.url,
      interval: body.interval || 60, // seconds
      timeout: body.timeout || 30, // seconds
      expectedStatus: body.expectedStatus || 200,
      alertEmail: body.alertEmail,
      alertWebhook: body.alertWebhook,
      isActive: body.isActive ?? true,
      status: 'unknown',
      lastChecked: null,
      lastResponseTime: null,
      uptimePercent: 100,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(monitor),
    })

    return jsonResponse({ monitor }, 201)
  } catch (error) {
    console.error('Create uptime monitor error:', error)
    return errorResponse('Failed to create uptime monitor')
  }
}

/**
 * GET /api/sites/{siteId}/uptime
 */
export async function handleGetUptimeMonitors(request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'UPTIME#' },
      },
    }) as { Items?: any[] }

    const monitors = (result.Items || []).map(unmarshall)

    return jsonResponse({ monitors })
  } catch (error) {
    console.error('Get uptime monitors error:', error)
    return errorResponse('Failed to fetch uptime monitors')
  }
}

/**
 * GET /api/sites/{siteId}/uptime/{monitorId}/history
 */
export async function handleGetUptimeHistory(request: Request, siteId: string, monitorId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `UPTIME_CHECK#${siteId}#${monitorId}` },
        ':start': { S: `CHECK#${startDate.toISOString()}` },
        ':end': { S: `CHECK#${endDate.toISOString()}` },
      },
      ScanIndexForward: false,
      Limit: 1000,
    }) as { Items?: any[] }

    const checks = (result.Items || []).map(unmarshall)

    // Calculate uptime stats
    const totalChecks = checks.length
    const successfulChecks = checks.filter(c => c.status === 'up').length
    const uptimePercent = totalChecks > 0 ? Math.round((successfulChecks / totalChecks) * 10000) / 100 : 100

    const avgResponseTime = totalChecks > 0
      ? Math.round(checks.reduce((sum, c) => sum + (c.responseTime || 0), 0) / totalChecks)
      : 0

    // Get incidents (status changes)
    const incidents: Array<{ timestamp: string; status: string; duration?: number }> = []
    let currentIncident: { start: string; status: string } | null = null

    for (let i = checks.length - 1; i >= 0; i--) {
      const check = checks[i]
      if (check.status === 'down' && !currentIncident) {
        currentIncident = { start: check.timestamp, status: 'down' }
      } else if (check.status === 'up' && currentIncident) {
        incidents.push({
          timestamp: currentIncident.start,
          status: currentIncident.status,
          duration: new Date(check.timestamp).getTime() - new Date(currentIncident.start).getTime(),
        })
        currentIncident = null
      }
    }

    if (currentIncident) {
      incidents.push({
        timestamp: currentIncident.start,
        status: currentIncident.status,
      })
    }

    return jsonResponse({
      checks: checks.slice(0, 100).map(c => ({
        timestamp: c.timestamp,
        status: c.status,
        responseTime: c.responseTime,
        statusCode: c.statusCode,
        error: c.error,
      })),
      summary: {
        totalChecks,
        uptimePercent,
        avgResponseTime,
        incidents: incidents.length,
      },
      incidents,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Get uptime history error:', error)
    return errorResponse('Failed to fetch uptime history')
  }
}

/**
 * DELETE /api/sites/{siteId}/uptime/{monitorId}
 */
export async function handleDeleteUptimeMonitor(_request: Request, siteId: string, monitorId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `UPTIME#${monitorId}`,
      }),
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Delete uptime monitor error:', error)
    return errorResponse('Failed to delete uptime monitor')
  }
}
