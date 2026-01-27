/**
 * API Key handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * Generate a secure API key
 */
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'ak_'
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return key
}

/**
 * POST /api/sites/{siteId}/api-keys
 */
export async function handleCreateApiKey(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.name) {
      return jsonResponse({ error: 'Missing required field: name' }, 400)
    }

    const keyId = generateId()
    const apiKey = generateApiKey()
    const keyRecord = {
      pk: `SITE#${siteId}`,
      sk: `API_KEY#${keyId}`,
      id: keyId,
      siteId,
      name: body.name,
      key: apiKey,
      keyPrefix: apiKey.slice(0, 8),
      permissions: body.permissions || ['read'],
      lastUsed: null,
      usageCount: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(keyRecord),
    })

    // Return full key only on creation
    return jsonResponse({
      apiKey: {
        id: keyId,
        name: body.name,
        key: apiKey,
        permissions: keyRecord.permissions,
        createdAt: keyRecord.createdAt,
      },
    }, 201)
  } catch (error) {
    console.error('Create API key error:', error)
    return errorResponse('Failed to create API key')
  }
}

/**
 * GET /api/sites/{siteId}/api-keys
 */
export async function handleGetApiKeys(request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'API_KEY#' },
      },
    }) as { Items?: any[] }

    const apiKeys = (result.Items || []).map(unmarshall).map(key => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      permissions: key.permissions,
      lastUsed: key.lastUsed,
      usageCount: key.usageCount,
      isActive: key.isActive,
      createdAt: key.createdAt,
    }))

    return jsonResponse({ apiKeys })
  } catch (error) {
    console.error('Get API keys error:', error)
    return errorResponse('Failed to fetch API keys')
  }
}

/**
 * DELETE /api/sites/{siteId}/api-keys/{keyId}
 */
export async function handleDeleteApiKey(_request: Request, siteId: string, keyId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `API_KEY#${keyId}`,
      }),
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Delete API key error:', error)
    return errorResponse('Failed to delete API key')
  }
}
