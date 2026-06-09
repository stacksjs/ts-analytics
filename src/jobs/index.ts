/**
 * Job registration bootstrap.
 *
 * Called once at startup to register every periodic job with the scheduler.
 * Feature jobs (error alerts #80, uptime checks #91, webhook delivery #92,
 * email digests #93) register here.
 */
import { registerJob } from '../lib/scheduler'
import { evaluateAllSitesErrorAlerts } from '../handlers/errors'
import { runUptimeChecks } from '../handlers/uptime'
import { sendDueEmailDigests } from '../handlers/alerts'

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

  // Error alerts — evaluate every site's error-rate / new-issue alerts and
  // notify (email + webhook) when they fire (#80).
  registerJob({
    name: 'error-alerts',
    intervalMs: 5 * 60_000,
    run: async () => {
      const n = await evaluateAllSitesErrorAlerts()
      if (n > 0)
        console.log(`[jobs] error-alerts: ${n} alert(s) triggered`)
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

  // Feature jobs append here in their own issues.
}
