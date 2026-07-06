/**
 * Miscellaneous handlers (health, sites list, revenue, site management)
 */

import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'
import { generateApiKey } from './api-keys'
import { addMembership, getUserMemberships, getMembership, getSiteMembers, removeMembership } from '../lib/membership'
import { getUserPlan, planLimits } from '../lib/plans'
import { generateId } from '../index'
import { generateAppId } from '../lib/crypto-random'

/**
 * GET /health
 */
export async function handleHealth(_request: Request): Promise<Response> {
  return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() })
}

/**
 * POST /api/sites - Create a new site
 */
export async function handleCreateSite(request: Request, ownerId?: string): Promise<Response> {
  try {
    const body = await request.json() as { name?: string; domain?: string; domains?: string[] }

    if (!body.name) {
      return jsonResponse({ error: 'Site name is required' }, 400)
    }

    const domains = body.domains || (body.domain ? [body.domain] : [])
    const now = new Date().toISOString()

    // Plan limit (#62): cap owned projects per account.
    if (ownerId) {
      const limits = planLimits(await getUserPlan(ownerId))
      if (limits.maxProjects > 0) {
        const owned = (await getUserMemberships(ownerId)).filter(m => m.role === 'owner').length
        if (owned >= limits.maxProjects) {
          return jsonResponse({ error: `Project limit reached (${limits.maxProjects} on your plan)` }, 403)
        }
      }
    }

    // Adopt an ownerless site the tracker auto-created under a readable id
    // (legacy #114 flow): the tracking snippet auto-creates ownerless SITES rows
    // via /collect, so a user creating that project by the same name should adopt
    // it (attach ownerId + membership) rather than be blocked out of their data.
    // Match on the name's slug; brand-new sites get a random App ID below.
    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (slug) {
      const existing = await dynamodb.getItem({
        TableName: TABLE_NAME,
        Key: { pk: { S: 'SITES' }, sk: { S: `SITE#${slug}` } },
      })
      if (existing.Item) {
        const existingSite = unmarshall(existing.Item)
        if (ownerId && !existingSite.ownerId) {
          await dynamodb.updateItem({
            TableName: TABLE_NAME,
            Key: { pk: { S: 'SITES' }, sk: { S: `SITE#${slug}` } },
            UpdateExpression: 'SET ownerId = :o, gsi1pk = :gp, gsi1sk = :gs, updatedAt = :now',
            ExpressionAttributeValues: {
              ':o': { S: ownerId },
              ':gp': { S: `OWNER#${ownerId}` },
              ':gs': { S: `SITE#${slug}` },
              ':now': { S: now },
            },
          })
          await addMembership(ownerId, slug, 'owner')
          return jsonResponse({ site: { ...existingSite, id: slug, ownerId }, claimed: true }, 200)
        }
        // Already owned → fall through and create a fresh site with a random id
        // (names aren't unique now that ids are random, Fathom-style).
      }
    }

    // Brand-new site: a short, random, unguessable App ID (Fathom-style, ~8 chars).
    const siteId = generateAppId()

    // Create the site
    const siteItem: Record<string, unknown> = {
      pk: 'SITES',
      sk: `SITE#${siteId}`,
      id: siteId,
      siteId,
      name: body.name,
      domains,
      createdAt: now,
      updatedAt: now,
    }

    if (ownerId) {
      siteItem.ownerId = ownerId
      siteItem.gsi1pk = `OWNER#${ownerId}`
      siteItem.gsi1sk = `SITE#${siteId}`
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(siteItem),
    })

    // Record the creator as the project owner (membership layer).
    if (ownerId) await addMembership(ownerId, siteId, 'owner')

    // Auto-generate the first API key
    const keyId = generateId()
    const apiKey = generateApiKey()
    const permissions = ['read']

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
        createdAt: now,
      }),
    })

    return jsonResponse({
      success: true,
      site: {
        id: siteId,
        name: body.name,
        domains,
        createdAt: now,
      },
      apiKey: {
        id: keyId,
        key: apiKey,
        name: 'Default',
        permissions,
      },
    }, 201)
  }
catch (error) {
    console.error('Create site error:', error)
    return errorResponse('Failed to create site')
  }
}

/**
 * DELETE /api/sites/{siteId} — owner-only. Removes the project, its memberships,
 * and everything stored under its SITE# partition (API keys, errors, stats,
 * pageviews, sessions, …). Large projects are purged via pagination.
 */
export async function handleDeleteSite(_request: Request, siteId: string, userId?: string): Promise<Response> {
  try {
    if (!userId) return jsonResponse({ error: 'Authentication required' }, 401)
    const role = await getMembership(userId, siteId)
    if (role !== 'owner') return jsonResponse({ error: 'Only the project owner can delete it' }, 403)

    // The site metadata record (lives in the shared SITES partition).
    await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: { pk: { S: 'SITES' }, sk: { S: `SITE#${siteId}` } } })

    // Memberships (both mirrored records per member).
    for (const m of await getSiteMembers(siteId)) {
      await removeMembership(m.userId, siteId)
    }

    // Everything under the project's own partition: API keys, error groups +
    // occurrences, statuses, alerts, pageviews, sessions, etc.
    let lastKey: Record<string, unknown> | undefined
    do {
      const res = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: `SITE#${siteId}` } },
        ExclusiveStartKey: lastKey,
        Limit: 200,
      }) as { Items?: any[]; LastEvaluatedKey?: Record<string, unknown> }
      for (const raw of (res.Items || [])) {
        const it = unmarshall(raw)
        await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: { pk: { S: it.pk }, sk: { S: it.sk } } })
      }
      lastKey = res.LastEvaluatedKey
    } while (lastKey)

    return jsonResponse({ success: true, siteId })
  }
catch (error) {
    console.error('Delete site error:', error)
    return errorResponse('Failed to delete site')
  }
}

/**
 * Ensure a site exists (auto-create if not) - used by collect handler
 */
export async function ensureSiteExists(siteId: string, hostname?: string, ownerId?: string): Promise<Record<string, any> | null> {
  try {
    // Check if site exists
    const existing = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: 'SITES' },
        sk: { S: `SITE#${siteId}` },
      },
    })

    if (existing.Item) {
      return unmarshall(existing.Item)
    }

    if (!existing.Item) {
      // Ingress firewall (#170): site ids are public in the tag, so open
      // auto-provisioning lets anyone spray junk site ids as a write-cost
      // attack. Auto-create stays on for dev convenience but is OFF in
      // production unless explicitly enabled.
      const autoCreate = process.env.ANALYTICS_AUTO_CREATE_SITES
        ? process.env.ANALYTICS_AUTO_CREATE_SITES === 'true'
        : process.env.NODE_ENV !== 'production'
      if (!autoCreate)
        return null

      const now = new Date().toISOString()
      const domains = hostname ? [hostname] : []

      const siteItem: Record<string, unknown> = {
        pk: 'SITES',
        sk: `SITE#${siteId}`,
        id: siteId,
        siteId,
        name: siteId,
        domains,
        createdAt: now,
        updatedAt: now,
        autoCreated: true,
      }

      if (ownerId) {
        siteItem.ownerId = ownerId
        siteItem.gsi1pk = `OWNER#${ownerId}`
        siteItem.gsi1sk = `SITE#${siteId}`
      }

      // Auto-create the site
      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshall(siteItem),
      })
      console.log(`[ensureSiteExists] Auto-created site: ${siteId}`)
      return siteItem
    }
    return null
  }
catch (error) {
    // Log but don't fail - site creation is best-effort
    console.error('[ensureSiteExists] Error:', error)
    return null
  }
}

/**
 * GET /api/sites
 */
export async function handleGetSites(_request: Request, ownerId?: string): Promise<Response> {
  try {
    // Dedupe by site sort-key across owned + member-shared projects.
    const bySk = new Map<string, any>()

    if (ownerId) {
      // Sites this user owns (OWNER# GSI)...
      const owned = await dynamodb.query({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: `OWNER#${ownerId}` } },
      }) as { Items?: any[] }
      for (const raw of (owned.Items || [])) {
        const s = unmarshall(raw)
        bySk.set(s.sk || `SITE#${s.siteId}`, s)
      }

      // ...plus projects shared with them via membership (teams).
      const memberships = await getUserMemberships(ownerId)
      for (const m of memberships) {
        const sk = `SITE#${m.siteId}`
        if (bySk.has(sk)) {
          bySk.get(sk).role = m.role
          continue
        }
        const got = await dynamodb.getItem({ TableName: TABLE_NAME, Key: { pk: { S: 'SITES' }, sk: { S: sk } } })
        if (got.Item) {
          const s = unmarshall(got.Item)
          s.role = m.role
          bySk.set(sk, s)
        }
      }
    }
else {
      // No session → all sites (legacy/unauthenticated access; gated by #54).
      const all = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: 'SITES' } },
      }) as { Items?: any[] }
      for (const raw of (all.Items || [])) {
        const s = unmarshall(raw)
        bySk.set(s.sk || `SITE#${s.siteId}`, s)
      }
    }

    const sites = [...bySk.values()].map((s: any) => ({
      id: s.id || s.siteId,
      name: s.name,
      domains: s.domains || [],
      role: s.role || (ownerId && s.ownerId === ownerId ? 'owner' : undefined),
      createdAt: s.createdAt,
    }))

    sites.sort((a: any, b: any) => a.name.localeCompare(b.name))

    return jsonResponse({
      sites,
      total: sites.length,
    })
  }
catch (error) {
    console.error('Get sites error:', error)
    return errorResponse('Failed to fetch sites')
  }
}

/**
 * GET /api/sites/{siteId}/verify-install (#84)
 *
 * Installation check: did any pageview land for this site in the last few
 * minutes? The Settings "Verify installation" button fires a synthetic
 * pageview through the public /collect endpoint, then calls this to confirm
 * the full ingest round-trip (HTTP → handler → DynamoDB → read-back).
 */
export async function handleVerifyInstall(_request: Request, siteId: string): Promise<Response> {
  try {
    const now = new Date()
    const windowStart = new Date(now.getTime() - 5 * 60_000)

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${windowStart.toISOString()}` },
        ':end': { S: `PAGEVIEW#${now.toISOString()}~` },
      },
      Select: 'COUNT',
    }) as { Count?: number }

    const recentEvents = result.Count || 0
    return jsonResponse({
      verified: recentEvents > 0,
      recentEvents,
      windowMinutes: 5,
      checkedAt: now.toISOString(),
    })
  }
catch (error) {
    console.error('Verify install error:', error)
    return errorResponse('Failed to verify installation')
  }
}

/**
 * GET /api/sites/{siteId}/revenue
 */
export async function handleGetRevenue(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    // Query events with revenue data
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `EVENT#${startDate.toISOString()}` },
        ':end': { S: `EVENT#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    // Stored custom-event fields are `value` and `name` (not revenue/eventName),
    // so the old filter matched nothing and revenue was always 0 (#141).
    const events = (result.Items || []).map(unmarshall)
      .filter(e => typeof e.value === 'number' || e.name === 'purchase' || e.name === 'conversion')

    // Calculate revenue metrics
    let totalRevenue = 0
    let transactionCount = 0
    const revenueByDay: Record<string, number> = {}
    const revenueBySource: Record<string, number> = {}

    for (const event of events) {
      const revenue = typeof event.value === 'number' ? event.value : 0
      totalRevenue += revenue
      transactionCount++

      const day = event.timestamp.slice(0, 10)
      revenueByDay[day] = (revenueByDay[day] || 0) + revenue

      const source = event.utmSource || event.referrerSource || 'direct'
      revenueBySource[source] = (revenueBySource[source] || 0) + revenue
    }

    const avgOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0

    const dailyRevenue = Object.entries(revenueByDay)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const revenueBySourceList = Object.entries(revenueBySource)
      .map(([source, revenue]) => ({ source, revenue }))
      .sort((a, b) => b.revenue - a.revenue)

    return jsonResponse({
      totalRevenue,
      transactionCount,
      avgOrderValue,
      dailyRevenue,
      revenueBySource: revenueBySourceList,
      currency: 'USD',
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  }
catch (error) {
    console.error('Get revenue error:', error)
    return errorResponse('Failed to fetch revenue')
  }
}
