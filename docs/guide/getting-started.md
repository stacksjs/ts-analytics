---
title: Quick Start
description: Get started with ts-analytics in minutes
---

# Quick Start

This guide will help you set up ts-analytics in your application in just a few minutes.

## 1. Install the Package

```bash
bun add @stacksjs/ts-analytics
```

## 2. Set Up the Analytics Store

```typescript
import { AnalyticsStore, createAnalyticsTable } from '@stacksjs/ts-analytics'
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb'

// Create DynamoDB client
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

## 3. Add the Tracking Script

Add the tracking script to your website's HTML:

```typescript
import { generateTrackingScript } from '@stacksjs/ts-analytics'

const script = generateTrackingScript({
  siteId: 'my-site-id',
  endpoint: 'https://api.example.com/api/analytics',
  trackPageviews: true,
  trackOutboundLinks: true,
  respectDoNotTrack: true,
})

// Add to your HTML head
const html = `
<!DOCTYPE html>
<html>
<head>
  ${script}
</head>
<body>
  <!-- Your content -->
</body>
</html>
`
```

Or use the minimal snippet that loads the script asynchronously:

```typescript
import { generateTrackingSnippet } from '@stacksjs/ts-analytics'

const snippet = generateTrackingSnippet({
  siteId: 'my-site-id',
  apiEndpoint: 'https://analytics.example.com/api/analytics',
})

// Outputs:
// <script>
// (function(w,d,s,a){...})(window,document,'script');
// sa('init','my-site-id');
// </script>
```

## 4. Create API Handlers

### Using Bun's Built-in Server

```typescript
import { AnalyticsAPI, createBunRouter } from '@stacksjs/ts-analytics'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'us-east-1' })

const api = new AnalyticsAPI({
  tableName: 'my-analytics',
  siteId: 'my-site-id',
})

// Execute DynamoDB commands
async function executeCommand(cmd: { command: string; input: Record<string, unknown> }) {
  const Command = await import(`@aws-sdk/client-dynamodb`).then(m => m[cmd.command])
  return client.send(new Command(cmd.input))
}

const router = createBunRouter(api, executeCommand)

// Start the server
Bun.serve({
  port: 3000,
  fetch: router.fetch,
})

console.log('Analytics API running on http://localhost:3000')
```

### Using AWS Lambda

```typescript
import { AnalyticsAPI, createLambdaHandler } from '@stacksjs/ts-analytics'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: process.env.AWS_REGION })

const api = new AnalyticsAPI({
  tableName: process.env.TABLE_NAME!,
})

async function executeCommand(cmd: { command: string; input: Record<string, unknown> }) {
  const Command = await import(`@aws-sdk/client-dynamodb`).then(m => m[cmd.command])
  return client.send(new Command(cmd.input))
}

export const handler = createLambdaHandler(api, executeCommand)
```

## 5. Track Custom Events

From your website JavaScript:

```javascript
// Track a custom event
sa('event', 'button_click', { button: 'signup' })

// Track with category and value
sa('event', 'purchase', { product: 'pro-plan' }, 'conversion', 99)

// Identify a user (optional)
sa('identify', 'user-123')

// Set custom properties
sa('setProperty', 'plan', 'enterprise')
```

## 6. Query Analytics Data

```typescript
import { AnalyticsQueryAPI } from '@stacksjs/ts-analytics'

const queryApi = new AnalyticsQueryAPI({
  tableName: 'my-analytics',
})

// Generate dashboard queries
const queries = queryApi.generateDashboardQueries({
  siteId: 'my-site-id',
  dateRange: {
    start: new Date('2024-01-01'),
    end: new Date(),
  },
  includeComparison: true,
  includeRealtime: true,
  topLimit: 10,
})

// Execute queries and get results
// Results include: summary, timeSeries, topPages, referrers, etc.
```

## 7. Use Dashboard Components (Vue)

```vue
<script setup>
import {
  AnalyticsDashboard,
  StatCard,
  TimeSeriesChart,
  TopList,
} from '@stacksjs/ts-analytics'
</script>

<template>
  <AnalyticsDashboard
    :config="{
      baseUrl: '/api/analytics',
      siteId: 'my-site'
    }"
  />
</template>
```

## Complete Example

Here's a complete example combining all the pieces:

```typescript
// analytics-server.ts
import {
  AnalyticsStore,
  AnalyticsAPI,
  createBunRouter,
  generateTrackingScript
} from '@stacksjs/ts-analytics'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'us-east-1' })

// Initialize API
const api = new AnalyticsAPI({
  tableName: 'my-analytics',
  corsOrigins: ['https://mysite.com'],
})

async function executeCommand(cmd: { command: string; input: Record<string, unknown> }) {
  const Command = await import(`@aws-sdk/client-dynamodb`).then(m => m[cmd.command])
  return client.send(new Command(cmd.input))
}

const router = createBunRouter(api, executeCommand)

// Serve the API
Bun.serve({
  port: 3000,
  fetch(request) {
    const url = new URL(request.url)

    // Serve tracking script
    if (url.pathname === '/tracker.js') {
      const script = generateTrackingScript({
        siteId: 'my-site',
        apiEndpoint: 'https://analytics.mysite.com/api/analytics',
      })
      return new Response(script, {
        headers: { 'Content-Type': 'application/javascript' }
      })
    }

    // Handle API routes
    return router.fetch(request)
  },
})
```

## Next Steps

- [Tracking Script Guide](/guide/tracking-script) - Learn about all tracking options
- [API Endpoints](/guide/api) - Explore the full API
- [Dashboard Components](/guide/dashboard) - Build beautiful dashboards
- [AWS Deployment](/deploy/aws) - Deploy to production
