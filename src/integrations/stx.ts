/**
 * stx / Stacks Config Integration
 *
 * Add ts-analytics to a stx (or Stacks) app the way you'd add a Nuxt analytics
 * module — from the config file, keyed by an **App ID**.
 *
 * ts-analytics serves one shared, cacheable tracker at `<apiEndpoint>/script.js`
 * (Fathom/Plausible-style). The tracker reads its App ID from the `data-site`
 * attribute and derives the collector endpoint from its own `src` origin, so
 * the only thing a host app supplies is the App ID + the API origin.
 *
 * Spread the result into your stx config's `app.head.script`:
 *
 * ```ts
 * // config/stx.ts (Stacks)  — or  stx.config.ts
 * import { tsAnalytics } from '@stacksjs/ts-analytics/stx'
 *
 * export default {
 *   app: {
 *     head: {
 *       script: [
 *         ...tsAnalytics({ appId: 'my-app', apiEndpoint: 'https://analytics.example.com' }),
 *       ],
 *     },
 *   },
 * }
 * ```
 *
 * **Why a head helper and not a `plugins: [...]` entry?** stx's plugin render
 * lifecycle hooks (`afterRender`) are not invoked by the dev/serve render
 * pipeline, and a plugin's `setup()` config mutation does not propagate to
 * rendering. The head config *is* read on every render, so this is the reliable
 * mechanism — and it mirrors what framework analytics modules do internally
 * (push a tag onto the document head).
 */

/** A stx head `<script>` entry — an item of the config `app.head.script` array. */
export interface StxHeadScript {
  src?: string
  content?: string
  defer?: boolean
  async?: boolean
  type?: string
  /** Arbitrary attributes (e.g. `data-site`) are rendered verbatim. */
  [attr: string]: unknown
}

export interface TsAnalyticsOptions {
  /** Your ts-analytics **App ID** (rendered as the tracker's `data-site`). */
  appId: string
  /**
   * Origin of your ts-analytics API — where `/script.js` is served and where
   * the tracker POSTs pageviews/events. e.g. `'https://analytics.example.com'`,
   * or `'http://localhost:2027'` in dev. Trailing slashes are trimmed.
   */
  apiEndpoint: string
  /** Path of the shared tracker script. Default `'/script.js'`. */
  scriptPath?: string
  /** Load the tracker in stealth mode (appends `?stealth=true`). Default false. */
  stealth?: boolean
}

/**
 * Build the ts-analytics head `<script>` entry for a stx/Stacks app config.
 *
 * Returns an **array** (so it spreads cleanly into `app.head.script` and can
 * grow later — e.g. an error-tracking tag — without changing call sites).
 * Returns `[]` when `appId`/`apiEndpoint` are missing, so a half-configured
 * environment never injects a broken tag.
 */
export function tsAnalytics(options: TsAnalyticsOptions): StxHeadScript[] {
  const appId = options?.appId?.trim()
  const apiEndpoint = options?.apiEndpoint?.trim()
  if (!appId || !apiEndpoint)
    return []

  const origin = apiEndpoint.replace(/\/+$/, '')
  const rawPath = options.scriptPath ?? '/script.js'
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  const src = `${origin}${path}${options.stealth ? '?stealth=true' : ''}`

  return [
    {
      src,
      defer: true,
      'data-site': appId,
    },
  ]
}

/**
 * Raw `<script>` tag string for non-stx contexts — paste into a plain HTML
 * `<head>`, or inject server-side. Same inputs as {@link tsAnalytics}. Returns
 * `''` when required options are missing.
 */
export function tsAnalyticsTag(options: TsAnalyticsOptions): string {
  const [entry] = tsAnalytics(options)
  if (!entry)
    return ''
  return `<script defer data-site="${String(entry['data-site'])}" src="${String(entry.src)}"></script>`
}

export default tsAnalytics
