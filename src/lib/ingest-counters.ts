/**
 * Per-site hourly ingest counters (#175).
 *
 * Every beacon outcome — collected or dropped, and WHY — increments an
 * in-process buffer that flushes to one item per site per hour
 * (sk = INGEST#YYYY-MM-DDTHH) via atomic ADDs. This is what makes silent
 * ingest failures visible: the CORS bug shipped twice with nothing to detect
 * it because drops looked identical to no-traffic.
 *
 * Buffered (not per-event writes) so counting adds no per-beacon latency and
 * at most one WCU per site-hour-flush. A dying instance loses at most the
 * last FLUSH_MS of counts — acceptable for an ops signal.
 */
import { dynamodb, TABLE_NAME } from './dynamodb'
import { log } from './log'

export type IngestOutcome
  = 'collected' | 'bot' | 'firewall' | 'dedup' | 'invalid'
  | 'rate_limited' | 'excluded' | 'quota'

const FLUSH_MS = 15_000
const MAX_BUFFERED_KEYS = 500
const COUNTER_TTL_S = 90 * 24 * 60 * 60

// site|hour -> field -> pending increment
const buffer = new Map<string, Map<string, number>>()
let flushTimer: ReturnType<typeof setInterval> | null = null
let flushing = false

function hourKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13)
}

/** Sanitize a tracker version into a counter field name (v_1_2_3). */
function versionField(version: string): string {
  return `v_${version.replace(/[^\w.-]/g, '').replace(/[.-]/g, '_').slice(0, 24)}`
}

/** Count one beacon outcome for a site (buffered; flushes on a timer). */
export function recordIngest(siteId: string, outcome: IngestOutcome, trackerVersion?: string): void {
  if (!siteId)
    return
  const key = `${siteId}|${hourKey()}`
  let fields = buffer.get(key)
  if (!fields) {
    fields = new Map()
    buffer.set(key, fields)
  }
  fields.set(outcome, (fields.get(outcome) || 0) + 1)
  if (outcome === 'collected' && trackerVersion)
    fields.set(versionField(trackerVersion), (fields.get(versionField(trackerVersion)) || 0) + 1)

  if (!flushTimer) {
    flushTimer = setInterval(() => { void flushIngestCounters() }, FLUSH_MS)
    // Never keep the process alive just to flush counters.
    if (typeof (flushTimer as any).unref === 'function')
      (flushTimer as any).unref()
  }
  if (buffer.size > MAX_BUFFERED_KEYS)
    void flushIngestCounters()
}

/** Flush buffered counts to DynamoDB (atomic ADDs). Exported for tests/tick. */
export async function flushIngestCounters(): Promise<number> {
  if (flushing || buffer.size === 0)
    return 0
  flushing = true
  const entries = [...buffer.entries()]
  buffer.clear()
  let flushed = 0
  try {
    for (const [key, fields] of entries) {
      const [siteId, hour] = key.split('|')
      const names: Record<string, string> = {}
      const values: Record<string, unknown> = {}
      const adds: string[] = []
      let i = 0
      for (const [field, n] of fields) {
        names[`#f${i}`] = field
        values[`:f${i}`] = { N: String(n) }
        adds.push(`#f${i} :f${i}`)
        i++
      }
      names['#ttl'] = 'ttl'
      values[':ttl'] = { N: String(Math.floor(Date.now() / 1000) + COUNTER_TTL_S) }
      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: { pk: { S: `SITE#${siteId}` }, sk: { S: `INGEST#${hour}` } },
        UpdateExpression: `ADD ${adds.join(', ')} SET #ttl = if_not_exists(#ttl, :ttl)`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
      flushed++
    }
  }
  catch (e) {
    log.warn('ingest_counters.flush_failed', { error: (e as Error).message })
  }
  finally {
    flushing = false
  }
  return flushed
}

/** Hourly counter rows for a site over the trailing `hours` (default 48). */
export async function readIngestCounters(siteId: string, hours = 48): Promise<Array<Record<string, unknown>>> {
  const { queryAllItems, unmarshall } = await import('./dynamodb')
  const start = new Date(Date.now() - hours * 60 * 60 * 1000)
  const res = await queryAllItems({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':pk': { S: `SITE#${siteId}` },
      ':start': { S: `INGEST#${hourKey(start)}` },
      ':end': { S: `INGEST#${hourKey()}~` },
    },
  })
  return (res.Items || []).map(unmarshall).map((it: any) => {
    const { pk, sk, ttl, ...counts } = it
    return { hour: String(sk).slice('INGEST#'.length), ...counts }
  })
}
