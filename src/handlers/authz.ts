/**
 * Authorization for per-project API routes.
 *
 * Closes the open-data hole: every `/api/sites/{siteId}/*` and stealth
 * `/api/p/{siteId}/*` endpoint must belong to the authenticated user. Applied
 * as a single global middleware (see router.use) so no handler is missed.
 *
 * Account-first by default (#114): enforcement is ON unless
 * ANALYTICS_REQUIRE_AUTH=false (kiosk/legacy single-tenant installs).
 * The public tracker script (`/script`, `/script.js`) is always exempt — site
 * visitors load it without a session.
 */
import { getSessionFromRequest } from './auth'
import { handleValidateApiKey } from './api-keys'
import { getMembership, addMembership, roleAtLeast, type Role } from '../lib/membership'
import { dynamodb, TABLE_NAME, unmarshall } from '../lib/dynamodb'
import { jsonResponse } from '../utils/response'

const SITE_PATH = /^\/api\/(?:sites|p)\/([^/]+)\//
const PUBLIC_SUFFIX = /\/(?:script|script\.js)$/

/**
 * Endpoints a share token may read (#152): aggregate reports only, canonical
 * AND stealth names. Deliberately excludes sessions/flow (visitor-level),
 * goals, and every management surface (api-keys/team/webhooks/...).
 */
const SHARE_READ_PATH = new RegExp(`/(?:${[
  // canonical
  'stats', 'timeseries', 'realtime', 'pages', 'referrers', 'devices',
  'browsers', 'os', 'countries', 'regions', 'cities', 'campaigns', 'events',
  'entry-exit', 'comparison', 'insights',
  // stealth aliases (resources/stores/dashboard.ts STEALTH_MAP)
  'summary', 'series', 'pulse', 'content', 'sources', 'clients', 'agents',
  'platform', 'geo', 'area', 'locale', 'promo', 'actions', 'endpoints',
  'diff', 'intel',
].join('|')})(?:\\?|$)`)

/** Whether the SITES record for `siteId` names `userId` as its owner. */
async function ownsSite(userId: string, siteId: string): Promise<boolean> {
  try {
    const res = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: 'SITES' }, sk: { S: `SITE#${siteId}` } },
    }) as { Item?: Record<string, any> }
    return !!res.Item && unmarshall(res.Item).ownerId === userId
  }
  catch {
    return false
  }
}

/**
 * The project id a path is scoped to, or null if the path is not a guarded
 * per-project route (or is a public exemption). Pure — unit tested.
 */
export function guardedSiteId(path: string): string | null {
  if (PUBLIC_SUFFIX.test(path)) return null
  const m = path.match(SITE_PATH)
  return m ? m[1] : null
}

/** Whether enforcement is active (default ON; opt out with ANALYTICS_REQUIRE_AUTH=false). */
export function authRequired(): boolean {
  return process.env.ANALYTICS_REQUIRE_AUTH !== 'false'
}

/**
 * Minimum role for a request: reads need viewer, member management needs admin,
 * other writes need editor. Pure — unit tested.
 */
export function requiredRole(method: string, path: string): Role {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'viewer'
  if (/\/(?:team|members)(?:\/|$)/.test(path)) return 'admin'
  return 'editor'
}

/**
 * Returns a 401/403 Response to block the request, or null to allow it.
 */
export async function siteAuthGuard(req: Request): Promise<Response | null> {
  if (!authRequired()) return null

  const path = new URL(req.url).pathname
  const siteId = guardedSiteId(path)
  if (!siteId) return null

  // Programmatic read API (#154): a valid `read` API key scoped to this site
  // authorizes read-only access without a session. Only for read methods — a
  // read key can never mutate; writes still require a session with editor/admin.
  const method = (req as { method?: string }).method || 'GET'
  const presentsKey = !!(req.headers.get('X-Analytics-Token') || req.headers.get('Authorization'))
  if (presentsKey && (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')) {
    const key = await handleValidateApiKey(req, 'read')
    if (key.valid && key.siteId === siteId)
      return null
  }

  // Shared-dashboard token (#152): grants anonymous READ access to the
  // aggregate report endpoints only — never sessions, settings, keys, or any
  // write. Token via header (the share page) or ?share= (simple embeds);
  // password-protected links also require the matching ?share_pw=.
  if (method === 'GET' || method === 'HEAD') {
    const url = new URL(req.url)
    const shareToken = req.headers.get('X-Share-Token') || url.searchParams.get('share') || ''
    if (shareToken && SHARE_READ_PATH.test(path)) {
      const { resolveShareToken } = await import('./sharing')
      const link = await resolveShareToken(shareToken)
      if (link && link.siteId === siteId) {
        const pw = req.headers.get('X-Share-Password') || url.searchParams.get('share_pw') || ''
        if (!link.password || link.password === pw)
          return null
      }
    }
  }

  const session = await getSessionFromRequest(req)
  if (!session) return jsonResponse({ error: 'Authentication required' }, 401)

  // Fall back to the site record's ownerId when no membership row exists, so
  // sites that predate the membership model (legacy installs, tracker
  // auto-created sites later claimed, ADMIN_EMAIL backfill) remain openable by
  // their owner (#114 regression). Self-healing: backfill the membership.
  let role = await getMembership(session.userId, siteId)
  if (!role && await ownsSite(session.userId, siteId)) {
    await addMembership(session.userId, siteId, 'owner').catch(() => {})
    role = 'owner'
  }
  if (!role) return jsonResponse({ error: 'You do not have access to this project' }, 403)

  if (!roleAtLeast(role, requiredRole((req as { method?: string }).method || 'GET', path))) {
    return jsonResponse({ error: 'Insufficient permissions for this action' }, 403)
  }

  return null
}
