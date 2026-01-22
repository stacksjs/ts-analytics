---
title: Real-time Analytics
description: Track visitors and events in real-time
---

# Real-time Analytics

ts-analytics provides live visitor tracking and real-time event streaming.

## Overview

Real-time features include:
- Current visitor count
- Active page monitoring
- Live event feed
- Geographic distribution
- Instant metric updates

## How It Works

Real-time data uses a sliding window approach:

```typescript
// Data stored with 10-minute TTL
const realtimeCommand = store.updateRealtimeStatsCommand({
  siteId: 'my-site',
  minute: '2024-01-15T10:30',
  currentVisitors: 42,
  pageViews: 156,
  activePages: {
    '/': 15,
    '/pricing': 8,
    '/docs': 12,
  },
  ttl: Math.floor(Date.now() / 1000) + 600, // 10 min TTL
})
```

Data automatically expires, keeping only recent activity.

## API Endpoint

### GET /sites/:siteId/realtime

```bash
curl "https://api.example.com/api/analytics/sites/my-site/realtime?minutes=5"
```

Response:

```json
{
  "currentVisitors": 42,
  "pageViews": 156,
  "activePages": [
    { "path": "/", "visitors": 15 },
    { "path": "/pricing", "visitors": 8 },
    { "path": "/docs", "visitors": 12 }
  ],
  "recentEvents": [
    { "type": "pageview", "path": "/signup", "timestamp": "..." },
    { "type": "event", "name": "button_click", "timestamp": "..." }
  ]
}
```

## Dashboard Components

### RealtimeCounter

Display live visitor count:

```vue
<template>
  <RealtimeCounter
    :config="{ baseUrl: '/api/analytics', siteId: 'my-site' }"
    :poll-interval="5000"
  />
</template>
```

Features:
- Animated number transitions
- Pulse animation on updates
- Configurable poll interval

### LiveActivityFeed

Show real-time event stream:

```vue
<template>
  <LiveActivityFeed
    :config="config"
    :max-items="20"
    :show-location="true"
  />
</template>
```

Events displayed:
- Page views with path
- Custom events
- Outbound clicks
- Goal completions

### Active Pages List

Show currently viewed pages:

```vue
<template>
  <TopList
    title="Active Pages"
    :items="realtime.activePages"
    label-key="path"
    value-key="visitors"
    :realtime="true"
  />
</template>
```

## Composables

### createRealtimePoller

Set up polling for real-time data:

```typescript
import { createRealtimePoller } from '@stacksjs/ts-analytics'
import { onMounted, onUnmounted } from 'vue'

const { data, isLoading, error, start, stop } = createRealtimePoller({
  baseUrl: '/api/analytics',
  siteId: 'my-site',
  interval: 5000, // 5 seconds
})

onMounted(() => start())
onUnmounted(() => stop())

// Access data reactively
const currentVisitors = computed(() => data.value?.currentVisitors ?? 0)
```

### Manual Fetching

Fetch real-time data on demand:

```typescript
import { fetchDashboardData } from '@stacksjs/ts-analytics'

const data = await fetchDashboardData(
  { baseUrl: '/api/analytics', siteId: 'my-site' },
  { realtime: true }
)

console.log('Current visitors:', data.realtime.currentVisitors)
```

## Real-time in AnalyticsStore

### Query Real-time Stats

```typescript
// Get last 5 minutes of real-time data
const command = store.getRealtimeStatsCommand('my-site', 5)
const result = await executeCommand(command)

// Process the results
const realtimeData = AnalyticsQueryAPI.processRealtimeData(result.Items)
```

### Update Real-time Stats

Called automatically when events are received:

```typescript
// In the /collect handler
const realtimeCommand = store.updateRealtimeStatsCommand({
  siteId: payload.s,
  minute: timestamp.toISOString().slice(0, 16),
  currentVisitors: 1, // Incremental
  pageViews: 1,
  activePages: { [parsedUrl.pathname]: 1 },
  ttl: Math.floor(Date.now() / 1000) + 600,
})
```

## WebSocket Support (Custom)

For true real-time without polling, implement WebSockets:

```typescript
// Server
const server = Bun.serve({
  port: 3000,
  fetch(req, server) {
    if (req.url.endsWith('/ws')) {
      server.upgrade(req)
      return
    }
    return router.fetch(req)
  },
  websocket: {
    open(ws) {
      ws.subscribe('realtime')
    },
    message(ws, message) {
      // Handle subscriptions
    },
  },
})

// Broadcast updates
function broadcastRealtimeUpdate(data) {
  server.publish('realtime', JSON.stringify(data))
}
```

Client:

```typescript
const ws = new WebSocket('wss://api.example.com/ws')

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  updateRealtimeDisplay(data)
}
```

## DynamoDB Streams

Use DynamoDB Streams for event-driven updates:

```typescript
// Enable streams on the table
await client.send(new UpdateTableCommand({
  TableName: 'AnalyticsTable',
  StreamSpecification: {
    StreamEnabled: true,
    StreamViewType: 'NEW_IMAGE',
  },
}))

// Lambda function triggered by stream
export async function handler(event) {
  for (const record of event.Records) {
    if (record.eventName === 'INSERT') {
      const item = unmarshall(record.dynamodb.NewImage)

      if (item.pk.startsWith('SITE#') && item.sk.startsWith('PV#')) {
        // New page view - update real-time dashboard
        await broadcastToConnectedClients(item)
      }
    }
  }
}
```

## Performance Considerations

### Polling Intervals

| Use Case | Recommended Interval |
|----------|---------------------|
| Dashboard overview | 30-60 seconds |
| Live activity feed | 5-10 seconds |
| Current visitors | 10-15 seconds |
| Active pages | 15-30 seconds |

### TTL Settings

```typescript
// Short TTL for real-time data
const REALTIME_TTL = 600 // 10 minutes

// Cleanup happens automatically via DynamoDB TTL
```

### Aggregation

For high-traffic sites, aggregate in memory:

```typescript
const realtimeBuffer = new Map()

// Buffer updates
function bufferRealtimeUpdate(siteId, data) {
  const key = `${siteId}:${getCurrentMinute()}`
  const existing = realtimeBuffer.get(key) || { visitors: 0, pageViews: 0 }
  realtimeBuffer.set(key, {
    visitors: existing.visitors + 1,
    pageViews: existing.pageViews + data.pageViews,
  })
}

// Flush periodically
setInterval(() => {
  for (const [key, data] of realtimeBuffer) {
    writeToDatabase(key, data)
  }
  realtimeBuffer.clear()
}, 5000)
```

## Next Steps

- [Dashboard Components](/guide/dashboard) - Build real-time UIs
- [Goal Tracking](/features/goals) - Track conversions in real-time
- [API Endpoints](/guide/api) - Real-time API reference
