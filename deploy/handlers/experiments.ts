/**
 * A/B Testing / Experiment handlers
 */

import { generateId } from '../../src/index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../lambda-adapter'

/**
 * POST /api/sites/{siteId}/experiments
 */
export async function handleCreateExperiment(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.name || !body.variants || !Array.isArray(body.variants) || body.variants.length < 2) {
      return jsonResponse({ error: 'Missing required fields: name, variants (min 2)' }, 400)
    }

    const experimentId = generateId()
    const experiment = {
      pk: `SITE#${siteId}`,
      sk: `EXPERIMENT#${experimentId}`,
      id: experimentId,
      siteId,
      name: body.name,
      description: body.description || '',
      variants: body.variants.map((v: any, i: number) => ({
        id: v.id || generateId(),
        name: v.name || `Variant ${i + 1}`,
        weight: v.weight || Math.floor(100 / body.variants.length),
        conversions: 0,
        visitors: 0,
      })),
      goalId: body.goalId,
      status: 'active',
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(experiment),
    })

    return jsonResponse({ experiment }, 201)
  } catch (error) {
    console.error('Create experiment error:', error)
    return errorResponse('Failed to create experiment')
  }
}

/**
 * GET /api/sites/{siteId}/experiments
 */
export async function handleGetExperiments(request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'EXPERIMENT#' },
      },
    }) as { Items?: any[] }

    const experiments = (result.Items || []).map(unmarshall)

    return jsonResponse({ experiments })
  } catch (error) {
    console.error('Get experiments error:', error)
    return errorResponse('Failed to fetch experiments')
  }
}

/**
 * POST /api/sites/{siteId}/experiments/event
 */
export async function handleRecordExperimentEvent(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.experimentId || !body.variantId || !body.eventType) {
      return jsonResponse({ error: 'Missing required fields: experimentId, variantId, eventType' }, 400)
    }

    // Get experiment
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':sk': { S: `EXPERIMENT#${body.experimentId}` },
      },
    }) as { Items?: any[] }

    if (!result.Items || result.Items.length === 0) {
      return jsonResponse({ error: 'Experiment not found' }, 404)
    }

    const experiment = unmarshall(result.Items[0])
    const variant = experiment.variants.find((v: any) => v.id === body.variantId)

    if (!variant) {
      return jsonResponse({ error: 'Variant not found' }, 404)
    }

    // Update variant stats
    if (body.eventType === 'view') {
      variant.visitors = (variant.visitors || 0) + 1
    } else if (body.eventType === 'conversion') {
      variant.conversions = (variant.conversions || 0) + 1
    }

    // Save updated experiment
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({
        ...experiment,
        variants: experiment.variants,
        updatedAt: new Date().toISOString(),
      }),
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Record experiment event error:', error)
    return errorResponse('Failed to record experiment event')
  }
}
