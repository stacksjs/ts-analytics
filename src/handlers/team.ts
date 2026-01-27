/**
 * Team management handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * POST /api/sites/{siteId}/team
 */
export async function handleInviteTeamMember(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.email || !body.role) {
      return jsonResponse({ error: 'Missing required fields: email, role' }, 400)
    }

    const validRoles = ['admin', 'editor', 'viewer']
    if (!validRoles.includes(body.role)) {
      return jsonResponse({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, 400)
    }

    const memberId = generateId()
    const member = {
      pk: `SITE#${siteId}`,
      sk: `TEAM#${memberId}`,
      id: memberId,
      siteId,
      email: body.email,
      role: body.role,
      status: 'invited',
      invitedAt: new Date().toISOString(),
      acceptedAt: null,
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(member),
    })

    return jsonResponse({ member }, 201)
  } catch (error) {
    console.error('Invite team member error:', error)
    return errorResponse('Failed to invite team member')
  }
}

/**
 * GET /api/sites/{siteId}/team
 */
export async function handleGetTeamMembers(request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'TEAM#' },
      },
    }) as { Items?: any[] }

    const members = (result.Items || []).map(unmarshall)

    return jsonResponse({ members })
  } catch (error) {
    console.error('Get team members error:', error)
    return errorResponse('Failed to fetch team members')
  }
}

/**
 * DELETE /api/sites/{siteId}/team/{memberId}
 */
export async function handleRemoveTeamMember(_request: Request, siteId: string, memberId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `TEAM#${memberId}`,
      }),
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Remove team member error:', error)
    return errorResponse('Failed to remove team member')
  }
}
