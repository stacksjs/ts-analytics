/**
 * Daily pre-aggregation rollups (#94) — pure helpers.
 */
import { describe, expect, it } from 'bun:test'
import { dayKeysBetween, fullyCoveredDays, isCompleteDay } from '../src/lib/rollups'

describe('dayKeysBetween', () => {
  it('lists every day touched by the range, inclusive', () => {
    const days = dayKeysBetween(new Date('2026-06-01T10:00:00Z'), new Date('2026-06-03T02:00:00Z'))
    expect(days).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
  })

  it('handles a single-day range', () => {
    expect(dayKeysBetween(new Date('2026-06-05T00:00:00Z'), new Date('2026-06-05T23:59:59Z')))
      .toEqual(['2026-06-05'])
  })

  it('crosses month boundaries', () => {
    const days = dayKeysBetween(new Date('2026-05-30T00:00:00Z'), new Date('2026-06-02T00:00:00Z'))
    expect(days).toEqual(['2026-05-30', '2026-05-31', '2026-06-01', '2026-06-02'])
  })
})

describe('isCompleteDay', () => {
  const now = new Date('2026-06-10T08:00:00Z')

  it('yesterday is complete, today and tomorrow are not', () => {
    expect(isCompleteDay('2026-06-09', now)).toBe(true)
    expect(isCompleteDay('2026-06-10', now)).toBe(false)
    expect(isCompleteDay('2026-06-11', now)).toBe(false)
  })
})

describe('fullyCoveredDays', () => {
  it('excludes a partial first day', () => {
    const days = fullyCoveredDays(new Date('2026-06-01T12:00:00Z'), new Date('2026-06-03T23:59:59.999Z'))
    expect(days).toEqual(['2026-06-02', '2026-06-03'])
  })

  it('excludes a partial last day', () => {
    const days = fullyCoveredDays(new Date('2026-06-01T00:00:00.000Z'), new Date('2026-06-03T12:00:00Z'))
    expect(days).toEqual(['2026-06-01', '2026-06-02'])
  })

  it('includes day-aligned ranges fully', () => {
    const days = fullyCoveredDays(new Date('2026-06-01T00:00:00.000Z'), new Date('2026-06-02T23:59:59.999Z'))
    expect(days).toEqual(['2026-06-01', '2026-06-02'])
  })

  it('returns nothing when the whole range is inside one partial day', () => {
    expect(fullyCoveredDays(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-01T20:00:00Z'))).toEqual([])
  })
})
