/**
 * `useTsAnalytics()` — custom event tracking for the Nuxt module.
 *
 * ```ts
 * const { track } = useTsAnalytics()
 * track('signup')
 * track('purchase', 4200)              // optional numeric value
 * track('signup', 0, { plan: 'pro' })  // custom properties
 * ```
 *
 * ## Why this dispatches instead of calling one global
 *
 * Up to 0.1.13 this called `window.fathom.track(...)` through an optional chain.
 * The tracker served by analyticshq.org does not define `window.fathom` — it
 * defines `window.analyticshq`, a *function* rather than an object — so every
 * optional link resolved to `undefined` and `track()` returned having done
 * nothing at all. No throw, no warning, no network request: custom events from a
 * Nuxt app were dropped in full, and the only symptom was an empty Events report.
 *
 * There are genuinely two trackers with two shapes, and which one answers depends
 * on the host an app points at:
 *
 * | tracker                        | global                                  |
 * |--------------------------------|-----------------------------------------|
 * | analyticshq (`public/script.js`) | `analyticshq(name, props)`            |
 * | ts-analytics (`src/Analytics.ts`)| `fathom.track(name, value, props)`    |
 *
 * The signatures differ too, so a rename would not have been enough — the
 * analyticshq tracker has no `value` parameter. It carries revenue *inside*
 * props (`analyticshq('Purchase', { value: 19.99 })`, read at
 * `routes/analytics.ts:531` as `p.value ?? p.revenue ?? p.amount`), so this
 * folds `value` into props on that path and passes it positionally on the other.
 *
 * The public signature is unchanged, so existing call sites keep compiling —
 * they just start working.
 */
export interface TsAnalyticsApi {
  /**
   * Track a custom event by name, with an optional numeric value and custom
   * properties (Plausible-style) that appear under Event Properties.
   */
  track: (name: string, value?: number, props?: Record<string, string | number | boolean>) => void
}

type Props = Record<string, string | number | boolean>

interface TrackerWindow {
  analyticshq?: (name: string, props?: Props) => void
  fathom?: { track?: (name: string, value?: number, props?: Props) => void }
}

/** One queued call, held until a tracker exists. */
type Queued = [name: string, value: number | undefined, props: Props | undefined]

/**
 * The tag is injected with `defer`, so it executes after the document parses —
 * later than a component's `onMounted`. An event fired on the landing page
 * therefore races the tracker and, before this queue, simply lost.
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
  if (typeof w.analyticshq === 'function' || typeof w.fathom?.track === 'function')
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
          + 'queued events. Check that the module injected its <script> and that '
          + '`apiEndpoint` points at a host serving /script.js.',
        )
      }
    }
  }, POLL_MS)
  // Never hold the process open in a test runner or SSR-adjacent runtime.
  ;(timer as unknown as { unref?: () => void }).unref?.()
}

export function useTsAnalytics(): TsAnalyticsApi {
  return {
    track(name: string, value?: number, props?: Props): void {
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
    },
  }
}

/**
 * Exported for tests: reset queue + poll state between cases.
 *
 * @internal
 */
export function __resetTsAnalyticsQueue(): void {
  queue.length = 0
  polling = false
  waited = 0
  warned = false
}
