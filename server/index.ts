/**
 * ts-analytics API Server
 *
 * A Bun-powered analytics API using bun-router.
 * Uses the full router from src/router.ts with all handler modules.
 */

import { createRouter } from '../src/router'
import { assignUnownedSites } from '../src/handlers/auth'

// Configuration from environment
const PORT = Number.parseInt(process.env.PORT || '3001', 10)

console.log(`Starting ts-analytics API server...`)
console.log(`Table: ${process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'}`)
console.log(`Region: ${process.env.AWS_REGION || 'us-east-1'}`)
console.log(`Port: ${PORT}`)
console.log(`CORS: ${process.env.CORS_ORIGINS || '*'}`)

// Assign unowned sites to admin (if ADMIN_EMAIL is set)
await assignUnownedSites()

const router = await createRouter()
await router.serve({ port: PORT })
console.log(`\nts-analytics API running at http://localhost:${PORT}`)
