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
 * ## Use {@link tsAnalyticsStxConfig} — it is the path that renders
 *
 * ```ts
 * // config/ui.ts (Stacks)  — or  stx.config.ts
 * import { tsAnalyticsStxConfig } from '@ts-analytics/tracking/stx'
 *
 * export default {
 *   analytics: tsAnalyticsStxConfig({ appId: 'my-app' }),   // endpoint is baked in
 * }
 * ```
 *
 * stx ships an analytics module of its own (`generateAnalyticsScript` /
 * `injectAnalytics`), and `process.js` calls it on every render to place a tag
 * before `</head>`. That is a real, exercised code path — it is how
 * analyticshq.org tracks itself. So the integration's job is to hand stx a
 * correct config block for its `custom` driver, not to emit a tag ourselves.
 *
 * We target `custom` rather than stx's own `self-hosted` driver deliberately.
 * `self-hosted` exists and works, but it generates its own inline beacon with a
 * different payload contract (`{s, sid, e, p, u, r, t, sw, sh}`, a client-minted
 * session id) and exposes a third global, `window.stxAnalytics`. Our `/collect`
 * accepts a different shape, and dogfooding means running the same artifact
 * customers install rather than a lookalike.
 *
 * ## `tsAnalytics()` and `app.head.script`
 *
 * {@link tsAnalytics} predates the above and returns head-script entries for
 * `app.head.script`. Its docblock used to call that "the reliable mechanism";
 * that claim was never verified, and searching a current stx build turns up no
 * reader for `app.head.script` at all — the only `head script` handling is the
 * SPA swap runtime reconciling tags that already exist in the document. It is
 * kept for non-stx callers (see {@link tsAnalyticsTag}) and for anyone already
 * depending on it, but for an stx app reach for {@link tsAnalyticsStxConfig}.
 */

/**
 * Generate a short, unguessable App ID (Fathom-style `data-site`, 8 chars). Run
 * once per site and paste the result into your config — the backend
 * auto-provisions the site on its first event, so nothing else is needed.
 *
 * ```ts
 * import { generateAppId } from '@ts-analytics/tracking/stx'
 * console.log(generateAppId()) // e.g. 'K7MN4PQR'
 * ```
 */
export { generateAppId } from '../lib/crypto-random'

/**
 * Default API origin — where `/script.js` is served and events are collected.
 * Baked in (Fathom-style) so host apps supply *only* an App ID.
 *
 * Endpoint resolution order: an explicit `apiEndpoint` option → the
 * `TS_ANALYTICS_ENDPOINT` env var → this constant.
 *
 * ## This was `http://localhost:2027` in every release up to 0.1.13
 *
 * Which made the "supply only an appId, the endpoint is baked in" promise above
 * false in exactly the case it was written for. A host app that configured only
 * an App ID — the documented happy path — emitted
 * `<script src="http://localhost:2027/script.js">`, and on any HTTPS site the
 * browser refused it as mixed content before DNS was even consulted.
 *
 * Nothing threw. The tag was in the document, the console warning was one line
 * in a page full of them, and the dashboard simply stayed empty — which reads
 * like "no traffic yet" rather than "the SDK is pointed at your laptop". A test
 * now pins this to an absolute https origin so a localhost default cannot ship
 * again.
 */
export const DEFAULT_API_ENDPOINT = 'https://analyticshq.org'

/** Resolve the API origin from an explicit override, env, then the default. */
export function resolveApiEndpoint(explicit?: string): string {
  const raw = (explicit ?? process.env.TS_ANALYTICS_ENDPOINT ?? DEFAULT_API_ENDPOINT).trim()
  return raw.replace(/\/+$/, '')
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
 * The `analytics` block of an stx/Stacks UI config, shaped for stx's `custom`
 * driver — what {@link tsAnalyticsStxConfig} returns.
 *
 * Structural, not imported from `@stacksjs/types`: this package must stay
 * installable in a plain stx app that has no Stacks dependency. It satisfies
 * `AnalyticsConfig` where that type is in scope.
 */
export interface StxAnalyticsConfig {
  /** stx returns '' from `generateAnalyticsScript` before reading anything else when false. */
  enabled: boolean
  driver: 'custom'
  custom: {
    scriptUrl: string
    attributes: Record<string, string>
  }
}

/**
 * Build the stx `analytics` config block that injects the tracker.
 *
 * ```ts
 * // config/ui.ts
 * export default {
 *   analytics: tsAnalyticsStxConfig({ appId: process.env.MY_SITE_ID }),
 * }
 * ```
 *
 * `enabled` follows the App ID: absent or blank means the block is inert, so a
 * fresh checkout with no env var set never beacons at production. Pass
 * `enabled: false` to force it off with an ID present (local development).
 *
 * Note there is no `defer` in `attributes` — stx's `generateCustomScript`
 * appends one unconditionally, and declaring it here too renders the malformed
 * `<script defer="" ... defer>`.
 */
export function tsAnalyticsStxConfig(
  options: TsAnalyticsOptions & { enabled?: boolean },
): StxAnalyticsConfig {
  const appId = options?.appId?.trim() ?? ''
  const origin = resolveApiEndpoint(options?.apiEndpoint)
  const rawPath = options?.scriptPath ?? '/script.js'
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`

  return {
    enabled: options?.enabled !== false && Boolean(appId) && Boolean(origin),
    driver: 'custom',
    custom: {
      scriptUrl: `${origin}${path}${options?.stealth ? '?stealth=true' : ''}`,
      attributes: { 'data-site': appId },
    },
  }
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
