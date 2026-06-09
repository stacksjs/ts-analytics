import { describe, expect, it } from 'bun:test'
import { monthKey, quotaExceeded } from '../src/lib/quota'

describe('quotaExceeded', () => {
  it('treats limit <= 0 as unlimited', () => {
    expect(quotaExceeded(1_000_000, 0)).toBe(false)
    expect(quotaExceeded(5, -1)).toBe(false)
  })

  it('allows counts up to and including the limit', () => {
    expect(quotaExceeded(99, 100)).toBe(false)
    expect(quotaExceeded(100, 100)).toBe(false)
  })

  it('flags counts past the limit', () => {
    expect(quotaExceeded(101, 100)).toBe(true)
  })
})

describe('monthKey', () => {
  it('returns the YYYY-MM bucket', () => {
    expect(monthKey(new Date('2026-03-15T12:00:00Z'))).toBe('2026-03')
    expect(monthKey(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12')
  })
})
