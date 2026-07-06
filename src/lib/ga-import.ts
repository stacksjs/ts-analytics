/**
 * GA4 CSV importer — Phase A of #155.
 *
 * Migrating users start from zero history; this backfills it WITHOUT
 * fabricating raw events: GA4 exports are daily aggregates by dimension,
 * which map 1:1 onto the rollup store the dashboard already reads for
 * settled days (#172) — ROLLUP#DAY (scalars) + ROLLUP#DIMS (breakdowns).
 * Even the uniques semantics line up: GA reports daily users and our
 * invariant is "uniques = sum of daily uniques".
 *
 * Input: one or more CSVs exported from GA4 (Explorations or the report UI
 * with a Date dimension added; UA exports with the same columns also work).
 * Files are auto-detected by header:
 *   - traffic:  Date + Views/Users/Sessions (+ optional bounce/duration/events)
 *   - pages:    Date + Page path + Views (+ Users)
 *   - sources:  Date + Session source|Channel group + Users (+ Views|Sessions)
 *   - devices/browsers/os/countries/regions/cities: Date + that dimension + Users
 *   - events:   Date + Event name + Event count (+ Users)
 *
 * Import policy (honest + idempotent):
 *   - A day that already has a REAL (tracked) rollup is never overwritten;
 *     re-importing over previous imports is fine (items carry source:'ga-import').
 *   - Incomplete days (today onward) are skipped.
 *   - The imported span is zero-filled through yesterday so the dashboard's
 *     contiguous-settled-prefix reads (#172) never die at a gap between the
 *     end of GA history and the start of live tracking.
 */
import { dynamodb, marshall, TABLE_NAME, unmarshall } from './dynamodb'

export interface GaImportFileResult {
  name: string
  kind: string
  rows: number
  days: number
}

export interface GaImportResult {
  files: GaImportFileResult[]
  daysWritten: number
  daysSkipped: string[]
  zeroFilled: number
  span: { start: string, end: string } | null
}

/** Minimal CSV parser: quoted fields, embedded commas/quotes, CRLF, BOM, and GA's leading # comment lines. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        }
        else {
          inQuotes = false
        }
      }
      else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    }
    else if (c === ',') {
      row.push(field)
      field = ''
    }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n')
        i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '')
        rows.push(row)
      row = []
    }
    else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '')
      rows.push(row)
  }
  // GA4 prepends metadata lines starting with '#' — drop them.
  return rows.filter(r => !String(r[0] || '').trimStart().startsWith('#'))
}

/** Normalize a header for matching: lowercase, alphanumerics only. */
function norm(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Column aliases (GA4 + UA English exports + our canonical names). */
const COLS: Record<string, string[]> = {
  date: ['date', 'day'],
  views: ['views', 'screenpageviews', 'pageviews', 'viewsperpage'],
  visitors: ['activeusers', 'totalusers', 'users', 'visitors', 'people'],
  sessions: ['sessions', 'visits'],
  bounceRate: ['bouncerate'],
  engagementRate: ['engagementrate'],
  avgSessionSeconds: ['averagesessionduration', 'avgsessionduration'],
  eventCount: ['eventcount', 'events', 'totalevents'],
  page: ['pagepathandscreenclass', 'pagepath', 'pagepathscreenclass', 'landingpage', 'page'],
  source: ['sessionsource', 'firstusersource', 'sessiondefaultchannelgroup', 'sessiondefaultchannelgrouping', 'defaultchannelgroup', 'source', 'referrersource'],
  device: ['devicecategory', 'device'],
  browser: ['browser'],
  os: ['operatingsystem', 'os'],
  country: ['country'],
  region: ['region'],
  city: ['city', 'town'],
  eventName: ['eventname'],
}

function findCol(headers: string[], key: string): number {
  const wanted = COLS[key]
  for (let i = 0; i < headers.length; i++) {
    if (wanted.includes(norm(headers[i])))
      return i
  }
  return -1
}

/** '20260101', '2026-01-01', or '01/01/2026' (UA) → '2026-01-01' (or null). */
export function parseGaDate(value: string): string | null {
  const v = value.trim()
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m)
    return `${m[1]}-${m[2]}-${m[3]}`
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m)
    return v
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m)
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}

function num(value: string | undefined): number {
  if (value === undefined)
    return 0
  const v = value.replace(/[%,\s]/g, '').replace(/^</, '')
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Rate cells come as '0.42', '42%', or '42.0' — normalize to 0..1. */
function rate(value: string | undefined): number {
  const n = num(value)
  return n > 1 ? n / 100 : n
}

export type GaFileKind
  = 'traffic' | 'pages' | 'sources' | 'devices' | 'browsers' | 'os'
  | 'countries' | 'regions' | 'cities' | 'events' | 'unknown'

export function detectKind(headers: string[]): GaFileKind {
  if (findCol(headers, 'date') === -1)
    return 'unknown'
  if (findCol(headers, 'page') !== -1)
    return 'pages'
  if (findCol(headers, 'eventName') !== -1)
    return 'events'
  if (findCol(headers, 'source') !== -1)
    return 'sources'
  if (findCol(headers, 'city') !== -1)
    return 'cities'
  if (findCol(headers, 'region') !== -1)
    return 'regions'
  if (findCol(headers, 'country') !== -1)
    return 'countries'
  if (findCol(headers, 'browser') !== -1)
    return 'browsers'
  if (findCol(headers, 'os') !== -1)
    return 'os'
  if (findCol(headers, 'device') !== -1)
    return 'devices'
  if (findCol(headers, 'views') !== -1 || findCol(headers, 'visitors') !== -1 || findCol(headers, 'sessions') !== -1)
    return 'traffic'
  return 'unknown'
}

export interface DayAccumulator {
  scalars: { views: number, visitors: number, sessions: number, bounces: number, totalDuration: number, events: number }
  hasTraffic: boolean
  pages: Record<string, { w: number, v: number, e: number }>
  sources: Record<string, { v: number, w: number }>
  devices: Record<string, { v: number }>
  browsers: Record<string, { v: number }>
  os: Record<string, { v: number }>
  countries: Record<string, { v: number }>
  regions: Record<string, { v: number }>
  cities: Record<string, { v: number }>
  events: Record<string, { c: number, v: number, val: number }>
}

export function dayAcc(days: Map<string, DayAccumulator>, day: string): DayAccumulator {
  let acc = days.get(day)
  if (!acc) {
    acc = {
      scalars: { views: 0, visitors: 0, sessions: 0, bounces: 0, totalDuration: 0, events: 0 },
      hasTraffic: false,
      pages: {},
      sources: {},
      devices: {},
      browsers: {},
      os: {},
      countries: {},
      regions: {},
      cities: {},
      events: {},
    }
    days.set(day, acc)
  }
  return acc
}

/**
 * Parse the provided files into per-day rollup data. Pure — unit-testable
 * without DynamoDB.
 */
export function buildDailyData(files: Array<{ name: string, content: string }>): { days: Map<string, DayAccumulator>, results: GaImportFileResult[] } {
  const days = new Map<string, DayAccumulator>()
  const results: GaImportFileResult[] = []

  for (const file of files) {
    const rows = parseCsv(file.content)
    if (rows.length < 2) {
      results.push({ name: file.name, kind: 'unknown', rows: 0, days: 0 })
      continue
    }
    const headers = rows[0]
    const kind = detectKind(headers)
    const dateCol = findCol(headers, 'date')
    const daysSeen = new Set<string>()
    let parsed = 0
    if (kind === 'unknown') {
      results.push({ name: file.name, kind, rows: 0, days: 0 })
      continue
    }

    const col = (key: string): number => findCol(headers, key)
    const cViews = col('views')
    const cVisitors = col('visitors')
    const cSessions = col('sessions')
    const cBounce = col('bounceRate')
    const cEngage = col('engagementRate')
    const cAvgDur = col('avgSessionSeconds')
    const cEvents = col('eventCount')

    for (const row of rows.slice(1)) {
      const day = parseGaDate(String(row[dateCol] ?? ''))
      if (!day)
        continue // Totals/blank rows GA appends
      const acc = dayAcc(days, day)
      daysSeen.add(day)
      parsed++
      const views = num(row[cViews])
      const visitors = num(row[cVisitors])
      const sessions = num(row[cSessions])

      if (kind === 'traffic') {
        acc.hasTraffic = true
        acc.scalars.views += views
        acc.scalars.visitors += visitors
        acc.scalars.sessions += sessions
        acc.scalars.events += num(row[cEvents])
        const sess = sessions || visitors
        if (cBounce !== -1)
          acc.scalars.bounces += Math.round(sess * rate(row[cBounce]))
        else if (cEngage !== -1)
          acc.scalars.bounces += Math.round(sess * (1 - rate(row[cEngage])))
        if (cAvgDur !== -1)
          acc.scalars.totalDuration += Math.round(sess * num(row[cAvgDur]) * 1000)
      }
      else if (kind === 'pages') {
        const path = String(row[col('page')] || '').trim() || '/'
        const cell = (acc.pages[path] ||= { w: 0, v: 0, e: 0 })
        cell.w += views || visitors
        cell.v += visitors
      }
      else if (kind === 'sources') {
        const raw = String(row[col('source')] || '').trim()
        const source = !raw || /^\(direct\)$|^direct$|^\(none\)$/i.test(raw) ? 'Direct' : raw
        const cell = (acc.sources[source] ||= { v: 0, w: 0 })
        cell.v += visitors || sessions
        cell.w += views || sessions || visitors
      }
      else if (kind === 'events') {
        const name = String(row[col('eventName')] || '').trim() || 'unknown'
        const cell = (acc.events[name] ||= { c: 0, v: 0, val: 0 })
        cell.c += num(row[cEvents]) || views || 1
        cell.v += visitors
      }
      else if (kind === 'regions') {
        const region = String(row[col('region')] || '').trim() || 'Unknown'
        const country = String(row[col('country')] || '').trim() || 'Unknown'
        const key = `${country}:${region}`
        const cell = (acc.regions[key] ||= { v: 0 })
        cell.v += visitors || sessions
      }
      else if (kind === 'cities') {
        const city = String(row[col('city')] || '').trim() || 'Unknown'
        const region = String(row[col('region')] || '').trim() || 'Unknown'
        const country = String(row[col('country')] || '').trim() || 'Unknown'
        const key = `${country}:${region}:${city}`
        const cell = (acc.cities[key] ||= { v: 0 })
        cell.v += visitors || sessions
      }
      else {
        // Single-key visitor dimensions: devices/browsers/os/countries.
        const colKey = kind === 'devices' ? 'device' : kind === 'browsers' ? 'browser' : kind === 'os' ? 'os' : 'country'
        let value = String(row[col(colKey)] || '').trim()
        if (!value)
          continue
        if (kind === 'devices')
          value = value.toLowerCase()
        const cell = ((acc as any)[kind][value] ||= { v: 0 })
        cell.v += visitors || sessions
      }
    }
    results.push({ name: file.name, kind, rows: parsed, days: daysSeen.size })
  }
  return { days, results }
}

/**
 * When no traffic file was provided, derive day scalars from the dimension
 * files (documented approximation): views from pages, visitors/sessions from
 * sources (each session has exactly one source, so per-source user counts sum
 * to ~daily users — the same semantics our own rollups use).
 */
function deriveScalars(acc: DayAccumulator): void {
  if (acc.hasTraffic)
    return
  const pageViews = Object.values(acc.pages).reduce((sum, c) => sum + c.w, 0)
  const sourceVisitors = Object.values(acc.sources).reduce((sum, c) => sum + c.v, 0)
  const dimVisitors = Object.values(acc.devices).reduce((sum, c) => sum + c.v, 0)
  acc.scalars.views = pageViews
  acc.scalars.visitors = sourceVisitors || dimVisitors
  acc.scalars.sessions = sourceVisitors || dimVisitors
  acc.scalars.events = Object.values(acc.events).reduce((sum, c) => sum + c.c, 0)
}

/** Write the parsed CSV files into the rollup store. */
export async function importGaData(siteId: string, files: Array<{ name: string, content: string }>): Promise<GaImportResult> {
  const { days, results } = buildDailyData(files)
  const write = await writeImportedDays(siteId, days)
  return { files: results, ...write }
}

/**
 * Shared write phase for both import paths (CSV + Data API): collision policy,
 * zero-fill, and batched rollup writes.
 */
export async function writeImportedDays(siteId: string, days: Map<string, DayAccumulator>): Promise<Omit<GaImportResult, 'files'>> {
  const today = new Date().toISOString().slice(0, 10)
  const importedDays = [...days.keys()].filter(d => d < today).sort()
  if (importedDays.length === 0)
    return { daysWritten: 0, daysSkipped: [], zeroFilled: 0, span: null }

  // Zero-fill from the span start through YESTERDAY so contiguous-prefix
  // reads never break between GA history and live tracking (#172).
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const allDays: string[] = []
  const cursor = new Date(`${importedDays[0]}T00:00:00.000Z`)
  while (cursor.toISOString().slice(0, 10) <= yesterday) {
    allDays.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  // Never overwrite a day that has a REAL (tracked) rollup.
  const existingReal = new Set<string>()
  {
    const res = await import('./dynamodb').then(m => m.queryAllItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ROLLUP#DAY#${allDays[0]}` },
        ':end': { S: `ROLLUP#DAY#${allDays[allDays.length - 1]}~` },
      },
    }))
    for (const raw of (res.Items || [])) {
      const item = unmarshall(raw)
      if (item.source !== 'ga-import' && item.day)
        existingReal.add(item.day)
    }
  }

  let daysWritten = 0
  let zeroFilled = 0
  const daysSkipped: string[] = []
  const empty = (): DayAccumulator => dayAcc(new Map(), 'x')

  // Batched writes (25/request — the BatchWriteItem cap): a multi-year import
  // is ~1,500 items, which as sequential puts would blow API-gateway timeouts.
  const pending: Record<string, unknown>[] = []
  const now = new Date().toISOString()
  for (const day of allDays) {
    if (existingReal.has(day)) {
      if (days.has(day))
        daysSkipped.push(day)
      continue
    }
    const acc = days.get(day) ?? empty()
    deriveScalars(acc)
    pending.push({
      pk: `SITE#${siteId}`,
      sk: `ROLLUP#DAY#${day}`,
      day,
      ...acc.scalars,
      source: 'ga-import',
      computedAt: now,
    })
    pending.push({
      pk: `SITE#${siteId}`,
      sk: `ROLLUP#DIMS#${day}`,
      day,
      pages: acc.pages,
      sources: acc.sources,
      devices: acc.devices,
      browsers: acc.browsers,
      os: acc.os,
      countries: acc.countries,
      regions: acc.regions,
      cities: acc.cities,
      campaigns: {},
      events: acc.events,
      entries: {},
      exits: {},
      source: 'ga-import',
      computedAt: now,
    })
    if (days.has(day))
      daysWritten++
    else zeroFilled++
  }

  for (let i = 0; i < pending.length; i += 25) {
    const batch = pending.slice(i, i + 25)
    let unprocessed = batch.map(item => ({ PutRequest: { Item: marshall(item) } }))
    // Retry unprocessed items (throughput spikes) a few times before failing.
    for (let attempt = 0; unprocessed.length > 0 && attempt < 5; attempt++) {
      const res = await dynamodb.batchWriteItem({
        RequestItems: { [TABLE_NAME]: unprocessed },
      }) as { UnprocessedItems?: Record<string, any[]> }
      unprocessed = res.UnprocessedItems?.[TABLE_NAME] || []
      if (unprocessed.length > 0)
        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)))
    }
    if (unprocessed.length > 0)
      throw new Error(`Import incomplete: ${unprocessed.length} items unwritten after retries`)
  }

  return {
    daysWritten,
    daysSkipped,
    zeroFilled,
    span: { start: allDays[0], end: allDays[allDays.length - 1] },
  }
}
