/**
 * SDK integration guardrails (stx + Nuxt).
 *
 * Both integrations shipped broken through 0.1.13 in the same way: they emitted
 * something plausible, nothing threw, and the only symptom was a dashboard that
 * stayed empty — which reads like "no traffic yet". Neither had a single test.
 *
 * The two failures pinned here:
 *
 * 1. `DEFAULT_API_ENDPOINT` was `http://localhost:2027`, so the documented
 *    "supply only an appId" path produced a tag pointed at the developer's
 *    laptop — blocked as mixed content on any HTTPS host.
 * 2. `useTsAnalytics().track()` called `window.fathom.track` through an optional
 *    chain. The analyticshq tracker defines `window.analyticshq` instead, so
 *    every custom event resolved to undefined and was dropped in full.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  DEFAULT_API_ENDPOINT,
  resolveApiEndpoint,
  tsAnalytics,
  tsAnalyticsStxConfig,
  tsAnalyticsTag,
} from '../src/integrations/stx'
import { __resetTsAnalyticsQueue, useTsAnalytics } from '../src/integrations/runtime/use-ts-analytics'

describe('the default endpoint is publicly reachable', () => {
  // The regression this exists for is specifically a localhost default, which is
  // correct in development and silently useless everywhere else.
  test('is an absolute https origin', () => {
    expect(DEFAULT_API_ENDPOINT).toMatch(/^https:\/\//)
  })

  test('is not localhost or a private host', () => {
    expect(DEFAULT_API_ENDPOINT).not.toMatch(/localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b|192\.168\.|\[::1\]/)
  })

  test('carries no path, so `${origin}${path}` cannot double up', () => {
    // resolveApiEndpoint trims trailing slashes; a default like
    // "https://host/api" would compose to "https://host/api/script.js".
    expect(new URL(DEFAULT_API_ENDPOINT).pathname).toBe('/')
  })

  test('resolution order is explicit > env > default', () => {
    const saved = process.env.TS_ANALYTICS_ENDPOINT
    try {
      process.env.TS_ANALYTICS_ENDPOINT = 'https://env.example.com'
      expect(resolveApiEndpoint('https://explicit.example.com')).toBe('https://explicit.example.com')
      expect(resolveApiEndpoint()).toBe('https://env.example.com')
      delete process.env.TS_ANALYTICS_ENDPOINT
      expect(resolveApiEndpoint()).toBe(DEFAULT_API_ENDPOINT)
    }
    finally {
      if (saved === undefined)
        delete process.env.TS_ANALYTICS_ENDPOINT
      else process.env.TS_ANALYTICS_ENDPOINT = saved
    }
  })

  test('trailing slashes are trimmed so the script URL stays single-slashed', () => {
    expect(resolveApiEndpoint('https://host.example.com///')).toBe('https://host.example.com')
    const [entry] = tsAnalytics({ appId: 'ABC', apiEndpoint: 'https://host.example.com/' })
    expect(entry.src).toBe('https://host.example.com/script.js')
  })
})

describe('tsAnalytics() head entries', () => {
  test('a bare appId produces a reachable, deferred tag', () => {
    const [entry] = tsAnalytics({ appId: 'ABC12345' })
    expect(entry).toEqual({
      src: `${DEFAULT_API_ENDPOINT}/script.js`,
      defer: true,
      'data-site': 'ABC12345',
    })
  })

  test('returns [] when appId is missing or blank, rather than a broken tag', () => {
    expect(tsAnalytics({ appId: '' })).toEqual([])
    expect(tsAnalytics({ appId: '   ' })).toEqual([])
    expect(tsAnalyticsTag({ appId: '' })).toBe('')
  })

  test('a scriptPath without a leading slash is still normalised', () => {
    const [entry] = tsAnalytics({ appId: 'A', scriptPath: 'tracker.js' })
    expect(entry.src).toBe(`${DEFAULT_API_ENDPOINT}/tracker.js`)
  })
})

describe('tsAnalyticsStxConfig() matches the shape stx actually renders', () => {
  // stx's generateAnalyticsScript switches on `driver` and returns '' before
  // reading anything else when `enabled` is false. generateCustomScript reads
  // `custom.scriptUrl` and spreads `custom.attributes`.
  test('produces an enabled custom-driver block for a valid appId', () => {
    expect(tsAnalyticsStxConfig({ appId: 'ABC12345' })).toEqual({
      enabled: true,
      driver: 'custom',
      custom: {
        scriptUrl: `${DEFAULT_API_ENDPOINT}/script.js`,
        attributes: { 'data-site': 'ABC12345' },
      },
    })
  })

  test('is inert rather than malformed when the App ID env var is unset', () => {
    // The failure mode being avoided: `enabled: true` with an empty data-site,
    // which beacons every page view under a site id the backend cannot resolve.
    const config = tsAnalyticsStxConfig({ appId: process.env.DEFINITELY_UNSET_SITE_ID ?? '' })
    expect(config.enabled).toBe(false)
  })

  test('enabled: false wins over a present appId', () => {
    expect(tsAnalyticsStxConfig({ appId: 'ABC', enabled: false }).enabled).toBe(false)
  })

  test('declares no `defer` attribute', () => {
    // generateCustomScript appends `defer` unconditionally; declaring it here
    // too renders `<script defer="" ... defer>`.
    const { custom } = tsAnalyticsStxConfig({ appId: 'ABC' })
    expect(Object.keys(custom.attributes)).toEqual(['data-site'])
  })
})

/**
 * The composable, against both real tracker shapes.
 *
 * `window` is stubbed rather than mocked through a DOM: the whole contract is
 * "which global does it reach for, and with what arguments".
 */
describe('useTsAnalytics().track() reaches a real tracker', () => {
  const originalWindow = (globalThis as any).window

  afterEach(() => {
    if (originalWindow === undefined)
      delete (globalThis as any).window
    else (globalThis as any).window = originalWindow
    __resetTsAnalyticsQueue()
  })

  test('dispatches to window.analyticshq(name, props) — the analyticshq tracker', () => {
    const calls: any[] = []
    ;(globalThis as any).window = { analyticshq: (...a: any[]) => calls.push(a) }

    useTsAnalytics().track('signup')
    expect(calls).toEqual([['signup', {}]])
  })

  test('folds the positional value into props for that tracker', () => {
    // routes/analytics.ts reads revenue as `p.value ?? p.revenue ?? p.amount`,
    // so a value passed positionally has to arrive inside props or it is lost.
    const calls: any[] = []
    ;(globalThis as any).window = { analyticshq: (...a: any[]) => calls.push(a) }

    useTsAnalytics().track('Purchase', 19.99, { plan: 'pro' })
    expect(calls).toEqual([['Purchase', { plan: 'pro', value: 19.99 }]])
  })

  test('an explicit props.value is not clobbered by a positional 0', () => {
    const calls: any[] = []
    ;(globalThis as any).window = { analyticshq: (...a: any[]) => calls.push(a) }

    useTsAnalytics().track('Purchase', 0, { value: 42 })
    expect(calls[0][1].value).toBe(42)
  })

  test('dispatches positionally to window.fathom.track — the ts-analytics tracker', () => {
    const calls: any[] = []
    ;(globalThis as any).window = { fathom: { track: (...a: any[]) => calls.push(a) } }

    useTsAnalytics().track('signup', 5, { plan: 'pro' })
    expect(calls).toEqual([['signup', 5, { plan: 'pro' }]])
  })

  test('prefers analyticshq when both globals somehow exist', () => {
    const seen: string[] = []
    ;(globalThis as any).window = {
      analyticshq: () => seen.push('analyticshq'),
      fathom: { track: () => seen.push('fathom') },
    }

    useTsAnalytics().track('e')
    expect(seen).toEqual(['analyticshq'])
  })

  test('never dispatches to the REAL Fathom global', async () => {
    // Apps really do run both: a client storefront in this codebase's orbit
    // ships nuxt-fathom (which loads cdn.usefathom.com via fathom-client)
    // alongside this SDK. Real Fathom exposes trackEvent/trackGoal/
    // trackPageview and no `track`, so routing to it would send the app's
    // events to a competitor's collector as OUR failure mode.
    const fathomCalls: string[] = []
    ;(globalThis as any).window = {
      fathom: {
        trackEvent: (n: string) => fathomCalls.push(n),
        trackGoal: () => fathomCalls.push('goal'),
        trackPageview: () => fathomCalls.push('pv'),
      },
    }

    useTsAnalytics().track('checkout')
    expect(fathomCalls).toEqual([])

    // And it must not be treated as "a tracker arrived" by the queue either:
    // the event stays pending for our own tracker rather than being consumed.
    ;(globalThis as any).window.analyticshq = (n: string) => fathomCalls.push(`ours:${n}`)
    await new Promise(r => setTimeout(r, 400))
    expect(fathomCalls).toEqual(['ours:checkout'])
  })

  test('still dispatches to a fathom global that is ours (has track, no trackEvent)', () => {
    const calls: any[] = []
    ;(globalThis as any).window = { fathom: { track: (...a: any[]) => calls.push(a) } }

    useTsAnalytics().track('signup')
    expect(calls).toEqual([['signup', undefined, undefined]])
  })

  test('is a no-op under SSR rather than throwing', () => {
    delete (globalThis as any).window
    expect(() => useTsAnalytics().track('signup')).not.toThrow()
  })

  test('queues events fired before the deferred tracker loads, then flushes', async () => {
    // The race this covers: the tag is `defer`, so it executes after parse —
    // later than a component's onMounted. These calls used to be lost outright.
    ;(globalThis as any).window = {}
    const { track } = useTsAnalytics()
    track('early-one')
    track('early-two', 7)

    const calls: any[] = []
    ;(globalThis as any).window.analyticshq = (...a: any[]) => calls.push(a)

    await new Promise(r => setTimeout(r, 400))
    expect(calls).toEqual([['early-one', {}], ['early-two', { value: 7 }]])
  })

  test('a throwing tracker does not strand the rest of the queue', async () => {
    ;(globalThis as any).window = {}
    const { track } = useTsAnalytics()
    track('boom')
    track('fine')

    const seen: string[] = []
    let first = true
    ;(globalThis as any).window.analyticshq = (name: string) => {
      seen.push(name)
      if (first) {
        first = false
        throw new Error('tracker exploded')
      }
    }

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toEqual(['boom', 'fine'])
  })

  test('the queue is bounded so a never-arriving tracker cannot grow it forever', () => {
    ;(globalThis as any).window = {}
    const { track } = useTsAnalytics()
    for (let i = 0; i < 500; i++)
      track(`e${i}`)

    // Drain into a late tracker and count what survived.
    const calls: any[] = []
    ;(globalThis as any).window.analyticshq = (...a: any[]) => calls.push(a)
    track('trigger-immediate')
    expect(calls.length).toBeLessThanOrEqual(51)
  })
})

describe('the published package name is consistent', () => {
  test('the Nuxt module meta.name matches package.json', async () => {
    // Nuxt dedupes modules by meta.name; a stale one lets the same module
    // install twice under two specifiers and inject two tags.
    const [pkg, source] = await Promise.all([
      Bun.file(new URL('../package.json', import.meta.url)).json(),
      Bun.file(new URL('../src/integrations/nuxt.ts', import.meta.url)).text(),
    ])
    const meta = source.match(/name:\s*'([^']+)'/)
    expect(meta?.[1]).toBe(pkg.name)
  })
})
