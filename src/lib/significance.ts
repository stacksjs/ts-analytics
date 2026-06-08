/**
 * A/B test statistical significance (two-proportion z-test vs the control).
 *
 * The first variant is treated as the control. Each other variant gets a
 * conversion rate, uplift, two-tailed p-value, confidence, and a significance
 * flag (p < 0.05) so the dashboard can call a winner instead of showing raw
 * counts.
 */

/** Error function approximation (Abramowitz & Stegun 7.1.26). */
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}

/** Standard normal CDF. */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

export interface VariantStat {
  visitors: number
  conversions: number
  conversionRate: number
  upliftPct: number | null
  pValue: number | null
  confidence: number | null
  significant: boolean
  isControl: boolean
}

export function analyzeVariants(variants: { visitors?: number; conversions?: number }[]): VariantStat[] {
  if (!variants.length) return []

  const control = variants[0]
  const n1 = control.visitors || 0
  const c1 = control.conversions || 0
  const p1 = n1 > 0 ? c1 / n1 : 0

  return variants.map((v, i) => {
    const n2 = v.visitors || 0
    const c2 = v.conversions || 0
    const p2 = n2 > 0 ? c2 / n2 : 0
    const isControl = i === 0

    let upliftPct: number | null = null
    let pValue: number | null = null
    let confidence: number | null = null
    let significant = false

    if (!isControl && n1 > 0 && n2 > 0) {
      upliftPct = p1 > 0 ? ((p2 - p1) / p1) * 100 : null
      const pooled = (c1 + c2) / (n1 + n2)
      const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
      if (se > 0) {
        const z = (p2 - p1) / se
        pValue = 2 * (1 - normalCdf(Math.abs(z)))
        confidence = (1 - pValue) * 100
        significant = pValue < 0.05
      }
    }

    return { visitors: n2, conversions: c2, conversionRate: p2 * 100, upliftPct, pValue, confidence, significant, isControl }
  })
}
