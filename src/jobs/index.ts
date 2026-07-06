/**
 * Job registration bootstrap.
 *
 * Called once at startup to register every periodic job with the scheduler.
 * Feature jobs (error alerts #80, uptime checks #91, webhook delivery #92,
 * email digests #93) register here.
 */
import { registerJob } from '../lib/scheduler'
import { runUptimeChecks } from '../handlers/uptime'
import { sendDueEmailDigests } from '../handlers/alerts'
import { processWebhookDeliveries } from '../handlers/webhooks'
import { runDailyRollups } from '../lib/rollups'

let bootstrapped = false

export function bootstrapJobs(): void {
  if (bootstrapped)
    return
  bootstrapped = true

  // Heartbeat — proves the runtime ticks + persists last-run end to end.
  registerJob({
    name: 'heartbeat',
    intervalMs: 60_000,
    run: async () => {
      console.log(`[jobs] heartbeat ${new Date().toISOString()}`)
    },
  })

  // Ingest-drop watchdog (#175): a site whose collected-beacon count falls
  // off a cliff day-over-day is silently broken (CORS, firewall misconfig,
  // removed snippet) — exactly the failure mode that shipped twice unnoticed.
  registerJob({
    name: 'ingest-drop-watch',
    intervalMs: 60 * 60_000,
    run: async () => {
      const { queryAllItems, unmarshall, dynamodb, TABLE_NAME } = await import('../lib/dynamodb')
      const { log } = await import('../lib/log')
      const sitesRes = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: 'SITES' } },
      }) as { Items?: any[] }
      const now = Date.now()
      const hourIso = (ms: number): string => new Date(ms).toISOString().slice(0, 13)
      for (const raw of (sitesRes.Items || [])) {
        const site = unmarshall(raw)
        const siteId = site.id || site.siteId
        if (!siteId)
          continue
        const res = await queryAllItems({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
          ExpressionAttributeValues: {
            ':pk': { S: `SITE#${siteId}` },
            ':start': { S: `INGEST#${hourIso(now - 48 * 3600_000)}` },
            ':end': { S: `INGEST#${hourIso(now)}~` },
          },
        })
        let recent = 0
        let previous = 0
        for (const item of (res.Items || []).map(unmarshall)) {
          const hour = String(item.sk).slice('INGEST#'.length)
          const n = Number(item.collected || 0)
          if (hour >= hourIso(now - 24 * 3600_000))
            recent += n
          else previous += n
        }
        // Alert only with a meaningful baseline; 70%+ drop is a cliff.
        if (previous >= 100 && recent < previous * 0.3) {
          log.error('ingest.drop_detected', { siteId, previous24h: previous, recent24h: recent })
        }
      }
    },
  })

  // Uptime checks — probe each due monitor's URL and record up/down + latency,
  // notifying on a down transition (#91). Runs every minute; each monitor is
  // probed on its own configured interval.
  registerJob({
    name: 'uptime-checks',
    intervalMs: 60_000,
    run: async () => {
      const n = await runUptimeChecks()
      if (n > 0)
        console.log(`[jobs] uptime-checks: probed ${n} monitor(s)`)
    },
  })

  // Email digests — send each email-report on its schedule (daily/weekly/
  // monthly) with the period's pageview summary (#93). Checked hourly; the
  // per-report schedule gates the actual send.
  registerJob({
    name: 'email-digests',
    intervalMs: 60 * 60_000,
    run: async () => {
      const n = await sendDueEmailDigests()
      if (n > 0)
        console.log(`[jobs] email-digests: sent ${n} report(s)`)
    },
  })

  // Webhook delivery — drain the queue, POST each event (HMAC-signed) with
  // retry/backoff (#92).
  registerJob({
    name: 'webhook-delivery',
    intervalMs: 60_000,
    run: async () => {
      const n = await processWebhookDeliveries()
      if (n > 0)
        console.log(`[jobs] webhook-delivery: processed ${n} delivery(s)`)
    },
  })

  // Daily rollups — pre-aggregate each site's complete days so /stats and
  // /timeseries read O(buckets) instead of re-scanning raw events (#94).
  // Hourly cadence: idempotent, so most runs are no-ops once days are covered.
  registerJob({
    name: 'daily-rollups',
    intervalMs: 60 * 60_000,
    run: async () => {
      const n = await runDailyRollups()
      if (n > 0)
        console.log(`[jobs] daily-rollups: wrote ${n} day rollup(s)`)
    },
  })
}
