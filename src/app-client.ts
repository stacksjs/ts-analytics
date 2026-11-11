/**
 * `@ts-analytics/tracking/app`
 *
 * An event client for native and desktop apps: the Bun or Node agent behind a
 * webview, a CLI, a tray app. There is no DOM here and nothing is stored. It
 * uses `fetch` and nothing else, so it has no dependencies of its own.
 *
 * ## What it sends
 *
 * One `POST {endpoint}/collect` per event, with a JSON body:
 *
 *     {
 *       "s": "<site id>",
 *       "e": "pageview" | "<event name>",
 *       "u": "app://<app>/<screen>",
 *       "p": { ...properties },                 // events only, when given
 *       "app": {
 *         "id": "<install id, a UUID>",
 *         "version": "<app version>",
 *         "name": "<app name>",                 // when given
 *         "os": "macOS",                        // when known
 *         "osVersion": "15.1"                   // when given
 *       }
 *     }
 *
 * The `app` object is what makes it an app-mode request. A server only accepts
 * it for a site whose owner turned app mode on, and answers 4xx otherwise.
 *
 * ## The install id is yours
 *
 * Generate it once with `crypto.randomUUID()`, keep it wherever the app keeps
 * its settings, and pass it in. This module never creates or persists one,
 * because where it lives and when it is reset are the app's decisions: delete
 * it and the next event is a new, unrelated visitor.
 *
 * ## It never throws into the app
 *
 * Analytics must not be able to break the product it measures. Every method
 * resolves, with `false` when the event was not delivered, and reports the
 * reason to `onError` if one was given. That includes a wrong `endpoint`, an
 * invalid install id, no network, a 4xx and a `fetch` that throws
 * synchronously. Nothing is retried: a lost event stays lost.
 */

import { APP_CLIENT_TOKEN } from './utils/user-agent'
import { TRACKER_VERSION } from './version'

/** A canonical UUID, any version, either case. */
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Is this a usable install id? A canonical 36-character UUID, as `crypto.randomUUID()` returns. */
export function isValidInstallId(value: unknown): value is string {
  return typeof value === 'string' && INSTALL_ID_PATTERN.test(value)
}

/** The operating system the app runs on: a name, or a name and a version. */
export type AppOs = string | { name: string, version?: string }

/** Properties attached to one event. Must survive `JSON.stringify`. */
export type AppEventProperties = Record<string, unknown>

export interface AppClientOptions {
  /** The analytics host, `https://analytics.example.com`, or its full `/collect` URL. */
  endpoint: string
  siteId: string
  /** The app's own random UUID. See the note at the top of this file. */
  installId: string
  /** The app's version, e.g. `1.4.2`. At most 32 characters, no spaces. */
  appVersion: string
  /** The app's display name. Shown where a browser's name would be. */
  appName?: string
  /**
   * `'macOS'`, `'Windows'`, `'Linux'`, or `{ name, version }`. When omitted
   * the name is read from `process.platform` where there is one. The version
   * is never guessed: pass it if you want it recorded.
   */
  os?: AppOs
  /**
   * The opt-in switch. Nothing is sent while this is false. Defaults to true,
   * so construct the client with your user's saved choice, not without one.
   */
  enabled?: boolean
  /** A deployment label, e.g. `staging`, stored with each event when the server supports it. */
  environment?: string
  /**
   * Queue events and send them together. `true` uses the defaults: flush every
   * 5 seconds or at 20 events. The server takes one event per request, so a
   * flush is still one request each. What batching buys is fewer wake-ups and
   * a single place to `await flush()` before the app quits.
   */
  batch?: boolean | { maxSize?: number, flushInterval?: number }
  /** Give up on one request after this many milliseconds. Default 10000. */
  timeout?: number
  /** Sent as the User-Agent. Defaults to `appUserAgent(...)`. `false` leaves the runtime's own. */
  userAgent?: string | false
  /** The `fetch` to use. Defaults to the global one. */
  fetch?: typeof fetch
  /** Called with whatever went wrong. Exceptions it throws are swallowed too. */
  onError?: (error: unknown) => void
}

export interface AppClient {
  /** Record a named event. Resolves true when the server accepted it (or it was queued). */
  track: (name: string, properties?: AppEventProperties) => Promise<boolean>
  /** Record a screen view, the app's page view. `screen('Settings')` is stored as the path `/Settings`. */
  screen: (name: string) => Promise<boolean>
  /** The same as `screen`, for code shared with a web tracker. */
  pageview: (name: string) => Promise<boolean>
  /** Send everything queued. Await this before the app exits. Never rejects. */
  flush: () => Promise<void>
  /** Turn sending on or off, for a settings toggle. Turning it off drops the queue. */
  setEnabled: (enabled: boolean) => void
  /** Whether events are being sent: opted in, and configured correctly. */
  readonly enabled: boolean
  /** Swap the install id, after the user resets it. An invalid id disables the client. */
  setInstallId: (installId: string) => void
  /** The User-Agent this client sends, or null when it leaves the runtime's own. */
  readonly userAgent: string | null
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_BATCH_SIZE = 20
const DEFAULT_FLUSH_INTERVAL_MS = 5000
/** Events held while offline. The oldest are dropped past this, not the app's memory. */
const MAX_QUEUE = 500

const PLATFORM_OS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
}

/** The OS name for this process, or null in a runtime without `process.platform`. */
function detectOs(): string | null {
  const platform = (globalThis as { process?: { platform?: unknown } }).process?.platform
  return typeof platform === 'string' ? (PLATFORM_OS[platform] ?? null) : null
}

/** A value safe to put in a User-Agent product or comment: printable ASCII, no delimiters. */
function uaToken(value: string): string {
  return value.replace(/[^\w.+-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}

/**
 * The declared User-Agent of an app client:
 * `Fettler/1.4.2 (macOS 15.1) ts-analytics-app/0.1.20`.
 *
 * It says what the request is to anyone reading a log. It is not what gets an
 * event accepted: the server decides that from the site's own setting.
 */
export function appUserAgent(app: { name?: string, version: string, os?: AppOs | null }): string {
  const product = `${uaToken(app.name ?? '') || 'App'}/${uaToken(app.version) || '0'}`
  const osName = typeof app.os === 'string' ? app.os : app.os?.name
  const osVersion = typeof app.os === 'object' && app.os !== null ? app.os.version : undefined
  const system = [osName, osVersion].filter((part): part is string => typeof part === 'string' && part.trim() !== '').map(uaToken).join(' ')
  return `${product}${system ? ` (${system})` : ''} ${APP_CLIENT_TOKEN}/${TRACKER_VERSION}`
}

/** The full `/collect` URL for an endpoint given as a host, a base path, or the URL itself. */
function collectUrl(endpoint: string): string {
  let url: URL
  try {
    url = new URL(endpoint)
  }
  catch {
    throw new Error('endpoint must be an http(s) URL, for example https://analytics.example.com')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`endpoint must be an http(s) URL, got ${url.protocol}`)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/collect') ? path : `${path}/collect`
  return url.toString()
}

/** `Settings` and `/settings/billing` both become a path that starts with one slash. */
function screenPath(name: string): string {
  const trimmed = String(name).trim().replace(/^\/+/, '')
  return `/${trimmed.split('/').map(encodeURIComponent).join('/')}`
}

/** The host part of the `app://` URL: the app's name, lowercased to a hostname. */
function appHost(name: string | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'app'
}

interface QueuedEvent {
  e: string
  u: string
  p?: AppEventProperties
}

/**
 * Create the event client. Never throws: a bad option gives a client that
 * sends nothing, and tells `onError` why.
 */
export function createAppClient(options: AppClientOptions): AppClient {
  const report = (error: unknown): void => {
    try {
      options?.onError?.(error)
    }
    catch {
      // The host's error handler is not allowed to break the host either.
    }
  }

  let url: string | null = null
  let installId: string | null = null
  let optedIn = true
  let configured = false
  let userAgent: string | null = null
  let os: { name: string | null, version: string | null } = { name: null, version: null }
  let host = 'app'
  let batchSize = 0
  let flushInterval = DEFAULT_FLUSH_INTERVAL_MS
  let timeout = DEFAULT_TIMEOUT_MS

  try {
    optedIn = options.enabled !== false
    url = collectUrl(options.endpoint)
    if (typeof options.siteId !== 'string' || options.siteId.trim() === '')
      throw new Error('siteId is required')
    if (typeof options.appVersion !== 'string' || !/^[0-9a-z][0-9a-z.+_-]{0,31}$/i.test(options.appVersion))
      throw new Error('appVersion must be a version string of at most 32 characters, for example 1.4.2')
    if (!isValidInstallId(options.installId))
      throw new Error('installId must be a UUID, for example the value of crypto.randomUUID()')
    installId = options.installId.toLowerCase()

    os = typeof options.os === 'string'
      ? { name: options.os, version: null }
      : options.os
        ? { name: options.os.name, version: options.os.version ?? null }
        : { name: detectOs(), version: null }
    host = appHost(options.appName)
    userAgent = options.userAgent === false
      ? null
      : (options.userAgent ?? appUserAgent({ name: options.appName, version: options.appVersion, os: os.name ? { name: os.name, version: os.version ?? undefined } : null }))

    if (options.batch) {
      const batch = options.batch === true ? {} : options.batch
      batchSize = Math.max(1, Math.floor(batch.maxSize ?? DEFAULT_BATCH_SIZE))
      flushInterval = Math.max(0, Math.floor(batch.flushInterval ?? DEFAULT_FLUSH_INTERVAL_MS))
    }
    if (typeof options.timeout === 'number' && options.timeout > 0)
      timeout = options.timeout
    configured = true
  }
  catch (error) {
    report(error)
  }

  let current = `app://${host}/`
  let queue: QueuedEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing: Promise<void> | null = null

  const active = (): boolean => configured && optedIn && installId !== null

  async function send(event: QueuedEvent): Promise<boolean> {
    if (!active() || url === null)
      return false
    try {
      const body: Record<string, unknown> = {
        s: options.siteId,
        e: event.e,
        u: event.u,
        app: {
          id: installId,
          version: options.appVersion,
          ...(options.appName ? { name: options.appName } : {}),
          ...(os.name ? { os: os.name } : {}),
          ...(os.version ? { osVersion: os.version } : {}),
        },
      }
      if (event.p !== undefined)
        body.p = event.p
      if (options.environment)
        body.environment = options.environment

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (userAgent)
        headers['User-Agent'] = userAgent

      const doFetch = options.fetch ?? globalThis.fetch
      const response = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeout) : undefined,
      })
      if (!response.ok) {
        // The server explains a refusal in JSON ("App mode is not enabled for
        // this site"). Surface it, because a silent false is hard to debug.
        const detail = await response.text().catch(() => '')
        report(new Error(`analytics: ${response.status} from ${url}${detail ? `: ${detail.slice(0, 300)}` : ''}`))
        return false
      }
      return true
    }
    catch (error) {
      report(error)
      return false
    }
  }

  function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    // One flush at a time, so events leave in the order they were recorded.
    const run = async (): Promise<void> => {
      if (flushing)
        await flushing
      const batch = queue
      queue = []
      for (const event of batch)
        await send(event)
    }
    const next = run().catch(report).finally(() => {
      if (flushing === next)
        flushing = null
    })
    flushing = next
    return next
  }

  function enqueue(event: QueuedEvent): Promise<boolean> {
    if (!active())
      return Promise.resolve(false)
    if (batchSize === 0)
      return send(event)

    queue.push(event)
    if (queue.length > MAX_QUEUE)
      queue.splice(0, queue.length - MAX_QUEUE)
    if (queue.length >= batchSize) {
      void flush()
    }
    else if (timer === null) {
      timer = setTimeout(() => {
        timer = null
        void flush()
      }, flushInterval)
      // A pending flush must not keep a CLI or an agent process alive.
      ;(timer as { unref?: () => void }).unref?.()
    }
    return Promise.resolve(true)
  }

  function record(build: () => QueuedEvent): Promise<boolean> {
    try {
      return enqueue(build())
    }
    catch (error) {
      report(error)
      return Promise.resolve(false)
    }
  }

  const screen = (name: string): Promise<boolean> => record(() => {
    current = `app://${host}${screenPath(name)}`
    return { e: 'pageview', u: current }
  })

  return {
    track: (name, properties) => record(() => {
      const event = String(name ?? '').trim()
      if (!event || event === 'pageview' || event === 'vitals')
        throw new Error(`"${event}" is not a usable event name`)
      return properties === undefined ? { e: event, u: current } : { e: event, u: current, p: properties }
    }),
    screen,
    pageview: screen,
    flush: () => {
      try {
        return flush()
      }
      catch (error) {
        report(error)
        return Promise.resolve()
      }
    },
    setEnabled: (enabled) => {
      optedIn = enabled === true
      if (!optedIn)
        queue = []
    },
    get enabled() {
      return active()
    },
    setInstallId: (next) => {
      if (isValidInstallId(next)) {
        installId = next.toLowerCase()
      }
      else {
        installId = null
        report(new Error('installId must be a UUID, for example the value of crypto.randomUUID()'))
      }
    },
    get userAgent() {
      return userAgent
    },
  }
}
