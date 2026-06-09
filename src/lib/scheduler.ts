/**
 * Lightweight scheduled-jobs runtime.
 *
 * Features register periodic jobs (alerts, uptime checks, webhook delivery,
 * email digests). Last-run is persisted in DynamoDB (JOBS / JOB#{name}) so the
 * schedule survives restarts and is consistent across instances. Trigger it via
 * the in-process loop (startScheduler, single-instance/dev) or an external cron
 * hitting POST /api/jobs/tick (Lambda schedule / EventBridge).
 */
import { dynamodb, TABLE_NAME, unmarshall } from './dynamodb'

export interface Job {
  name: string
  intervalMs: number
  run: () => Promise<void>
}

const jobs: Job[] = []

export function registerJob(job: Job): void {
  if (!jobs.some(j => j.name === job.name))
    jobs.push(job)
}

export function registeredJobs(): Job[] {
  return jobs.slice()
}

/** Pure: whether a job is due given its last run (ms epoch, or null) + interval. */
export function isDue(lastRunMs: number | null, intervalMs: number, now: number): boolean {
  return lastRunMs === null || now - lastRunMs >= intervalMs
}

async function getLastRun(name: string): Promise<number | null> {
  try {
    const r = await dynamodb.getItem({ TableName: TABLE_NAME, Key: { pk: { S: 'JOBS' }, sk: { S: `JOB#${name}` } } })
    if (!r.Item)
      return null
    const v = unmarshall(r.Item).lastRun
    return typeof v === 'number' ? v : null
  }
catch {
    return null
  }
}

async function setLastRun(name: string, ts: number): Promise<void> {
  try {
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: { pk: { S: 'JOBS' }, sk: { S: `JOB#${name}` }, lastRun: { N: String(ts) }, updatedAt: { S: new Date(ts).toISOString() } },
    })
  }
catch (e) {
    console.error(`[jobs] setLastRun(${name}) failed:`, (e as Error).message)
  }
}

/** Run every job whose interval has elapsed. Returns which ran / were skipped / failed. */
export async function runDueJobs(now: number = Date.now()): Promise<{ ran: string[], skipped: string[], failed: string[] }> {
  const ran: string[] = []
  const skipped: string[] = []
  const failed: string[] = []
  for (const job of jobs) {
    const last = await getLastRun(job.name)
    if (!isDue(last, job.intervalMs, now)) {
      skipped.push(job.name)
      continue
    }
    try {
      await job.run()
      await setLastRun(job.name, now)
      ran.push(job.name)
    }
catch (e) {
      failed.push(job.name)
      console.error(`[jobs] ${job.name} failed:`, (e as Error).message)
    }
  }
  return { ran, skipped, failed }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Start the in-process tick loop (single-instance / dev). Idempotent. */
export function startScheduler(tickMs: number = 60_000): void {
  if (timer)
    return
  timer = setInterval(() => { void runDueJobs() }, tickMs)
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
