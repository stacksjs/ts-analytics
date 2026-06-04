/**
 * Tests for the gated read-through cache (src/handlers/lib/read-cache.ts).
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { withReadCache, readCacheEnabled } from '../src/handlers/lib/read-cache'
import { clearAllCaches } from '../src/utils/cache'

function req(url = 'https://x/api/sites/s1/stats?start=a&end=b'): Request {
  return new Request(url)
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('withReadCache', () => {
  beforeEach(() => {
    clearAllCaches()
    delete process.env.ANALYTICS_READ_CACHE
  })
  afterEach(() => {
    delete process.env.ANALYTICS_READ_CACHE
  })

  it('passes through (computes every call) when disabled', async () => {
    let calls = 0
    const compute = async () => { calls++; return json({ n: calls }) }
    await withReadCache(req(), 'stats', 1000, compute)
    await withReadCache(req(), 'stats', 1000, compute)
    expect(calls).toBe(2)
    expect(readCacheEnabled()).toBe(false)
  })

  it('serves the second call from cache when enabled', async () => {
    process.env.ANALYTICS_READ_CACHE = 'true'
    let calls = 0
    const compute = async () => { calls++; return json({ n: calls }) }
    const r1 = await withReadCache(req(), 'stats', 1000, compute)
    const r2 = await withReadCache(req(), 'stats', 1000, compute)
    expect(calls).toBe(1)
    expect(await r1.text()).toBe(await r2.text())
    expect(r2.headers.get('Content-Type')).toBe('application/json')
  })

  it('keys by path + query (a different range recomputes)', async () => {
    process.env.ANALYTICS_READ_CACHE = 'true'
    let calls = 0
    const compute = async () => { calls++; return json({ n: calls }) }
    await withReadCache(req('https://x/api/sites/s1/stats?range=6h'), 'stats', 1000, compute)
    await withReadCache(req('https://x/api/sites/s1/stats?range=24h'), 'stats', 1000, compute)
    expect(calls).toBe(2)
  })

  it('does not cache non-200 responses', async () => {
    process.env.ANALYTICS_READ_CACHE = 'true'
    let calls = 0
    const compute = async () => { calls++; return json({ error: 'x' }, 500) }
    await withReadCache(req(), 'stats', 1000, compute)
    await withReadCache(req(), 'stats', 1000, compute)
    expect(calls).toBe(2)
  })
})
