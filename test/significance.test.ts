import { describe, expect, it } from 'bun:test'
import { analyzeVariants } from '../src/lib/significance'

describe('analyzeVariants', () => {
  it('marks the first variant as control with no p-value', () => {
    const [control] = analyzeVariants([{ visitors: 1000, conversions: 100 }, { visitors: 1000, conversions: 130 }])
    expect(control.isControl).toBe(true)
    expect(control.pValue).toBeNull()
    expect(control.conversionRate).toBeCloseTo(10, 5)
  })

  it('detects a significant winner with a large, clear difference', () => {
    const [, variant] = analyzeVariants([
      { visitors: 5000, conversions: 500 }, // 10%
      { visitors: 5000, conversions: 750 }, // 15%
    ])
    expect(variant.significant).toBe(true)
    expect(variant.pValue!).toBeLessThan(0.05)
    expect(variant.upliftPct!).toBeCloseTo(50, 0)
    expect(variant.confidence!).toBeGreaterThan(95)
  })

  it('does NOT flag significance on a tiny difference with small samples', () => {
    const [, variant] = analyzeVariants([
      { visitors: 100, conversions: 10 }, // 10%
      { visitors: 100, conversions: 11 }, // 11%
    ])
    expect(variant.significant).toBe(false)
    expect(variant.pValue!).toBeGreaterThan(0.05)
  })

  it('handles zero/empty input safely', () => {
    expect(analyzeVariants([])).toEqual([])
    const [, v] = analyzeVariants([{ visitors: 0, conversions: 0 }, { visitors: 0, conversions: 0 }])
    expect(v.significant).toBe(false)
    expect(v.conversionRate).toBe(0)
  })
})
