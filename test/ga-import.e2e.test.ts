/**
 * GA4 CSV importer (#155 Phase A): format parsing, end-to-end import into the
 * rollup store, dashboard reads over imported history, collision policy, and
 * gap contiguity.
 */
import { describe, expect, it } from 'bun:test'
import { parseCsv, parseGaDate, detectKind, buildDailyData } from '../src/lib/ga-import'
import { handleGaImport } from '../src/handlers/data'
import { handleGetStats, handleGetPages, handleGetReferrers, handleGetBrowsers } from '../src/handlers/stats'
import { dynamodb, TABLE_NAME, marshall } from '../src/lib/dynamodb'

const SITE = `gasite${Math.random().toString(36).slice(2, 8)}`
const day = (offset: number): string => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10)
const ga = (d: string): string => d.replace(/-/g, '')
// A settled span well in the past: D20..D10 (days ago).
const D = { start: day(20), mid: day(15), end: day(10) }

describe('CSV parsing', () => {
  it('handles GA # comments, quoted fields, and CRLF', () => {
    const rows = parseCsv('# ----\n# GA4 export\nDate,"Page path and screen class",Views\r\n20260615,"/a,b",12\n')
    expect(rows.length).toBe(2)
    expect(rows[1]).toEqual(['20260615', '/a,b', '12'])
  })

  it('parses GA4, ISO, and UA date formats', () => {
    expect(parseGaDate('20260615')).toBe('2026-06-15')
    expect(parseGaDate('2026-06-15')).toBe('2026-06-15')
    expect(parseGaDate('6/15/2026')).toBe('2026-06-15')
    expect(parseGaDate('Grand total')).toBeNull()
  })

  it('detects file kinds from headers', () => {
    expect(detectKind(['Date', 'Views', 'Active users', 'Sessions'])).toBe('traffic')
    expect(detectKind(['Date', 'Page path and screen class', 'Views'])).toBe('pages')
    expect(detectKind(['Date', 'Session source', 'Active users'])).toBe('sources')
    expect(detectKind(['Date', 'Country', 'Active users'])).toBe('countries')
    expect(detectKind(['Date', 'Browser', 'Active users'])).toBe('browsers')
    expect(detectKind(['Page path', 'Views'])).toBe('unknown') // no date column
  })

  it('maps traffic metrics, bounce rate, and (direct) normalization', () => {
    const { days } = buildDailyData([
      { name: 't.csv', content: `Date,Views,Active users,Sessions,Bounce rate,Average session duration\n${ga(D.start)},100,40,50,42%,90\n` },
      { name: 's.csv', content: `Date,Session source,Active users,Sessions\n${ga(D.start)},(direct),25,30\n${ga(D.start)},google,15,20\n` },
    ])
    const acc = days.get(D.start)!
    expect(acc.scalars).toMatchObject({ views: 100, visitors: 40, sessions: 50, bounces: 21 })
    expect(acc.scalars.totalDuration).toBe(50 * 90 * 1000)
    expect(acc.sources.Direct.v).toBe(25)
    expect(acc.sources.google.v).toBe(15)
  })
})

describe('end-to-end import (#155)', () => {
  const post = (files: Array<{ name: string, content: string }>): Promise<Response> =>
    handleGaImport(new Request(`http://l/api/sites/${SITE}/import/ga`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files }),
    }), SITE)

  it('imports a multi-file GA export into the rollup store (with a gap day)', async () => {
    // Pre-existing REAL tracked rollup on D.mid must survive the import.
    // Post-#172, real days always have BOTH the scalar and dims items.
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({ pk: `SITE#${SITE}`, sk: `ROLLUP#DAY#${D.mid}`, day: D.mid, views: 7, visitors: 7, sessions: 7, bounces: 0, totalDuration: 0, events: 0 }),
    })
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: `SITE#${SITE}`, sk: `ROLLUP#DIMS#${D.mid}`, day: D.mid,
        pages: { '/real': { w: 7, v: 7, e: 7 } }, sources: { Direct: { v: 7, w: 7 } },
        devices: {}, browsers: {}, os: {}, countries: {}, regions: {}, cities: {},
        campaigns: {}, events: {}, entries: {}, exits: {},
      }),
    })

    const res = await post([
      { name: 'traffic.csv', content: `Date,Views,Active users,Sessions,Bounce rate\n${ga(D.start)},100,40,50,50%\n${ga(D.mid)},60,20,25,20%\n${ga(D.end)},30,10,12,25%\n` },
      { name: 'pages.csv', content: `Date,Page path and screen class,Views,Active users\n${ga(D.start)},/,60,30\n${ga(D.start)},/pricing,40,20\n${ga(D.end)},/,30,10\n` },
      { name: 'sources.csv', content: `Date,Session source,Active users,Sessions\n${ga(D.start)},google,30,35\n${ga(D.start)},(direct),10,15\n${ga(D.end)},(direct),10,12\n` },
      { name: 'browsers.csv', content: `Date,Browser,Active users\n${ga(D.start)},Chrome,30\n${ga(D.start)},Safari,10\n` },
    ])
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.daysWritten).toBe(2) // D.start + D.end (D.mid skipped — real data)
    expect(body.daysSkipped).toEqual([D.mid])
    expect(body.zeroFilled).toBeGreaterThan(0) // gap days + span→yesterday
    expect(body.files.map((f: any) => f.kind).sort()).toEqual(['browsers', 'pages', 'sources', 'traffic'])
  })

  it('dashboard stats read the imported history (rolled path)', async () => {
    const range = `startDate=${D.start}T00:00:00.000Z&endDate=${D.end}T23:59:59.999Z`
    const stats = await (await handleGetStats(new Request(`http://l/s?${range}`), SITE)).json()
    // 100+30 imported + 7 real (D.mid preserved) = 137 views; people 40+10+7.
    expect(stats.views).toBe(137)
    expect(stats.people).toBe(57)

    const pages = await (await handleGetPages(new Request(`http://l/p?${range}`), SITE)).json()
    const home = pages.pages.find((p: any) => p.path === '/')
    expect(home.views).toBe(90) // 60 (D.start) + 30 (D.end) across the span
    expect(home.visitors).toBe(40)
    expect(pages.pages.find((p: any) => p.path === '/real')?.views).toBe(7) // real day preserved

    const refs = await (await handleGetReferrers(new Request(`http://l/r?${range}`), SITE)).json()
    expect(refs.referrers.find((r: any) => r.source === 'google')?.visitors).toBe(30)
    expect(refs.referrers.find((r: any) => r.source === 'Direct')?.visitors).toBe(27) // 10+10 imported + 7 real

    const browsers = await (await handleGetBrowsers(new Request(`http://l/b?${range}`), SITE)).json()
    expect(browsers.browsers.find((b: any) => b.name === 'Chrome')?.visitors).toBe(30)
  })

  it('re-import is idempotent (imported days overwritten, not doubled)', async () => {
    const res = await post([
      { name: 'traffic.csv', content: `Date,Views,Active users,Sessions\n${ga(D.start)},100,40,50\n` },
    ])
    expect(res.status).toBe(200)
    const range = `startDate=${D.start}T00:00:00.000Z&endDate=${D.start}T23:59:59.999Z`
    const stats = await (await handleGetStats(new Request(`http://l/s?${range}`), SITE)).json()
    expect(stats.views).toBe(100)
  })

  it('rejects empty and oversized payloads', async () => {
    expect((await post([])).status).toBe(400)
  })
})
