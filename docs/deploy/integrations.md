---
title: Framework Integrations
description: Integrate ts-analytics with various frameworks
---

# Framework Integrations

ts-analytics works with any JavaScript/TypeScript runtime and framework.

## Bun (Native)

Built-in support for Bun's HTTP server:

```typescript
import { AnalyticsAPI, createBunRouter } from '@stacksjs/ts-analytics'

const api = new AnalyticsAPI({ tableName: 'AnalyticsTable' })
const router = createBunRouter(api, executeCommand)

Bun.serve({
  port: 3000,
  fetch: router.fetch,
})
```

## Hono

Use with the Hono web framework:

```typescript
import { Hono } from 'hono'
import { createAnalyticsRoutes, mountAnalyticsRoutes } from '@stacksjs/ts-analytics'

const app = new Hono()

// Option 1: Mount routes
mountAnalyticsRoutes(app, {
  tableName: 'AnalyticsTable',
  basePath: '/api/analytics',
  executeCommand,
})

// Option 2: Create routes manually
const analyticsRoutes = createAnalyticsRoutes({
  tableName: 'AnalyticsTable',
  executeCommand,
})

app.route('/api/analytics', analyticsRoutes)

export default app
```

### Hono Middleware

```typescript
import { analyticsMiddleware } from '@stacksjs/ts-analytics'

app.use('*', analyticsMiddleware({
  siteId: 'my-site',
  tableName: 'AnalyticsTable',
  executeCommand,
  excludePaths: ['/api', '/admin'],
}))
```

## AWS Lambda

Deploy as a Lambda function:

```typescript
import { AnalyticsAPI, createLambdaHandler } from '@stacksjs/ts-analytics'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: process.env.AWS_REGION })

const api = new AnalyticsAPI({
  tableName: process.env.TABLE_NAME!,
})

async function executeCommand(cmd: { command: string; input: Record<string, unknown> }) {
  const Command = await import('@aws-sdk/client-dynamodb').then(m => m[cmd.command])
  return client.send(new Command(cmd.input))
}

export const handler = createLambdaHandler(api, executeCommand)
```

### SAM Template

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  AnalyticsFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      Runtime: nodejs20.x
      MemorySize: 256
      Timeout: 30
      Environment:
        Variables:
          TABLE_NAME: !Ref AnalyticsTable
      Events:
        Api:
          Type: Api
          Properties:
            Path: /{proxy+}
            Method: ANY
```

## Cloudflare Workers

Deploy to the edge:

```typescript
import {
  createAnalyticsHandler,
  createD1Adapter,
  type CloudflareEnv,
} from '@stacksjs/ts-analytics'

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    // Use D1 as storage (Cloudflare's SQL database)
    const adapter = createD1Adapter(env.DB)

    const handler = createAnalyticsHandler({
      siteId: 'my-site',
      storage: adapter,
    })

    return handler(request)
  },
}
```

### wrangler.toml

```toml
name = "analytics"
main = "src/index.ts"

[[d1_databases]]
binding = "DB"
database_name = "analytics"
database_id = "xxx"
```

## Express

Use with Express:

```typescript
import express from 'express'
import { AnalyticsAPI } from '@stacksjs/ts-analytics'

const app = express()
app.use(express.json())

const api = new AnalyticsAPI({ tableName: 'AnalyticsTable' })
const ctx = api.createContext(executeCommand)

// Mount routes
app.post('/api/analytics/collect', async (req, res) => {
  const response = await api.handleCollect({
    method: 'POST',
    path: '/collect',
    params: {},
    query: req.query as Record<string, string>,
    body: req.body,
    headers: req.headers as Record<string, string>,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }, ctx)

  res.status(response.status).json(response.body)
})

app.get('/api/analytics/sites/:siteId/stats', async (req, res) => {
  const response = await api.handleGetStats({
    method: 'GET',
    path: `/sites/${req.params.siteId}/stats`,
    params: req.params,
    query: req.query as Record<string, string>,
    body: {},
    headers: req.headers as Record<string, string>,
  }, ctx)

  res.status(response.status).json(response.body)
})

app.listen(3000)
```

## Fastify

Use with Fastify:

```typescript
import Fastify from 'fastify'
import { AnalyticsAPI } from '@stacksjs/ts-analytics'

const fastify = Fastify()
const api = new AnalyticsAPI({ tableName: 'AnalyticsTable' })
const ctx = api.createContext(executeCommand)

fastify.post('/api/analytics/collect', async (request, reply) => {
  const response = await api.handleCollect({
    method: 'POST',
    path: '/collect',
    params: {},
    query: request.query as Record<string, string>,
    body: request.body,
    headers: request.headers as Record<string, string>,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  }, ctx)

  reply.status(response.status).send(response.body)
})

fastify.listen({ port: 3000 })
```

## Stacks Framework

First-class integration with Stacks:

```typescript
import {
  createAnalyticsDriver,
  createAnalyticsMiddleware,
  createDashboardActions,
  createServerTrackingMiddleware,
} from '@stacksjs/ts-analytics'

// Create the driver
const driver = await createAnalyticsDriver({
  tableName: 'AnalyticsTable',
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

app.get('/dashboard/stats', async () => {
  return actions.getDashboardStats({ startDate: '2024-01-01' })
})
```

### Stacks Models

Use the provided model definitions:

```typescript
import {
  SiteModel,
  PageViewModel,
  SessionModel,
  GoalModel,
} from '@stacksjs/ts-analytics'

// Register models with Stacks
export default {
  models: [
    SiteModel,
    PageViewModel,
    SessionModel,
    GoalModel,
  ],
}
```

## Next.js

### API Routes (App Router)

```typescript
// app/api/analytics/collect/route.ts
import { AnalyticsAPI } from '@stacksjs/ts-analytics'
import { NextRequest, NextResponse } from 'next/server'

const api = new AnalyticsAPI({ tableName: 'AnalyticsTable' })
const ctx = api.createContext(executeCommand)

export async function POST(request: NextRequest) {
  const body = await request.json()

  const response = await api.handleCollect({
    method: 'POST',
    path: '/collect',
    params: {},
    query: Object.fromEntries(request.nextUrl.searchParams),
    body,
    headers: Object.fromEntries(request.headers),
    ip: request.ip ?? request.headers.get('x-forwarded-for') ?? undefined,
    userAgent: request.headers.get('user-agent') ?? undefined,
  }, ctx)

  return NextResponse.json(response.body, { status: response.status })
}
```

### Middleware

```typescript
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Track server-side page views
  if (request.nextUrl.pathname.startsWith('/blog')) {
    // Send to analytics API
    fetch('http://localhost:3000/api/analytics/collect', {
      method: 'POST',
      body: JSON.stringify({
        s: 'my-site',
        e: 'pageview',
        u: request.url,
        r: request.headers.get('referer'),
      }),
    })
  }

  return NextResponse.next()
}
```

## Nuxt

### Server API Route

```typescript
// server/api/analytics/collect.post.ts
import { AnalyticsAPI } from '@stacksjs/ts-analytics'

const api = new AnalyticsAPI({ tableName: 'AnalyticsTable' })
const ctx = api.createContext(executeCommand)

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const response = await api.handleCollect({
    method: 'POST',
    path: '/collect',
    params: {},
    query: getQuery(event),
    body,
    headers: getHeaders(event),
    ip: getRequestIP(event),
    userAgent: getHeader(event, 'user-agent'),
  }, ctx)

  setResponseStatus(event, response.status)
  return response.body
})
```

## Generic Integration

For any framework, implement the request/response mapping:

```typescript
import { AnalyticsAPI, AnalyticsRequest, AnalyticsResponse } from '@stacksjs/ts-analytics'

const api = new AnalyticsAPI({ tableName: 'AnalyticsTable' })
const ctx = api.createContext(executeCommand)

// Convert your framework's request to AnalyticsRequest
function toAnalyticsRequest(frameworkRequest: any): AnalyticsRequest {
  return {
    method: frameworkRequest.method,
    path: frameworkRequest.path,
    params: frameworkRequest.params || {},
    query: frameworkRequest.query || {},
    body: frameworkRequest.body || {},
    headers: frameworkRequest.headers || {},
    ip: frameworkRequest.ip,
    userAgent: frameworkRequest.headers?.['user-agent'],
  }
}

// Convert AnalyticsResponse to your framework's response
function fromAnalyticsResponse(response: AnalyticsResponse): any {
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
  }
}
```

## Next Steps

- [AWS Deployment](/deploy/aws) - Deploy to production
- [Local Development](/deploy/local) - Set up development environment
- [API Reference](/guide/api) - Full API documentation
