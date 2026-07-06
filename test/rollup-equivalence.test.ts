/**
 * The golden rollup invariant (#172/#177): for any settled day, every
 * breakdown endpoint must return IDENTICAL results whether the day is served
 * from ROLLUP#DIMS aggregates or recomputed from raw rows. Traffic is seeded
 * through the REAL ingest path at a frozen past time, rolled up by the REAL
 * job code, and compared endpoint-by-endpoint.
 */
import { afterAll, describe, expect, it, setSystemTime } from 'bun:test'
import { handleCollect } from '../src/handlers/collect'
import { handleGetStats, handleGetPages, handleGetReferrers, handleGetBrowsers, handleGetDevices, handleGetOS, handleGetCountries } from '../src/handlers/stats'
import { ensureDayRollups } from '../src/lib/rollups'
import { dynamodb, TABLE_NAME } from '../src/lib/dynamodb'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0'
const SITE = `rollsite${Math.random().toString(36).slice(2, 8)}`

// A settled day: 10 days in the past, frozen at noon UTC.
const DAY = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

function beacon(body: Record<string, unknown>, ua: string, ip: string): Promise<Response> {
  return handleCollect(new Request('http://localhost/collect', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'user-agent': ua, 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  }))
}

const RANGE = `startDate=${DAY}T00:00:00.000Z&endDate=${new Date().toISOString()}`
const req = (ep: string): Request => new Request(`http://localhost/api/sites/${SITE}/${ep}?${RANGE}`)

const ENDPOINTS: Array<[string, (r: Request, s: string) => Promise<Response>]> = [
  ['stats', handleGetStats],
  ['pages', handleGetPages],
  ['referrers', handleGetReferrers],
  ['browsers', handleGetBrowsers],
  ['devices', handleGetDevices],
  ['os', handleGetOS],
  ['countries', handleGetCountries],
]

async function snapshot(): Promise<Record<string, any>> {
  const out: Record<string, any> = {}
  for (const [name, handler] of ENDPOINTS) {
    const res = await handler(req(name), SITE)
    expect(res.status).toBe(200)
    const body = await res.json()
    delete body.realtime // timing-dependent, not part of the invariant
    out[name] = body
  }
  return out
}

afterAll(() => setSystemTime())

describe('rollup/raw equivalence', () => {
  it('seeds a settled day of traffic through the real ingest path', async () => {
    setSystemTime(new Date(`${DAY}T12:00:00.000Z`))
    // Visitor 1: Chrome, Manila timezone, via Google, two pages.
    await beacon({ s: SITE, sid: 'roll1-abcdef', e: 'pageview', u: 'http://example.com/', r: 'https://www.google.com/', t: 'Home', tz: 'Asia/Manila' }, CHROME, '10.1.0.1')
    await beacon({ s: SITE, sid: 'roll1-abcdef', e: 'pageview', u: 'http://example.com/docs', t: 'Docs', tz: 'Asia/Manila' }, CHROME, '10.1.0.1')
    // Visitor 2: Firefox, New York timezone, direct bounce.
    await beacon({ s: SITE, sid: 'roll2-abcdef', e: 'pageview', u: 'http://example.com/pricing', t: 'Pricing', tz: 'America/New_York' }, FIREFOX, '10.1.0.2')
    // Visitor 3: Chrome, custom event too.
    await beacon({ s: SITE, sid: 'roll3-abcdef', e: 'pageview', u: 'http://example.com/', t: 'Home', tz: 'Asia/Manila' }, CHROME, '10.1.0.3')
    await beacon({ s: SITE, sid: 'roll3-abcdef', e: 'event', u: 'http://example.com/', p: { name: 'signup', value: 5 } }, CHROME, '10.1.0.3')
    setSystemTime()
  })

  it('rollups computed; endpoints serve the settled day from aggregates', async () => {
    const written = await ensureDayRollups(SITE)
    expect(written).toBeGreaterThan(0)

    const rolled = await snapshot()

    // Remove the day's rollup items -> the same window is now raw-served.
    for (const sk of [`ROLLUP#DIMS#${DAY}`, `ROLLUP#DAY#${DAY}`]) {
      await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: { pk: { S: `SITE#${SITE}` }, sk: { S: sk } } })
    }
    const raw = await snapshot()

    for (const [name] of ENDPOINTS) {
      expect(JSON.stringify(rolled[name], null, 1)).toBe(JSON.stringify(raw[name], null, 1))
    }

    // And the rolled numbers are the truth we seeded:
    expect(rolled.stats.people).toBe(3)
    expect(rolled.stats.views).toBe(4)
    expect(rolled.stats.sessions).toBe(3)
    const home = rolled.pages.pages.find((p: any) => p.path === '/')
    expect(home).toMatchObject({ views: 2, visitors: 2 })
    expect(rolled.browsers.browsers.find((b: any) => b.name === 'Chrome')?.visitors).toBe(2)
    expect(rolled.countries.countries.find((c: any) => c.name === 'Philippines')?.visitors).toBe(2)
    expect(rolled.countries.countries.find((c: any) => c.name === 'United States')?.visitors).toBe(1)
  })
})
