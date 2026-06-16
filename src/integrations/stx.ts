/**
 * stx integration for ts-analytics.
 *
 * The whole install is: add the plugin and give it your app ID — mirroring
 * the nuxt-fathom one-liner (register the module + provide an ID).
 *
 * ```ts
 * // stx.config.ts
 * export default {
 *   plugins: ['@stacksjs/ts-analytics'],
 *   analytics: {
 *     appId: 'YOUR_APP_ID',
 *     // apiEndpoint defaults to '/api/analytics'
 *   },
 * }
 * ```
 *
 * It injects ts-analytics' SPA-aware tracking script before `</head>` on every
 * server-rendered page. The tracker patches `history.pushState`/`replaceState`,
 * so it counts client-side (SPA) navigations after the first load — not just
 * full reloads. This is exposed as the package's DEFAULT export, so stx
 * resolves `plugins: ['@stacksjs/ts-analytics']` to it directly (no subpath).
 *
 * Config is read from the top-level `analytics` key (the same way nuxt-fathom
 * reads `fathom:`); you can also pass options inline on the plugin entry:
 *
 * ```ts
 * plugins: [['@stacksjs/ts-analytics', { appId: 'YOUR_APP_ID' }]]
 * ```
 */
import type { TrackingScriptConfig } from '../tracking-script'
import { generateFullTrackingScript } from '../tracking-script'

/**
 * ts-analytics config for stx — the shape of the top-level `analytics` key.
 * Extends the tracker config but swaps the internal `siteId` for the
 * consumer-facing `appId`, and adds an `apiEndpoint` default.
 */
export interface StxAnalyticsConfig extends Partial<Omit<TrackingScriptConfig, 'siteId' | 'apiEndpoint'>> {
  /** Your ts-analytics app ID (the site/app identifier). Required to track. */
  appId?: string
  /** Collector base URL. POSTs land at `${apiEndpoint}/collect`. Default: `/api/analytics`. */
  apiEndpoint?: string
  /** Set `false` to disable without removing the plugin from the list. */
  enabled?: boolean
}

/** Minimal shape of the stx plugin setup context (avoids a hard dep on stx types). */
interface StxPluginContext {
  config?: {
    analytics?: StxAnalyticsConfig & {
      enabled?: boolean
      driver?: string
      custom?: { inlineScript?: string, scriptUrl?: string, __tsAnalytics?: boolean }
    }
  } & Record<string, unknown>
}

/**
 * The stx plugin object. Exported by name for explicit imports; also the
 * package default export (see `src/index.ts`) so `plugins: ['@stacksjs/ts-analytics']`
 * resolves to it.
 */
export const stxPlugin = {
  name: 'ts-analytics',
  setup(options: StxAnalyticsConfig | undefined, stx: StxPluginContext): void {
    // Merge the top-level `analytics` config with any inline plugin options
    // (inline wins). Makes BOTH styles work:
    //   plugins: ['@stacksjs/ts-analytics'], analytics: { appId }
    //   plugins: [['@stacksjs/ts-analytics', { appId }]]
    const cfg: StxAnalyticsConfig = { ...(stx.config?.analytics ?? {}), ...(options ?? {}) }

    if (cfg.enabled === false)
      return

    const appId = cfg.appId ?? (cfg as { siteId?: string }).siteId
    if (!appId) {
      console.warn(
        '[ts-analytics] no `appId` configured — add `analytics: { appId: \'…\' }` to stx.config.ts. Skipping tracker injection.',
      )
      return
    }

    // Validate before these values get interpolated into the inline tracker.
    // They're developer config, but a stray quote/backslash/newline would
    // silently break the whole tracker, and a `</script>` would close the
    // injected <script> element (the HTML parser ignores JS string context).
    // Warn-and-skip — matching the missing-appId path — beats a broken page.
    if (!/^[\w.-]+$/.test(String(appId))) {
      console.warn(
        `[ts-analytics] appId '${appId}' has unexpected characters (allowed: A–Z a–z 0–9 . _ -). Skipping tracker injection.`,
      )
      return
    }
    // Strip trailing slashes so we never emit `${apiEndpoint}//collect`, then
    // reject anything that could still break out of the literal / <script>.
    const apiEndpoint = (cfg.apiEndpoint ?? '/api/analytics').replace(/\/+$/, '')
    if (/[<>"'\\\n\r]/.test(apiEndpoint)) {
      console.warn(
        `[ts-analytics] apiEndpoint '${apiEndpoint}' contains unsafe characters. Skipping tracker injection.`,
      )
      return
    }

    // Everything except the integration-only keys flows through to the tracker
    // (honorDnt, trackOutboundLinks, heatmap, excludePaths, …). `siteId` is
    // dropped explicitly so a stray value can't shadow appId regardless of key order.
    const { appId: _appId, apiEndpoint: _apiEndpoint, enabled: _enabled, siteId: _siteId, ...trackerOpts }
      = cfg as StxAnalyticsConfig & { siteId?: string }
    const trackerJs = generateFullTrackingScript({
      autoPageView: true,
      ...trackerOpts,
      siteId: appId,
      apiEndpoint,
    })

    // stx's native analytics injection (injectAnalytics) is the right home for
    // this: it runs at process.ts ~1356, and the client-script transform runs
    // LATER (~1482). So our injected inline <script> IS re-wrapped into a
    // `<script data-stx-scoped>;(function(){'use strict'; … })()`, and because
    // the SPA fragment extractor re-runs every data-stx-scoped script, it is
    // re-executed on every client-side navigation. That re-execution is exactly
    // why the `if(!window.__tsAnalytics)` guard below is LOAD-BEARING (not
    // defensive): it keeps history.pushState patched once and avoids
    // double-counting. (The wrapper carries no `window.stx` destructure, so it's
    // safe on no-signals pages.) We adapt the simple `{ appId }` config into
    // stx's single-driver native analytics: { enabled, driver:'custom', custom }.
    stx.config ??= {}
    stx.config.analytics ??= {}
    const a = stx.config.analytics
    // Evaluate the conflict against the EFFECTIVE config (analytics + inline
    // options), and treat our own prior injection as a no-op — so HMR / a re-run
    // of setup neither warns nor double-injects.
    const effectiveDriver = (cfg as { driver?: string }).driver
    if ((effectiveDriver && effectiveDriver !== 'custom') || (a.custom && !a.custom.__tsAnalytics)) {
      console.warn(
        `[ts-analytics] a native analytics provider is already configured (${effectiveDriver ? `driver: '${effectiveDriver}'` : 'analytics.custom'}); ts-analytics tracker NOT injected.`,
      )
      return
    }
    a.enabled = true
    a.driver = 'custom'
    // if-block guard (not a top-level `return`, which is illegal inside <script>);
    // load-bearing — see above. `__tsAnalytics: true` marks the block as ours so
    // a re-run of setup is an idempotent no-op.
    a.custom = {
      __tsAnalytics: true,
      inlineScript: `if(!window.__tsAnalytics){window.__tsAnalytics=1;\n${trackerJs}\n}`,
    }
  },
}

export default stxPlugin
