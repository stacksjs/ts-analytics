<p align="center"><img src="https://github.com/stacksjs/ts-analytics/blob/main/.github/art/cover.png?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
[![npm downloads][npm-downloads-src]][npm-downloads-href]

# @stacksjs/analytics

A privacy-first analytics toolkit for web applications, powered by DynamoDB single-table design.

## Features

- **Privacy-First**: No cookies, no personal data collection, GDPR-compliant by design
- **DynamoDB Single-Table Design**: Efficient, scalable, and cost-effective storage
- **Real-time Analytics**: Live visitor tracking and dashboard updates
- **Goal Tracking**: Define and track conversion goals
- **Vue Dashboard Components**: Ready-to-use dashboard UI components
- **Framework Agnostic**: Works with Bun, Express, Hono, AWS Lambda, and more
- **Stacks Integration**: First-class support for the Stacks framework

## Installation

```bash
bun add @stacksjs/analytics
```

## Integrate on Your Site (the 3-step recipe)

The validated pattern for adding ts-analytics to any site (docs sites included):

1. **Create a project** in the dashboard (or let the first event auto-create it), then copy the one-liner from **Settings → Installation**:

   ```html
   <script defer src="https://your-analytics-host/api/sites/YOUR_SITE_ID/script.js"></script>
   ```

   It captures page views, SPA route changes, link & outbound clicks, engagement time, web vitals, and JS errors — no cookies, no consent banner needed.

2. **Verify** with the *Verify installation* button in Settings (fires a real event through `/collect` and confirms the round trip), or just visit your site and watch the dashboard.

3. **Optional hardening**: append `?stealth=true` for the unlisted beacon path, or serve it first-party from your own domain — see the [ad-blocker resilience guide](docs/guide/tracking-script.md#ad-blocker-resilience-first-party-proxy). Error tracking without analytics: grab the DSN + SDK snippet from the same Settings page.

## Quick Start

### 1. Set Up the Analytics Store

```typescript
import { AnalyticsStore, createAnalyticsTable } from '@stacksjs/analytics'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'us-east-1' })

// Create the analytics table (one-time setup)
await createAnalyticsTable(client, {
  tableName: 'my-analytics',
  billingMode: 'PAY_PER_REQUEST',
}, { CreateTableCommand, DescribeTableCommand })

// Initialize the store
const store = new AnalyticsStore({
  tableName: 'my-analytics',
})
```

### 2. Add the Tracking Script

```typescript
import { generateTrackingScript } from '@stacksjs/analytics'

const script = generateTrackingScript({
  siteId: 'my-site-id',
  endpoint: 'https://api.example.com/collect',
  // Optional settings
  trackPageviews: true,
  trackOutboundLinks: true,
  respectDoNotTrack: true,
})

// Inject into your HTML
const html = `<html><head>${script}</head>...</html>`
```

### 3. Create API Handlers

```typescript
import { AnalyticsAPI, createBunRouter } from '@stacksjs/analytics'

const api = new AnalyticsAPI({
  tableName: 'my-analytics',
  siteId: 'my-site-id',
})

// For Bun
const router = createBunRouter(api, executeCommand)

// For AWS Lambda
import { createLambdaHandler } from '@stacksjs/analytics'
export const handler = createLambdaHandler(api, executeCommand)
```

## Architecture: Source of Truth

The repository has two API layers — only one is live:

| Layer | Status | Where |
|---|---|---|
| **Live server** | ✅ source of truth | `src/router.ts` + `src/handlers/*` (DynamoDB-backed), served by `server/index.ts`; jobs in `src/jobs/`, pre-aggregation in `src/lib/rollups.ts` |
| Legacy library | ⚠️ compatibility only | `src/api.ts`, `src/stacks-integration.ts`, and the in-memory `AnalyticsStore`/`AnalyticsQueryAPI`/`AggregationPipeline` classes in `src/Analytics.ts` |

New endpoints and features belong in `src/router.ts` + `src/handlers/`. The legacy layer is kept so existing imports of the published package keep compiling; it does not serve the bundled server or dashboard. (`generateTrackingScript` in `src/Analytics.ts` **is** live — it builds the served `/script.js`.)

## Core Concepts

### Analytics Store

The `AnalyticsStore` provides DynamoDB operations for all analytics entities:

```typescript
const store = new AnalyticsStore({
  tableName: 'analytics',
  useTtl: true,
  rawEventTtl: 30 _ 24 _ 60 * 60, // 30 days
})

// Create a site
const siteCommand = store.createSiteCommand({
  id: 'site-123',
  name: 'My Website',
  domains: ['example.com'],
  ownerId: 'user-456',
})

// Record a page view
const pvCommand = store.recordPageViewCommand({
  id: 'pv-789',
  siteId: 'site-123',
  path: '/blog/hello-world',
  visitorId: 'visitor-hash',
  sessionId: 'session-abc',
  timestamp: new Date(),
})
```

### Aggregation Pipeline

Pre-compute statistics for fast dashboard queries:

```typescript
import { AggregationPipeline, AnalyticsAggregator } from '@stacksjs/analytics'

const pipeline = new AggregationPipeline({
  tableName: 'analytics',
})

// Run hourly aggregation
const aggregator = new AnalyticsAggregator({
  tableName: 'analytics',
})

await aggregator.aggregateHourly('site-123', new Date())
```

### Query API

Fetch analytics data for dashboards:

```typescript
import { AnalyticsQueryAPI } from '@stacksjs/analytics'

const queryApi = new AnalyticsQueryAPI({
  tableName: 'analytics',
})

// Generate dashboard queries
const queries = queryApi.generateDashboardQueries({
  siteId: 'site-123',
  dateRange: { start: new Date('2024-01-01'), end: new Date() },
})
```

### Goal Tracking

Define and track conversion goals:

```typescript
import { GoalMatcher } from '@stacksjs/analytics'

const goals = [
  { id: 'signup', type: 'pageview', pattern: '/signup/complete', matchType: 'exact' },
  { id: 'purchase', type: 'event', pattern: 'purchase', matchType: 'exact' },
]

const matcher = new GoalMatcher(goals)

// Check if a page view matches any goals
const matches = matcher.matchPageView('/signup/complete')
// => [{ goalId: 'signup', value: undefined }]
```

## Dashboard Components

Vue 3 components for building analytics dashboards:

```vue
<script setup>
import {
  AnalyticsDashboard,
  StatCard,
  TimeSeriesChart,
  TopList,
  DeviceBreakdown,
  RealtimeCounter,
  DateRangePicker,
} from '@stacksjs/analytics'
</script>

<template>
  <AnalyticsDashboard
    :config="{ baseUrl: '/api/analytics', siteId: 'my-site' }"
  />
</template>
```

### Composables

```typescript
import { createAnalyticsComposable, fetchDashboardData } from '@stacksjs/analytics'

// Create a composable for Vue
const analytics = createAnalyticsComposable({
  baseUrl: '/api/analytics',
  siteId: 'my-site',
})

// Or fetch data directly
const data = await fetchDashboardData(
  { baseUrl: '/api/analytics', siteId: 'my-site' },
  { startDate: new Date('2024-01-01'), endDate: new Date() }
)
```

## Stacks Framework Integration

First-class integration with the Stacks framework:

```typescript
import { createAnalyticsDriver, createAnalyticsMiddleware } from '@stacksjs/analytics'

// Create the driver
const driver = await createAnalyticsDriver({
  tableName: 'analytics',
  siteId: 'my-site',
  region: 'us-east-1',
})

// Add tracking middleware
app.use(createAnalyticsMiddleware(driver))

// Server-side tracking
app.use(createServerTrackingMiddleware(driver, {
  excludedPaths: [/^\/api/, /^\/admin/],
}))

// Dashboard actions
const actions = createDashboardActions(driver)
const stats = await actions.getDashboardStats({ startDate: '2024-01-01' })
```

## Infrastructure

Generate infrastructure code for deployment:

```typescript
import {
  generateCloudFormationTemplate,
  generateCdkCode,
  generateSamTemplate,
  generateAwsCliCommands,
} from '@stacksjs/analytics'

// CloudFormation
const cfn = generateCloudFormationTemplate({ tableName: 'analytics' })

// AWS CDK
const cdk = generateCdkCode({ tableName: 'analytics' })

// SAM
const sam = generateSamTemplate({ tableName: 'analytics' })

// AWS CLI commands
const cli = generateAwsCliCommands({ tableName: 'analytics' })
```

## Models

Stacks-compatible model definitions for all analytics entities:

```typescript
import {
  SiteModel,
  PageViewModel,
  SessionModel,
  CustomEventModel,
  GoalModel,
  AggregatedStatsModel,
  // ... and more
} from '@stacksjs/analytics'
```

## Testing

```bash
bun test
```

## Changelog

Please see our [releases](https://github.com/stacksjs/analytics/releases) page for more information on what has changed recently.

## Contributing

Please see [CONTRIBUTING](.github/CONTRIBUTING.md) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://stacksjs.com/discord)

## Postcardware

Stacks OSS will always stay open-sourced, and we will always love to receive postcards from wherever Stacks is used! _And we also determine the OSS dependencies we utilize._

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, USA

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## License

The MIT License (MIT). Please see [LICENSE](LICENSE.md) for more information.

Made with love by [Chris Breuer](https://github.com/chrisbbreuer) and [contributors](https://github.com/stacksjs/analytics/graphs/contributors).

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/@stacksjs/analytics?style=flat-square
[npm-version-href]: https://npmjs.com/package/@stacksjs/analytics
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/analytics/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/analytics/actions?query=workflow%3Aci
[npm-downloads-src]: https://img.shields.io/npm/dm/@stacksjs/analytics?style=flat-square
[npm-downloads-href]: https://npmjs.com/package/@stacksjs/analytics
