/**
 * Account plans & limits (#62) — pure helpers.
 */
import { describe, expect, it } from 'bun:test'
import { PLANS, planLimits } from '../src/lib/plans'

describe('planLimits (#62)', () => {
  it('defaults to free for missing or unknown plans', () => {
    expect(planLimits()).toEqual(PLANS.free)
    expect(planLimits(null)).toEqual(PLANS.free)
    expect(planLimits('nonsense')).toEqual(PLANS.free)
  })

  it('resolves known plans', () => {
    expect(planLimits('pro')).toEqual(PLANS.pro)
    expect(planLimits('unlimited').maxProjects).toBe(0)
  })

  it('free plan has finite limits', () => {
    const free = planLimits('free')
    expect(free.maxProjects).toBeGreaterThan(0)
    expect(free.monthlyEvents).toBeGreaterThan(0)
    expect(free.retentionDays).toBeGreaterThan(0)
  })
})
