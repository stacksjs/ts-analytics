/**
 * Annotation handlers
 */

import { generateId } from '../../src/index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../lambda-adapter'

/**
 * POST /api/sites/{siteId}/annotations
 */
export async function handleCreateAnnotation(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.text) {
      return jsonResponse({ error: 'Missing required field: text' }, 400)
    }

    const annotationId = generateId()
    const timestamp = body.timestamp || new Date().toISOString()
    const annotation = {
      pk: `SITE#${siteId}`,
      sk: `ANNOTATION#${timestamp}#${annotationId}`,
      id: annotationId,
      siteId,
      text: body.text,
      type: body.type || 'general',
      timestamp,
      createdAt: new Date().toISOString(),
      createdBy: body.createdBy || 'system',
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(annotation),
    })

    return jsonResponse({ annotation }, 201)
  } catch (error) {
    console.error('Create annotation error:', error)
    return errorResponse('Failed to create annotation')
  }
}

/**
 * GET /api/sites/{siteId}/annotations
 */
export async function handleGetAnnotations(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ANNOTATION#${startDate.toISOString()}` },
        ':end': { S: `ANNOTATION#${endDate.toISOString()}Z` },
      },
    }) as { Items?: any[] }

    const annotations = (result.Items || []).map(unmarshall)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return jsonResponse({ annotations })
  } catch (error) {
    console.error('Get annotations error:', error)
    return errorResponse('Failed to fetch annotations')
  }
}

/**
 * DELETE /api/sites/{siteId}/annotations/{annotationId}
 */
export async function handleDeleteAnnotation(request: Request, siteId: string, annotationId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const timestamp = query.timestamp

    if (!timestamp) {
      // Need to find the annotation first
      const result = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':prefix': { S: 'ANNOTATION#' },
        },
      }) as { Items?: any[] }

      const annotations = (result.Items || []).map(unmarshall)
      const annotation = annotations.find(a => a.id === annotationId)

      if (!annotation) {
        return jsonResponse({ error: 'Annotation not found' }, 404)
      }

      await dynamodb.deleteItem({
        TableName: TABLE_NAME,
        Key: marshall({
          pk: `SITE#${siteId}`,
          sk: annotation.sk,
        }),
      })
    } else {
      await dynamodb.deleteItem({
        TableName: TABLE_NAME,
        Key: marshall({
          pk: `SITE#${siteId}`,
          sk: `ANNOTATION#${timestamp}#${annotationId}`,
        }),
      })
    }

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Delete annotation error:', error)
    return errorResponse('Failed to delete annotation')
  }
}
