/**
 * Basic Analytics Usage Example
 *
 * This example demonstrates how to set up and use @stacksjs/analytics
 * with DynamoDB for a privacy-first analytics solution.
 */

import type { PageView, Site } from '@stacksjs/analytics'
import {
  // Core Analytics
  AnalyticsAPI,
  AnalyticsStore,

  createBunRouter,
  // Configuration
  defineConfig,
  // DynamoDB Utilities
  generateId,

  generateTrackingScript,
  getPeriodStart,
  KeyPatterns,
  // Types

  marshal,
  setConfig,

} from '@stacksjs/analytics'

// ============================================================================
// 9. Tracking Script Generation
// ============================================================================

// ============================================================================
// 1. Configuration
// ============================================================================

// Define your analytics configuration
const config = defineConfig({
  table: {
    tableName: 'my-analytics-table',
    billingMode: 'PAY_PER_REQUEST',
  },
  region: 'us-east-1',
  // For local development with DynamoDB Local:
  // endpoint: 'http://localhost:8000',

  privacy: {
    hashVisitorIds: true,
    collectGeolocation: false,
    honorDnt: true,
    ipAnonymization: 'partial',
  },

  tracking: {
    trackReferrers: true,
    trackUtmParams: true,
    trackDeviceType: true,
    trackOutboundLinks: true,
  },

  retention: {
    rawEventTtl: 30 * 24 * 60 * 60, // 30 days
    hourlyAggregateTtl: 90 * 24 * 60 * 60, // 90 days
    dailyAggregateTtl: 2 * 365 * 24 * 60 * 60, // 2 years
  },
})

// Set as global config
setConfig(config)

// ============================================================================
// 2. Initialize Analytics Store
// ============================================================================

const store = new AnalyticsStore({
  tableName: config.table.tableName,
  useTtl: true,
  rawEventTtl: config.retention.rawEventTtl,
})

// ============================================================================
// 3. Create a Site
// ============================================================================

async function createSite(): Promise<Site> {
  const site: Site = {
    id: generateId(),
    name: 'My Website',
    domains: ['example.com', 'www.example.com'],
    timezone: 'America/New_York',
    isActive: true,
    ownerId: 'user_123',
    settings: {
      collectGeolocation: false,
      trackReferrers: true,
      trackUtmParams: true,
      trackDeviceType: true,
      publicDashboard: false,
      excludedPaths: ['/admin/*', '/api/*'],
      excludedIps: [],
      dataRetentionDays: 365,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  // Generate the DynamoDB command
  const command = store.createSiteCommand(site)
  console.log('Create site command:', command)

  // In production, execute with your DynamoDB client:
  // await dynamoClient.send(new PutItemCommand(command.input))

  return site
}

// ============================================================================
// 4. Record a Page View
// ============================================================================

async function recordPageView(siteId: string): Promise<PageView> {
  const pageView: PageView = {
    id: generateId(),
    siteId,
    visitorId: 'visitor_abc123', // Hashed visitor ID
    sessionId: 'session_xyz789',
    path: '/blog/hello-world',
    hostname: 'example.com',
    title: 'Hello World - My Blog',
    referrer: 'https://google.com',
    referrerSource: 'google',
    utmSource: 'newsletter',
    utmMedium: 'email',
    utmCampaign: 'weekly-digest',
    deviceType: 'desktop',
    browser: 'Chrome',
    browserVersion: '120',
    os: 'macOS',
    osVersion: '14.0',
    screenWidth: 1920,
    screenHeight: 1080,
    isUnique: true,
    isBounce: false,
    timestamp: new Date(),
  }

  // Generate the DynamoDB command
  const command = store.recordPageViewCommand(pageView)
  console.log('Record page view command:', command)

  return pageView
}

// ============================================================================
// 5. Query Stats
// ============================================================================

async function getStats(siteId: string): Promise<void> {
  const period = 'day'
  const periodStart = getPeriodStart(new Date(), period)

  // Get aggregated stats command
  const statsCommand = store.getAggregatedStatsCommand(siteId, period, periodStart)
  console.log('Get stats command:', statsCommand)

  // Get top pages command
  const topPagesCommand = store.getTopPagesCommand(siteId, period, periodStart, 10)
  console.log('Get top pages command:', topPagesCommand)

  // Get realtime stats command
  const realtimeCommand = store.getRealtimeStatsCommand(siteId, 5)
  console.log('Get realtime command:', realtimeCommand)
}

// ============================================================================
// 6. Using Key Patterns Directly
// ============================================================================

function demonstrateKeyPatterns(): void {
  const siteId = 'site_123'
  const timestamp = new Date()

  // Site keys
  console.log('Site PK:', KeyPatterns.site.pk(siteId))
  console.log('Site SK:', KeyPatterns.site.sk(siteId))

  // Page view keys
  console.log('PageView PK:', KeyPatterns.pageView.pk(siteId))
  console.log('PageView SK:', KeyPatterns.pageView.sk(timestamp, 'pv_456'))

  // Stats keys
  console.log('Stats SK:', KeyPatterns.stats.sk('day', '2024-01-15'))

  // Realtime keys
  const minute = timestamp.toISOString().slice(0, 16)
  console.log('Realtime SK:', KeyPatterns.realtime.sk(minute))
}

// ============================================================================
// 7. Using Marshal/Unmarshal
// ============================================================================

function demonstrateMarshal(): void {
  const item = {
    pk: 'SITE#site_123',
    sk: 'SITE#site_123',
    name: 'My Website',
    domains: ['example.com'],
    isActive: true,
    pageViews: 1000,
    createdAt: new Date().toISOString(),
  }

  const dynamoItem = marshal(item)
  console.log('Marshalled item:', JSON.stringify(dynamoItem, null, 2))
}

// ============================================================================
// 8. HTTP API Setup (Bun Server)
// ============================================================================

async function setupBunServer(): Promise<void> {
  // Create the API instance
  const api = new AnalyticsAPI({
    tableName: config.table.tableName,
    corsOrigins: ['https://example.com'],
    basePath: '/api/analytics',
  })

  // Create a mock DynamoDB execute function
  // In production, use actual DynamoDB client
  const executeCommand = async (cmd: { command: string, input: Record<string, unknown> }): Promise<unknown> => {
    console.log('Executing:', cmd.command, cmd.input)
    return { Items: [] }
  }

  // Create the Bun router
  const router = createBunRouter(api, executeCommand)

  // Start the server
  console.log('Starting server on http://localhost:3000')

  // Bun.serve({
  //   port: 3000,
  //   fetch: router.fetch,
  // })
}

function getTrackingScript(siteId: string): string {
  const script = generateTrackingScript({
    siteId,
    apiEndpoint: 'https://api.example.com/analytics',
    honorDnt: true,
    trackHashChanges: false,
    trackOutboundLinks: true,
  })

  console.log('Tracking script:')
  console.log(script)

  return script
}

// ============================================================================
// Run Examples
// ============================================================================

async function main(): Promise<void> {
  console.log('=== Analytics Usage Examples ===\n')

  console.log('1. Creating a site...')
  const site = await createSite()
  console.log('Site created:', site.id, '\n')

  console.log('2. Recording a page view...')
  await recordPageView(site.id)
  console.log('')

  console.log('3. Querying stats...')
  await getStats(site.id)
  console.log('')

  console.log('4. Key patterns...')
  demonstrateKeyPatterns()
  console.log('')

  console.log('5. Marshal example...')
  demonstrateMarshal()
  console.log('')

  console.log('6. Tracking script...')
  getTrackingScript(site.id)
}

main().catch(console.error)
