/**
 * Authorization for per-project API routes.
 *
 * Closes the open-data hole: every `/api/sites/{siteId}/*` and stealth
 * `/api/p/{siteId}/*` endpoint must belong to the authenticated user. Applied
 * as a single global middleware (see router.use) so no handler is missed.
 *
 * Gated by ANALYTICS_REQUIRE_AUTH so it can ship ahead of the SPA login flow:
 *   - unset/false → no-op (existing behaviour, dashboard keeps working)
 *   - "true"      → enforce session + project membership
 * The public tracker script (`/script`, `/script.js`) is always exempt — site
 * visitors load it without a session.
 */
import { getSessionFromRequest } from './auth'
import { getMembership } from '../lib/membership'
import { jsonResponse } from '../utils/response'

const SITE_PATH = /^\/api\/(?:sites|p)\/([^/]+)\//
const PUBLIC_SUFFIX = /\/(?:script|script\.js)$/

/**
 * The project id a path is scoped to, or null if the path is not a guarded
 * per-project route (or is a public exemption). Pure — unit tested.
 */
export function guardedSiteId(path: string): string | null {
  if (PUBLIC_SUFFIX.test(path)) return null
  const m = path.match(SITE_PATH)
  return m ? m[1] : null
}

/** Whether enforcement is active (env-gated for safe rollout). */
export function authRequired(): boolean {
  return process.env.ANALYTICS_REQUIRE_AUTH === 'true'
}

/**
 * Returns a 401/403 Response to block the request, or null to allow it.
 */
export async function siteAuthGuard(req: Request): Promise<Response | null> {
  if (!authRequired()) return null

  const siteId = guardedSiteId(new URL(req.url).pathname)
  if (!siteId) return null

  const session = await getSessionFromRequest(req)
  if (!session) return jsonResponse({ error: 'Authentication required' }, 401)

  const role = await getMembership(session.userId, siteId)
  if (!role) return jsonResponse({ error: 'You do not have access to this project' }, 403)

  return null
}
