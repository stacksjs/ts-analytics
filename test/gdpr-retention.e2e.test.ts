/**
 * GDPR export/delete completeness + per-site retention at ingest (#178).
 */
import { describe, expect, it } from 'bun:test'
import { handleCollect } from '../src/handlers/collect'
import { handleExport, handleGdprExport, handleGdprDelete } from '../src/handlers/data'
import { dynamodb, TABLE_NAME, marshall } from '../src/lib/dynamodb'
import { clearSiteRetentionCache } from '../src/lib/site-retention'
import { dumpTable } from './harness/dynamo-fake'
import { getConfig } from '../src/config'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function beacon(body: Record<string, unknown>): Promise<Response> {
  return handleCollect(new Request('http://localhost/collect', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'user-agent': UA },
    body: JSON.stringify(body),
  }))
}

function rows(siteId: string, prefix: string): any[] {
  return dumpTable(TABLE_NAME)
    .filter(it => it.pk?.S === `SITE#${siteId}` && String(it.sk?.S || '').startsWith(prefix))
}

describe('per-site retention honored at ingest (#178)', () => {
  it('stamps raw TTLs from RETENTION_SETTINGS instead of the global default', async () => {
    const site = `retsite${Math.random().toString(36).slice(2, 8)}`
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({ pk: `SITE#${site}`, sk: 'RETENTION_SETTINGS', siteId: site, retentionDays: 7 }),
    })
    clearSiteRetentionCache()

    await beacon({ s: site, sid: 'ret1-abcdef', e: 'pageview', u: 'http://example.com/' })
    const pv = rows(site, 'PAGEVIEW#')[0]
    const ttl = Number(pv.ttl.N)
    const expected = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    expect(Math.abs(ttl - expected)).toBeLessThan(60)
  })

  it('falls back to the global TTL for sites without a setting', async () => {
    const site = `retdef${Math.random().toString(36).slice(2, 8)}`
    await beacon({ s: site, sid: 'ret2-abcdef', e: 'pageview', u: 'http://example.com/' })
    const pv = rows(site, 'PAGEVIEW#')[0]
    const expected = Math.floor(Date.now() / 1000) + getConfig().retention.rawEventTtl
    expect(Math.abs(Number(pv.ttl.N) - expected)).toBeLessThan(60)
  })
})

describe('GDPR export/delete completeness (#178)', () => {
  const site = `gdprsite${Math.random().toString(36).slice(2, 8)}`
  const sid = 'gdpr1-abcdef'
  let visitorId = ''

  it('seeds pageview + click + engagement for one visitor', async () => {
    await beacon({ s: site, sid, e: 'pageview', u: 'http://example.com/' })
    await beacon({ s: site, sid, e: 'click', u: 'http://example.com/', p: { url: 'http://example.com/file.pdf', kind: 'download', text: 'PDF' } })
    await beacon({ s: site, sid, e: 'engagement', u: 'http://example.com/', p: { scrollDepth: 50, timeOnPage: 10 } })
    visitorId = rows(site, 'PAGEVIEW#')[0].visitorId.S
    expect(visitorId).toBeTruthy()
  })

  it('export covers clicks and engagement (previously omitted) with the rotation note', async () => {
    const res = await handleGdprExport(new Request(`http://l/api/sites/${site}/gdpr/export?visitorId=${visitorId}`), site)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.pageviews.length).toBe(1)
    expect(body.data.clicks.length).toBe(1)
    expect(body.data.engagement.length).toBe(1)
    expect(body.note).toContain('rotate daily')
  })

  it('delete removes every record type for the visitor', async () => {
    const res = await handleGdprDelete(new Request(`http://l/api/sites/${site}/gdpr/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorId }),
    }), site)
    const body = await res.json()
    expect(body.deletedCount).toBeGreaterThanOrEqual(4) // pv + session + click + engagement
    expect(rows(site, 'PAGEVIEW#').length).toBe(0)
    expect(rows(site, 'CLICK#').length).toBe(0)
    expect(rows(site, 'ENGAGEMENT#').length).toBe(0)
  })
})

describe('regular export (#178)', () => {
  it('CSV headers are the union of keys across rows', async () => {
    const site = `csvsite${Math.random().toString(36).slice(2, 8)}`
    // Row 1: no UTM fields. Row 2: with utm_source — a first-row-headers CSV
    // would silently drop the utmSource column.
    await beacon({ s: site, sid: 'csv1-abcdef', e: 'pageview', u: 'http://example.com/' })
    await beacon({ s: site, sid: 'csv2-abcdef', e: 'pageview', u: 'http://example.com/?utm_source=newsletter' })

    const res = await handleExport(new Request(`http://l/api/sites/${site}/export?format=csv&type=pageviews`), site)
    expect(res.status).toBe(200)
    const csv = await res.text()
    const headers = csv.split('\n')[0].split(',')
    expect(headers).toContain('utmSource')
    expect(csv.split('\n').length).toBe(3) // header + 2 rows
  })

  it('supports the previously unreachable types', async () => {
    const site = `exptype${Math.random().toString(36).slice(2, 8)}`
    await beacon({ s: site, sid: 'exp1-abcdef', e: 'pageview', u: 'http://example.com/' })
    await beacon({ s: site, sid: 'exp1-abcdef', e: 'click', u: 'http://example.com/', p: { url: 'http://x.com/', kind: 'outbound', text: 'x' } })
    const res = await handleExport(new Request(`http://l/api/sites/${site}/export?type=clicks`), site)
    const body = await res.json()
    expect(body.count).toBe(1)
  })
})
