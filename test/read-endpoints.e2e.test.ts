/**
 * Read-endpoint end-to-end tests (#177): seed traffic through the REAL
 * ingest path, then assert the dashboard endpoints report it correctly.
 */
import { describe, expect, it } from 'bun:test'
import { handleCollect } from '../src/handlers/collect'
import { handleGetStats, handleGetPages, handleGetReferrers, handleGetBrowsers, handleGetDevices } from '../src/handlers/stats'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0'
const SITE = `readsite${Math.random().toString(36).slice(2, 8)}`

function beacon(body: Record<string, unknown>, ua: string, ip: string): Promise<Response> {
  return handleCollect(new Request('http://localhost/collect', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'user-agent': ua, 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  }))
}

async function json(res: Response): Promise<any> {
  expect(res.status).toBe(200)
  return res.json()
}

const req = (path: string): Request => new Request(`http://localhost${path}`)

describe('read endpoints reflect ingested traffic', () => {
  it('seeds: 2 visitors, 3 views, 1 bounce', async () => {
    // Visitor 1 (Chrome, via Google): two pages in one session — not a bounce.
    await beacon({ s: SITE, sid: 'reads1-abcdef', e: 'pageview', u: 'http://example.com/', r: 'https://www.google.com/', t: 'Home' }, CHROME, '10.0.0.1')
    await beacon({ s: SITE, sid: 'reads1-abcdef', e: 'pageview', u: 'http://example.com/pricing', t: 'Pricing' }, CHROME, '10.0.0.1')
    // Visitor 2 (Firefox, direct): one page — a bounce.
    await beacon({ s: SITE, sid: 'reads2-abcdef', e: 'pageview', u: 'http://example.com/', t: 'Home' }, FIREFOX, '10.0.0.2')
  })

  it('/stats: people, views, sessions, bounce rate', async () => {
    const d = await json(await handleGetStats(req(`/api/sites/${SITE}/stats`), SITE))
    expect(d.people).toBe(2)
    expect(d.views).toBe(3)
    expect(d.sessions).toBe(2)
    expect(d.bounceRate).toBe(50)
  })

  it('/pages: per-path views, visitors, entries', async () => {
    const d = await json(await handleGetPages(req(`/api/sites/${SITE}/pages`), SITE))
    const home = d.pages.find((p: any) => p.path === '/')
    const pricing = d.pages.find((p: any) => p.path === '/pricing')
    expect(home).toMatchObject({ views: 2, visitors: 2, entries: 2 })
    expect(pricing).toMatchObject({ views: 1, visitors: 1, entries: 0 })
  })

  it('/referrers: source attribution + Direct', async () => {
    const d = await json(await handleGetReferrers(req(`/api/sites/${SITE}/referrers`), SITE))
    const google = d.referrers.find((r: any) => /google/i.test(r.source))
    const direct = d.referrers.find((r: any) => r.source === 'Direct')
    expect(google?.visitors).toBe(1)
    expect(google?.views).toBe(2)
    expect(direct?.visitors).toBe(1)
  })

  it('/browsers: Chrome and Firefox each one visitor', async () => {
    const d = await json(await handleGetBrowsers(req(`/api/sites/${SITE}/browsers`), SITE))
    expect(d.browsers.find((b: any) => b.name === 'Chrome')?.visitors).toBe(1)
    expect(d.browsers.find((b: any) => b.name === 'Firefox')?.visitors).toBe(1)
  })

  it('/devices: desktop visitors with percentage', async () => {
    const d = await json(await handleGetDevices(req(`/api/sites/${SITE}/devices`), SITE))
    const desktop = d.devices.find((x: any) => /desktop/i.test(x.type))
    expect(desktop?.visitors).toBe(2)
    expect(desktop?.percentage).toBe(100)
  })
})
