/**
 * Funnel Analysis Utilities
 *
 * Tools for analyzing conversion funnels and user journeys.
 */

import type { CustomEvent, PageView, Session } from './types'

// ============================================================================
// Types
// ============================================================================

export interface FunnelStep {
  /** Step identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Match criteria for this step */
  match: FunnelStepMatcher
}

export interface FunnelStepMatcher {
  /** Path pattern (supports * wildcard) */
  path?: string
  /** Event name to match */
  eventName?: string
  /** Event category to match */
  eventCategory?: string
  /** Custom matcher function */
  custom?: (event: PageView | CustomEvent) => boolean
}

export interface Funnel {
  /** Funnel identifier */
  id: string
  /** Funnel name */
  name: string
  /** Ordered steps in the funnel */
  steps: FunnelStep[]
  /** Time window in milliseconds for completing funnel */
  windowMs?: number
}

export interface FunnelAnalysis {
  /** Funnel being analyzed */
  funnel: Funnel
  /** Date range of analysis */
  dateRange: {
    start: Date
    end: Date
  }
  /** Total users who entered the funnel */
  totalEntries: number
  /** Users who completed the funnel */
  completions: number
  /** Overall conversion rate */
  conversionRate: number
  /** Step-by-step breakdown */
  steps: FunnelStepAnalysis[]
  /** Average time to complete (ms) */
  avgCompletionTimeMs?: number
}

export interface FunnelStepAnalysis {
  /** Step being analyzed */
  step: FunnelStep
  /** Users who reached this step */
  reached: number
  /** Users who dropped off at this step */
  droppedOff: number
  /** Conversion rate from previous step */
  conversionFromPrevious: number
  /** Overall conversion rate from funnel start */
  conversionFromStart: number
  /** Average time spent on this step (ms) */
  avgTimeOnStepMs?: number
}

export interface UserJourney {
  /** Visitor ID */
  visitorId: string
  /** Session ID */
  sessionId: string
  /** Steps completed */
  stepsCompleted: number
  /** Total steps in funnel */
  totalSteps: number
  /** Whether funnel was completed */
  completed: boolean
  /** Timestamps for each step */
  stepTimestamps: Date[]
  /** Time to complete (ms) */
  completionTimeMs?: number
  /** Drop-off step (if not completed) */
  dropOffStep?: string
}

// ============================================================================
// Funnel Builder
// ============================================================================

/**
 * Fluent builder for creating funnels
 *
 * @example
 * ```ts
 * const checkout = createFunnel('checkout')
 *   .name('Checkout Flow')
 *   .step('view_product', 'View Product', { path: '/products/*' })
 *   .step('add_to_cart', 'Add to Cart', { eventName: 'add_to_cart' })
 *   .step('checkout', 'Checkout', { path: '/checkout' })
 *   .step('purchase', 'Purchase', { eventName: 'purchase' })
 *   .window(30 * 60 * 1000) // 30 minutes
 *   .build()
 * ```
 */
export function createFunnel(id: string): FunnelBuilder {
  return new FunnelBuilder(id)
}

class FunnelBuilder {
  private funnel: Funnel

  constructor(id: string) {
    this.funnel = {
      id,
      name: id,
      steps: [],
    }
  }

  name(name: string): this {
    this.funnel.name = name
    return this
  }

  step(id: string, name: string, match: FunnelStepMatcher): this {
    this.funnel.steps.push({ id, name, match })
    return this
  }

  window(windowMs: number): this {
    this.funnel.windowMs = windowMs
    return this
  }

  build(): Funnel {
    if (this.funnel.steps.length < 2) {
      throw new Error('Funnel must have at least 2 steps')
    }
    return { ...this.funnel }
  }
}

// ============================================================================
// Funnel Analyzer
// ============================================================================

/**
 * Analyze funnel performance from event data
 */
export class FunnelAnalyzer {
  private funnel: Funnel

  constructor(funnel: Funnel) {
    this.funnel = funnel
  }

  /**
   * Analyze funnel performance from page views and events
   */
  analyze(
    pageViews: PageView[],
    events: CustomEvent[],
    sessions: Session[],
  ): FunnelAnalysis {
    // Group events by session
    const sessionEvents = this.groupBySession(pageViews, events)

    // Analyze each session's journey through the funnel
    const journeys = this.analyzeJourneys(sessionEvents)

    // Calculate metrics
    const totalEntries = journeys.filter(j => j.stepsCompleted >= 1).length
    const completions = journeys.filter(j => j.completed).length
    const conversionRate = totalEntries > 0 ? completions / totalEntries : 0

    // Calculate completion times
    const completionTimes = journeys
      .filter(j => j.completed && j.completionTimeMs)
      .map(j => j.completionTimeMs!)
    const avgCompletionTimeMs = completionTimes.length > 0
      ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      : undefined

    // Analyze each step
    const steps = this.analyzeSteps(journeys, totalEntries)

    return {
      funnel: this.funnel,
      dateRange: this.getDateRange(pageViews, events),
      totalEntries,
      completions,
      conversionRate,
      steps,
      avgCompletionTimeMs,
    }
  }

  /**
   * Get individual user journeys through the funnel
   */
  getJourneys(
    pageViews: PageView[],
    events: CustomEvent[],
  ): UserJourney[] {
    const sessionEvents = this.groupBySession(pageViews, events)
    return this.analyzeJourneys(sessionEvents)
  }

  private groupBySession(
    pageViews: PageView[],
    events: CustomEvent[],
  ): Map<string, Array<PageView | CustomEvent>> {
    const sessionEvents = new Map<string, Array<PageView | CustomEvent>>()

    // Add page views
    for (const pv of pageViews) {
      const key = `${pv.visitorId}:${pv.sessionId}`
      if (!sessionEvents.has(key)) {
        sessionEvents.set(key, [])
      }
      sessionEvents.get(key)!.push(pv)
    }

    // Add custom events
    for (const event of events) {
      const key = `${event.visitorId}:${event.sessionId}`
      if (!sessionEvents.has(key)) {
        sessionEvents.set(key, [])
      }
      sessionEvents.get(key)!.push(event)
    }

    // Sort by timestamp
    for (const [key, eventList] of sessionEvents) {
      eventList.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    }

    return sessionEvents
  }

  private analyzeJourneys(
    sessionEvents: Map<string, Array<PageView | CustomEvent>>,
  ): UserJourney[] {
    const journeys: UserJourney[] = []

    for (const [key, eventList] of sessionEvents) {
      const [visitorId, sessionId] = key.split(':')
      const journey = this.analyzeSessionJourney(visitorId, sessionId, eventList)
      if (journey.stepsCompleted > 0) {
        journeys.push(journey)
      }
    }

    return journeys
  }

  private analyzeSessionJourney(
    visitorId: string,
    sessionId: string,
    events: Array<PageView | CustomEvent>,
  ): UserJourney {
    const stepTimestamps: Date[] = []
    let currentStepIndex = 0
    let funnelStartTime: Date | undefined

    for (const event of events) {
      // Check time window
      if (funnelStartTime && this.funnel.windowMs) {
        const elapsed = event.timestamp.getTime() - funnelStartTime.getTime()
        if (elapsed > this.funnel.windowMs) {
          break // Time window exceeded
        }
      }

      // Check if event matches current step
      const currentStep = this.funnel.steps[currentStepIndex]
      if (currentStep && this.matchesStep(event, currentStep)) {
        stepTimestamps.push(event.timestamp)

        if (currentStepIndex === 0) {
          funnelStartTime = event.timestamp
        }

        currentStepIndex++

        // Check if funnel completed
        if (currentStepIndex >= this.funnel.steps.length) {
          break
        }
      }
    }

    const completed = currentStepIndex >= this.funnel.steps.length
    const completionTimeMs = completed && stepTimestamps.length >= 2
      ? stepTimestamps[stepTimestamps.length - 1].getTime() - stepTimestamps[0].getTime()
      : undefined

    return {
      visitorId,
      sessionId,
      stepsCompleted: currentStepIndex,
      totalSteps: this.funnel.steps.length,
      completed,
      stepTimestamps,
      completionTimeMs,
      dropOffStep: !completed && currentStepIndex < this.funnel.steps.length
        ? this.funnel.steps[currentStepIndex].id
        : undefined,
    }
  }

  private matchesStep(event: PageView | CustomEvent, step: FunnelStep): boolean {
    const { match } = step

    // Custom matcher takes precedence
    if (match.custom) {
      return match.custom(event)
    }

    // Path matching
    if (match.path) {
      const path = 'path' in event ? event.path : undefined
      if (path && !this.matchPath(path, match.path)) {
        return false
      }
      if (match.path && !path) {
        return false
      }
    }

    // Event name matching
    if (match.eventName) {
      const eventName = 'name' in event ? event.name : undefined
      if (eventName !== match.eventName) {
        return false
      }
    }

    // Event category matching
    if (match.eventCategory) {
      const category = 'category' in event ? event.category : undefined
      if (category !== match.eventCategory) {
        return false
      }
    }

    return true
  }

  private matchPath(path: string, pattern: string): boolean {
    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*/g, '.*') // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(path)
  }

  private analyzeSteps(journeys: UserJourney[], totalEntries: number): FunnelStepAnalysis[] {
    return this.funnel.steps.map((step, index) => {
      const reached = journeys.filter(j => j.stepsCompleted > index).length
      const droppedOff = index === 0
        ? totalEntries - reached
        : journeys.filter(j => j.stepsCompleted === index).length

      const previousReached = index === 0 ? totalEntries : journeys.filter(j => j.stepsCompleted >= index).length
      const conversionFromPrevious = previousReached > 0 ? reached / previousReached : 0
      const conversionFromStart = totalEntries > 0 ? reached / totalEntries : 0

      // Calculate average time on step
      const stepTimes = journeys
        .filter(j => j.stepsCompleted > index && j.stepTimestamps.length > index + 1)
        .map(j => {
          const stepStart = j.stepTimestamps[index]
          const stepEnd = j.stepTimestamps[index + 1]
          return stepEnd.getTime() - stepStart.getTime()
        })

      const avgTimeOnStepMs = stepTimes.length > 0
        ? stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length
        : undefined

      return {
        step,
        reached,
        droppedOff,
        conversionFromPrevious,
        conversionFromStart,
        avgTimeOnStepMs,
      }
    })
  }

  private getDateRange(
    pageViews: PageView[],
    events: CustomEvent[],
  ): { start: Date, end: Date } {
    const allTimestamps = [
      ...pageViews.map(pv => pv.timestamp),
      ...events.map(e => e.timestamp),
    ].sort((a, b) => a.getTime() - b.getTime())

    return {
      start: allTimestamps[0] ?? new Date(),
      end: allTimestamps[allTimestamps.length - 1] ?? new Date(),
    }
  }
}

// ============================================================================
// Preset Funnels
// ============================================================================

/**
 * Common e-commerce checkout funnel
 */
export const ecommerceCheckoutFunnel = createFunnel('ecommerce-checkout')
  .name('E-commerce Checkout')
  .step('view_product', 'View Product', { path: '/products/*' })
  .step('add_to_cart', 'Add to Cart', { eventName: 'add_to_cart' })
  .step('view_cart', 'View Cart', { path: '/cart' })
  .step('begin_checkout', 'Begin Checkout', { path: '/checkout' })
  .step('complete_purchase', 'Complete Purchase', { eventName: 'purchase' })
  .window(60 * 60 * 1000) // 1 hour
  .build()

/**
 * SaaS signup funnel
 */
export const saasSignupFunnel = createFunnel('saas-signup')
  .name('SaaS Signup')
  .step('landing', 'Landing Page', { path: '/' })
  .step('pricing', 'View Pricing', { path: '/pricing' })
  .step('signup_start', 'Start Signup', { path: '/signup' })
  .step('signup_complete', 'Complete Signup', { eventName: 'signup_complete' })
  .window(24 * 60 * 60 * 1000) // 24 hours
  .build()

/**
 * Content engagement funnel
 */
export const contentEngagementFunnel = createFunnel('content-engagement')
  .name('Content Engagement')
  .step('article_view', 'View Article', { path: '/blog/*' })
  .step('scroll_50', 'Scroll 50%', { eventName: 'scroll_depth', custom: e => 'properties' in e && (e as CustomEvent).properties?.depth === 50 })
  .step('scroll_100', 'Scroll 100%', { eventName: 'scroll_depth', custom: e => 'properties' in e && (e as CustomEvent).properties?.depth === 100 })
  .step('share', 'Share Article', { eventName: 'share' })
  .build()

// ============================================================================
// Utilities
// ============================================================================

/**
 * Calculate drop-off rate between two steps
 */
export function calculateDropOffRate(
  stepACount: number,
  stepBCount: number,
): number {
  if (stepACount === 0) return 0
  return 1 - (stepBCount / stepACount)
}

/**
 * Format funnel analysis as a simple report
 */
export function formatFunnelReport(analysis: FunnelAnalysis): string {
  const lines: string[] = [
    `Funnel: ${analysis.funnel.name}`,
    `Period: ${analysis.dateRange.start.toISOString()} - ${analysis.dateRange.end.toISOString()}`,
    '',
    `Total Entries: ${analysis.totalEntries}`,
    `Completions: ${analysis.completions}`,
    `Overall Conversion: ${(analysis.conversionRate * 100).toFixed(2)}%`,
    '',
    'Step Breakdown:',
  ]

  for (const step of analysis.steps) {
    lines.push(`  ${step.step.name}:`)
    lines.push(`    Reached: ${step.reached}`)
    lines.push(`    Drop-off: ${step.droppedOff}`)
    lines.push(`    Conv. from prev: ${(step.conversionFromPrevious * 100).toFixed(2)}%`)
    lines.push(`    Conv. from start: ${(step.conversionFromStart * 100).toFixed(2)}%`)
    if (step.avgTimeOnStepMs !== undefined) {
      lines.push(`    Avg time: ${(step.avgTimeOnStepMs / 1000).toFixed(1)}s`)
    }
  }

  if (analysis.avgCompletionTimeMs !== undefined) {
    lines.push('')
    lines.push(`Avg Completion Time: ${(analysis.avgCompletionTimeMs / 1000).toFixed(1)}s`)
  }

  return lines.join('\n')
}

/**
 * Identify common drop-off points
 */
export function identifyDropOffPoints(analysis: FunnelAnalysis): Array<{
  step: FunnelStep
  dropOffRate: number
  impact: number // How much this affects overall conversion
}> {
  return analysis.steps
    .map((step, index) => {
      const dropOffRate = 1 - step.conversionFromPrevious
      const previousConversion = index === 0 ? 1 : analysis.steps[index - 1].conversionFromStart
      const impact = dropOffRate * previousConversion

      return {
        step: step.step,
        dropOffRate,
        impact,
      }
    })
    .sort((a, b) => b.impact - a.impact)
}
