---
title: AnalyticsAPI
description: API reference for AnalyticsAPI HTTP handler
---

# AnalyticsAPI

Framework-agnostic HTTP handler for analytics endpoints.

## Constructor

```typescript
import { AnalyticsAPI } from '@stacksjs/ts-analytics'

const api = new AnalyticsAPI({
  tableName: 'AnalyticsTable',
  corsOrigins: ['https://example.com'],
  useTtl: true,
  rawEventTtl: 30 * 24 * 60 * 60,
  basePath: '/api/analytics',
})
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tableName` | string | required | DynamoDB table name |
| `corsOrigins` | string[] | `['*']` | CORS allowed origins |
| `useTtl` | boolean | `true` | Enable TTL |
| `rawEventTtl` | number | `2592000` | Raw event TTL (seconds) |
| `basePath` | string | `'/api/analytics'` | API base path |

## Methods

### createContext

Create a handler context for request processing.

```typescript
const ctx = api.createContext(executeCommand, {
  getGoals: async (siteId) => fetchGoals(siteId),
  getSite: async (siteId) => fetchSite(siteId),
  sessionStore: mySessionStore,
})
```

### getCorsHeaders

Get CORS headers for a response.

```typescript
const headers = api.getCorsHeaders(request.headers.origin)
```

### handleOptions

Handle OPTIONS preflight request.

```typescript
const response = api.handleOptions(request)
```

### handleCollect

Handle POST /collect - receive tracking events.

```typescript
const response = await api.handleCollect(request, ctx)
```

### handleListSites

Handle GET /sites - list sites for a user.

```typescript
const response = await api.handleListSites(request, ctx, ownerId)
```

### handleCreateSite

Handle POST /sites - create a new site.

```typescript
const response = await api.handleCreateSite(request, ctx, ownerId)
```

### handleGetSite

Handle GET /sites/:siteId - get site details.

```typescript
const response = await api.handleGetSite(request, ctx)
```

### handleGetStats

Handle GET /sites/:siteId/stats - get dashboard stats.

```typescript
const response = await api.handleGetStats(request, ctx)
```

### handleGetRealtime

Handle GET /sites/:siteId/realtime - get realtime stats.

```typescript
const response = await api.handleGetRealtime(request, ctx)
```

### handleGetScript

Handle GET /sites/:siteId/script - get tracking script.

```typescript
const response = api.handleGetScript(request)
```

### handleListGoals

Handle GET /sites/:siteId/goals - list goals.

```typescript
const response = await api.handleListGoals(request, ctx)
```

### handleCreateGoal

Handle POST /sites/:siteId/goals - create a goal.

```typescript
const response = await api.handleCreateGoal(request, ctx)
```

### handleGetTopPages

Handle GET /sites/:siteId/pages - get top pages.

```typescript
const response = await api.handleGetTopPages(request, ctx)
```

### handleAggregate

Handle POST /aggregate - trigger aggregation.

```typescript
const response = await api.handleAggregate(request, ctx)
```

### getStore

Get the underlying AnalyticsStore instance.

```typescript
const store = api.getStore()
```

### getQueryAPI

Get the AnalyticsQueryAPI instance.

```typescript
const queryApi = api.getQueryAPI()
```

### getPipeline

Get the AggregationPipeline instance.

```typescript
const pipeline = api.getPipeline()
```

## Types

### AnalyticsRequest

```typescript
interface AnalyticsRequest {
  method: string
  path: string
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
  headers: Record<string, string>
  ip?: string
  userAgent?: string
}
```

### AnalyticsResponse

```typescript
interface AnalyticsResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}
```

### HandlerContext

```typescript
interface HandlerContext {
  store: AnalyticsStore
  queryApi: AnalyticsQueryAPI
  pipeline: AggregationPipeline
  visitorSalt: string
  executeCommand: (command: {...}) => Promise<unknown>
  getGoals?: (siteId: string) => Promise<Goal[]>
  getSite?: (siteId: string) => Promise<Site | null>
  sessionStore?: SessionStore
}
```

### CollectPayload

```typescript
interface CollectPayload {
  s: string      // Site ID
  sid: string    // Session ID
  e: 'pageview' | 'event' | 'outbound'
  p?: Record<string, unknown>  // Properties
  u: string      // URL
  r?: string     // Referrer
  t?: string     // Title
  sw?: number    // Screen width
  sh?: number    // Screen height
}
```

## Framework Adapters

### createBunRouter

Create a Bun/Hono compatible router.

```typescript
import { createBunRouter } from '@stacksjs/ts-analytics'

const router = createBunRouter(api, executeCommand)

Bun.serve({
  port: 3000,
  fetch: router.fetch,
})
```

### createLambdaHandler

Create an AWS Lambda handler.

```typescript
import { createLambdaHandler } from '@stacksjs/ts-analytics'

export const handler = createLambdaHandler(api, executeCommand)
```

## See Also

- [API Endpoints](/guide/api) - Endpoint reference
- [Framework Integrations](/deploy/integrations) - Integration guides
- [AnalyticsStore](/api/store) - Data operations
