/**
 * Ingest-path end-to-end tests (#177): the REAL handleCollect against the
 * in-process DynamoDB fake — sessions, flags, idempotency, timeout rotation,
 * bots, the domain firewall, body caps, events, and engagement folding.
 *
 * Each test uses its own siteId/sid: the collect handler keeps an in-process
 * session cache keyed `${siteId}:${sid}`, so reusing ids would leak state
 * between tests.
 */
import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { handleCollect } from '../src/handlers/collect'
import { dynamodb, TABLE_NAME, marshall } from '../src/lib/dynamodb'
import { dumpTable } from './harness/dynamo-fake'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

let seq = 0
function uid(prefix: string): string {
  return `${prefix}${++seq}x${Math.random().toString(36).slice(2, 8)}`
}

function beacon(body: unknown, opts: { ua?: string | null, ip?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'text/plain' }
  if (opts.ua !== null) headers['user-agent'] = opts.ua ?? UA
  if (opts.ip) headers['x-forwarded-for'] = opts.ip
  return handleCollect(new Request('http://localhost/collect', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

function rows(siteId: string, prefix: string): any[] {
  return dumpTable(TABLE_NAME)
    .filter(it => it.pk?.S === `SITE#${siteId}` && String(it.sk?.S || '').startsWith(prefix))
}

afterEach(() => {
  setSystemTime() // always restore real time
})

describe('ingest: pageviews and sessions', () => {
  it('first pageview creates a session and a unique/bounce pageview', async () => {
    const site = uid('site')
    const sid = `${uid('s')}-abcdef`
    const res = await beacon({ s: site, sid, e: 'pageview', u: 'http://example.com/', t: 'Home' })
    expect(res.status).toBe(204)

    const sessions = rows(site, 'SESSION#')
    expect(sessions.length).toBe(1)
    expect(sessions[0].pageViewCount.N).toBe('1')
    expect(sessions[0].isBounce.BOOL).toBe(true)
    expect(sessions[0].entryPath.S).toBe('/')
    // #171: the time-keyed index entry is written with the session
    expect(sessions[0].gsi1pk.S).toBe(`SITE#${site}#SESSIONS`)

    const pvs = rows(site, 'PAGEVIEW#')
    expect(pvs.length).toBe(1)
    expect(pvs[0].isUnique.BOOL).toBe(true)
    expect(pvs[0].isBounce.BOOL).toBe(true)
  })

  it('second pageview increments the session and is not unique (#145)', async () => {
    const site = uid('site')
    const sid = `${uid('s')}-abcdef`
    await beacon({ s: site, sid, e: 'pageview', u: 'http://example.com/' })
    await beacon({ s: site, sid, e: 'pageview', u: 'http://example.com/about' })

    const sessions = rows(site, 'SESSION#')
    expect(sessions.length).toBe(1)
    expect(sessions[0].pageViewCount.N).toBe('2')
    expect(sessions[0].isBounce.BOOL).toBe(false)
    expect(sessions[0].exitPath.S).toBe('/about')

    const uniques = rows(site, 'PAGEVIEW#').filter(pv => pv.isUnique.BOOL)
    expect(uniques.length).toBe(1)
  })

  it('replayed delivery with the same eid stores one pageview (#169)', async () => {
    const site = uid('site')
    const body = { s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://example.com/', eid: 'replay-eid-0001' }
    expect((await beacon(body)).status).toBe(204)
    expect((await beacon(body)).status).toBe(204)
    expect(rows(site, 'PAGEVIEW#').length).toBe(1)
  })

  it('a reused sid after 30 idle minutes starts a NEW session (#135)', async () => {
    const site = uid('site')
    const sid = `${uid('s')}-abcdef`
    await beacon({ s: site, sid, e: 'pageview', u: 'http://example.com/' })

    setSystemTime(new Date(Date.now() + 31 * 60 * 1000))
    await beacon({ s: site, sid, e: 'pageview', u: 'http://example.com/back' })

    expect(rows(site, 'SESSION#').length).toBe(2)
  })
})

describe('ingest: bot and junk filtering (#166)', () => {
  it.each([
    ['curl', 'curl/8.7.1'],
    ['headless chrome', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36'],
    ['googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ])('drops %s traffic without writing', async (_label, ua) => {
    const site = uid('site')
    const res = await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://example.com/' }, { ua })
    expect(res.status).toBe(204)
    expect(rows(site, 'PAGEVIEW#').length).toBe(0)
    expect(rows(site, 'SESSION#').length).toBe(0)
  })

  it('drops UA-less requests without writing', async () => {
    const site = uid('site')
    await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://example.com/' }, { ua: null })
    expect(rows(site, 'PAGEVIEW#').length).toBe(0)
  })
})

describe('ingest: domain firewall (#170)', () => {
  async function createSite(site: string, domains: string[]): Promise<void> {
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({ pk: 'SITES', sk: `SITE#${site}`, id: site, siteId: site, name: site, domains }),
    })
  }

  it('drops events from foreign hostnames, keeps configured ones', async () => {
    const site = uid('site')
    await createSite(site, ['example.com'])

    await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://evil.com/steal' })
    expect(rows(site, 'PAGEVIEW#').length).toBe(0)

    await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://example.com/ok' })
    await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://www.example.com/www-ok' })
    await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://app.example.com/sub-ok' })
    expect(rows(site, 'PAGEVIEW#').length).toBe(3)
  })

  it('a site with no domains keeps the open behavior', async () => {
    const site = uid('site')
    await createSite(site, [])
    await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://anything.dev/' })
    expect(rows(site, 'PAGEVIEW#').length).toBe(1)
  })

  it('unknown site with auto-provisioning disabled drops silently', async () => {
    process.env.ANALYTICS_AUTO_CREATE_SITES = 'false'
    try {
      const site = uid('site')
      const res = await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://example.com/' })
      expect(res.status).toBe(204)
      const created = dumpTable(TABLE_NAME).filter(it => it.pk?.S === 'SITES' && it.sk?.S === `SITE#${site}`)
      expect(created.length).toBe(0)
      expect(rows(site, 'PAGEVIEW#').length).toBe(0)
    }
    finally {
      delete process.env.ANALYTICS_AUTO_CREATE_SITES
    }
  })
})

describe('ingest: body hardening (#173)', () => {
  it('rejects oversized bodies with 413 before parsing', async () => {
    const big = JSON.stringify({ s: uid('site'), e: 'pageview', u: 'http://example.com/', t: 'A'.repeat(20_000) })
    expect((await beacon(big)).status).toBe(413)
  })

  it('rejects malformed JSON with 400', async () => {
    expect((await beacon('not json {{')).status).toBe(400)
  })

  it('truncates oversized pageview titles at ingest', async () => {
    const site = uid('site')
    await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://example.com/', t: 'T'.repeat(2000) })
    const pvs = rows(site, 'PAGEVIEW#')
    expect(pvs.length).toBe(1)
    expect(pvs[0].title.S.length).toBe(512)
  })

  it('normalizes self-referrals to Direct', async () => {
    const site = uid('site')
    await beacon({ s: site, sid: `${uid('s')}-abcdef`, e: 'pageview', u: 'http://example.com/page', r: 'http://example.com/other' })
    const pvs = rows(site, 'PAGEVIEW#')
    expect(pvs[0].referrerSource.S).toBe('Direct')
    // undefined marshals to NULL — either way, no self-referrer is stored
    expect(pvs[0].referrer?.S).toBeUndefined()
  })
})

describe('ingest: custom events and engagement', () => {
  it('stores custom events with capped primitive props and increments the session', async () => {
    const site = uid('site')
    const sid = `${uid('s')}-abcdef`
    await beacon({ s: site, sid, e: 'pageview', u: 'http://example.com/' })
    const props: Record<string, unknown> = { name: 'signup', value: 12, plan: 'pro', nested: { drop: true } }
    await beacon({ s: site, sid, e: 'event', u: 'http://example.com/', p: props })

    const events = rows(site, 'EVENT#')
    expect(events.length).toBe(1)
    expect(events[0].name.S).toBe('signup')
    expect(Number(events[0].value.N)).toBe(12)
    // Properties are serialized as a JSON string on the item
    const stored = JSON.parse(events[0].properties?.S ?? '{}')
    expect(stored.plan).toBe('pro')
    expect(stored.nested).toBeUndefined()
  })

  it('folds departure-ping time into session activeTime (#167)', async () => {
    const site = uid('site')
    const sid = `${uid('s')}-abcdef`
    await beacon({ s: site, sid, e: 'pageview', u: 'http://example.com/' })
    await beacon({ s: site, sid, e: 'engagement', u: 'http://example.com/', p: { scrollDepth: 80, timeOnPage: 42 } })
    await beacon({ s: site, sid, e: 'engagement', u: 'http://example.com/', p: { scrollDepth: 95, timeOnPage: 18 } })

    const sessions = rows(site, 'SESSION#')
    expect(Number(sessions[0].activeTime.N)).toBe(60_000)
  })
})
