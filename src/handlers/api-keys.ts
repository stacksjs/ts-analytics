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
 * Token validation result
 */
export interface ApiKeyValidationResult {
  valid: boolean
  siteId?: string
  keyId?: string
}

// In-memory cache for validated tokens (5-minute TTL)
const tokenCache = new Map<string, { result: ApiKeyValidationResult; expires: number }>()

/**
 * Validate an API key from request headers.
 * Checks X-Analytics-Token or Authorization: Bearer header.
 * Requires the key to be active and have the specified permission.
 */
export async function handleValidateApiKey(
  request: Request,
  requiredPermission: string = 'error-tracking',
): Promise<ApiKeyValidationResult> {
  const token = request.headers.get('X-Analytics-Token')
    || request.headers.get('Authorization')?.replace('Bearer ', '')

  if (!token || !token.startsWith('ak_')) {
    return { valid: false }
  }

  // Check cache
  const cached = tokenCache.get(`${token}:${requiredPermission}`)
  if (cached && cached.expires > Date.now()) {
    return cached.result
  }

  try {
    // Query GSI1 to look up key by value
    const queryResult = await dynamodb.query({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `API_KEY#${token}` },
      },
    }) as { Items?: any[] }

    if (!queryResult.Items || queryResult.Items.length === 0) {
      const invalid = { valid: false } as const
      tokenCache.set(`${token}:${requiredPermission}`, { result: invalid, expires: Date.now() + 60_000 })
      return invalid
    }

    const keyRecord = unmarshall(queryResult.Items[0])

    if (!keyRecord.isActive) {
      return { valid: false }
    }

    const permissions: string[] = keyRecord.permissions || []
    if (!permissions.includes(requiredPermission)) {
      return { valid: false }
    }

    const result: ApiKeyValidationResult = {
      valid: true,
      siteId: keyRecord.siteId,
      keyId: keyRecord.id,
    }

    // Cache for 5 minutes
    tokenCache.set(`${token}:${requiredPermission}`, { result, expires: Date.now() + 5 * 60 * 1000 })

    // Fire-and-forget: update lastUsed and usageCount
    dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: `SITE#${keyRecord.siteId}` },
        sk: { S: `API_KEY#${keyRecord.id}` },
      },
      UpdateExpression: 'SET lastUsed = :now, usageCount = if_not_exists(usageCount, :zero) + :one',
      ExpressionAttributeValues: {
        ':now': { S: new Date().toISOString() },
        ':zero': { N: '0' },
        ':one': { N: '1' },
      },
    }).catch(e => console.error('Failed to update API key usage:', e))

    return result
  } catch (error) {
    console.error('Validate API key error:', error)
    return { valid: false }
  }
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
      gsi1pk: `API_KEY#${apiKey}`,
      gsi1sk: `SITE#${siteId}`,
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
