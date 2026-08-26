/**
 * Nuxt Module — add ts-analytics to a Nuxt app the way you'd add `nuxt-fathom`.
 *
 * ```ts
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: ['@ts-analytics/tracking/nuxt'],
 *   tsAnalytics: {
 *     appId: 'APP_ID',   // that's it — the endpoint is baked in (Fathom-style)
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
 * supplies is `appId` (the endpoint is baked in; override via `apiEndpoint` or
 * the `TS_ANALYTICS_ENDPOINT` env var).
 *
 * For custom events, the auto-imported `useTsAnalytics()` composable wraps the
 * tracker's global (`window.fathom`, Fathom-API compatible).
 *
 * Requires `@nuxt/kit` (provided by any Nuxt project; declared as an optional
 * peer so non-Nuxt consumers of @ts-analytics/tracking don't pull it in).
 */
import type { Nuxt, NuxtModule } from '@nuxt/schema'
import { addImports, createResolver, defineNuxtModule } from '@nuxt/kit'
import { resolveApiEndpoint, tsAnalytics, type TsAnalyticsOptions } from './stx'

export interface TsAnalyticsNuxtOptions extends TsAnalyticsOptions {
  /**
   * Inject the tracker. **Defaults to `!nuxt.options.dev`** — on for `build`
   * and `generate`, off under `nuxt dev`.
   *
   * The tracker applies no localhost filtering of its own: it reports
   * `location.origin + location.pathname`, so with this on during development
   * every hot reload lands in the same reports as production traffic, tagged
   * with paths like `/` that are indistinguishable from the real thing. There
   * is no way to separate it out afterwards short of deleting by date.
   *
   * Set `true` to force it on in dev (pointing `apiEndpoint` at a local
   * collector), or `false` to disable it everywhere.
   */
  enabled?: boolean
}

const tsAnalyticsNuxtModule: NuxtModule<TsAnalyticsNuxtOptions> = defineNuxtModule<TsAnalyticsNuxtOptions>({
  meta: {
    // Must match the published package name: Nuxt keys module dedupe and its
    // build-time module list off this, so a stale name lets the same module
    // install twice under two specifiers and inject two tags.
    name: '@ts-analytics/tracking',
    configKey: 'tsAnalytics',
    compatibility: { nuxt: '>=3.0.0' },
  },
  // No `enabled` default here on purpose — a static default is indistinguishable
  // from an explicit choice, and `enabled ?? !dev` below needs to see undefined.
  setup(options: TsAnalyticsNuxtOptions, nuxt: Nuxt) {
    const enabled = options.enabled ?? !nuxt.options.dev
    if (!enabled)
      return

    // tsAnalytics() returns [] when appId is missing — so a half-configured env
    // never injects a broken tag.
    const scripts = tsAnalytics(options)
    if (scripts.length === 0) {
      console.warn('[ts-analytics] module skipped — `appId` is required in nuxt.config `tsAnalytics`.')
      return
    }

    // Inject the shared tracker into <head> on every page.
    nuxt.options.app.head.script = nuxt.options.app.head.script || []
    nuxt.options.app.head.script.push(...(scripts as unknown[] as NonNullable<typeof nuxt.options.app.head.script>))

    // Surface non-secret config for the composable / debugging.
    ;(nuxt.options.runtimeConfig.public as Record<string, unknown>).tsAnalytics = {
      appId: options.appId,
      apiEndpoint: resolveApiEndpoint(options.apiEndpoint),
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
