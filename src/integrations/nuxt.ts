/**
 * Nuxt Module — add ts-analytics to a Nuxt app the way you'd add `nuxt-fathom`.
 *
 * ```ts
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: ['@stacksjs/ts-analytics/nuxt'],
 *   tsAnalytics: {
 *     appId: 'APP_ID',
 *     apiEndpoint: 'https://analytics.example.com',
 *   },
 * })
 * ```
 *
 * Behind the scenes it injects ts-analytics' shared `/script.js` into `<head>`
 * (keyed by your App ID via `data-site`). That tracker self-reports pageviews,
 * **SPA route changes** (it hooks `history.pushState`/`replaceState` — i.e.
 * vue-router/Nuxt navigation, so client-side route changes are tracked with no
 * router wiring), link clicks, engagement, Core Web Vitals and JS errors,
 * POSTing them to `<apiEndpoint>/collect`. It derives the collector from its own
 * `src` origin and the App ID from `data-site`, so the only config a host app
 * supplies is `appId` + `apiEndpoint`.
 *
 * For custom events, the auto-imported `useTsAnalytics()` composable wraps the
 * tracker's global (`window.fathom`, Fathom-API compatible).
 *
 * Requires `@nuxt/kit` (provided by any Nuxt project; declared as an optional
 * peer so non-Nuxt consumers of @stacksjs/ts-analytics don't pull it in).
 */
import type { Nuxt, NuxtModule } from '@nuxt/schema'
import { addImports, createResolver, defineNuxtModule } from '@nuxt/kit'
import { tsAnalytics, type TsAnalyticsOptions } from './stx'

export interface TsAnalyticsNuxtOptions extends TsAnalyticsOptions {
  /** Set false to skip injecting the tracker (e.g. in local dev). Default: true. */
  enabled?: boolean
}

const tsAnalyticsNuxtModule: NuxtModule<TsAnalyticsNuxtOptions> = defineNuxtModule<TsAnalyticsNuxtOptions>({
  meta: {
    name: '@stacksjs/ts-analytics',
    configKey: 'tsAnalytics',
    compatibility: { nuxt: '>=3.0.0' },
  },
  defaults: { enabled: true } as Partial<TsAnalyticsNuxtOptions>,
  setup(options: TsAnalyticsNuxtOptions, nuxt: Nuxt) {
    if (options.enabled === false)
      return

    // tsAnalytics() returns [] when appId/apiEndpoint are missing — so a
    // half-configured env never injects a broken tag.
    const scripts = tsAnalytics(options)
    if (scripts.length === 0) {
      console.warn('[ts-analytics] module skipped — `appId` and `apiEndpoint` are required in nuxt.config `tsAnalytics`.')
      return
    }

    // Inject the shared tracker into <head> on every page.
    nuxt.options.app.head.script = nuxt.options.app.head.script || []
    nuxt.options.app.head.script.push(...(scripts as unknown[] as NonNullable<typeof nuxt.options.app.head.script>))

    // Surface non-secret config for the composable / debugging.
    ;(nuxt.options.runtimeConfig.public as Record<string, unknown>).tsAnalytics = {
      appId: options.appId,
      apiEndpoint: options.apiEndpoint,
    }

    // Auto-import useTsAnalytics() for custom events.
    const resolver = createResolver(import.meta.url)
    addImports({
      name: 'useTsAnalytics',
      as: 'useTsAnalytics',
      from: resolver.resolve('./runtime/use-ts-analytics'),
    })
  },
})

export default tsAnalyticsNuxtModule
