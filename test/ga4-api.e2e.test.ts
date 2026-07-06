/**
 * GA4 Data API importer (#155 Phase B): JWT service-account auth against a
 * fake Google (token + runReport), report folding, and end-to-end import
 * read back through the real dashboard endpoints.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { foldReport, importFromGa4Api } from '../src/lib/ga4-api'
import { handleGetStats, handleGetPages, handleGetBrowsers } from '../src/handlers/stats'

const SITE = `ga4site${Math.random().toString(36).slice(2, 8)}`
const day = (offset: number): string => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10)
const ga = (d: string): string => d.replace(/-/g, '')
const D1 = day(30)
const D2 = day(29)

// ---- a throwaway RSA key so the real signing path runs end to end ----
async function makeKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  )
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  let bin = ''
  for (const b of der) bin += String.fromCharCode(b)
  const b64 = btoa(bin).replace(/(.{64})/g, '$1\n')
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`
}

// ---- fake Google: token endpoint + Data API ----
const seenTokenRequests: string[] = []
const seenReports: string[] = []
const fake = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const url = new URL(req.url)
    if (url.pathname === '/token') {
      seenTokenRequests.push(await req.text())
      return Response.json({ access_token: 'fake-token', expires_in: 3600 })
    }
    if (url.pathname.endsWith(':runReport')) {
      if (req.headers.get('authorization') !== 'Bearer fake-token')
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      const body = await req.json() as { dimensions: Array<{ name: string }> }
      const dims = body.dimensions.map(d => d.name).join(',')
      seenReports.push(dims)
      const row = (dimValues: string[], metValues: number[]) => ({
        dimensionValues: dimValues.map(value => ({ value })),
        metricValues: metValues.map(v => ({ value: String(v) })),
      })
      if (dims === 'date')
        return Response.json({ rows: [row([ga(D1)], [100, 40, 50, 0.4, 90, 10]), row([ga(D2)], [60, 25, 30, 0.2, 120, 5])], rowCount: 2 })
      if (dims === 'date,pagePath')
        return Response.json({ rows: [row([ga(D1), '/'], [70, 30]), row([ga(D1), '/docs'], [30, 15]), row([ga(D2), '/'], [60, 25])], rowCount: 3 })
      if (dims === 'date,sessionSource')
        return Response.json({ rows: [row([ga(D1), '(direct)'], [25, 30, 60]), row([ga(D1), 'google'], [15, 20, 40])], rowCount: 2 })
      if (dims === 'date,browser')
        return Response.json({ rows: [row([ga(D1), 'Chrome'], [30]), row([ga(D1), '(not set)'], [3])], rowCount: 2 })
      return Response.json({ rows: [], rowCount: 0 })
    }
    return new Response('not found', { status: 404 })
  },
})
process.env.GA4_TOKEN_URL = `http://127.0.0.1:${fake.port}/token`
process.env.GA4_API_BASE = `http://127.0.0.1:${fake.port}`

afterAll(() => {
  fake.stop(true)
  delete process.env.GA4_TOKEN_URL
  delete process.env.GA4_API_BASE
})

describe('foldReport (pure)', () => {
  it('folds traffic metrics with bounce rate and duration', () => {
    const days = new Map()
    foldReport(days, 'traffic', [{
      dimensionValues: [{ value: '20260101' }],
      metricValues: [{ value: '100' }, { value: '40' }, { value: '50' }, { value: '0.42' }, { value: '90' }, { value: '7' }],
    }])
    const acc = days.get('2026-01-01')!
    expect(acc.scalars).toMatchObject({ views: 100, visitors: 40, sessions: 50, bounces: 21, totalDuration: 50 * 90 * 1000, events: 7 })
  })

  it('skips rows with unparsable dates (totals rows)', () => {
    const days = new Map()
    const folded = foldReport(days, 'pages', [{ dimensionValues: [{ value: 'Grand total' }], metricValues: [{ value: '9' }] }])
    expect(folded).toBe(0)
  })
})

describe('GA4 API import E2E (#155 Phase B)', () => {
  it('signs a JWT, exchanges it, pulls all reports, and writes rollups', async () => {
    const result = await importFromGa4Api(SITE, {
      propertyId: 'properties/123456',
      serviceAccountKey: { client_email: 'importer@test.iam.gserviceaccount.com', private_key: await makeKey() },
      startDate: D1,
      endDate: D2,
    })
    expect(seenTokenRequests.length).toBe(1)
    expect(seenTokenRequests[0]).toContain('jwt-bearer')
    expect(seenReports.length).toBe(10) // every report family requested
    expect(result.daysWritten).toBe(2)
    expect(result.files.find(f => f.kind === 'traffic')?.rows).toBe(2)
  })

  it('imported history reads through the dashboard', async () => {
    const range = `startDate=${D1}T00:00:00.000Z&endDate=${D2}T23:59:59.999Z`
    const stats = await (await handleGetStats(new Request(`http://l/s?${range}`), SITE)).json()
    expect(stats.views).toBe(160)
    expect(stats.people).toBe(65)

    const pages = await (await handleGetPages(new Request(`http://l/p?${range}`), SITE)).json()
    expect(pages.pages.find((p: any) => p.path === '/')?.views).toBe(130)

    const browsers = await (await handleGetBrowsers(new Request(`http://l/b?${range}`), SITE)).json()
    expect(browsers.browsers.find((b: any) => b.name === 'Chrome')?.visitors).toBe(30)
    // '(not set)' is dropped, not reported as a junk bucket
    expect(browsers.browsers.find((b: any) => b.name === '(not set)')).toBeUndefined()
  })

  it('rejects a non-numeric property id with an actionable error', async () => {
    await expect(importFromGa4Api(SITE, {
      propertyId: 'my-property',
      serviceAccountKey: { client_email: 'x@y.iam.gserviceaccount.com', private_key: await makeKey() },
    })).rejects.toThrow(/numeric/)
  })
})
