/**
 * `useTsAnalytics()` — custom event tracking for the Nuxt module.
 *
 * ```ts
 * const { track } = useTsAnalytics()
 * track('signup')
 * track('purchase', 4200)              // optional numeric value
 * track('signup', 0, { plan: 'pro' })  // custom properties
 * ```
 *
 * The behaviour lives in `./tracker` — which tracker global to reach for, how
 * `value` maps onto each one, the queue that holds events fired before the
 * deferred tag executes, and the guard that stops a real Fathom global from
 * receiving this app's events. The Vue plugin exposes the same functions, so
 * there is one implementation to fix rather than two to keep in step.
 *
 * This file stays a separate entrypoint because Nuxt's `addImports` resolves it
 * by path string, not by import.
 */
import type { Props, TsAnalyticsApi } from './tracker'
import { createTrackerApi } from './tracker'

export type { Props, TsAnalyticsApi } from './tracker'

export function useTsAnalytics(): TsAnalyticsApi {
  return createTrackerApi()
}

/**
 * Exported for tests: reset queue + poll state between cases.
 *
 * @internal
 */
export { __resetTrackerState as __resetTsAnalyticsQueue } from './tracker'
