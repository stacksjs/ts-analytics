import { describe, expect, it } from 'bun:test'
import { digestDue } from '../src/handlers/alerts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const now = 1_000 * DAY

describe('digestDue', () => {
  it('is due when never sent', () => {
    expect(digestDue('daily', null, now)).toBe(true)
    expect(digestDue('weekly', null, now)).toBe(true)
  })

  it('daily: due after 24h, not before', () => {
    expect(digestDue('daily', now - 25 * HOUR, now)).toBe(true)
    expect(digestDue('daily', now - 1 * HOUR, now)).toBe(false)
  })

  it('weekly: due after 7d, not before', () => {
    expect(digestDue('weekly', now - 8 * DAY, now)).toBe(true)
    expect(digestDue('weekly', now - 2 * DAY, now)).toBe(false)
  })

  it('monthly: due after 30d', () => {
    expect(digestDue('monthly', now - 31 * DAY, now)).toBe(true)
    expect(digestDue('monthly', now - 10 * DAY, now)).toBe(false)
  })
})
