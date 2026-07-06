/**
 * Share link handlers
 */

import { generateId } from '../index'
import { randomToken } from '../lib/crypto-random'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * Generate a secure share token (CSPRNG so tokens aren't guessable — #130).
 */
function generateShareToken(): string {
  return randomToken(24)
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
      // Per-site listing (#152) — share rows were unreachable by site before.
      gsi1pk: `SITE#${siteId}#SHARES`,
      gsi1sk: new Date().toISOString(),
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
  }
catch (error) {
    console.error('Create share link error:', error)
    return errorResponse('Failed to create share link')
  }
}

/**
 * Resolve a share token to its link record (60s in-process cache — the guard
 * consults this on every shared-dashboard API call, #152). Returns null for
 * unknown or expired tokens.
 */
const tokenCache = new Map<string, { link: Record<string, any> | null, at: number }>()

export async function resolveShareToken(token: string): Promise<Record<string, any> | null> {
  if (!/^[\w-]{16,64}$/.test(token))
    return null
  const hit = tokenCache.get(token)
  if (hit && Date.now() - hit.at < 60_000)
    return hit.link
  const result = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: `SHARE#${token}` } },
  }) as { Items?: any[] }
  const link = result.Items?.[0] ? unmarshall(result.Items[0]) : null
  tokenCache.set(token, { link, at: Date.now() })
  if (!link)
    return null
  if (link.expiresAt && new Date(link.expiresAt) < new Date())
    return null
  return link
}

/** Test hook. */
export function clearShareTokenCache(): void {
  tokenCache.clear()
}

/**
 * GET /api/sites/{siteId}/share — list this site's share links (owner view;
 * behind the site auth guard like every management endpoint).
 */
export async function handleListShareLinks(_request: Request, siteId: string): Promise<Response> {
  try {
    const { queryAllItems } = await import('../lib/dynamodb')
    const result = await queryAllItems({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': { S: `SITE#${siteId}#SHARES` } },
    })
    const links = (result.Items || []).map(unmarshall).map(link => ({
      token: link.token,
      url: `/shared/${link.token}`,
      hasPassword: !!link.password,
      expiresAt: link.expiresAt || null,
      createdAt: link.createdAt,
    }))
    return jsonResponse({ links })
  }
  catch (error) {
    console.error('List share links error:', error)
    return errorResponse('Failed to list share links')
  }
}

/**
 * DELETE /api/sites/{siteId}/share/{token} — revoke a share link.
 */
export async function handleRevokeShareLink(_request: Request, siteId: string, token: string): Promise<Response> {
  try {
    const link = await resolveShareToken(token)
    if (link && link.siteId !== siteId) {
      return jsonResponse({ error: 'Share link does not belong to this site' }, 403)
    }
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: `SHARE#${token}` }, sk: { S: `SITE#${siteId}` } },
    })
    tokenCache.delete(token)
    return jsonResponse({ success: true, token })
  }
  catch (error) {
    console.error('Revoke share link error:', error)
    return errorResponse('Failed to revoke share link')
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

    // Site display name for the public page header.
    let siteName = shareLink.siteId
    try {
      const siteRes = await dynamodb.getItem({
        TableName: TABLE_NAME,
        Key: { pk: { S: 'SITES' }, sk: { S: `SITE#${shareLink.siteId}` } },
      }) as { Item?: Record<string, any> }
      if (siteRes.Item)
        siteName = unmarshall(siteRes.Item).name || siteName
    }
    catch {}

    return jsonResponse({
      valid: true,
      siteId: shareLink.siteId,
      siteName,
      permissions: shareLink.permissions,
      allowedMetrics: shareLink.allowedMetrics,
    })
  }
catch (error) {
    console.error('Get shared dashboard error:', error)
    return errorResponse('Failed to validate share link')
  }
}
