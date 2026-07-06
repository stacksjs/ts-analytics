/**
 * GA4 Data API importer — Phase B of #155.
 *
 * Pulls a property's full daily history straight from Google's Analytics
 * Data API and feeds it through the same write phase as the CSV importer
 * (collision policy, zero-fill, batched rollup writes).
 *
 * Auth is a SERVICE ACCOUNT key, not OAuth: the user creates a service
 * account in Google Cloud, grants its email Viewer access on the GA4
 * property, and pastes the JSON key. No consent screens, no app
 * verification, no refresh tokens. The key is used for this import only and
 * is NEVER persisted.
 *
 * Test seams: GA4_TOKEN_URL / GA4_API_BASE env overrides let the test
 * harness stand in for Google.
 */
import { type DayAccumulator, dayAcc, writeImportedDays, type GaImportResult } from './ga-import'

export interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri?: string
}

const TOKEN_URL = (): string => process.env.GA4_TOKEN_URL || 'https://oauth2.googleapis.com/token'
const API_BASE = (): string => process.env.GA4_API_BASE || 'https://analyticsdata.googleapis.com'

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PEM (PKCS8) → DER bytes (backed by a plain ArrayBuffer for WebCrypto). */
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(body)
  const buf = new ArrayBuffer(bin.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Exchange the service-account key for an access token (RS256 JWT grant). */
export async function getAccessToken(key: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: key.token_uri || TOKEN_URL(),
    iat: now,
    exp: now + 3600,
  }))
  const signingInput = `${header}.${claims}`
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(key.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput)))
  const jwt = `${signingInput}.${b64url(signature)}`

  const res = await fetch(TOKEN_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google token exchange failed (${res.status}): ${body.slice(0, 300)}`)
  }
  const data = await res.json() as { access_token?: string }
  if (!data.access_token)
    throw new Error('Google token exchange returned no access_token')
  return data.access_token
}

interface GaReportRow {
  dimensionValues?: Array<{ value?: string }>
  metricValues?: Array<{ value?: string }>
}

interface RunReportResponse {
  rows?: GaReportRow[]
  rowCount?: number
}

async function runReport(
  token: string,
  propertyId: string,
  body: Record<string, unknown>,
): Promise<GaReportRow[]> {
  const rows: GaReportRow[] = []
  const limit = 100_000
  let offset = 0
  for (let page = 0; page < 30; page++) {
    const res = await fetch(`${API_BASE()}/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, limit, offset }),
    })
    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`GA4 runReport failed (${res.status}): ${errBody.slice(0, 300)}`)
    }
    const data = await res.json() as RunReportResponse
    rows.push(...(data.rows || []))
    offset += limit
    if (!data.rows || data.rows.length < limit || rows.length >= (data.rowCount ?? rows.length))
      break
  }
  return rows
}

const nnum = (v: string | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function isoDay(gaDate: string | undefined): string | null {
  const m = String(gaDate || '').match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** The report set: one per rollup dimension family (+ daily scalars). */
export const GA4_REPORTS: Array<{ kind: string, dimensions: string[], metrics: string[] }> = [
  { kind: 'traffic', dimensions: ['date'], metrics: ['screenPageViews', 'activeUsers', 'sessions', 'bounceRate', 'averageSessionDuration', 'eventCount'] },
  { kind: 'pages', dimensions: ['date', 'pagePath'], metrics: ['screenPageViews', 'activeUsers'] },
  { kind: 'sources', dimensions: ['date', 'sessionSource'], metrics: ['activeUsers', 'sessions', 'screenPageViews'] },
  { kind: 'devices', dimensions: ['date', 'deviceCategory'], metrics: ['activeUsers'] },
  { kind: 'browsers', dimensions: ['date', 'browser'], metrics: ['activeUsers'] },
  { kind: 'os', dimensions: ['date', 'operatingSystem'], metrics: ['activeUsers'] },
  { kind: 'countries', dimensions: ['date', 'country'], metrics: ['activeUsers'] },
  { kind: 'regions', dimensions: ['date', 'country', 'region'], metrics: ['activeUsers'] },
  { kind: 'cities', dimensions: ['date', 'country', 'region', 'city'], metrics: ['activeUsers'] },
  { kind: 'events', dimensions: ['date', 'eventName'], metrics: ['eventCount', 'activeUsers'] },
]

/**
 * Fold one report's rows into the per-day accumulators. Pure — unit-testable
 * with canned API responses.
 */
export function foldReport(days: Map<string, DayAccumulator>, kind: string, rows: GaReportRow[]): number {
  let folded = 0
  for (const row of rows) {
    const dims = (row.dimensionValues || []).map(d => d.value || '')
    const mets = (row.metricValues || []).map(m => m.value)
    const day = isoDay(dims[0])
    if (!day)
      continue
    const acc = dayAcc(days, day)
    folded++
    if (kind === 'traffic') {
      acc.hasTraffic = true
      acc.scalars.views += nnum(mets[0])
      acc.scalars.visitors += nnum(mets[1])
      acc.scalars.sessions += nnum(mets[2])
      const sessions = nnum(mets[2]) || nnum(mets[1])
      acc.scalars.bounces += Math.round(sessions * nnum(mets[3])) // bounceRate is 0..1
      acc.scalars.totalDuration += Math.round(sessions * nnum(mets[4]) * 1000)
      acc.scalars.events += nnum(mets[5])
    }
    else if (kind === 'pages') {
      const path = dims[1] || '/'
      const cell = (acc.pages[path] ||= { w: 0, v: 0, e: 0 })
      cell.w += nnum(mets[0])
      cell.v += nnum(mets[1])
    }
    else if (kind === 'sources') {
      const raw = dims[1] || ''
      const source = !raw || /^\(direct\)$|^\(none\)$/i.test(raw) ? 'Direct' : raw
      const cell = (acc.sources[source] ||= { v: 0, w: 0 })
      cell.v += nnum(mets[0])
      cell.w += nnum(mets[2]) || nnum(mets[1])
    }
    else if (kind === 'events') {
      const name = dims[1] || 'unknown'
      const cell = (acc.events[name] ||= { c: 0, v: 0, val: 0 })
      cell.c += nnum(mets[0])
      cell.v += nnum(mets[1])
    }
    else if (kind === 'regions') {
      const key = `${dims[1] || 'Unknown'}:${dims[2] || 'Unknown'}`
      const cell = (acc.regions[key] ||= { v: 0 })
      cell.v += nnum(mets[0])
    }
    else if (kind === 'cities') {
      const key = `${dims[1] || 'Unknown'}:${dims[2] || 'Unknown'}:${dims[3] || 'Unknown'}`
      const cell = (acc.cities[key] ||= { v: 0 })
      cell.v += nnum(mets[0])
    }
    else if (kind === 'devices' || kind === 'browsers' || kind === 'os' || kind === 'countries') {
      let value = (dims[1] || '').trim()
      if (!value || value === '(not set)')
        continue
      if (kind === 'devices')
        value = value.toLowerCase()
      const cell = ((acc as any)[kind][value] ||= { v: 0 })
      cell.v += nnum(mets[0])
    }
  }
  return folded
}

export interface Ga4ApiImportOptions {
  propertyId: string
  serviceAccountKey: ServiceAccountKey
  /** ISO date; defaults to GA4's earliest possible day. */
  startDate?: string
  /** ISO date; defaults to yesterday. */
  endDate?: string
}

/** Pull the property's history from the Data API and import it. */
export async function importFromGa4Api(siteId: string, options: Ga4ApiImportOptions): Promise<GaImportResult> {
  const propertyId = options.propertyId.replace(/^properties\//, '').trim()
  if (!/^\d+$/.test(propertyId))
    throw new Error('propertyId must be the numeric GA4 property id')
  const token = await getAccessToken(options.serviceAccountKey)

  const dateRange = {
    startDate: options.startDate || '2015-08-14',
    endDate: options.endDate || 'yesterday',
  }

  const days = new Map<string, DayAccumulator>()
  const files: GaImportResult['files'] = []
  for (const report of GA4_REPORTS) {
    const rows = await runReport(token, propertyId, {
      dateRanges: [dateRange],
      dimensions: report.dimensions.map(name => ({ name })),
      metrics: report.metrics.map(name => ({ name })),
    })
    const folded = foldReport(days, report.kind, rows)
    files.push({ name: `ga4-api:${report.kind}`, kind: report.kind, rows: folded, days: 0 })
  }

  const write = await writeImportedDays(siteId, days)
  return { files, ...write }
}
