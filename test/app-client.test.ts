/**
 * The app event client (`@ts-analytics/tracking/app`).
 *
 * Three promises are pinned here, because an app developer relies on each of
 * them without reading the source:
 *
 *   1. the exact request: URL, headers and JSON body,
 *   2. it never throws into the host app, whatever goes wrong, and
 *   3. nothing is sent while the user has not opted in.
 *
 * And one about the rest of the library: adding an explicit way past the bot
 * filter for app mode did not change what `isBot` says about web traffic.
 */

import { describe, expect, it } from 'bun:test'
import { appUserAgent, createAppClient, isValidInstallId } from '../src/app-client'
import * as appEntry from '../src/app-client'
import * as root from '../src/index'
import * as tracking from '../src/tracking'
import { APP_CLIENT_TOKEN, isAppClientUserAgent, isBot, isBotRequest } from '../src/utils/user-agent'
import { TRACKER_VERSION } from '../src/version'

const INSTALL = '3f2b8c1e-9a4d-4e7b-b1c2-0d9e8f7a6b5c'

interface Sent {
  url: string
  method: string | undefined
  headers: Record<string, string>
  body: Record<string, unknown>
}

/** A `fetch` that records what it was asked to send and answers as told. */
function recorder(respond: () => Response | Promise<Response> = () => new Response(null, { status: 204 })): { fetch: typeof fetch, sent: Sent[] } {
  const sent: Sent[] = []
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({
      url: String(input),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return respond()
  }
  return { fetch: fake as typeof fetch, sent }
}

function client(over: Partial<Parameters<typeof createAppClient>[0]> = {}, respond?: () => Response | Promise<Response>) {
  const { fetch, sent } = recorder(respond)
  const errors: unknown[] = []
  const app = createAppClient({
    endpoint: 'https://analytics.example.com',
    siteId: 'fettler',
    installId: INSTALL,
    appVersion: '1.4.2',
    appName: 'Fettler',
    os: { name: 'macOS', version: '15.1' },
    fetch,
    onError: error => errors.push(error),
    ...over,
  })
  return { app, sent, errors }
}

describe('the request', () => {
  it('a screen view is a pageview with an app:// URL and the app declaration', async () => {
    const { app, sent } = client()
    expect(await app.screen('Settings')).toBe(true)

    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('https://analytics.example.com/collect')
    expect(sent[0].method).toBe('POST')
    expect(sent[0].body).toEqual({
      s: 'fettler',
      e: 'pageview',
      u: 'app://fettler/Settings',
      app: { id: INSTALL, version: '1.4.2', name: 'Fettler', os: 'macOS', osVersion: '15.1' },
    })
  })

  it('an event carries its name, its properties and the screen it happened on', async () => {
    const { app, sent } = client()
    await app.screen('/library/albums')
    expect(await app.track('Export', { format: 'csv', rows: 120 })).toBe(true)

    expect(sent[1].body).toEqual({
      s: 'fettler',
      e: 'Export',
      u: 'app://fettler/library/albums',
      p: { format: 'csv', rows: 120 },
      app: { id: INSTALL, version: '1.4.2', name: 'Fettler', os: 'macOS', osVersion: '15.1' },
    })
  })

  it('an event before any screen is recorded at the root, with no p key when none was given', async () => {
    const { app, sent } = client()
    await app.track('Launched')
    expect(sent[0].body.u).toBe('app://fettler/')
    expect('p' in sent[0].body).toBe(false)
  })

  it('pageview is screen under the name a web tracker uses', async () => {
    const { app, sent } = client()
    await app.pageview('Home')
    expect(sent[0].body).toMatchObject({ e: 'pageview', u: 'app://fettler/Home' })
  })

  it('sends JSON under a declared app User-Agent', async () => {
    const { app, sent } = client()
    await app.track('Launched')
    expect(sent[0].headers['Content-Type']).toBe('application/json')
    expect(sent[0].headers['User-Agent']).toBe(`Fettler/1.4.2 (macOS 15.1) ${APP_CLIENT_TOKEN}/${TRACKER_VERSION}`)
    expect(app.userAgent).toBe(sent[0].headers['User-Agent'])
    expect(isAppClientUserAgent(sent[0].headers['User-Agent'])).toBe(true)
  })

  it('the User-Agent can be replaced, or left to the runtime', async () => {
    const custom = client({ userAgent: 'Fettler-Agent/9' })
    await custom.app.track('x')
    expect(custom.sent[0].headers['User-Agent']).toBe('Fettler-Agent/9')

    const none = client({ userAgent: false })
    await none.app.track('x')
    expect('User-Agent' in none.sent[0].headers).toBe(false)
    expect(none.app.userAgent).toBeNull()
  })

  it('accepts the endpoint as a host, a base path or the collect URL itself', async () => {
    for (const [endpoint, url] of [
      ['https://analytics.example.com', 'https://analytics.example.com/collect'],
      ['https://analytics.example.com/', 'https://analytics.example.com/collect'],
      ['https://analytics.example.com/collect', 'https://analytics.example.com/collect'],
      ['https://example.com/stats/', 'https://example.com/stats/collect'],
      ['http://localhost:3008', 'http://localhost:3008/collect'],
    ]) {
      const { app, sent } = client({ endpoint })
      await app.track('x')
      expect({ endpoint, url: sent[0]?.url }).toEqual({ endpoint, url })
    }
  })

  it('the optional fields are left out, not sent empty', async () => {
    const { app, sent } = client({ appName: undefined, os: 'Linux' })
    await app.screen('Home')
    expect(sent[0].body.app).toEqual({ id: INSTALL, version: '1.4.2', os: 'Linux' })
    expect(sent[0].body.u).toBe('app://app/Home')
  })

  it('without an os option the name comes from the platform, and no version is guessed', async () => {
    const { app, sent } = client({ os: undefined })
    await app.track('x')
    const declared = sent[0].body.app as Record<string, unknown>
    expect(['macOS', 'Windows', 'Linux']).toContain(declared.os as string)
    expect('osVersion' in declared).toBe(false)
  })

  it('the install id is sent lowercased, and an environment label rides along', async () => {
    const { app, sent } = client({ installId: INSTALL.toUpperCase(), environment: 'staging' })
    await app.track('x')
    expect((sent[0].body.app as Record<string, unknown>).id).toBe(INSTALL)
    expect(sent[0].body.environment).toBe('staging')
  })

  it('a screen name cannot escape its path', async () => {
    const { app, sent } = client()
    await app.screen('a b/../c?d=1#e')
    expect(sent[0].body.u).toBe('app://fettler/a%20b/../c%3Fd%3D1%23e')
  })
})

describe('it never throws into the host app', () => {
  it('a fetch that rejects resolves false and reports the error', async () => {
    const errors: unknown[] = []
    const app = createAppClient({
      endpoint: 'https://analytics.example.com',
      siteId: 'fettler',
      installId: INSTALL,
      appVersion: '1.4.2',
      fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
      onError: error => errors.push(error),
    })
    expect(await app.track('x')).toBe(false)
    expect(await app.screen('Home')).toBe(false)
    expect(errors).toHaveLength(2)
  })

  it('a fetch that throws synchronously is caught too', async () => {
    const app = createAppClient({
      endpoint: 'https://analytics.example.com',
      siteId: 'fettler',
      installId: INSTALL,
      appVersion: '1.4.2',
      fetch: (() => { throw new Error('no network stack') }) as unknown as typeof fetch,
    })
    expect(await app.track('x')).toBe(false)
  })

  it('a refusal from the server resolves false and passes the reason on', async () => {
    const { app, errors } = client({}, () => new Response(JSON.stringify({ error: 'App mode is not enabled for this site.' }), { status: 403 }))
    expect(await app.track('x')).toBe(false)
    expect(String(errors[0])).toContain('403')
    expect(String(errors[0])).toContain('App mode is not enabled for this site.')
  })

  it('an onError that throws is swallowed', async () => {
    const { app } = client({ onError: () => { throw new Error('handler bug') } }, () => new Response(null, { status: 500 }))
    expect(await app.track('x')).toBe(false)
  })

  it('a bad option gives a client that sends nothing, and says why', async () => {
    const cases: Array<[string, Partial<Parameters<typeof createAppClient>[0]>]> = [
      ['installId', { installId: 'not-a-uuid' }],
      ['installId', { installId: undefined as unknown as string }],
      ['appVersion', { appVersion: 'one two' }],
      ['appVersion', { appVersion: '' }],
      ['siteId', { siteId: '' }],
      ['endpoint', { endpoint: 'not a url' }],
      ['endpoint', { endpoint: 'ftp://analytics.example.com' }],
    ]
    for (const [field, over] of cases) {
      const { app, sent, errors } = client(over)
      expect({ field, enabled: app.enabled }).toEqual({ field, enabled: false })
      expect(await app.track('x')).toBe(false)
      expect(await app.screen('Home')).toBe(false)
      await app.flush()
      expect(sent).toHaveLength(0)
      expect(String(errors[0])).toContain(field)
    }
  })

  it('no options at all does not throw either', async () => {
    const app = createAppClient(undefined as unknown as Parameters<typeof createAppClient>[0])
    expect(app.enabled).toBe(false)
    expect(await app.track('x')).toBe(false)
    await app.flush()
  })

  it('properties that cannot be serialized lose the event, not the app', async () => {
    const { app, sent, errors } = client()
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(await app.track('x', loop)).toBe(false)
    expect(sent).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })

  it('reserved and empty event names are refused without a request', async () => {
    const { app, sent } = client()
    for (const name of ['', '  ', 'pageview', 'vitals', undefined as unknown as string])
      expect(await app.track(name)).toBe(false)
    expect(sent).toHaveLength(0)
  })
})

describe('opt-in', () => {
  it('nothing is sent while disabled, and sending resumes when turned on', async () => {
    const { app, sent } = client({ enabled: false })
    expect(app.enabled).toBe(false)
    expect(await app.track('x')).toBe(false)
    expect(await app.screen('Home')).toBe(false)
    expect(sent).toHaveLength(0)

    app.setEnabled(true)
    expect(app.enabled).toBe(true)
    expect(await app.track('x')).toBe(true)
    expect(sent).toHaveLength(1)

    app.setEnabled(false)
    expect(await app.track('x')).toBe(false)
    expect(sent).toHaveLength(1)
  })

  it('the install id can be reset, and an invalid one stops the client', async () => {
    const { app, sent, errors } = client()
    const fresh = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
    app.setInstallId(fresh)
    await app.track('x')
    expect((sent[0].body.app as Record<string, unknown>).id).toBe(fresh)

    app.setInstallId('nope')
    expect(app.enabled).toBe(false)
    expect(await app.track('x')).toBe(false)
    expect(sent).toHaveLength(1)
    expect(errors).toHaveLength(1)
  })

  it('the client never invents or stores an install id', () => {
    expect(isValidInstallId(INSTALL)).toBe(true)
    expect(isValidInstallId(INSTALL.toUpperCase())).toBe(true)
    for (const bad of ['', 'abc', `${INSTALL}0`, INSTALL.replace(/-/g, ''), 42, null, undefined])
      expect(isValidInstallId(bad)).toBe(false)
  })
})

describe('batching', () => {
  it('holds events until flush, then sends them in order, one request each', async () => {
    const { app, sent } = client({ batch: { maxSize: 10, flushInterval: 60_000 } })
    expect(await app.screen('Home')).toBe(true)
    expect(await app.track('A')).toBe(true)
    expect(await app.track('B')).toBe(true)
    expect(sent).toHaveLength(0)

    await app.flush()
    expect(sent.map(s => s.body.e)).toEqual(['pageview', 'A', 'B'])
  })

  it('flushes on its own when the batch is full', async () => {
    const { app, sent } = client({ batch: { maxSize: 2, flushInterval: 60_000 } })
    await app.track('A')
    expect(sent).toHaveLength(0)
    await app.track('B')
    await app.flush()
    expect(sent.map(s => s.body.e)).toEqual(['A', 'B'])
  })

  it('flushes on the interval', async () => {
    const { app, sent } = client({ batch: { maxSize: 50, flushInterval: 5 } })
    await app.track('A')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(sent.map(s => s.body.e)).toEqual(['A'])
  })

  it('opting out drops what was queued', async () => {
    const { app, sent } = client({ batch: true })
    await app.track('A')
    app.setEnabled(false)
    await app.flush()
    expect(sent).toHaveLength(0)
  })

  it('a failed send during a flush does not reject it', async () => {
    const { app, errors } = client({ batch: true }, () => new Response(null, { status: 500 }))
    await app.track('A')
    await app.flush()
    expect(errors).toHaveLength(1)
  })
})

describe('the declared User-Agent', () => {
  it('names the app, its version and the system', () => {
    expect(appUserAgent({ name: 'Fettler', version: '1.4.2', os: { name: 'macOS', version: '15.1' } })).toBe(`Fettler/1.4.2 (macOS 15.1) ${APP_CLIENT_TOKEN}/${TRACKER_VERSION}`)
    expect(appUserAgent({ name: 'Fettler', version: '1.4.2', os: 'Linux' })).toBe(`Fettler/1.4.2 (Linux) ${APP_CLIENT_TOKEN}/${TRACKER_VERSION}`)
    expect(appUserAgent({ version: '2.0.0' })).toBe(`App/2.0.0 ${APP_CLIENT_TOKEN}/${TRACKER_VERSION}`)
  })

  it('cannot be broken out of by a name with spaces, slashes or newlines', () => {
    const ua = appUserAgent({ name: 'My App/\r\nX-Evil: 1', version: '1.0 (beta)', os: 'mac)OS' })
    expect(ua).not.toMatch(/[\r\n]/)
    expect(ua.split(' ')[0]).toBe('My-App-X-Evil-1/1.0-beta')
  })

  it('is recognised by its token, and the token alone is not a way past the filter', () => {
    const ua = appUserAgent({ name: 'Fettler', version: '1.4.2' })
    expect(isAppClientUserAgent(ua)).toBe(true)
    expect(isAppClientUserAgent('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBe(false)
    expect(isAppClientUserAgent('not-ts-analytics-app/1')).toBe(false)
    expect(isAppClientUserAgent(undefined as unknown as string)).toBe(false)
    // A bot that puts the token after its own name is still a bot to isBot:
    // the label is never what skips the filter.
    expect(isBot(`curl/8.4.0 ${APP_CLIENT_TOKEN}/1.0`)).toBe(true)
    expect(isBotRequest(`curl/8.4.0 ${APP_CLIENT_TOKEN}/1.0`)).toBe(true)
  })
})

describe('the bot filter and app mode', () => {
  // What a desktop app's agent actually sends when it does not set its own.
  const RUNTIMES = ['Bun/1.3.2', 'bun/1.3.2', 'undici', 'node-fetch/3.3.2 (+https://github.com/node-fetch/node-fetch)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Fettler/1.4.2 Chrome/126.0.0.0 Electron/31.0.0 Safari/537.36']
  const BROWSERS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ]

  it('isBot still drops every one of these runtimes: it was not weakened', () => {
    for (const ua of RUNTIMES)
      expect({ ua, bot: isBot(ua) }).toEqual({ ua, bot: true })
    expect(isBot('')).toBe(true)
    expect(isBot('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe(true)
    expect(isBot('curl/8.4.0')).toBe(true)
  })

  it('and still lets every real browser through', () => {
    for (const ua of BROWSERS)
      expect({ ua, bot: isBot(ua) }).toEqual({ ua, bot: false })
  })

  it('isBotRequest is isBot unless the server vouches for app mode', () => {
    for (const ua of [...RUNTIMES, ...BROWSERS, '', 'curl/8.4.0', 'Googlebot/2.1 (+http://www.google.com/bot.html)']) {
      expect({ ua, same: isBotRequest(ua) === isBot(ua) }).toEqual({ ua, same: true })
      expect(isBotRequest(ua, {})).toBe(isBot(ua))
      expect(isBotRequest(ua, { appMode: false })).toBe(isBot(ua))
    }
  })

  it('with appMode the request is not filtered, whatever sent it', () => {
    for (const ua of [...RUNTIMES, ''])
      expect({ ua, bot: isBotRequest(ua, { appMode: true }) }).toEqual({ ua, bot: false })
    // Only the literal true: a truthy value read off a request is not a yes.
    expect(isBotRequest('Bun/1.3.2', { appMode: 'true' as unknown as boolean })).toBe(true)
    expect(isBotRequest('Bun/1.3.2', { appMode: 1 as unknown as boolean })).toBe(true)
  })
})

describe('the package surface', () => {
  it('the client is exported from the root, the dependency-free entry and its own subpath', () => {
    for (const entry of [root, tracking, appEntry]) {
      expect(typeof entry.createAppClient).toBe('function')
      expect(typeof entry.appUserAgent).toBe('function')
      expect(typeof entry.isValidInstallId).toBe('function')
    }
    expect(typeof root.isBotRequest).toBe('function')
    expect(typeof tracking.isBotRequest).toBe('function')
    expect(tracking.APP_CLIENT_TOKEN).toBe('ts-analytics-app')
  })

  it('package.json maps ./app to a file the build is required to emit', async () => {
    const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json() as { exports: Record<string, { types?: string, import?: string }> }
    expect(pkg.exports['./app']).toEqual({ types: './dist/app-client.d.ts', import: './dist/app-client.js' })
    const build = await Bun.file(new URL('../build.ts', import.meta.url)).text()
    expect(build).toContain(`'./src/app-client.ts'`)
    expect(build).toContain(`'./dist/app-client.js'`)
    expect(build).toContain(`'./dist/app-client.d.ts'`)
  })

  it('the client module pulls in nothing but the version and the User-Agent helpers', async () => {
    const source = await Bun.file(new URL('../src/app-client.ts', import.meta.url)).text()
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])
    expect(imports.sort()).toEqual(['./utils/user-agent', './version'])
  })
})
