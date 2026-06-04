/**
 * Read-through cache for expensive dashboard read endpoints.
 *
 * Each cached endpoint currently re-scans raw DynamoDB events and aggregates
 * them in memory on every request. This wraps such a handler so the computed
 * JSON response is cached for a short TTL keyed by (path + query), letting
 * repeated polls (e.g. the summary card every ~15s) reuse the result instead of
 * re-scanning.
 *
 * Safety: gated behind ANALYTICS_READ_CACHE=true (default OFF, behavior
 * unchanged), only caches successful (200) responses, and ALWAYS falls back to
 * the real handler on a cache miss — a missing/expired entry never yields wrong
 * or empty data. The cache is the existing in-memory generic cache (per warm
 * process; resets on cold start).
 */

import { getFromCache, setInCache } from '../../utils/cache'

interface CachedResponse {
  body: string
  status: number
  headers: Record<string, string>
}

/** Whether the read-through cache is enabled (env-gated, default off). */
export function readCacheEnabled(): boolean {
  return process.env.ANALYTICS_READ_CACHE === 'true'
}

/**
 * Wrap a read handler with the read-through cache. When disabled, this is a
 * transparent pass-through to `compute`.
 */
export async function withReadCache(
  request: Request,
  name: string,
  ttlMs: number,
  compute: () => Promise<Response>,
): Promise<Response> {
  if (!readCacheEnabled()) return compute()

  const url = new URL(request.url)
  const key = `read:${name}:${url.pathname}:${url.search}`

  const hit = getFromCache<CachedResponse>(key)
  if (hit) {
    return new Response(hit.body, { status: hit.status, headers: hit.headers })
  }

  const res = await compute()
  // Only cache successful responses; errors must re-run next time.
  if (res.status === 200) {
    try {
      const body = await res.clone().text()
      const headers = Object.fromEntries(res.headers.entries())
      setInCache<CachedResponse>(key, { body, status: res.status, headers }, ttlMs)
    } catch {
      // Caching is best-effort; never fail the request over a cache write.
    }
  }
  return res
}
