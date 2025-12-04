/**
 * Local Development Utilities
 *
 * Helpers for running analytics locally with DynamoDB Local.
 * Uses dynamodb-tooling for DynamoDB Local management.
 */

import type { AnalyticsConfig } from './config'
import { getConfig } from './config'

// ============================================================================
// Local DynamoDB Configuration
// ============================================================================

export interface LocalDynamoDBConfig {
  /** Port for DynamoDB Local (default: 8000) */
  port: number
  /** Region to use (default: us-east-1) */
  region: string
  /** Endpoint URL */
  endpoint: string
  /** Whether to use shared database mode */
  sharedDb: boolean
  /** Path to store data (empty for in-memory) */
  dbPath: string
}

export const defaultLocalConfig: LocalDynamoDBConfig = {
  port: 8000,
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  sharedDb: true,
  dbPath: '',
}

// ============================================================================
// Table Creation
// ============================================================================

/**
 * Generate CreateTable input for analytics table (local development)
 */
export function generateLocalCreateTableInput(config?: AnalyticsConfig): {
  TableName: string
  KeySchema: Array<{ AttributeName: string, KeyType: 'HASH' | 'RANGE' }>
  AttributeDefinitions: Array<{ AttributeName: string, AttributeType: 'S' | 'N' | 'B' }>
  BillingMode: string
  GlobalSecondaryIndexes?: Array<{
    IndexName: string
    KeySchema: Array<{ AttributeName: string, KeyType: 'HASH' | 'RANGE' }>
    Projection: { ProjectionType: string }
  }>
} {
  const cfg = config ?? getConfig()
  const { singleTable } = cfg.table

  const input: ReturnType<typeof generateLocalCreateTableInput> = {
    TableName: cfg.table.tableName,
    KeySchema: [
      { AttributeName: singleTable.partitionKeyName, KeyType: 'HASH' },
      { AttributeName: singleTable.sortKeyName, KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: singleTable.partitionKeyName, AttributeType: 'S' },
      { AttributeName: singleTable.sortKeyName, AttributeType: 'S' },
      { AttributeName: singleTable.gsi1pkName, AttributeType: 'S' },
      { AttributeName: singleTable.gsi1skName, AttributeType: 'S' },
      { AttributeName: singleTable.gsi2pkName, AttributeType: 'S' },
      { AttributeName: singleTable.gsi2skName, AttributeType: 'S' },
    ],
    BillingMode: cfg.table.billingMode,
    GlobalSecondaryIndexes: [
      {
        IndexName: 'gsi1',
        KeySchema: [
          { AttributeName: singleTable.gsi1pkName, KeyType: 'HASH' },
          { AttributeName: singleTable.gsi1skName, KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'gsi2',
        KeySchema: [
          { AttributeName: singleTable.gsi2pkName, KeyType: 'HASH' },
          { AttributeName: singleTable.gsi2skName, KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  }

  return input
}

/**
 * Generate AWS CLI command to create the table
 */
export function generateAwsCliCommand(config?: AnalyticsConfig): string {
  const input = generateLocalCreateTableInput(config)

  const command = [
    'aws dynamodb create-table',
    `--table-name ${input.TableName}`,
    `--attribute-definitions '${JSON.stringify(input.AttributeDefinitions)}'`,
    `--key-schema '${JSON.stringify(input.KeySchema)}'`,
    `--billing-mode ${input.BillingMode}`,
    `--global-secondary-indexes '${JSON.stringify(input.GlobalSecondaryIndexes)}'`,
    '--endpoint-url http://localhost:8000',
    '--region us-east-1',
  ]

  return command.join(' \\\n  ')
}

// ============================================================================
// Docker Compose
// ============================================================================

/**
 * Generate docker-compose.yml for local development
 */
export function generateDockerCompose(localConfig: Partial<LocalDynamoDBConfig> = {}): string {
  const cfg = { ...defaultLocalConfig, ...localConfig }

  return `version: '3.8'

services:
  dynamodb-local:
    image: amazon/dynamodb-local:latest
    container_name: analytics-dynamodb
    ports:
      - "${cfg.port}:8000"
    command: ["-jar", "DynamoDBLocal.jar"${cfg.sharedDb ? ', "-sharedDb"' : ''}${cfg.dbPath ? `, "-dbPath", "/data"` : ''}]
    ${cfg.dbPath
      ? `volumes:
      - ./data/dynamodb:/data`
      : ''}
    networks:
      - analytics-network

networks:
  analytics-network:
    driver: bridge
`
}

// ============================================================================
// Seed Data
// ============================================================================

export interface SeedDataOptions {
  /** Number of sites to create */
  sites: number
  /** Number of page views per site */
  pageViewsPerSite: number
  /** Number of sessions per site */
  sessionsPerSite: number
  /** Number of days of historical data */
  daysOfHistory: number
}

export const defaultSeedOptions: SeedDataOptions = {
  sites: 1,
  pageViewsPerSite: 100,
  sessionsPerSite: 50,
  daysOfHistory: 7,
}

/**
 * Generate seed data for local development
 */
export function generateSeedData(options: Partial<SeedDataOptions> = {}): {
  sites: Array<Record<string, unknown>>
  pageViews: Array<Record<string, unknown>>
  sessions: Array<Record<string, unknown>>
} {
  const opts = { ...defaultSeedOptions, ...options }
  const sites: Array<Record<string, unknown>> = []
  const pageViews: Array<Record<string, unknown>> = []
  const sessions: Array<Record<string, unknown>> = []

  const paths = [
    '/',
    '/about',
    '/blog',
    '/blog/post-1',
    '/blog/post-2',
    '/contact',
    '/pricing',
    '/features',
  ]

  const referrers = [
    { source: 'google', url: 'https://google.com' },
    { source: 'twitter', url: 'https://twitter.com' },
    { source: 'direct', url: null },
    { source: 'facebook', url: 'https://facebook.com' },
    { source: 'linkedin', url: 'https://linkedin.com' },
  ]

  const devices = ['desktop', 'mobile', 'tablet']
  const browsers = ['Chrome', 'Firefox', 'Safari', 'Edge']
  const oses = ['Windows', 'macOS', 'iOS', 'Android', 'Linux']

  for (let s = 0; s < opts.sites; s++) {
    const siteId = `site_${String(s + 1).padStart(3, '0')}`

    // Create site
    sites.push({
      pk: `SITE#${siteId}`,
      sk: `SITE#${siteId}`,
      gsi1pk: `OWNER#user_001`,
      gsi1sk: `SITE#${siteId}`,
      id: siteId,
      name: `Test Site ${s + 1}`,
      domains: [`site${s + 1}.example.com`],
      timezone: 'UTC',
      isActive: true,
      ownerId: 'user_001',
      settings: JSON.stringify({
        collectGeolocation: false,
        trackReferrers: true,
        trackUtmParams: true,
        trackDeviceType: true,
        publicDashboard: false,
        excludedPaths: [],
        excludedIps: [],
        dataRetentionDays: 365,
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Create sessions
    for (let sess = 0; sess < opts.sessionsPerSite; sess++) {
      const sessionId = `sess_${siteId}_${String(sess + 1).padStart(4, '0')}`
      const visitorId = `visitor_${String(Math.floor(Math.random() * opts.sessionsPerSite / 2) + 1).padStart(4, '0')}`
      const daysAgo = Math.floor(Math.random() * opts.daysOfHistory)
      const startTime = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
      const duration = Math.floor(Math.random() * 300000) // 0-5 minutes
      const pageCount = Math.floor(Math.random() * 5) + 1
      const referrer = referrers[Math.floor(Math.random() * referrers.length)]
      const device = devices[Math.floor(Math.random() * devices.length)]

      sessions.push({
        pk: `SITE#${siteId}`,
        sk: `SESSION#${sessionId}`,
        id: sessionId,
        siteId,
        visitorId,
        entryPath: paths[Math.floor(Math.random() * paths.length)],
        exitPath: paths[Math.floor(Math.random() * paths.length)],
        referrer: referrer.url,
        referrerSource: referrer.source,
        deviceType: device,
        browser: browsers[Math.floor(Math.random() * browsers.length)],
        os: oses[Math.floor(Math.random() * oses.length)],
        pageViewCount: pageCount,
        eventCount: Math.floor(Math.random() * 3),
        isBounce: pageCount === 1,
        duration,
        startedAt: startTime.toISOString(),
        endedAt: new Date(startTime.getTime() + duration).toISOString(),
      })
    }

    // Create page views
    for (let pv = 0; pv < opts.pageViewsPerSite; pv++) {
      const pageViewId = `pv_${siteId}_${String(pv + 1).padStart(5, '0')}`
      const sessionIdx = Math.floor(Math.random() * opts.sessionsPerSite)
      const sessionId = `sess_${siteId}_${String(sessionIdx + 1).padStart(4, '0')}`
      const visitorId = `visitor_${String(Math.floor(Math.random() * opts.sessionsPerSite / 2) + 1).padStart(4, '0')}`
      const daysAgo = Math.floor(Math.random() * opts.daysOfHistory)
      const timestamp = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - Math.random() * 24 * 60 * 60 * 1000)
      const path = paths[Math.floor(Math.random() * paths.length)]
      const referrer = referrers[Math.floor(Math.random() * referrers.length)]

      pageViews.push({
        pk: `SITE#${siteId}`,
        sk: `PV#${timestamp.toISOString()}#${pageViewId}`,
        gsi1pk: `SITE#${siteId}#DATE#${timestamp.toISOString().slice(0, 10)}`,
        gsi1sk: `PATH#${path}#${pageViewId}`,
        id: pageViewId,
        siteId,
        visitorId,
        sessionId,
        path,
        hostname: `site${s + 1}.example.com`,
        title: `Page: ${path}`,
        referrer: referrer.url,
        referrerSource: referrer.source,
        deviceType: devices[Math.floor(Math.random() * devices.length)],
        browser: browsers[Math.floor(Math.random() * browsers.length)],
        os: oses[Math.floor(Math.random() * oses.length)],
        screenWidth: [1920, 1440, 1366, 375, 768][Math.floor(Math.random() * 5)],
        screenHeight: [1080, 900, 768, 667, 1024][Math.floor(Math.random() * 5)],
        isUnique: pv % 3 === 0,
        isBounce: false,
        timestamp: timestamp.toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      })
    }
  }

  return { sites, pageViews, sessions }
}

// ============================================================================
// Setup Script
// ============================================================================

/**
 * Print setup instructions for local development
 */
export function printLocalSetupInstructions(): void {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                 Analytics Local Development Setup                  ║
╚═══════════════════════════════════════════════════════════════════╝

1. Start DynamoDB Local:

   Option A: Using Docker
   ────────────────────────
   docker run -p 8000:8000 amazon/dynamodb-local

   Option B: Using docker-compose
   ────────────────────────
   Save the docker-compose.yml and run:
   docker-compose up -d

   Option C: Using dynamodb-tooling (if installed globally)
   ────────────────────────
   dbtooling local start

2. Create the analytics table:

   ${generateAwsCliCommand()}

3. Verify the table was created:

   aws dynamodb list-tables --endpoint-url http://localhost:8000

4. Configure your analytics:

   import { setConfig } from '@stacksjs/analytics'

   setConfig({
     table: { tableName: 'AnalyticsTable' },
     endpoint: 'http://localhost:8000',
     region: 'us-east-1',
   })

5. Run the seed script (optional):

   bun run examples/seed-local.ts

Happy developing! 🚀
`)
}
