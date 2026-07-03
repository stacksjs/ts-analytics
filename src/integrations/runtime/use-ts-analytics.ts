/**
 * `useTsAnalytics()` — custom event tracking for the ts-analytics Nuxt module.
 *
 * The injected tracker exposes a Fathom-API-compatible global
 * (`window.fathom.track(name, value)`); this composable wraps it with an
 * SSR-safe no-op on the server. Auto-imported by `@stacksjs/ts-analytics/nuxt`.
 *
 * ```ts
 * const { track } = useTsAnalytics()
 * track('signup')
 * track('purchase', 4200) // optional numeric value (e.g. cents)
 * track('signup', 0, { plan: 'pro' }) // custom properties
 * ```
 */
export interface TsAnalyticsApi {
  /** Track a custom event by name, with an optional numeric value and
   * custom properties (Plausible-style) that appear under Event Properties. */
  track: (name: string, value?: number, props?: Record<string, string | number | boolean>) => void
}

export function useTsAnalytics(): TsAnalyticsApi {
  return {
    track(name: string, value?: number, props?: Record<string, string | number | boolean>): void {
      if (typeof window === 'undefined')
        return // SSR: the tracker only exists in the browser
      const tracker = (window as unknown as {
        fathom?: { track?: (name: string, value?: number, props?: Record<string, string | number | boolean>) => void }
      }).fathom
      tracker?.track?.(name, value, props)
    },
  }
}
