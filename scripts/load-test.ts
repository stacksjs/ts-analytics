/**
 * Load test (#98): ingest throughput + dashboard read latency.
 *
 * Phase 1 — INGEST: POSTs synthetic pageviews to /collect at a given
 * concurrency and reports throughput + latency percentiles.
 *
 * Phase 2 — SEED: batch-writes pageviews directly to DynamoDB spread over the
 * last N complete days (HTTP ingest always stamps "now", so past days must be
 * seeded directly) — this is what makes the raw-vs-rollup comparison real.
 *
 * Phase 3 — READS: measures /stats and /timeseries latency with rollups
 * absent (raw scans) and again after running the rollup job.
 *
 * Usage:
 *   bun scripts/load-test.ts [--site loadtest-98] [--api http://localhost:3001]
 *                            [--ingest 500] [--concurrency 25] [--seed 5000] [--days 5]
 *
 * NOTE: writes to the configured ANALYTICS_TABLE_NAME. Use a dedicated site id
 * and clean up afterwards with DELETE /api/sites/{siteId} (owner-only purge).
 */
import { dynamodb, TABLE_NAME, marshall } from '../src/lib/dynamodb'
import { ensureDayRollups, readDayRollups } from '../src/lib/rollups'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const SITE = arg('site', 'loadtest-98')
const API = arg('api', 'http://localhost:3001')
const INGEST_N = Number(arg('ingest', '500'))
const CONCURRENCY = Number(arg('concurrency', '25'))
const SEED_N = Number(arg('seed', '5000'))
const DAYS = Number(arg('days', '5'))

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0)
    return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function report(label: string, latencies: number[], totalMs: number): void {
  const sorted = [...latencies].sort((a, b) => a - b)
  const rps = (latencies.length / (totalMs / 1000)).toFixed(1)
  console.log(`${label}: n=${latencies.length} | ${rps} req/s | p50=${pct(sorted, 50).toFixed(1)}ms p95=${pct(sorted, 95).toFixed(1)}ms p99=${pct(sorted, 99).toFixed(1)}ms max=${sorted[sorted.length - 1]?.toFixed(1)}ms`)
}

// ── Phase 1: HTTP ingest ────────────────────────────────────────────────────
async function ingestPhase(): Promise<void> {
  console.log(`\n[1/3] Ingest: ${INGEST_N} pageviews → ${API}/collect (concurrency ${CONCURRENCY})`)
  const latencies: number[] = []
  let next = 0
  const t0 = performance.now()

  async function worker(w: number): Promise<void> {
    while (next < INGEST_N) {
      const i = next++
      const start = performance.now()
      const res = await fetch(`${API}/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `Mozilla/5.0 (LoadTest; worker ${w}) Chrome/126`, 'X-Forwarded-For': `10.0.${w}.${i % 250}` },
        body: JSON.stringify({ s: SITE, e: 'pageview', u: `https://${SITE}.example/page-${i % 20}`, sid: `lt-${w}-${Math.floor(i / 10)}` }),
      })
      latencies.push(performance.now() - start)
      if (res.status !== 204 && res.status !== 200)
        console.error(`  ingest ${i}: HTTP ${res.status}`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)))
  report('  ingest', latencies, performance.now() - t0)
}

// ── Phase 2: direct seed of past days ───────────────────────────────────────
async function seedPhase(): Promise<string[]> {
  console.log(`\n[2/3] Seed: ${SEED_N} pageviews across the last ${DAYS} complete days (direct batch-write)`)
  const days: string[] = []
  for (let d = 1; d <= DAYS; d++) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000)
    days.push(date.toISOString().slice(0, 10))
  }

  const perDay = Math.floor(SEED_N / DAYS)
  const t0 = performance.now()
  let written = 0
  for (const day of days) {
    const items: any[] = []
    for (let i = 0; i < perDay; i++) {
      const ts = `${day}T${String(Math.floor(i / 240) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}.000Z`
      const id = `lt-${day}-${i}`
      items.push({
        PutRequest: {
          Item: marshall({
            pk: `SITE#${SITE}`,
            sk: `PAGEVIEW#${ts}#${id}`,
            id,
            siteId: SITE,
            visitorId: `v-${day}-${i % 800}`,
            sessionId: `s-${day}-${Math.floor(i / 4)}`,
            path: `/page-${i % 20}`,
            hostname: `${SITE}.example`,
            isUnique: i % 4 === 0,
            isBounce: i % 4 === 0,
            timestamp: ts,
            _et: 'PageView',
            ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
          }),
        },
      })
    }
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25)
      await dynamodb.batchWriteItem({ RequestItems: { [TABLE_NAME]: chunk } })
      written += chunk.length
    }
    process.stdout.write(`  ${day}: ${perDay} written\n`)
  }
  console.log(`  total ${written} items in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
  return days
}

// ── Phase 3: read latency, raw vs rollups ───────────────────────────────────
async function measureReads(label: string): Promise<void> {
  const endpoints = [
    `/api/sites/${SITE}/stats?startDate=${new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()}`,
    `/api/sites/${SITE}/timeseries?period=day&startDate=${new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()}`,
  ]
  for (const ep of endpoints) {
    const latencies: number[] = []
    const t0 = performance.now()
    for (let i = 0; i < 10; i++) {
      const start = performance.now()
      const res = await fetch(`${API}${ep}&_nocache=${i}`)
      await res.text()
      latencies.push(performance.now() - start)
    }
    report(`  ${label} ${ep.split('?')[0].split('/').pop()}`, latencies, performance.now() - t0)
  }
}

async function readPhase(days: string[]): Promise<void> {
  console.log(`\n[3/3] Reads: raw scans vs rollups (cache disabled via unique query strings)`)

  // Ensure a clean raw baseline: remove any rollups for the seeded window.
  const existing = await readDayRollups(SITE, days[days.length - 1], days[0])
  for (const day of existing.keys()) {
    await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: { pk: { S: `SITE#${SITE}` }, sk: { S: `ROLLUP#DAY#${day}` } } })
  }
  await measureReads('RAW    ')

  const t0 = performance.now()
  const wrote = await ensureDayRollups(SITE, DAYS + 1)
  console.log(`  rollup job: ${wrote} day(s) computed in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
  await measureReads('ROLLUP ')
}

console.log(`Load test → site=${SITE} api=${API} table=${TABLE_NAME}`)
await ingestPhase()
const days = await seedPhase()
await readPhase(days)
console.log(`\nDone. Clean up with: curl -X DELETE ${API}/api/sites/${SITE}`)
