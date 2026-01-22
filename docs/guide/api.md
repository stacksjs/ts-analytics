---
title: API Endpoints
description: Analytics API endpoints reference
---

# API Endpoints

ts-analytics provides a complete REST API for collecting and querying analytics data.

## Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/collect` | POST | Receive tracking events |
| `/sites` | GET | List sites |
| `/sites` | POST | Create a site |
| `/sites/:siteId` | GET | Get site details |
| `/sites/:siteId/stats` | GET | Get dashboard stats |
| `/sites/:siteId/realtime` | GET | Get realtime stats |
| `/sites/:siteId/script` | GET | Get tracking script |
| `/sites/:siteId/goals` | GET | List goals |
| `/sites/:siteId/goals` | POST | Create a goal |
| `/sites/:siteId/pages` | GET | Get top pages |
| `/aggregate` | POST | Trigger aggregation |

## Setting Up the API

```typescript
import { AnalyticsAPI, createBunRouter } from '@stacksjs/ts-analytics'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'us-east-1' })

const api = new AnalyticsAPI({
  tableName: 'AnalyticsTable',
  corsOrigins: ['https://yourdomain.com'],
  basePath: '/api/analytics',
})

async function executeCommand(cmd) {
  const Command = await import('@aws-sdk/client-dynamodb').then(m => m[cmd.command])
  return client.send(new Command(cmd.input))
}

const router = createBunRouter(api, executeCommand)

Bun.serve({
  port: 3000,
  fetch: router.fetch,
})
```

## Endpoint Details

### POST /collect

Receive tracking events from the JavaScript snippet.

**Request Body:**

```json
{
  "s": "site-id",
  "sid": "session-id",
  "e": "pageview",
  "u": "https://example.com/page",
  "r": "https://google.com",
  "t": "Page Title",
  "sw": 1920,
  "sh": 1080,
  "p": {
    "path": "/page",
    "title": "Page Title"
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `s` | string | Site ID |
| `sid` | string | Session ID |
| `e` | string | Event type: `pageview`, `event`, `outbound` |
| `u` | string | Current URL |
| `r` | string | Referrer URL (optional) |
| `t` | string | Page title (optional) |
| `sw` | number | Screen width (optional) |
| `sh` | number | Screen height (optional) |
| `p` | object | Event properties (optional) |

**Response:** `204 No Content`

### GET /sites/:siteId/stats

Get dashboard statistics for a site.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start` | string | 7 days ago | Start date (ISO 8601) |
| `end` | string | now | End date (ISO 8601) |
| `period` | string | auto | Aggregation period: `hour`, `day`, `month` |
| `compare` | boolean | false | Include comparison with previous period |

**Example:**

```bash
curl "https://api.example.com/api/analytics/sites/my-site/stats?start=2024-01-01&end=2024-01-31&compare=true"
```

**Response:**

```json
{
  "summary": {
    "pageViews": 12500,
    "uniqueVisitors": 3200,
    "sessions": 4100,
    "bounceRate": 0.42,
    "avgSessionDuration": 185,
    "pagesPerSession": 3.05,
    "changes": {
      "pageViews": 0.15,
      "uniqueVisitors": 0.08,
      "sessions": 0.12
    }
  },
  "timeSeries": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "pageViews": 450,
      "uniqueVisitors": 120
    }
  ],
  "topPages": [
    { "path": "/", "pageViews": 5000, "uniqueVisitors": 2100 },
    { "path": "/blog", "pageViews": 2300, "uniqueVisitors": 980 }
  ],
  "dateRange": {
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-01-31T23:59:59Z",
    "period": "day"
  }
}
```

### GET /sites/:siteId/realtime

Get real-time visitor data.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `minutes` | number | 5 | Time window in minutes |

**Response:**

```json
{
  "currentVisitors": 42,
  "pageViews": 156,
  "activePages": [
    { "path": "/", "visitors": 15 },
    { "path": "/pricing", "visitors": 8 }
  ],
  "locations": [
    { "country": "US", "visitors": 20 },
    { "country": "UK", "visitors": 8 }
  ]
}
```

### GET /sites/:siteId/script

Get the tracking script for a site.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `api` | string | auto | API endpoint URL |
| `dnt` | boolean | true | Honor Do Not Track |
| `hash` | boolean | false | Track hash changes |
| `outbound` | boolean | true | Track outbound links |

**Response:**

```html
<script>
(function(window, document) {
  "use strict";
  // ... tracking script
})(window, document);
</script>
```

### POST /sites

Create a new site.

**Request Body:**

```json
{
  "name": "My Website",
  "domains": ["example.com", "www.example.com"],
  "timezone": "America/New_York",
  "settings": {
    "collectGeolocation": false,
    "trackReferrers": true,
    "publicDashboard": false
  }
}
```

**Response:**

```json
{
  "site": {
    "id": "site-abc123",
    "name": "My Website",
    "domains": ["example.com"],
    "timezone": "America/New_York",
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### POST /sites/:siteId/goals

Create a conversion goal.

**Request Body:**

```json
{
  "name": "Newsletter Signup",
  "type": "pageview",
  "pattern": "/thank-you/newsletter",
  "matchType": "exact",
  "value": 5
}
```

**Goal Types:**

| Type | Description |
|------|-------------|
| `pageview` | Match page view paths |
| `event` | Match custom events |
| `duration` | Session duration threshold |

**Match Types:**

| Type | Description |
|------|-------------|
| `exact` | Exact string match |
| `contains` | Substring match |
| `regex` | Regular expression match |
| `startsWith` | Prefix match |

### POST /aggregate

Trigger aggregation manually (for scheduled jobs).

**Request Body:**

```json
{
  "siteId": "my-site",
  "period": "hour",
  "windowStart": "2024-01-15T00:00:00Z",
  "windowEnd": "2024-01-15T01:00:00Z"
}
```

## Error Handling

All endpoints return errors in this format:

```json
{
  "error": "Error message describing the problem"
}
```

**Status Codes:**

| Code | Description |
|------|-------------|
| `200` | Success |
| `201` | Created |
| `204` | No Content (successful, no body) |
| `400` | Bad Request |
| `404` | Not Found |
| `500` | Internal Server Error |

## CORS Configuration

Configure CORS origins:

```typescript
const api = new AnalyticsAPI({
  tableName: 'AnalyticsTable',
  corsOrigins: [
    'https://yourdomain.com',
    'https://app.yourdomain.com',
  ],
})
```

## Authentication

Add authentication middleware:

```typescript
Bun.serve({
  port: 3000,
  async fetch(request) {
    // Verify API key or JWT
    const apiKey = request.headers.get('x-api-key')
    if (!isValidApiKey(apiKey)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return router.fetch(request)
  }
})
```

## Next Steps

- [Dashboard Components](/guide/dashboard) - Build analytics UIs
- [AWS Deployment](/deploy/aws) - Deploy the API to AWS
- [Framework Integrations](/deploy/integrations) - Use with Hono, Express, etc.
