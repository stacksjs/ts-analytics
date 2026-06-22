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
 * ```
 */
export interface TsAnalyticsApi {
  /** Track a custom event by name, with an optional numeric value. */
  track: (name: string, value?: number) => void
}

export function useTsAnalytics(): TsAnalyticsApi {
  return {
    track(name: string, value?: number): void {
      if (typeof window === 'undefined')
        return // SSR: the tracker only exists in the browser
      const tracker = (window as unknown as {
        fathom?: { track?: (name: string, value?: number) => void }
      }).fathom
      tracker?.track?.(name, value)
    },
  }
}
