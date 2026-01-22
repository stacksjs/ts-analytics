---
title: DynamoDB Single-Table Design
description: Efficient data storage with DynamoDB single-table pattern
---

# DynamoDB Single-Table Design

ts-analytics uses a single-table design pattern for efficient, scalable storage in DynamoDB.

## Why Single-Table Design?

Benefits:
- **Reduced latency**: Fewer network round-trips
- **Lower costs**: One table = one provisioning decision
- **Simplified operations**: One table to monitor and maintain
- **Efficient queries**: Data locality for related items

## Table Schema

### Primary Key

| Attribute | Type | Description |
|-----------|------|-------------|
| `pk` | String | Partition key |
| `sk` | String | Sort key |

### Global Secondary Indexes

#### GSI1 - Site + Date Queries

| Attribute | Type | Description |
|-----------|------|-------------|
| `gsi1pk` | String | Site-based partition |
| `gsi1sk` | String | Date-based sort |

Use case: Query all data for a site within a date range.

#### GSI2 - Visitor Queries

| Attribute | Type | Description |
|-----------|------|-------------|
| `gsi2pk` | String | Visitor-based partition |
| `gsi2sk` | String | Timestamp sort |

Use case: Query all sessions for a visitor.

## Key Patterns

### Sites

```
pk: SITE#{siteId}
sk: METADATA
```

Example:
```typescript
{
  pk: 'SITE#my-site',
  sk: 'METADATA',
  name: 'My Website',
  domains: ['example.com'],
  ownerId: 'user-123',
  // ...
}
```

### Page Views

```
pk: SITE#{siteId}
sk: PV#{timestamp}#{id}
gsi1pk: SITE#{siteId}
gsi1sk: DATE#{date}
```

Example:
```typescript
{
  pk: 'SITE#my-site',
  sk: 'PV#2024-01-15T10:30:00Z#pv-abc123',
  gsi1pk: 'SITE#my-site',
  gsi1sk: 'DATE#2024-01-15',
  path: '/blog/post-1',
  visitorId: 'visitor-hash',
  sessionId: 'session-xyz',
  // ...
}
```

### Sessions

```
pk: SITE#{siteId}
sk: SESSION#{sessionId}
gsi2pk: VISITOR#{visitorId}
gsi2sk: {timestamp}
```

### Custom Events

```
pk: SITE#{siteId}
sk: EVENT#{timestamp}#{id}
gsi1pk: SITE#{siteId}
gsi1sk: DATE#{date}
```

### Goals

```
pk: SITE#{siteId}
sk: GOAL#{goalId}
```

### Aggregated Stats

```
pk: SITE#{siteId}
sk: STATS#{period}#{periodStart}
gsi1pk: SITE#{siteId}
gsi1sk: PERIOD#{period}#{periodStart}
```

Periods: `hour`, `day`, `month`

Example:
```typescript
{
  pk: 'SITE#my-site',
  sk: 'STATS#day#2024-01-15',
  gsi1pk: 'SITE#my-site',
  gsi1sk: 'PERIOD#day#2024-01-15',
  pageViews: 1500,
  uniqueVisitors: 420,
  sessions: 550,
  bounceRate: 0.42,
  // ...
}
```

### Real-time Stats

```
pk: SITE#{siteId}
sk: REALTIME#{minute}
ttl: {10 minutes from now}
```

Example:
```typescript
{
  pk: 'SITE#my-site',
  sk: 'REALTIME#2024-01-15T10:30',
  currentVisitors: 42,
  pageViews: 156,
  activePages: { '/': 15, '/pricing': 8 },
  ttl: 1705316400, // Unix timestamp
}
```

## Access Patterns

### Pattern 1: Get Site by ID

```typescript
const command = {
  TableName: 'AnalyticsTable',
  Key: {
    pk: { S: 'SITE#my-site' },
    sk: { S: 'METADATA' },
  },
}
```

### Pattern 2: Query Page Views by Date

```typescript
const command = {
  TableName: 'AnalyticsTable',
  IndexName: 'gsi1',
  KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk BETWEEN :start AND :end',
  ExpressionAttributeValues: {
    ':pk': { S: 'SITE#my-site' },
    ':start': { S: 'DATE#2024-01-01' },
    ':end': { S: 'DATE#2024-01-31' },
  },
}
```

### Pattern 3: Query Aggregated Stats

```typescript
const command = {
  TableName: 'AnalyticsTable',
  IndexName: 'gsi1',
  KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :prefix)',
  ExpressionAttributeValues: {
    ':pk': { S: 'SITE#my-site' },
    ':prefix': { S: 'PERIOD#day#' },
  },
}
```

### Pattern 4: Get Real-time Stats

```typescript
const now = new Date()
const minutes = []
for (let i = 0; i < 5; i++) {
  const d = new Date(now.getTime() - i * 60000)
  minutes.push(`REALTIME#${d.toISOString().slice(0, 16)}`)
}

const command = {
  TableName: 'AnalyticsTable',
  KeyConditionExpression: 'pk = :pk AND sk IN (:m1, :m2, :m3, :m4, :m5)',
  ExpressionAttributeValues: {
    ':pk': { S: 'SITE#my-site' },
    ...minutes.reduce((acc, m, i) => ({ ...acc, [`:m${i + 1}`]: { S: m } }), {}),
  },
}
```

### Pattern 5: Query Visitor Sessions

```typescript
const command = {
  TableName: 'AnalyticsTable',
  IndexName: 'gsi2',
  KeyConditionExpression: 'gsi2pk = :pk',
  ExpressionAttributeValues: {
    ':pk': { S: 'VISITOR#visitor-hash' },
  },
}
```

## Using AnalyticsStore

The `AnalyticsStore` class abstracts these patterns:

```typescript
import { AnalyticsStore, AnalyticsKeyPatterns } from '@stacksjs/ts-analytics'

const store = new AnalyticsStore({
  tableName: 'AnalyticsTable',
})

// Generate keys
const keys = AnalyticsKeyPatterns

console.log(keys.site('my-site'))
// { pk: 'SITE#my-site', sk: 'METADATA' }

console.log(keys.pageView('my-site', new Date(), 'pv-123'))
// { pk: 'SITE#my-site', sk: 'PV#2024-01-15T10:30:00Z#pv-123' }
```

## TTL (Time-to-Live)

Automatic data expiration:

```typescript
const config = {
  retention: {
    rawEventTtl: 30 * 24 * 60 * 60,        // 30 days
    hourlyAggregateTtl: 90 * 24 * 60 * 60, // 90 days
    dailyAggregateTtl: 2 * 365 * 24 * 60 * 60, // 2 years
    monthlyAggregateTtl: 0,                 // Never expire
  },
}
```

Items include a `ttl` attribute with Unix timestamp:

```typescript
{
  pk: 'SITE#my-site',
  sk: 'PV#...',
  // ...
  ttl: 1707955200, // 30 days from creation
}
```

## Data Aggregation

Raw events are aggregated into statistics:

```
Raw Events (30 days) → Hourly Stats (90 days) → Daily Stats (2 years) → Monthly Stats (forever)
```

### Aggregation Process

```typescript
import { AggregationPipeline, AnalyticsAggregator } from '@stacksjs/ts-analytics'

const pipeline = new AggregationPipeline(store)
const aggregator = new AnalyticsAggregator({ tableName: 'AnalyticsTable' })

// Hourly aggregation (run every hour)
await aggregator.aggregateHourly('my-site', new Date())

// Daily aggregation (run at midnight)
await aggregator.aggregateDaily('my-site', new Date())

// Monthly aggregation (run on 1st of month)
await aggregator.aggregateMonthly('my-site', new Date())
```

## Capacity Planning

### On-Demand (Recommended)

```typescript
{
  billingMode: 'PAY_PER_REQUEST',
}
```

- No capacity planning needed
- Automatic scaling
- Pay only for what you use

### Provisioned

For predictable workloads:

```typescript
{
  billingMode: 'PROVISIONED',
  readCapacity: 100,
  writeCapacity: 50,
}
```

### Capacity Estimates

| Events/Day | Read Units | Write Units | Monthly Cost |
|------------|------------|-------------|--------------|
| 10,000 | ~5 | ~3 | ~$5 |
| 100,000 | ~50 | ~30 | ~$50 |
| 1,000,000 | ~500 | ~300 | ~$500 |

*Estimates based on on-demand pricing, actual costs may vary.*

## Design Documentation

Generate design documentation:

```typescript
import {
  generateAnalyticsSingleTableDesign,
  generateAccessPatternMatrix,
  generateAnalyticsDesignDoc,
} from '@stacksjs/ts-analytics'

// Get the single-table design
const design = generateAnalyticsSingleTableDesign()

// Get access pattern matrix
const matrix = generateAccessPatternMatrix()

// Get full markdown documentation
const doc = generateAnalyticsDesignDoc()
```

## Next Steps

- [Infrastructure](/guide/infrastructure) - Generate infrastructure code
- [AWS Deployment](/deploy/aws) - Deploy to production
- [Local Development](/deploy/local) - Test locally
