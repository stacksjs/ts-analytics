---
title: AnalyticsStore
description: API reference for AnalyticsStore
---

Parse user agent string into device info.

```typescript
const deviceInfo = AnalyticsStore.parseUserAgent(userAgent)
// { deviceType: 'desktop', browser: 'Chrome', browserVersion: '120', os: 'macOS', osVersion: '14' }
```

### parseReferrerSource

Parse referrer URL into source category.

```typescript
const source = AnalyticsStore.parseReferrerSource('https://google.com/search')
// 'google'
```

### getPeriodStart

Get the start of an aggregation period.

```typescript
const periodStart = AnalyticsStore.getPeriodStart(new Date(), 'hour')
// Date at start of current hour
```

## Instance Methods

### Site Operations

#### createSiteCommand

```typescript
const command = store.createSiteCommand({
  id: 'site-123',
  name: 'My Website',
  domains: ['example.com'],
  ownerId: 'user-456',
  timezone: 'UTC',
  isActive: true,
  settings: { /* ... */ },
  createdAt: new Date(),
  updatedAt: new Date(),
})
```

#### getSiteCommand

```typescript
const command = store.getSiteCommand('site-123')
```

#### listSitesByOwnerCommand

```typescript
const command = store.listSitesByOwnerCommand('user-456')
```

### Page View Operations

#### recordPageViewCommand

```typescript
const command = store.recordPageViewCommand({
  id: 'pv-789',
  siteId: 'site-123',
  visitorId: 'visitor-hash',
  sessionId: 'session-abc',
  path: '/blog/post',
  hostname: 'example.com',
  timestamp: new Date(),
  // ... other fields
})
```

#### queryPageViewsCommand

```typescript
const command = store.queryPageViewsCommand('site-123', {
  start: new Date('2024-01-01'),
  end: new Date('2024-01-31'),
})
```

### Session Operations

#### upsertSessionCommand

```typescript
const command = store.upsertSessionCommand({
  id: 'session-abc',
  siteId: 'site-123',
  visitorId: 'visitor-hash',
  entryPath: '/',
  pageViewCount: 5,
  // ... other fields
})
```

#### querySessionsCommand

```typescript
const command = store.querySessionsCommand('site-123', {
  start: new Date('2024-01-01'),
  end: new Date('2024-01-31'),
})
```

### Custom Event Operations

#### recordCustomEventCommand

```typescript
const command = store.recordCustomEventCommand({
  id: 'event-xyz',
  siteId: 'site-123',
  visitorId: 'visitor-hash',
  sessionId: 'session-abc',
  name: 'button_click',
  properties: { button: 'signup' },
  timestamp: new Date(),
})
```

### Goal Operations

#### createGoalCommand

```typescript
const command = store.createGoalCommand({
  id: 'goal-123',
  siteId: 'site-123',
  name: 'Signup',
  type: 'pageview',
  pattern: '/signup/complete',
  matchType: 'exact',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
```

#### listGoalsCommand

```typescript
const command = store.listGoalsCommand('site-123')
```

### Statistics Operations

#### getAggregatedStatsCommand

```typescript
const command = store.getAggregatedStatsCommand(
  'site-123',
  'day',
  new Date('2024-01-01'),
  new Date('2024-01-31')
)
```

#### getTopPagesCommand

```typescript
const command = store.getTopPagesCommand(
  'site-123',
  'day',
  new Date('2024-01-15'),
  10 // limit
)
```

#### getRealtimeStatsCommand

```typescript
const command = store.getRealtimeStatsCommand('site-123', 5) // last 5 minutes
```

#### updateRealtimeStatsCommand

```typescript
const command = store.updateRealtimeStatsCommand({
  siteId: 'site-123',
  minute: '2024-01-15T10:30',
  currentVisitors: 42,
  pageViews: 156,
  activePages: { '/': 15, '/pricing': 8 },
  ttl: Math.floor(Date.now() / 1000) + 600,
})
```

## Types

### Site

```typescript
interface Site {
  id: string
  name: string
  domains: string[]
  timezone: string
  isActive: boolean
  ownerId: string
  settings: SiteSettings
  createdAt: Date
  updatedAt: Date
}
```

### PageView

```typescript
interface PageView {
  id: string
  siteId: string
  visitorId: string
  sessionId: string
  path: string
  hostname: string
  title?: string
  referrer?: string
  referrerSource?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  deviceType: DeviceType
  browser?: string
  browserVersion?: string
  os?: string
  osVersion?: string
  screenWidth?: number
  screenHeight?: number
  isUnique: boolean
  isBounce: boolean
  timestamp: Date
}
```

### Session

```typescript
interface Session {
  id: string
  siteId: string
  visitorId: string
  entryPath: string
  exitPath: string
  referrer?: string
  referrerSource?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  country?: string
  deviceType: DeviceType
  browser?: string
  os?: string
  pageViewCount: number
  eventCount: number
  isBounce: boolean
  duration: number
  startedAt: Date
  endedAt: Date
}
```

## See Also

- [AnalyticsAPI](/api/analytics-api) - HTTP API handler
- [AnalyticsQueryAPI](/guide/api) - Query helpers
- [DynamoDB Design](/features/dynamodb) - Single-table design
