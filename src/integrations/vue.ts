/**
 * Vue 3 Plugin — add analytics to a plain Vue app (Vite, vue-cli, anything that
 * is not Nuxt).
 *
 * ```ts
 * // main.ts
 * import { createApp } from 'vue'
 * import { tsAnalytics } from '@ts-analytics/tracking/vue'
 * import App from './App.vue'
 *
 * createApp(App)
 *   .use(tsAnalytics, { appId: 'APP_ID' })   // endpoint is baked in
 *   .mount('#app')
 * ```
 *
 * ```vue
 * <script setup lang="ts">
 * import { useTsAnalytics } from '@ts-analytics/tracking/vue'
 * const { track } = useTsAnalytics()
 * </script>
 * <template><button @click="track('signup')">Sign up</button></template>
 * ```
 *
 * ## Route changes need no wiring
 *
 * The tracker hooks `history.pushState` and `replaceState` itself, and
 * vue-router navigates through both, so client-side route changes are recorded
 * without this plugin touching the router.
 *
 * That is also why the plugin does NOT accept a `router` and subscribe to
 * `afterEach`: it would report every navigation twice, once from the history
 * hook and once from the subscription. The same trap exists in other SDKs —
 * bughq's Nuxt module ships `autoInstrument.navigation` defaulting to false for
 * exactly this reason.
 *
 * ## Where the script tag comes from
 *
 * Unlike the Nuxt and stx integrations, which inject the tag server-side into
 * the HTML the browser receives, a plain Vue SPA has no server render to inject
 * into — so this appends the tag at runtime, on install.
 *
 * Server-side is strictly better when available, because the tag is parsed with
 * the document rather than after the framework boots. If your app has an
 * `index.html` you control, prefer pasting the snippet there and the plugin will
 * detect it and not add a second one:
 *
 * ```html
 * <script defer data-site="APP_ID" src="https://analyticshq.org/script.js"></script>
 * ```
 */
import type { App } from 'vue'
import type { TsAnalyticsApi } from './runtime/tracker'
import type { TsAnalyticsOptions } from './stx'
import { createTrackerApi, ensureTrackerScript, track } from './runtime/tracker'
import { resolveApiEndpoint } from './stx'

export type { Props, TsAnalyticsApi } from './runtime/tracker'
export type { TsAnalyticsOptions } from './stx'

export interface TsAnalyticsVueOptions extends TsAnalyticsOptions {
  /**
   * Inject the tracker. **Defaults to `false` in development**, detected from
   * `import.meta.env.DEV` (Vite) and falling back to `NODE_ENV`.
   *
   * The tracker applies no localhost filtering of its own — it reports
   * `location.origin + location.pathname` — so with this on during development
   * every reload lands in the same reports as production traffic, under paths
   * indistinguishable from the real thing, and there is no way to separate it
   * out afterwards short of deleting by date.
   *
   * Set `true` to force it on (pointing `apiEndpoint` at a local collector), or
   * `false` to disable it everywhere.
   */
  enabled?: boolean
}

/**
 * Is this a development build?
 *
 * `import.meta.env.DEV` is the Vite signal and the accurate one; NODE_ENV is the
 * fallback for bundlers that do not define it. Wrapped in try/catch because
 * `import.meta` is a syntax-level construct that some CJS interop paths choke
 * on, and a crash here would take out `app.use()` for everyone.
 */
function isDevelopment(): boolean {
  try {
    const meta = import.meta as unknown as { env?: { DEV?: boolean } }
    if (typeof meta?.env?.DEV === 'boolean')
      return meta.env.DEV
  }
  catch {
    // fall through
  }
  return process.env.NODE_ENV !== 'production'
}

/**
 * Custom event tracking.
 *
 * Deliberately not `inject()`-based. The tracker is a browser global, so this
 * needs no plugin context and works anywhere — outside `setup()`, in a Pinia
 * store, in a plain module — where an injection-based composable would throw
 * "inject() can only be used inside setup()". The plugin still registers
 * `$tsAnalytics` for Options API components.
 *
 * Safe to call before the tracker script has executed: events are queued and
 * flushed when it arrives.
 */
export function useTsAnalytics(): TsAnalyticsApi {
  return createTrackerApi()
}

/** Vue's `Plugin` shape, declared structurally so `vue` stays a type-only import. */
export interface TsAnalyticsVuePlugin {
  install: (app: App, options?: TsAnalyticsVueOptions) => void
}

export const tsAnalytics: TsAnalyticsVuePlugin = {
  install(app: App, options?: TsAnalyticsVueOptions) {
    const appId = options?.appId?.trim()

    // Registered before the enabled/appId checks so `track()` is always callable.
    // A component that calls it must not throw because analytics happens to be
    // off in this environment — the tracker no-ops instead.
    app.config.globalProperties.$tsAnalytics = createTrackerApi()

    if (!appId) {
      console.warn('[ts-analytics] plugin skipped — `appId` is required: app.use(tsAnalytics, { appId })')
      return
    }

    const enabled = options?.enabled ?? !isDevelopment()
    if (!enabled)
      return

    const origin = resolveApiEndpoint(options?.apiEndpoint)
    if (!origin)
      return

    const rawPath = options?.scriptPath ?? '/script.js'
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
    const src = `${origin}${path}${options?.stealth ? '?stealth=true' : ''}`

    ensureTrackerScript(src, appId)
  },
}

/**
 * Disambiguated alias.
 *
 * `tsAnalytics` reads correctly at the call site — `app.use(tsAnalytics, …)` —
 * and is what the Vue docs' plugin convention suggests. But the stx integration
 * exports a *function* under that same name, so anyone importing both, or
 * pulling from the root barrel, gets one shadowing the other with no error and a
 * confusing "not a function". Use this name when both are in scope.
 */
export const tsAnalyticsVue: TsAnalyticsVuePlugin = tsAnalytics

export default tsAnalytics

declare module 'vue' {
  interface ComponentCustomProperties {
    /** Options API access — `this.$tsAnalytics.track('signup')`. */
    $tsAnalytics: TsAnalyticsApi
  }
}

/**
 * Track without the composable — for modules that are not components at all
 * (a Pinia store action, an API client, an error handler).
 */
export { track }
