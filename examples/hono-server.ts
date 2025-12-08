/**
 * Hono Server Example
 *
 * A complete example of running analytics with Hono and Bun.
 *
 * Run: bun run examples/hono-server.ts
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

import type { Session, SessionStore } from '../src'
import {
  analyticsMiddleware,
  defineConfig,
  generateLocalCreateTableInput,
  mountAnalyticsRoutes,
  printLocalSetupInstructions,
  setConfig,
} from '../src'

// ============================================================================
// Configuration
// ============================================================================

const config = defineConfig({
  table: {
    tableName: process.env.DYNAMODB_TABLE || 'AnalyticsTable',
  },
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
  api: {
    basePath: '/api/analytics',
    corsOrigins: ['*'],
  },
})

setConfig(config)

// ============================================================================
// DynamoDB Client (mock for example)
// ============================================================================

// In production, use @aws-sdk/client-dynamodb
// import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
// const client = new DynamoDBClient({ region: config.region, endpoint: config.endpoint })

// Mock in-memory store for demonstration
const mockStore = new Map<string, unknown>()

async function executeCommand(cmd: { command: string, input: Record<string, unknown> }): Promise<unknown> {
  console.log(`[DynamoDB] ${cmd.command}:`, JSON.stringify(cmd.input, null, 2).slice(0, 200))

  switch (cmd.command) {
    case 'PutItem': {
      const item = cmd.input.Item as Record<string, { S?: string }>
      const pk = item.pk?.S
      const sk = item.sk?.S
      if (pk && sk) {
        mockStore.set(`${pk}#${sk}`, item)
      }
      return {}
    }
    case 'Query': {
      const items: unknown[] = []
      // Simple mock - return empty for demo
      return { Items: items }
    }
    default:
      return {}
  }
}

// ============================================================================
// Session Store (in-memory for example)
// ============================================================================

const sessionCache = new Map<string, { session: Session, expires: number }>()

const sessionStore: SessionStore = {
  async get(key: string): Promise<Session | null> {
    const entry = sessionCache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expires) {
      sessionCache.delete(key)
      return null
    }
    return entry.session
  },
  async set(key: string, session: Session, ttlSeconds = 1800): Promise<void> {
    sessionCache.set(key, {
      session,
      expires: Date.now() + ttlSeconds * 1000,
    })
  },
  async delete(key: string): Promise<void> {
    sessionCache.delete(key)
  },
}

// ============================================================================
// Hono App
// ============================================================================

const app = new Hono()

// Built-in middleware
app.use('*', logger())
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}))

// Analytics middleware
app.use('*', analyticsMiddleware({
  skipPaths: ['/health', '/favicon.ico'],
}))

// Mount analytics routes
mountAnalyticsRoutes(app, '/api/analytics', {
  executeCommand,
  sessionStore,
})

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Root route with setup info
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Analytics Server</title>
      <style>
        body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
        pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
        h1 { color: #333; }
        .endpoint { margin: 10px 0; }
        .method { font-weight: bold; color: #0066cc; }
      </style>
    </head>
    <body>
      <h1>Analytics Server</h1>
      <p>Privacy-first analytics API running on Hono + Bun</p>

      <h2>Endpoints</h2>
      <div class="endpoint">
        <span class="method">POST</span> <code>/api/analytics/collect</code> - Track events
      </div>
      <div class="endpoint">
        <span class="method">GET</span> <code>/api/analytics/sites/:siteId/stats</code> - Get stats
      </div>
      <div class="endpoint">
        <span class="method">GET</span> <code>/api/analytics/sites/:siteId/realtime</code> - Realtime data
      </div>
      <div class="endpoint">
        <span class="method">GET</span> <code>/api/analytics/sites/:siteId/script</code> - Tracking script
      </div>
      <div class="endpoint">
        <span class="method">GET</span> <code>/api/analytics/sites</code> - List sites
      </div>
      <div class="endpoint">
        <span class="method">POST</span> <code>/api/analytics/sites</code> - Create site
      </div>

      <h2>Quick Start</h2>
      <pre>
# Create a site
curl -X POST http://localhost:3000/api/analytics/sites \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My Site", "domains": ["example.com"]}'

# Track a page view
curl -X POST http://localhost:3000/api/analytics/collect \\
  -H "Content-Type: application/json" \\
  -d '{
    "s": "SITE_ID",
    "sid": "session_123",
    "e": "pageview",
    "u": "https://example.com/page"
  }'
      </pre>

      <h2>Configuration</h2>
      <pre>
Table: ${config.table.tableName}
Region: ${config.region}
Endpoint: ${config.endpoint || 'AWS Default'}
      </pre>
    </body>
    </html>
  `)
})

// Setup instructions route
app.get('/setup', (c) => {
  const tableInput = generateLocalCreateTableInput(config)
  return c.json({
    instructions: 'Run these commands to set up DynamoDB Local',
    table: tableInput,
    dockerCompose: `docker run -p 8000:8000 amazon/dynamodb-local`,
  })
})

// ============================================================================
// Start Server
// ============================================================================

const port = Number.parseInt(process.env.PORT || '3000', 10)

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    Analytics Server Starting                       ║
╚═══════════════════════════════════════════════════════════════════╝

  Server:    http://localhost:${port}
  Table:     ${config.table.tableName}
  DynamoDB:  ${config.endpoint || 'AWS Default'}

  Endpoints:
    POST /api/analytics/collect     - Track events
    GET  /api/analytics/sites       - List sites
    POST /api/analytics/sites       - Create site
    GET  /setup                     - Setup instructions

`)

// For Bun - start the server
Bun.serve({
  port,
  fetch: app.fetch,
})
