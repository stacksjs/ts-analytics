/**
 * The browser-side tracker bridge — one implementation, shared by every
 * framework integration.
 *
 * ## Why this is its own module
 *
 * This logic used to live inside the Nuxt composable. When the Vue plugin was
 * added it needed exactly the same behaviour, and copying it would have
 * recreated the conditions for the bug this file's `isOurFathom` exists to
 * prevent: the composable called `window.fathom.track` for three releases while
 * the tracker being shipped published `window.analyticshq`, and nothing caught
 * it because there was no second reader to disagree. Two copies would drift the
 * same way, silently, and each would need finding twice.
 *
 * So framework packages own *wiring* — how a script tag gets on the page, how a
 * composable is registered — and this module owns *what a tracked event does*.
 */

/** Custom event properties, Plausible-style. */
export type Props = Record<string, string | number | boolean>

export interface TsAnalyticsApi {
  /**
   * Track a custom event by name, with an optional numeric value and custom
   * properties that appear under Event Properties.
   */
  track: (name: string, value?: number, props?: Props) => void
}

interface TrackerWindow {
  analyticshq?: (name: string, props?: Props) => void
  fathom?: {
    track?: (name: string, value?: number, props?: Props) => void
    /** Present only on the real Fathom global — see {@link isOurFathom}. */
    trackEvent?: unknown
    trackPageview?: unknown
  }
}

/**
 * Is `window.fathom` *ours*, or the actual Fathom Analytics script?
 *
 * The ts-analytics tracker publishes `window.fathom = { track }` and its comment
 * calls that "Fathom-API compatible". It is not. Real Fathom
 * (`cdn.usefathom.com/script.js`, which `fathom-client` loads) exposes
 * `trackEvent`, `trackGoal`, `trackPageview`, `setSite`, `blockTrackingForMe`
 * and `enableTrackingForMe` — and no `track` at all. The two are a name
 * collision with different shapes, not two implementations of one API.
 *
 * That matters because apps really do run both. A client storefront in this
 * codebase's orbit ships `nuxt-fathom` alongside this SDK, and without this
 * check a page where our tracker failed to load but Fathom succeeded would
 * quietly route the app's custom events to a competitor's collector — data
 * leaving for a third party as the *failure* mode of our own SDK.
 *
 * Requiring `track` and rejecting `trackEvent` distinguishes them today. The
 * rejection is the load-bearing half: `track` alone would start matching the
 * moment Fathom shipped a method by that name.
 */
function isOurFathom(f: TrackerWindow['fathom']): boolean {
  return typeof f?.track === 'function' && typeof f?.trackEvent !== 'function'
}

/** One queued call, held until a tracker exists. */
type Queued = [name: string, value: number | undefined, props: Props | undefined]

/**
 * The tag is injected with `defer`, so it executes after the document parses —
 * later than a component's `onMounted`. An event fired on the landing page
 * therefore races the tracker and, before this queue, was simply lost.
 *
 * Bounded on both axes: a page that fires hundreds of events into a tracker that
 * never arrives (blocked by a content blocker, wrong endpoint) must not grow an
 * unbounded array, and the poll must not run for the life of the tab.
 */
const QUEUE_LIMIT = 50
const POLL_MS = 250
const GIVE_UP_MS = 10_000

const queue: Queued[] = []
let polling = false
let waited = 0
let warned = false

function resolveTracker(): TrackerWindow | null {
  if (typeof window === 'undefined')
    return null
  const w = window as unknown as TrackerWindow
  if (typeof w.analyticshq === 'function' || isOurFathom(w.fathom))
    return w
  return null
}

/** Send now, assuming a tracker was already resolved. */
function dispatch(w: TrackerWindow, [name, value, props]: Queued): void {
  if (typeof w.analyticshq === 'function') {
    // Value rides inside props for this tracker. Spread first so an explicit
    // `props.value` set by the caller is not clobbered by a positional 0.
    const merged: Props = { ...(props ?? {}) }
    if (typeof value === 'number' && merged.value === undefined)
      merged.value = value
    w.analyticshq(name, merged)
    return
  }
  // Guarded again rather than trusting the caller: dispatch() is reachable from
  // drain(), where the global may have been replaced between queueing and flush.
  if (isOurFathom(w.fathom))
    w.fathom?.track?.(name, value, props)
}

function drain(): void {
  const w = resolveTracker()
  if (!w)
    return
  // Splice before dispatching: a tracker that throws must not replay the queue.
  const pending = queue.splice(0, queue.length)
  for (const call of pending) {
    try {
      dispatch(w, call)
    }
    catch {
      // A single bad event must not strand the rest of the queue.
    }
  }
}

function poll(): void {
  if (polling || typeof window === 'undefined')
    return
  polling = true
  const timer = setInterval(() => {
    waited += POLL_MS
    if (resolveTracker()) {
      clearInterval(timer)
      polling = false
      drain()
      return
    }
    if (waited >= GIVE_UP_MS) {
      clearInterval(timer)
      polling = false
      queue.length = 0
      if (!warned && process.env.NODE_ENV !== 'production') {
        warned = true
        console.warn(
          '[ts-analytics] no tracker global after 10s — dropped '
          + 'queued events. Check that the integration injected its <script> and '
          + 'that `apiEndpoint` points at a host serving /script.js.',
        )
      }
    }
  }, POLL_MS)
  // Never hold the process open in a test runner or SSR-adjacent runtime.
  ;(timer as unknown as { unref?: () => void }).unref?.()
}

/** Track an event, queueing it if the tracker has not executed yet. */
export function track(name: string, value?: number, props?: Props): void {
  if (typeof window === 'undefined')
    return // SSR: the tracker only exists in the browser

  const w = resolveTracker()
  if (w) {
    dispatch(w, [name, value, props])
    return
  }

  if (queue.length < QUEUE_LIMIT)
    queue.push([name, value, props])
  poll()
}

/** The public API object handed to callers by every framework integration. */
export function createTrackerApi(): TsAnalyticsApi {
  return { track }
}

/**
 * Put the tracker `<script>` on the page, if it is not already there.
 *
 * Only the client-side integrations need this. Nuxt and stx both inject the tag
 * server-side, into the HTML the browser receives — strictly better, because the
 * tag is parsed with the document instead of after the framework boots. A plain
 * Vue SPA has no server render to inject into, so the plugin appends it at
 * runtime.
 *
 * Returns what it did, so callers can warn intelligently rather than guessing.
 * `already-present` covers the case worth protecting: someone who pasted the
 * snippet into `index.html` — which is the better place for it — must not end up
 * with two tags double-counting every pageview. Detection is by App ID rather
 * than by exact URL, since the same site loaded from two origins is still one
 * tracker.
 */
export function ensureTrackerScript(src: string, appId: string): 'injected' | 'already-present' | 'skipped' {
  if (typeof document === 'undefined')
    return 'skipped' // SSR / non-browser

  const existing = document.querySelector(`script[data-site="${CSS.escape(appId)}"]`)
  if (existing)
    return 'already-present'

  const el = document.createElement('script')
  el.src = src
  el.defer = true
  el.setAttribute('data-site', appId)
  document.head.appendChild(el)
  return 'injected'
}

/**
 * Exported for tests: reset queue + poll state between cases.
 *
 * @internal
 */
export function __resetTrackerState(): void {
  queue.length = 0
  polling = false
  waited = 0
  warned = false
}
