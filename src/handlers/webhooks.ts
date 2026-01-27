/**
 * Webhook handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * POST /api/sites/{siteId}/webhooks
 */
export async function handleCreateWebhook(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.url || !body.events || !Array.isArray(body.events) || body.events.length === 0) {
      return jsonResponse({ error: 'Missing required fields: url, events (array)' }, 400)
    }

    const validEvents = ['pageview', 'session.start', 'session.end', 'goal.conversion', 'error', 'alert.triggered']
    const invalidEvents = body.events.filter((e: string) => !validEvents.includes(e))
    if (invalidEvents.length > 0) {
      return jsonResponse({ error: `Invalid events: ${invalidEvents.join(', ')}. Valid events: ${validEvents.join(', ')}` }, 400)
    }

    const webhookId = generateId()
    const webhook = {
      pk: `SITE#${siteId}`,
      sk: `WEBHOOK#${webhookId}`,
      id: webhookId,
      siteId,
      url: body.url,
      events: body.events,
      secret: body.secret || generateId(),
      headers: body.headers || {},
      isActive: body.isActive ?? true,
      lastTriggered: null,
      failureCount: 0,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(webhook),
    })

    return jsonResponse({ webhook }, 201)
  } catch (error) {
    console.error('Create webhook error:', error)
    return errorResponse('Failed to create webhook')
  }
}

/**
 * GET /api/sites/{siteId}/webhooks
 */
export async function handleGetWebhooks(request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'WEBHOOK#' },
      },
    }) as { Items?: any[] }

    const webhooks = (result.Items || []).map(unmarshall).map(w => ({
      id: w.id,
      url: w.url,
      events: w.events,
      isActive: w.isActive,
      lastTriggered: w.lastTriggered,
      failureCount: w.failureCount,
      createdAt: w.createdAt,
    }))

    return jsonResponse({ webhooks })
  } catch (error) {
    console.error('Get webhooks error:', error)
    return errorResponse('Failed to fetch webhooks')
  }
}

/**
 * DELETE /api/sites/{siteId}/webhooks/{webhookId}
 */
export async function handleDeleteWebhook(_request: Request, siteId: string, webhookId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `WEBHOOK#${webhookId}`,
      }),
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Delete webhook error:', error)
    return errorResponse('Failed to delete webhook')
  }
}
