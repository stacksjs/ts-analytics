/**
 * ts-analytics API Server
 *
 * A Bun-powered analytics API using bun-router.
 * Uses the full router from src/router.ts with all handler modules.
 */

import { createRouter } from '../src/router'
import { assignUnownedSites } from '../src/handlers/auth'
import { bootstrapJobs } from '../src/jobs'
import { startScheduler } from '../src/lib/scheduler'

// Configuration from environment. PORT (default 2027) is the API port; the
// dashboard's dev proxy targets it. Set it in .env to avoid local conflicts.
const PORT = Number.parseInt(process.env.PORT || '2027', 10)

console.log(`Starting ts-analytics API server...`)
console.log(`Table: ${process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'}`)
console.log(`Region: ${process.env.AWS_REGION || 'us-east-1'}`)
console.log(`Port: ${PORT}`)
console.log(`CORS: ${process.env.CORS_ORIGINS || '*'}`)

// Assign unowned sites to admin (if ADMIN_EMAIL is set)
await assignUnownedSites()

// Register periodic jobs. The in-process scheduler runs only when
// ANALYTICS_ENABLE_JOBS=true (otherwise drive it via POST /api/jobs/tick).
bootstrapJobs()
if (process.env.ANALYTICS_ENABLE_JOBS === 'true') {
  startScheduler()
  console.log('Scheduler: in-process loop enabled')
}

const router = await createRouter()
await router.serve({ port: PORT })
console.log(`\nts-analytics API running at http://localhost:${PORT}`)
