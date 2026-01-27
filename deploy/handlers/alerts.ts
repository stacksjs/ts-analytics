/**
 * Alerts and Email Reports handlers
 */

import { generateId } from '../../src/index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../lambda-adapter'

/**
 * POST /api/sites/{siteId}/alerts
 */
export async function handleCreateAlert(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.name || !body.metric || !body.condition || body.threshold === undefined) {
      return jsonResponse({ error: 'Missing required fields: name, metric, condition, threshold' }, 400)
    }

    const validConditions = ['above', 'below', 'equals', 'change_percent']
    if (!validConditions.includes(body.condition)) {
      return jsonResponse({ error: `Invalid condition. Must be one of: ${validConditions.join(', ')}` }, 400)
    }

    const alertId = generateId()
    const alert = {
      pk: `SITE#${siteId}`,
      sk: `ALERT#${alertId}`,
      id: alertId,
      siteId,
      name: body.name,
      metric: body.metric,
      condition: body.condition,
      threshold: body.threshold,
      email: body.email,
      webhookUrl: body.webhookUrl,
      isActive: body.isActive ?? true,
      lastTriggered: null,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(alert),
    })

    return jsonResponse({ alert }, 201)
  } catch (error) {
    console.error('Create alert error:', error)
    return errorResponse('Failed to create alert')
  }
}

/**
 * GET /api/sites/{siteId}/alerts
 */
export async function handleGetAlerts(request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'ALERT#' },
      },
    }) as { Items?: any[] }

    const alerts = (result.Items || []).map(unmarshall)

    return jsonResponse({ alerts })
  } catch (error) {
    console.error('Get alerts error:', error)
    return errorResponse('Failed to fetch alerts')
  }
}

/**
 * DELETE /api/sites/{siteId}/alerts/{alertId}
 */
export async function handleDeleteAlert(_request: Request, siteId: string, alertId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `ALERT#${alertId}`,
      }),
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Delete alert error:', error)
    return errorResponse('Failed to delete alert')
  }
}

/**
 * POST /api/sites/{siteId}/email-reports
 */
export async function handleCreateEmailReport(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.email || !body.schedule) {
      return jsonResponse({ error: 'Missing required fields: email, schedule' }, 400)
    }

    const validSchedules = ['daily', 'weekly', 'monthly']
    if (!validSchedules.includes(body.schedule)) {
      return jsonResponse({ error: `Invalid schedule. Must be one of: ${validSchedules.join(', ')}` }, 400)
    }

    const reportId = generateId()
    const report = {
      pk: `SITE#${siteId}`,
      sk: `EMAIL_REPORT#${reportId}`,
      id: reportId,
      siteId,
      email: body.email,
      schedule: body.schedule,
      metrics: body.metrics || ['visitors', 'pageviews', 'bounceRate', 'avgDuration'],
      isActive: body.isActive ?? true,
      lastSent: null,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(report),
    })

    return jsonResponse({ report }, 201)
  } catch (error) {
    console.error('Create email report error:', error)
    return errorResponse('Failed to create email report')
  }
}

/**
 * GET /api/sites/{siteId}/email-reports
 */
export async function handleGetEmailReports(request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'EMAIL_REPORT#' },
      },
    }) as { Items?: any[] }

    const reports = (result.Items || []).map(unmarshall)

    return jsonResponse({ reports })
  } catch (error) {
    console.error('Get email reports error:', error)
    return errorResponse('Failed to fetch email reports')
  }
}

/**
 * DELETE /api/sites/{siteId}/email-reports/{reportId}
 */
export async function handleDeleteEmailReport(_request: Request, siteId: string, reportId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `EMAIL_REPORT#${reportId}`,
      }),
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Delete email report error:', error)
    return errorResponse('Failed to delete email report')
  }
}
