/**
 * Reporting partials (#139): screen-sizes report, configured-metrics digest,
 * aggregated report CSV export.
 */
import { describe, expect, it } from 'bun:test'
import { handleCollect } from '../src/handlers/collect'
import { handleGetScreenSizes } from '../src/handlers/stats'
import { handleExport } from '../src/handlers/data'
import { buildDigestText } from '../src/handlers/alerts'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const SITE = `repsite${Math.random().toString(36).slice(2, 8)}`

function beacon(body: Record<string, unknown>, ip: string): Promise<Response> {
  return handleCollect(new Request('http://localhost/collect', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'user-agent': CHROME, 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  }))
}

describe('reporting partials (#139)', () => {
  it('seeds pageviews with screen dimensions', async () => {
    await beacon({ s: SITE, sid: 'rep1-abcdef', e: 'pageview', u: 'http://example.com/', r: 'https://google.com/', sw: 1440, sh: 900 }, '10.7.0.1')
    await beacon({ s: SITE, sid: 'rep2-abcdef', e: 'pageview', u: 'http://example.com/pricing', sw: 390, sh: 844 }, '10.7.0.2')
    await beacon({ s: SITE, sid: 'rep3-abcdef', e: 'pageview', u: 'http://example.com/', sw: 1920, sh: 1080 }, '10.7.0.3')
  })

  it('screen-sizes buckets viewport widths with visitors + percentages', async () => {
    const res = await handleGetScreenSizes(new Request(`http://l/s`), SITE)
    expect(res.status).toBe(200)
    const { screenSizes } = await res.json()
    const names = screenSizes.map((x: any) => x.name)
    expect(names.some((n: string) => n.includes('Desktop'))).toBe(true)
    expect(names.some((n: string) => n.includes('Mobile'))).toBe(true)
    expect(names.some((n: string) => n.includes('Large'))).toBe(true)
    const total = screenSizes.reduce((sum: number, x: any) => sum + x.visitors, 0)
    expect(total).toBe(3)
  })

  it('digest honors configured metrics and includes top pages/sources', async () => {
    const start = new Date(Date.now() - 24 * 3600_000).toISOString()
    const end = new Date().toISOString()
    const full = await buildDigestText(SITE, 'Rep Site', start, end, [], 'day')
    expect(full).toContain('Visitors: 3')
    expect(full).toContain('Pageviews: 3')
    expect(full).toContain('Top pages:')
    expect(full).toContain('Top sources:')
    expect(full).toContain('Google')

    const onlyViews = await buildDigestText(SITE, 'Rep Site', start, end, ['pageviews'], 'day')
    expect(onlyViews).toContain('Pageviews: 3')
    expect(onlyViews).not.toContain('Visitors:')
    expect(onlyViews).not.toContain('Bounce rate:')
  })

  it('exports the AGGREGATED pages report as CSV (not a raw dump)', async () => {
    const res = await handleExport(new Request(`http://l/e?report=pages&format=csv`), SITE)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv')
    const csv = await res.text()
    const lines = csv.split('\n')
    expect(lines[0].split(',')).toContain('path')
    expect(lines[0].split(',')).toContain('views')
    expect(lines.length).toBe(3) // header + 2 aggregated paths
    expect(csv).toContain('"/pricing"')
  })

  it('rejects unknown report names', async () => {
    const res = await handleExport(new Request(`http://l/e?report=nope`), SITE)
    expect(res.status).toBe(400)
  })
})
