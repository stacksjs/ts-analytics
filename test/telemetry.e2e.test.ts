/**
 * Telemetry + tracker identity tests (#175/#179): ingest outcomes counted per
 * site-hour, deep health check, tracker version embedded + aggregated, ETag
 * revalidation on the served script.
 */
import { describe, expect, it } from 'bun:test'
import { handleCollect } from '../src/handlers/collect'
import { handleHealth, handleGetIngestCounters } from '../src/handlers/misc'
import { flushIngestCounters } from '../src/lib/ingest-counters'
import { generateTrackingScript } from '../src/Analytics'
import { jsResponse } from '../src/utils/response'
import { TRACKER_VERSION } from '../src/version'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const SITE = `telsite${Math.random().toString(36).slice(2, 8)}`

function beacon(body: Record<string, unknown>, ua: string = UA): Promise<Response> {
  return handleCollect(new Request('http://localhost/collect', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'user-agent': ua },
    body: JSON.stringify(body),
  }))
}

describe('ingest counters (#175)', () => {
  it('counts collected/bot/dedup outcomes per site-hour, with tracker version', async () => {
    await beacon({ s: SITE, sid: 'tel1-abcdef', e: 'pageview', u: 'http://example.com/', v: TRACKER_VERSION })
    await beacon({ s: SITE, sid: 'tel2-abcdef', e: 'pageview', u: 'http://example.com/' }, 'curl/8.7.1')
    const dup = { s: SITE, sid: 'tel3-abcdef', e: 'pageview', u: 'http://example.com/', eid: 'tel-eid-1' }
    await beacon(dup)
    await beacon(dup)
    await flushIngestCounters()

    const res = await handleGetIngestCounters(new Request(`http://localhost/api/sites/${SITE}/ingest-counters`), SITE)
    expect(res.status).toBe(200)
    const { counters } = await res.json()
    expect(counters.length).toBe(1)
    const row = counters[0]
    expect(Number(row.collected)).toBe(2) // first beacon + first eid delivery
    expect(Number(row.bot)).toBe(1)
    expect(Number(row.dedup)).toBe(1)
    const vField = `v_${TRACKER_VERSION.replace(/[.-]/g, '_')}`
    expect(Number(row[vField])).toBe(1)
  })
})

describe('deep health check (#175)', () => {
  it('probes the database and reports latency', async () => {
    const res = await handleHealth(new Request('http://localhost/health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.db).toBe('ok')
    expect(typeof body.dbLatencyMs).toBe('number')
  })
})

describe('tracker version identity (#179)', () => {
  it('version constant matches package.json', async () => {
    const pkg = await import('../package.json')
    expect(TRACKER_VERSION).toBe(pkg.version)
  })

  it('embeds the version as the include-guard value and beacon field', () => {
    const script = generateTrackingScript({ siteId: 'x', apiEndpoint: 'http://a' })
    expect(script).toContain(`w.__tsa="${TRACKER_VERSION}"`)
    expect(script).toContain(`v:"${TRACKER_VERSION}"`)
  })
})

describe('script caching (#179)', () => {
  it('serves an ETag and honors If-None-Match with 304', async () => {
    const first = jsResponse('console.log(1)', {}, new Request('http://l/script.js'))
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    expect(first.headers.get('cache-control')).toContain('stale-while-revalidate')

    const revalidated = jsResponse('console.log(1)', {}, new Request('http://l/script.js', { headers: { 'if-none-match': etag! } }))
    expect(revalidated.status).toBe(304)

    const changed = jsResponse('console.log(2)', {}, new Request('http://l/script.js', { headers: { 'if-none-match': etag! } }))
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(etag)
  })
})
