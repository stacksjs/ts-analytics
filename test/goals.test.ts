/**
 * Goals and conversion tracking tests
 * Tests goal matching, pattern matching, and conversion calculations
 */

import { describe, expect, it } from 'bun:test'

// ============================================================================
// Goal Matching Tests
// ============================================================================

describe('Goal Matching', () => {
  describe('matchPattern', () => {
    it('should match exact patterns', () => {
      expect(matchPattern('/about', '/about', 'exact')).toBe(true)
      expect(matchPattern('/about', '/about-us', 'exact')).toBe(false)
      expect(matchPattern('/about', '/About', 'exact')).toBe(false)
    })

    it('should match contains patterns', () => {
      expect(matchPattern('checkout', '/cart/checkout/confirm', 'contains')).toBe(true)
      expect(matchPattern('checkout', '/cart/confirm', 'contains')).toBe(false)
    })

    it('should match regex patterns', () => {
      expect(matchPattern('^/blog/\\d+$', '/blog/123', 'regex')).toBe(true)
      expect(matchPattern('^/blog/\\d+$', '/blog/abc', 'regex')).toBe(false)
      expect(matchPattern('/products/.*', '/products/shoes/nike', 'regex')).toBe(true)
    })

    it('should handle invalid regex gracefully', () => {
      expect(matchPattern('[invalid(regex', '/test', 'regex')).toBe(false)
    })

    it('should handle empty patterns', () => {
      expect(matchPattern('', '/test', 'exact')).toBe(false)
      expect(matchPattern('/test', '', 'exact')).toBe(false)
    })
  })

  describe('matchGoal', () => {
    it('should match pageview goals', () => {
      const goal = { type: 'pageview', pattern: '/checkout', matchType: 'exact', isActive: true }
      expect(matchGoal(goal, { path: '/checkout' })).toBe(true)
      expect(matchGoal(goal, { path: '/cart' })).toBe(false)
    })

    it('should match event goals', () => {
      const goal = { type: 'event', pattern: 'purchase', matchType: 'exact', isActive: true }
      expect(matchGoal(goal, { path: '/checkout', eventName: 'purchase' })).toBe(true)
      expect(matchGoal(goal, { path: '/checkout', eventName: 'add_to_cart' })).toBe(false)
    })

    it('should match duration goals', () => {
      const goal = { type: 'duration', durationMinutes: 5, isActive: true }
      expect(matchGoal(goal, { path: '/', sessionDurationMinutes: 6 })).toBe(true)
      expect(matchGoal(goal, { path: '/', sessionDurationMinutes: 3 })).toBe(false)
    })

    it('should not match inactive goals', () => {
      const goal = { type: 'pageview', pattern: '/checkout', matchType: 'exact', isActive: false }
      expect(matchGoal(goal, { path: '/checkout' })).toBe(false)
    })
  })
})

function matchPattern(pattern: string, value: string, matchType: string): boolean {
  if (!pattern || !value) return false

  switch (matchType) {
    case 'exact':
      return value === pattern
    case 'contains':
      return value.includes(pattern)
    case 'regex':
      try {
        return new RegExp(pattern).test(value)
      } catch {
        return false
      }
    default:
      return value === pattern
  }
}

interface Goal {
  type: string
  pattern?: string
  matchType?: string
  durationMinutes?: number
  isActive: boolean
}

interface GoalContext {
  path: string
  eventName?: string
  sessionDurationMinutes?: number
}

function matchGoal(goal: Goal, context: GoalContext): boolean {
  if (!goal.isActive) return false

  switch (goal.type) {
    case 'pageview':
      return matchPattern(goal.pattern || '', context.path, goal.matchType || 'exact')
    case 'event':
      if (!context.eventName) return false
      return matchPattern(goal.pattern || '', context.eventName, goal.matchType || 'exact')
    case 'duration':
      if (context.sessionDurationMinutes === undefined) return false
      return context.sessionDurationMinutes >= (goal.durationMinutes || 0)
    default:
      return false
  }
}

// ============================================================================
// Detail Page Section Tests
// ============================================================================

describe('Detail Page Sections', () => {
  const validSections = ['pages', 'referrers', 'devices', 'browsers', 'countries', 'campaigns', 'events', 'goals']

  describe('isValidSection', () => {
    it('should validate all known sections', () => {
      for (const section of validSections) {
        expect(isValidSection(section)).toBe(true)
      }
    })

    it('should reject unknown sections', () => {
      expect(isValidSection('unknown')).toBe(false)
      expect(isValidSection('')).toBe(false)
      expect(isValidSection('admin')).toBe(false)
    })
  })

  describe('getSectionTitle', () => {
    it('should return correct titles', () => {
      expect(getSectionTitle('pages')).toBe('All Pages')
      expect(getSectionTitle('referrers')).toBe('All Referrers')
      expect(getSectionTitle('devices')).toBe('Devices & OS')
      expect(getSectionTitle('browsers')).toBe('All Browsers')
      expect(getSectionTitle('countries')).toBe('All Countries')
      expect(getSectionTitle('campaigns')).toBe('All Campaigns')
      expect(getSectionTitle('events')).toBe('All Events')
      expect(getSectionTitle('goals')).toBe('Goals')
    })

    it('should return default for unknown section', () => {
      expect(getSectionTitle('unknown')).toBe('Analytics')
    })
  })
})

function isValidSection(section: string): boolean {
  const validSections = ['pages', 'referrers', 'devices', 'browsers', 'countries', 'campaigns', 'events', 'goals']
  return validSections.includes(section)
}

function getSectionTitle(section: string): string {
  const titles: Record<string, string> = {
    pages: 'All Pages',
    referrers: 'All Referrers',
    devices: 'Devices & OS',
    browsers: 'All Browsers',
    countries: 'All Countries',
    campaigns: 'All Campaigns',
    events: 'All Events',
    goals: 'Goals',
  }
  return titles[section] || 'Analytics'
}

// ============================================================================
// Conversion Value Calculation Tests
// ============================================================================

describe('Conversion Value Calculation', () => {
  describe('calculateConversionValue', () => {
    it('should sum conversion values', () => {
      const conversions = [
        { value: 10.00 },
        { value: 25.50 },
        { value: 5.00 },
      ]
      expect(calculateTotalConversionValue(conversions)).toBe(40.50)
    })

    it('should handle conversions without value', () => {
      const conversions = [
        { value: 10.00 },
        { value: undefined },
        { value: 5.00 },
      ]
      expect(calculateTotalConversionValue(conversions)).toBe(15.00)
    })

    it('should return 0 for empty array', () => {
      expect(calculateTotalConversionValue([])).toBe(0)
    })

    it('should handle floating point precision', () => {
      const conversions = [
        { value: 0.1 },
        { value: 0.2 },
      ]
      expect(calculateTotalConversionValue(conversions)).toBeCloseTo(0.3, 10)
    })
  })

  describe('calculateConversionRate', () => {
    it('should calculate conversion rate correctly', () => {
      expect(calculateConversionRate(25, 100)).toBe(25)
      expect(calculateConversionRate(1, 1000)).toBe(0.1)
    })

    it('should handle zero visitors', () => {
      expect(calculateConversionRate(0, 0)).toBe(0)
    })

    it('should cap at 100%', () => {
      expect(calculateConversionRate(150, 100)).toBe(100)
    })
  })
})

function calculateTotalConversionValue(conversions: Array<{ value?: number }>): number {
  return conversions.reduce((sum, c) => sum + (c.value || 0), 0)
}

function calculateConversionRate(conversions: number, visitors: number): number {
  if (visitors <= 0) return 0
  return Math.min(100, Math.round((conversions / visitors) * 1000) / 10)
}
