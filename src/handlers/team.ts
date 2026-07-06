/**
 * Team management handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'
import { addMembership, removeMembership, addPendingInvite } from '../lib/membership'
import { getUserByEmail } from './auth'

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
    const existingUser = await getUserByEmail(body.email)
    const now = new Date().toISOString()
    const member = {
      pk: `SITE#${siteId}`,
      sk: `TEAM#${memberId}`,
      id: memberId,
      siteId,
      email: body.email,
      role: body.role,
      userId: existingUser?.userId || null,
      status: existingUser ? 'active' : 'invited',
      invitedAt: now,
      acceptedAt: existingUser ? now : null,
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(member),
    })

    // Existing users get immediate project access via the membership layer
    // (what the authz guard checks). New emails stay 'invited' until accept (#60).
    if (existingUser) await addMembership(existingUser.userId, siteId, body.role)
    else await addPendingInvite(body.email, siteId, body.role)

    return jsonResponse({ member }, 201)
  }
catch (error) {
    console.error('Invite team member error:', error)
    return errorResponse('Failed to invite team member')
  }
}

/**
 * GET /api/sites/{siteId}/team
 */
export async function handleGetTeamMembers(_request: Request, siteId: string): Promise<Response> {
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
  }
catch (error) {
    console.error('Get team members error:', error)
    return errorResponse('Failed to fetch team members')
  }
}

/**
 * DELETE /api/sites/{siteId}/team/{memberId}
 */
export async function handleRemoveTeamMember(request: Request, siteId: string, memberId: string): Promise<Response> {
  try {
    // Load the record first so we can revoke the linked project membership.
    const got = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: `SITE#${siteId}` }, sk: { S: `TEAM#${memberId}` } },
    })

    // Rank rules (#157): the guard already requires admin+ for team writes,
    // but an admin must not be able to remove the OWNER or peer admins —
    // that's an authorization bypass (team takeover). Owner removal is never
    // allowed here (transfer ownership instead); removing an admin requires
    // the owner. Self-removal (leaving the team) is always allowed except
    // for the owner.
    if (got.Item) {
      const target = unmarshall(got.Item)
      const targetRole = String(target.role || 'viewer')
      const { getSessionFromRequest } = await import('./auth')
      const session = await getSessionFromRequest(request)
      const isSelf = !!session && target.userId === session.userId
      if (targetRole === 'owner') {
        return jsonResponse({ error: 'The owner cannot be removed. Transfer ownership first.' }, 403)
      }
      if (targetRole === 'admin' && !isSelf && session) {
        const { getMembership } = await import('../lib/membership')
        const requesterRole = await getMembership(session.userId, siteId)
        if (requesterRole !== 'owner') {
          return jsonResponse({ error: 'Only the owner can remove an admin.' }, 403)
        }
      }
    }

    if (got.Item) {
      const m = unmarshall(got.Item)
      if (m.userId) await removeMembership(m.userId, siteId)
    }

    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `TEAM#${memberId}`,
      }),
    })

    return jsonResponse({ success: true })
  }
catch (error) {
    console.error('Remove team member error:', error)
    return errorResponse('Failed to remove team member')
  }
}
