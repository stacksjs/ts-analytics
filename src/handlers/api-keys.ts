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
export function generateApiKey(): string {
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
    }).catch((e: unknown) => console.error('Failed to update API key usage:', e))

    return result
  } catch (error) {
    console.error('Validate API key error:', error)
    return { valid: false }
  }
}

/**
 * GET /api/sites/{siteId}/api-keys
 * Returns the single API key for the site
 */
export async function handleGetApiKey(_request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'API_KEY#' },
      },
    }) as { Items?: any[] }

    const keys = (result.Items || []).map(unmarshall)
    const active = keys.find(k => k.isActive) || keys[0]

    if (!active) {
      return jsonResponse({ apiKey: null })
    }

    return jsonResponse({
      apiKey: {
        id: active.id,
        key: active.key,
        name: active.name,
        permissions: active.permissions,
        createdAt: active.createdAt,
        lastUsed: active.lastUsed,
        usageCount: active.usageCount,
      },
    })
  } catch (error) {
    console.error('Get API key error:', error)
    return errorResponse('Failed to fetch API key')
  }
}

/**
 * POST /api/sites/{siteId}/api-keys/regenerate
 * Deletes all existing keys and creates a fresh one
 */
export async function handleRegenerateApiKey(_request: Request, siteId: string): Promise<Response> {
  try {
    // 1. Query existing keys
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'API_KEY#' },
      },
    }) as { Items?: any[] }

    // 2. Delete each existing key
    for (const item of result.Items || []) {
      const record = unmarshall(item)
      // Invalidate cache entries for old key
      tokenCache.delete(`${record.key}:read`)
      tokenCache.delete(`${record.key}:error-tracking`)
      await dynamodb.deleteItem({
        TableName: TABLE_NAME,
        Key: marshall({
          pk: `SITE#${siteId}`,
          sk: `API_KEY#${record.id}`,
        }),
      })
    }

    // 3. Create new key
    const keyId = generateId()
    const apiKey = generateApiKey()
    const permissions = ['read', 'error-tracking']

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: `SITE#${siteId}`,
        sk: `API_KEY#${keyId}`,
        gsi1pk: `API_KEY#${apiKey}`,
        gsi1sk: `SITE#${siteId}`,
        id: keyId,
        siteId,
        name: 'Default',
        key: apiKey,
        keyPrefix: apiKey.slice(0, 8),
        permissions,
        lastUsed: null,
        usageCount: 0,
        isActive: true,
        createdAt: new Date().toISOString(),
      }),
    })

    // 4. Return the new key
    return jsonResponse({
      apiKey: {
        id: keyId,
        key: apiKey,
        name: 'Default',
        permissions,
        createdAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Regenerate API key error:', error)
    return errorResponse('Failed to regenerate API key')
  }
}
