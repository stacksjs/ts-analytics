/**
 * Project membership — the User <-> Project (site) relationship.
 *
 * One user can belong to many projects, each with a role. Stored as a pair of
 * mirrored items so both directions are a single-partition query:
 *   USER#{userId}  / MEMBERSHIP#SITE#{siteId}   -> a user's projects
 *   SITE#{siteId}  / MEMBER#{userId}            -> a project's members
 *
 * getMembership() is the O(1) lookup the authz layer uses on every request.
 */
import { dynamodb, TABLE_NAME, marshall, unmarshall } from './dynamodb'

export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 }

/** True if `role` is at least as privileged as `min`. */
export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  return !!role && RANK[role] >= RANK[min]
}

export async function addMembership(userId: string, siteId: string, role: Role): Promise<void> {
  const addedAt = new Date().toISOString()
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({ pk: `USER#${userId}`, sk: `MEMBERSHIP#SITE#${siteId}`, userId, siteId, role, addedAt }),
  })
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({ pk: `SITE#${siteId}`, sk: `MEMBER#${userId}`, userId, siteId, role, addedAt }),
  })
}

export async function removeMembership(userId: string, siteId: string): Promise<void> {
  await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: { pk: { S: `USER#${userId}` }, sk: { S: `MEMBERSHIP#SITE#${siteId}` } } })
  await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: { pk: { S: `SITE#${siteId}` }, sk: { S: `MEMBER#${userId}` } } })
}

/** The caller's role on a project, or null if they're not a member. */
export async function getMembership(userId: string, siteId: string): Promise<Role | null> {
  const r = await dynamodb.getItem({
    TableName: TABLE_NAME,
    Key: { pk: { S: `USER#${userId}` }, sk: { S: `MEMBERSHIP#SITE#${siteId}` } },
  })
  if (!r.Item) return null
  return (unmarshall(r.Item).role as Role) || null
}

export async function getUserMemberships(userId: string): Promise<{ siteId: string; role: Role }[]> {
  const r = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` }, ':sk': { S: 'MEMBERSHIP#SITE#' } },
  }) as { Items?: any[] }
  return (r.Items || []).map(unmarshall).map((m: any) => ({ siteId: m.siteId, role: m.role as Role }))
}

// ---- Pending invites (for emails without an account yet) -------------------
// Keyed by email so they can be found + auto-accepted when the person signs up:
//   INVITE#{email} / SITE#{siteId} -> role

export async function addPendingInvite(email: string, siteId: string, role: Role): Promise<void> {
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({ pk: `INVITE#${email.toLowerCase()}`, sk: `SITE#${siteId}`, email: email.toLowerCase(), siteId, role, invitedAt: new Date().toISOString() }),
  })
}

export async function getPendingInvites(email: string): Promise<{ siteId: string; role: Role }[]> {
  const r = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: `INVITE#${email.toLowerCase()}` } },
  }) as { Items?: any[] }
  return (r.Items || []).map(unmarshall).map((i: any) => ({ siteId: i.siteId, role: i.role as Role }))
}

/** Convert all pending invites for an email into real memberships. Returns count. */
export async function acceptInvites(userId: string, email: string): Promise<number> {
  const invites = await getPendingInvites(email)
  for (const inv of invites) {
    await addMembership(userId, inv.siteId, inv.role)
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: `INVITE#${email.toLowerCase()}` }, sk: { S: `SITE#${inv.siteId}` } },
    })
  }
  return invites.length
}

export async function getSiteMembers(siteId: string): Promise<{ userId: string; role: Role }[]> {
  const r = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': { S: `SITE#${siteId}` }, ':sk': { S: 'MEMBER#' } },
  }) as { Items?: any[] }
  return (r.Items || []).map(unmarshall).map((m: any) => ({ userId: m.userId, role: m.role as Role }))
}
