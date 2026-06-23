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
import { dynamodb, TABLE_NAME, marshall, unmarshall } from './dynamodb'

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

  // Sessions are id-keyed (not time-keyed) so this scans the partition's
  // SESSION# items — bounded by their 90-day TTL, and it runs once per day in
  // the rollup job rather than on every dashboard query.
  let sessions = 0
  let bounces = 0
  let totalDuration = 0
  let events = 0
  lastKey = undefined
  do {
    const page = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
      ExclusiveStartKey: lastKey,
    }) as { Items?: any[], LastEvaluatedKey?: Record<string, any> }
    for (const raw of (page.Items || [])) {
      const s = unmarshall(raw)
      const startedDay = typeof s.startedAt === 'string' ? s.startedAt.slice(0, 10) : ''
      if (startedDay !== day)
        continue
      sessions++
      if (s.isBounce)
        bounces++
      totalDuration += s.duration || 0
      events += s.eventCount || 0
    }
    lastKey = page.LastEvaluatedKey
  } while (lastKey)

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
  const wanted = dayKeysBetween(start, end).filter(d => isCompleteDay(d, now))
  if (wanted.length === 0)
    return 0

  let written = 0
  for (const day of wanted) {
    const rollup = await computeDayRollup(siteId, day)
    await writeDayRollup(siteId, rollup)
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
