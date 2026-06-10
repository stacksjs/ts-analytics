/**
 * Secret-seeded visitor-hash salt (#88): rotates daily, and cannot be
 * reproduced without the server secret.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { getDailySalt } from '../src/lib/salt'

const ORIGINAL = process.env.ANALYTICS_SALT_SECRET

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ANALYTICS_SALT_SECRET
  else process.env.ANALYTICS_SALT_SECRET = ORIGINAL
})

describe('getDailySalt (#88)', () => {
  it('is stable within the same day and secret', () => {
    process.env.ANALYTICS_SALT_SECRET = 'test-secret'
    expect(getDailySalt()).toBe(getDailySalt())
  })

  it('does not leak the date or a guessable prefix', () => {
    process.env.ANALYTICS_SALT_SECRET = 'test-secret'
    const salt = getDailySalt()
    const today = new Date().toISOString().slice(0, 10)
    expect(salt).not.toContain(today)
    expect(salt).not.toContain('analytics')
    expect(salt).toMatch(/^[0-9a-f]{64}$/) // HMAC-SHA256 hex
  })

  it('depends on the secret — a different secret yields a different salt', () => {
    process.env.ANALYTICS_SALT_SECRET = 'secret-one'
    const a = getDailySalt()
    process.env.ANALYTICS_SALT_SECRET = 'secret-two'
    const b = getDailySalt()
    expect(a).not.toBe(b)
  })

  it('falls back to an ephemeral secret when unset (still non-predictable)', () => {
    delete process.env.ANALYTICS_SALT_SECRET
    const salt = getDailySalt()
    expect(salt).toMatch(/^[0-9a-f]{64}$/)
    // legacy predictable formats must be gone
    expect(salt).not.toBe(`analytics-${new Date().toISOString().slice(0, 10)}`)
    // ephemeral secret is cached → stable within the process
    expect(getDailySalt()).toBe(salt)
  })
})
