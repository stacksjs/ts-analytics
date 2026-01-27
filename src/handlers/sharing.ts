/**
 * Share link handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * Generate a secure share token
 */
function generateShareToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}

/**
 * POST /api/sites/{siteId}/share
 */
export async function handleCreateShareLink(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    const token = generateShareToken()
    const shareLink = {
      pk: `SHARE#${token}`,
      sk: `SITE#${siteId}`,
      token,
      siteId,
      permissions: body.permissions || ['view'],
      expiresAt: body.expiresAt || null,
      password: body.password || null,
      allowedMetrics: body.allowedMetrics || ['all'],
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(shareLink),
    })

    return jsonResponse({
      shareLink: {
        token,
        url: `/shared/${token}`,
        expiresAt: shareLink.expiresAt,
        createdAt: shareLink.createdAt,
      },
    }, 201)
  } catch (error) {
    console.error('Create share link error:', error)
    return errorResponse('Failed to create share link')
  }
}

/**
 * GET /api/share/{token}
 */
export async function handleGetSharedDashboard(request: Request, token: string): Promise<Response> {
  try {
    // Find share link
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `SHARE#${token}` },
      },
    }) as { Items?: any[] }

    if (!result.Items || result.Items.length === 0) {
      return jsonResponse({ error: 'Invalid or expired share link' }, 404)
    }

    const shareLink = unmarshall(result.Items[0])

    // Check expiration
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      return jsonResponse({ error: 'Share link has expired' }, 410)
    }

    // Check password if required
    const query = getQueryParams(request)
    if (shareLink.password && query.password !== shareLink.password) {
      return jsonResponse({ error: 'Password required', requiresPassword: true }, 401)
    }

    return jsonResponse({
      valid: true,
      siteId: shareLink.siteId,
      permissions: shareLink.permissions,
      allowedMetrics: shareLink.allowedMetrics,
    })
  } catch (error) {
    console.error('Get shared dashboard error:', error)
    return errorResponse('Failed to validate share link')
  }
}
