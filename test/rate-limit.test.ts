import { beforeEach, describe, expect, it } from 'bun:test'
import { rateLimitAllow, resetRateLimits } from '../src/lib/rate-limit'

describe('rateLimitAllow', () => {
  beforeEach(() => resetRateLimits())

  it('allows up to the limit then blocks within the window', () => {
    const allowed = Array.from({ length: 5 }, () => rateLimitAllow('k', 3, 60_000))
    expect(allowed).toEqual([true, true, true, false, false])
  })

  it('tracks keys independently', () => {
    expect(rateLimitAllow('a', 1, 60_000)).toBe(true)
    expect(rateLimitAllow('a', 1, 60_000)).toBe(false)
    expect(rateLimitAllow('b', 1, 60_000)).toBe(true)
  })

  it('refreshes after the window elapses', () => {
    expect(rateLimitAllow('w', 1, 1)).toBe(true)
    expect(rateLimitAllow('w', 1, 1)).toBe(false)
    const start = Date.now()
    while (Date.now() - start < 3) { /* spin past the 1ms window */ }
    expect(rateLimitAllow('w', 1, 1)).toBe(true)
  })
})
