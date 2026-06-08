/**
 * In-memory fixed-window rate limiter.
 *
 * Keyed by an arbitrary string (e.g. an API key id). Good enough for a single
 * server process; a multi-instance deploy would back this with DynamoDB/Redis,
 * but this closes the "no enforcement at all" gap and returns 429 on abuse.
 */
interface Bucket { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Returns true if the request is allowed, false if the key is over its limit. */
export function rateLimitAllow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count++
  return b.count <= limit
}

/** Test/util: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear()
}
