/**
 * Daily pre-aggregation rollups (#94).
 *
 * Dashboards used to re-scan every raw PAGEVIEW#/SESSION# item on each query.
 * A scheduled job now writes one ROLLUP#DAY#{YYYY-MM-DD} item per site per
 * complete day (views, unique visitors, sessions, bounces, duration, events),
 * and the heavy read paths (/stats, /timeseries) consume those — touching raw
 * events only for days without a rollup (today's live window, or gaps).
 *
 * Semantics note: a rollup stores that day's unique visitors; summing across
 * days counts a returning visitor once per day (Fathom-style "daily uniques"),
 * whereas the raw path deduplicates across the whole range. Counts converge
 * for single-day ranges and diverge slightly for multi-day ones.
 *
 * A day with no traffic still gets a zero rollup so it reads as covered —
 * otherwise empty days would be re-scanned forever.
 */
import { queryAllItems, querySessionItemsInRange, dynamodb, TABLE_NAME, marshall, unmarshall } from './dynamodb'

export interface DayRollup {
  day: string // YYYY-MM-DD
  views: number
  visitors: number
  sessions: number
  bounces: number
  totalDuration: number
  events: number
}

/** All YYYY-MM-DD keys touched by [start, end], inclusive. Pure — unit tested. */
export function dayKeysBetween(start: Date, end: Date): string[] {
  const days: string[] = []
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  const last = end.toISOString().slice(0, 10)
  while (true) {
    const key = cur.toISOString().slice(0, 10)
    days.push(key)
    if (key >= last)
      break
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return days
}

/** Whether a day is complete (strictly before today, UTC). Pure — unit tested. */
export function isCompleteDay(day: string, now: Date = new Date()): boolean {
  return day < now.toISOString().slice(0, 10)
}

/**
 * A day "settles" ROLLUP_SETTLE_DAYS after it completes. Only settled days may
 * be SERVED from a rollup — the most-recent complete day(s) stay on the live raw
 * path, so late-arriving events for an already-rolled day (unload beacons near
 * the midnight boundary, retries, clock skew) are counted immediately instead of
 * being silently dropped (#162). The rollup job recomputes the trailing window,
 * so longer-tail late events are folded in before a day becomes settled. Pure.
 */
export const ROLLUP_SETTLE_DAYS = 1
export function isSettledDay(day: string, now: Date = new Date()): boolean {
  const cutoff = new Date(now.getTime() - ROLLUP_SETTLE_DAYS * 24 * 60 * 60 * 1000)
  return day < cutoff.toISOString().slice(0, 10)
}

/**
 * Days whose full 24h window lies inside [start, end] — only these may be
 * served from a full-day rollup; partial first/last days must stay on the raw
 * path or counts would include hours outside the range. Pure — unit tested.
 */
export function fullyCoveredDays(start: Date, end: Date): string[] {
  const startIso = start.toISOString()
  const endIso = end.toISOString()
  return dayKeysBetween(start, end).filter((day) => {
    return startIso <= `${day}T00:00:00.000Z` && endIso >= `${day}T23:59:59.999Z`
  })
}

/** Compute a single day's rollup from raw pageviews + sessions. */
export async function computeDayRollup(siteId: string, day: string): Promise<DayRollup> {
  // Pageviews are timestamp-keyed → one bounded range query (paginated).
  const visitors = new Set<string>()
  let views = 0
  let lastKey: Record<string, any> | undefined
  do {
    const page = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${day}T00:00:00.000Z` },
        ':end': { S: `PAGEVIEW#${day}T23:59:59.999Z` },
      },
      ExclusiveStartKey: lastKey,
    }) as { Items?: any[], LastEvaluatedKey?: Record<string, any> }
    for (const raw of (page.Items || [])) {
      const pv = unmarshall(raw)
      views++
      if (pv.visitorId)
        visitors.add(pv.visitorId)
    }
    lastKey = page.LastEvaluatedKey
  } while (lastKey)

  let sessions = 0
  let bounces = 0
  let totalDuration = 0
  let events = 0
  // Day-bounded via the time-keyed GSI entry (#171): the rollup job used to
  // scan EVERY session per site per recomputed day.
  const dayStart = new Date(`${day}T00:00:00.000Z`)
  const dayEnd = new Date(`${day}T23:59:59.999Z`)
  {
    const page = await querySessionItemsInRange(siteId, dayStart, dayEnd)
    for (const raw of (page.Items || [])) {
      const s = unmarshall(raw)
      const startedDay = typeof s.startedAt === 'string' ? s.startedAt.slice(0, 10) : ''
      if (startedDay !== day)
        continue
      sessions++
      if (s.isBounce)
        bounces++
      // Real engaged time when departure pings exist (#167), else wall-clock.
      totalDuration += (s.activeTime > 0 ? s.activeTime : (s.duration || 0))
      events += s.eventCount || 0
    }
  }

  return { day, views, visitors: visitors.size, sessions, bounces, totalDuration, events }
}

/** Write a day's rollup item. */
export async function writeDayRollup(siteId: string, rollup: DayRollup): Promise<void> {
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `SITE#${siteId}`,
      sk: `ROLLUP#DAY#${rollup.day}`,
      ...rollup,
      computedAt: new Date().toISOString(),
    }),
  })
}

/** Read all day rollups for a site within [startDay, endDay] (YYYY-MM-DD). */
export async function readDayRollups(siteId: string, startDay: string, endDay: string): Promise<Map<string, DayRollup>> {
  const result = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':pk': { S: `SITE#${siteId}` },
      ':start': { S: `ROLLUP#DAY#${startDay}` },
      ':end': { S: `ROLLUP#DAY#${endDay}` },
    },
  }) as { Items?: any[] }

  const map = new Map<string, DayRollup>()
  for (const raw of (result.Items || [])) {
    const r = unmarshall(raw)
    if (r.day)
      map.set(r.day, r as DayRollup)
  }
  return map
}

/**
 * Recompute rollups for the last `daysBack` complete days of a site. Recomputing
 * the whole trailing window (rather than skipping existing rollups) folds in
 * events that arrived late for an already-rolled day, so they aren't silently
 * dropped (#162). Rollups are deterministic from raw events, so re-runs are
 * safe. Returns how many were written.
 */
export async function ensureDayRollups(siteId: string, daysBack = 3): Promise<number> {
  const now = new Date()
  const end = new Date(now.getTime() - 24 * 60 * 60 * 1000) // yesterday
  const start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)
  // Trailing settle window is always recomputed (late events, #162).
  const recompute = new Set(dayKeysBetween(start, end).filter(d => isCompleteDay(d, now)))

  // Fill-once: any older settled day within raw retention that's missing its
  // dimensional rollup gets computed before the raw rows TTL out (#172).
  const retentionStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000)
  const fillable = dayKeysBetween(retentionStart, end).filter(d => isSettledDay(d, now))
  if (fillable.length > 0) {
    const existingDims = await readDayDimRollups(siteId, fillable[0], fillable[fillable.length - 1])
    for (const day of fillable) {
      if (!existingDims.has(day))
        recompute.add(day)
    }
  }
  if (recompute.size === 0)
    return 0

  let written = 0
  for (const day of [...recompute].sort()) {
    const rollup = await computeDayRollup(siteId, day)
    await writeDayRollup(siteId, rollup)
    const dims = await computeDayDimRollup(siteId, day)
    await writeDayDimRollup(siteId, dims)
    written++
  }
  return written
}

/** Roll up every site's recent complete days (driven by the scheduled job). */
export async function runDailyRollups(daysBack = 3): Promise<number> {
  const sitesResult = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: 'SITES' } },
  }) as { Items?: any[] }

  let written = 0
  for (const raw of (sitesResult.Items || [])) {
    const site = unmarshall(raw)
    const siteId = site.id || site.siteId
    if (!siteId)
      continue
    try {
      written += await ensureDayRollups(siteId, daysBack)
    }
    catch (e) {
      console.error(`Rollup failed for site ${siteId}:`, (e as Error).message)
    }
  }
  return written
}

// ============================================================================
// Dimensional day rollups (#172)
//
// Raw rows TTL out (30d), and every breakdown panel read them exclusively —
// so Pages/Referrers/Devices/… silently shrank to a 30-day window while the
// totals above them showed the full range, and "All Time" was structurally
// impossible. One ROLLUP#DIMS#{day} item per site per settled day holds
// per-dimension aggregates forever; read paths serve a rolled prefix and
// aggregate raw only for the live tail (same pattern as handleGetStats).
// Filtered queries can't be answered from rollups and stay raw-only.
// ============================================================================

/** Per-key metric cells (short field names keep the item small). */
export interface DimCellPage { w: number, v: number, e: number }        // views, visitors, entries
export interface DimCellSource { v: number, w: number }                 // visitors, views
export interface DimCellVisitors { v: number }
export interface DimCellCampaign { v: number, s: number, src: string, med: string }
export interface DimCellEvent { c: number, v: number, val: number }
export interface DimCellEntry { s: number, b: number }
export interface DimCellExit { s: number }

export interface DayDimRollup {
  day: string
  pages: Record<string, DimCellPage>
  sources: Record<string, DimCellSource>
  devices: Record<string, DimCellVisitors>
  browsers: Record<string, DimCellVisitors>
  os: Record<string, DimCellVisitors>
  countries: Record<string, DimCellVisitors>
  /** Keyed `${country}:${region}` — mirrors handleGetRegions. */
  regions: Record<string, DimCellVisitors>
  /** Keyed `${country}:${region}:${city}` — mirrors handleGetCities. */
  cities: Record<string, DimCellVisitors>
  campaigns: Record<string, DimCellCampaign>
  events: Record<string, DimCellEvent>
  entries: Record<string, DimCellEntry>
  exits: Record<string, DimCellExit>
}

/** Cap each dimension's stored keys so the item stays far below 400KB. */
const DIM_CAP = 300

function capDim<T>(map: Record<string, T>, primary: (cell: T) => number, dim: string, siteId: string, day: string): Record<string, T> {
  const keys = Object.keys(map)
  if (keys.length <= DIM_CAP)
    return map
  console.warn(`[rollups] ${siteId} ${day} ${dim}: ${keys.length} keys, keeping top ${DIM_CAP}`)
  const kept = keys.sort((a, b) => primary(map[b]) - primary(map[a])).slice(0, DIM_CAP)
  const out: Record<string, T> = {}
  for (const k of kept) out[k] = map[k]
  return out
}

/** Compute one day's per-dimension aggregates (three bounded passes). */
export async function computeDayDimRollup(siteId: string, day: string): Promise<DayDimRollup> {
  const dayStart = new Date(`${day}T00:00:00.000Z`)
  const dayEnd = new Date(`${day}T23:59:59.999Z`)

  const pages: Record<string, { w: number, v: Set<string>, e: number }> = {}
  {
    const res = await queryAllItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${day}T00:00:00.000Z` },
        ':end': { S: `PAGEVIEW#${day}T23:59:59.999Z` },
      },
    })
    for (const raw of (res.Items || [])) {
      const pv = unmarshall(raw)
      const path = pv.path || '/'
      const cell = (pages[path] ||= { w: 0, v: new Set(), e: 0 })
      cell.w++
      if (pv.visitorId) cell.v.add(pv.visitorId)
      if (pv.isUnique) cell.e++
    }
  }

  const sources: Record<string, { v: Set<string>, w: number }> = {}
  const simple: Record<'devices' | 'browsers' | 'os' | 'countries', Record<string, Set<string>>>
    = { devices: {}, browsers: {}, os: {}, countries: {} }
  const regions: Record<string, Set<string>> = {}
  const cities: Record<string, Set<string>> = {}
  const campaigns: Record<string, { v: Set<string>, s: number, src: string, med: string }> = {}
  const entries: Record<string, DimCellEntry> = {}
  const exits: Record<string, DimCellExit> = {}
  {
    const res = await querySessionItemsInRange(siteId, dayStart, dayEnd)
    for (const raw of (res.Items || [])) {
      const sess = unmarshall(raw)
      if (typeof sess.startedAt === 'string' && sess.startedAt.slice(0, 10) !== day) continue
      const vid = sess.visitorId
      const source = sess.referrerSource || 'Direct'
      ;(sources[source] ||= { v: new Set(), w: 0 })
      if (vid) sources[source].v.add(vid)
      sources[source].w += sess.pageViewCount || 1
      const dims: Array<['devices' | 'browsers' | 'os' | 'countries', string | undefined]> = [
        ['devices', sess.deviceType], ['browsers', sess.browser], ['os', sess.os],
        ['countries', sess.country],
      ]
      for (const [dim, value] of dims) {
        // Countries omit empty values entirely (the report drops the Unknown
        // bucket); other dims keep the handlers' 'Unknown'/'unknown' fallback.
        if (dim === 'countries' && !value) continue
        const key = value || (dim === 'devices' ? 'unknown' : 'Unknown')
        ;(simple[dim][key] ||= new Set())
        if (vid) simple[dim][key].add(vid)
      }
      {
        // Composite keys mirror the handlers (Unknown buckets included there).
        const rKey = `${sess.country || 'Unknown'}:${sess.region || 'Unknown'}`
        ;(regions[rKey] ||= new Set())
        if (vid) regions[rKey].add(vid)
        const cKey = `${rKey}:${sess.city || 'Unknown'}`
        ;(cities[cKey] ||= new Set())
        if (vid) cities[cKey].add(vid)
      }
      if (sess.utmCampaign) {
        const c = (campaigns[sess.utmCampaign] ||= { v: new Set(), s: 0, src: sess.utmSource || '', med: sess.utmMedium || '' })
        if (vid) c.v.add(vid)
        c.s++
      }
      if (sess.entryPath) {
        const e = (entries[sess.entryPath] ||= { s: 0, b: 0 })
        e.s++
        if (sess.isBounce) e.b++
      }
      if (sess.exitPath) {
        const x = (exits[sess.exitPath] ||= { s: 0 })
        x.s++
      }
    }
  }

  const events: Record<string, { c: number, v: Set<string>, val: number }> = {}
  {
    const res = await queryAllItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `EVENT#${day}T00:00:00.000Z` },
        ':end': { S: `EVENT#${day}T23:59:59.999Z` },
      },
    })
    for (const raw of (res.Items || [])) {
      const ev = unmarshall(raw)
      const name = ev.name || 'unknown'
      const cell = (events[name] ||= { c: 0, v: new Set(), val: 0 })
      cell.c++
      if (ev.visitorId) cell.v.add(ev.visitorId)
      if (typeof ev.value === 'number') cell.val += ev.value
    }
  }

  const sized = <T, U>(m: Record<string, T>, f: (t: T) => U): Record<string, U> => {
    const out: Record<string, U> = {}
    for (const [k, cell] of Object.entries(m)) out[k] = f(cell)
    return out
  }

  return {
    day,
    pages: capDim(sized(pages, c => ({ w: c.w, v: c.v.size, e: c.e })), c => c.v, 'pages', siteId, day),
    sources: capDim(sized(sources, c => ({ v: c.v.size, w: c.w })), c => c.v, 'sources', siteId, day),
    devices: sized(simple.devices, set => ({ v: set.size })),
    browsers: capDim(sized(simple.browsers, set => ({ v: set.size })), c => c.v, 'browsers', siteId, day),
    os: sized(simple.os, set => ({ v: set.size })),
    countries: capDim(sized(simple.countries, set => ({ v: set.size })), c => c.v, 'countries', siteId, day),
    regions: capDim(sized(regions, set => ({ v: set.size })), c => c.v, 'regions', siteId, day),
    cities: capDim(sized(cities, set => ({ v: set.size })), c => c.v, 'cities', siteId, day),
    campaigns: capDim(sized(campaigns, c => ({ v: c.v.size, s: c.s, src: c.src, med: c.med })), c => c.v, 'campaigns', siteId, day),
    events: capDim(sized(events, c => ({ c: c.c, v: c.v.size, val: c.val })), c => c.c, 'events', siteId, day),
    entries: capDim(entries, c => c.s, 'entries', siteId, day),
    exits: capDim(exits, c => c.s, 'exits', siteId, day),
  }
}

/** Write a day's dimensional rollup item (no TTL — aggregates live forever). */
export async function writeDayDimRollup(siteId: string, rollup: DayDimRollup): Promise<void> {
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `SITE#${siteId}`,
      sk: `ROLLUP#DIMS#${rollup.day}`,
      ...rollup,
      computedAt: new Date().toISOString(),
    }),
  })
}

/** Read dimensional rollups for [startDay, endDay] (YYYY-MM-DD), keyed by day. */
export async function readDayDimRollups(siteId: string, startDay: string, endDay: string): Promise<Map<string, DayDimRollup>> {
  const result = await queryAllItems({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':pk': { S: `SITE#${siteId}` },
      ':start': { S: `ROLLUP#DIMS#${startDay}` },
      ':end': { S: `ROLLUP#DIMS#${endDay}~` },
    },
  })
  const map = new Map<string, DayDimRollup>()
  for (const raw of (result.Items || [])) {
    const item = unmarshall(raw) as DayDimRollup & { sk?: string }
    if (item.day) map.set(item.day, item)
  }
  return map
}

/**
 * The contiguous settled-day prefix of [startDate, endDate] that dimensional
 * rollups can serve, and where the raw tail begins — the same split
 * handleGetStats uses for its scalar rollups.
 */
export async function readDimRollupPrefix(siteId: string, startDate: Date, endDate: Date): Promise<{ days: DayDimRollup[], rawWindowStart: Date }> {
  const eligible = fullyCoveredDays(startDate, endDate).filter(d => isSettledDay(d))
  if (eligible.length === 0)
    return { days: [], rawWindowStart: startDate }
  const rollups = await readDayDimRollups(siteId, eligible[0], eligible[eligible.length - 1])
  const days: DayDimRollup[] = []
  for (const day of eligible) {
    const r = rollups.get(day)
    if (!r)
      break
    days.push(r)
  }
  if (days.length === 0)
    return { days: [], rawWindowStart: startDate }
  const next = new Date(`${days[days.length - 1].day}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return { days, rawWindowStart: next }
}
