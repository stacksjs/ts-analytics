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
 *         ...tsAnalytics({ appId: 'my-app' }),   // endpoint is baked in
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

import { randomToken } from '../lib/crypto-random'

/**
 * Default ts-analytics API origin — where `/script.js` is served and events are
 * collected. Baked in (Fathom-style) so host apps supply *only* an App ID.
 *
 * Endpoint resolution order: an explicit `apiEndpoint` option → the
 * `TS_ANALYTICS_ENDPOINT` env var → this constant. Set this to your production
 * ts-analytics host so deployed apps need zero endpoint config.
 */
export const DEFAULT_API_ENDPOINT = 'http://localhost:2027'

/** Resolve the API origin from an explicit override, env, then the default. */
export function resolveApiEndpoint(explicit?: string): string {
  const raw = (explicit ?? process.env.TS_ANALYTICS_ENDPOINT ?? DEFAULT_API_ENDPOINT).trim()
  return raw.replace(/\/+$/, '')
}

/**
 * Generate a long, unguessable App ID (Fathom-style `data-site`). Run once per
 * site and paste the result into your config — the backend auto-provisions the
 * site on its first event, so nothing else is needed.
 *
 * ```ts
 * import { generateAppId } from '@stacksjs/ts-analytics/stx'
 * console.log(generateAppId()) // 32 url-safe chars
 * ```
 */
export function generateAppId(length = 32): string {
  return randomToken(length)
}

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
  /**
   * Your ts-analytics **App ID** — rendered as the tracker's `data-site`. A long,
   * unguessable random string (see {@link generateAppId}); the backend
   * auto-provisions the site on its first event, so no pre-registration needed.
   */
  appId: string
  /**
   * Origin of your ts-analytics API — where `/script.js` is served and where the
   * tracker POSTs. **Optional**: defaults to the `TS_ANALYTICS_ENDPOINT` env var,
   * then {@link DEFAULT_API_ENDPOINT}. Set this only for a one-off override — the
   * point is that host apps supply *just* an App ID (Fathom-style). Trailing
   * slashes are trimmed.
   */
  apiEndpoint?: string
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
  if (!appId)
    return []

  const origin = resolveApiEndpoint(options?.apiEndpoint)
  if (!origin)
    return []
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
