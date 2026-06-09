/**
 * Job registration bootstrap.
 *
 * Called once at startup to register every periodic job with the scheduler.
 * Feature jobs (error alerts #80, uptime checks #91, webhook delivery #92,
 * email digests #93) register here.
 */
import { registerJob } from '../lib/scheduler'

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

  // Feature jobs append here in their own issues.
}
