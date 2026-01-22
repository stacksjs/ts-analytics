---
title: Goal Tracking
description: Define and track conversion goals
---

# Goal Tracking

Track conversions and measure the success of your website with goal tracking.

## Creating Goals

### Via API

```typescript
// POST /sites/:siteId/goals
const response = await fetch('/api/analytics/sites/my-site/goals', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Newsletter Signup',
    type: 'pageview',
    pattern: '/thank-you/newsletter',
    matchType: 'exact',
    value: 5,
  }),
})
```

### Programmatically

```typescript
import { AnalyticsStore } from '@stacksjs/ts-analytics'

const store = new AnalyticsStore({ tableName: 'AnalyticsTable' })

const goal = {
  id: 'goal-123',
  siteId: 'my-site',
  name: 'Purchase Complete',
  type: 'pageview',
  pattern: '/checkout/complete',
  matchType: 'exact',
  value: 99.99, // Optional monetary value
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const command = store.createGoalCommand(goal)
await executeCommand(command)
```

## Goal Types

### Page View Goals

Track when users visit specific pages:

```typescript
{
  type: 'pageview',
  pattern: '/signup/complete',
  matchType: 'exact',
}
```

### Event Goals

Track custom events:

```typescript
{
  type: 'event',
  pattern: 'purchase_completed',
  matchType: 'exact',
}
```

### Duration Goals

Track engaged sessions:

```typescript
{
  type: 'duration',
  pattern: '300', // 5 minutes in seconds
  matchType: 'gte', // Greater than or equal
}
```

## Match Types

| Type | Description | Example |
|------|-------------|---------|
| `exact` | Exact string match | `/signup` matches `/signup` only |
| `contains` | Substring match | `/blog` matches `/blog/post-1` |
| `startsWith` | Prefix match | `/docs` matches `/docs/api` |
| `regex` | Regular expression | `^/product/\d+$` matches `/product/123` |

## GoalMatcher

Use GoalMatcher to check for conversions:

```typescript
import { GoalMatcher } from '@stacksjs/ts-analytics'

const goals = [
  {
    id: 'signup',
    type: 'pageview',
    pattern: '/signup/complete',
    matchType: 'exact',
    value: 10,
  },
  {
    id: 'purchase',
    type: 'event',
    pattern: 'purchase',
    matchType: 'exact',
    value: 99,
  },
]

const matcher = new GoalMatcher(goals)

// Check page view
const pageMatches = matcher.matchPageView('/signup/complete')
// => [{ goalId: 'signup', value: 10 }]

// Check event
const eventMatches = matcher.matchEvent('purchase', { product: 'pro' })
// => [{ goalId: 'purchase', value: 99 }]
```

## Tracking Conversions

Conversions are tracked automatically when:

1. A page view matches a pageview goal
2. A custom event matches an event goal
3. A session duration exceeds a duration goal

### Manual Conversion Tracking

```typescript
const conversion = {
  id: 'conv-123',
  siteId: 'my-site',
  goalId: 'signup',
  visitorId: 'visitor-hash',
  sessionId: 'session-abc',
  value: 10,
  path: '/signup/complete',
  timestamp: new Date(),
}

const command = store.recordConversionCommand(conversion)
await executeCommand(command)
```

## Goal Statistics

### Query Goal Performance

```typescript
const queries = queryApi.generateDashboardQueries({
  siteId: 'my-site',
  dateRange: { start: startDate, end: endDate },
  includeGoals: true,
})

const goalsResult = await executeCommand(queries.goals)
```

### Goal Stats Response

```json
{
  "goals": [
    {
      "goalId": "signup",
      "name": "Newsletter Signup",
      "conversions": 1250,
      "value": 12500,
      "conversionRate": 0.025,
      "change": 0.15
    },
    {
      "goalId": "purchase",
      "name": "Purchase Complete",
      "conversions": 340,
      "value": 33660,
      "conversionRate": 0.0068,
      "change": 0.08
    }
  ]
}
```

## Dashboard Components

### GoalsPanel

Display goal performance:

```vue
<template>
  <GoalsPanel
    :goals="goals"
    :conversions="conversions"
    :show-trend="true"
  />
</template>
```

### Goal Cards

Individual goal metrics:

```vue
<template>
  <div class="goals-grid">
    <StatCard
      v-for="goal in goals"
      :key="goal.id"
      :title="goal.name"
      :value="goal.conversions"
      :change="goal.change"
      :secondary="`${formatPercentage(goal.conversionRate)} rate`"
    />
  </div>
</template>
```

## Goal Configuration Examples

### E-commerce Goals

```typescript
const ecommerceGoals = [
  {
    name: 'Add to Cart',
    type: 'event',
    pattern: 'add_to_cart',
    matchType: 'exact',
  },
  {
    name: 'Checkout Started',
    type: 'pageview',
    pattern: '/checkout',
    matchType: 'startsWith',
  },
  {
    name: 'Purchase Complete',
    type: 'pageview',
    pattern: '/order/confirmation',
    matchType: 'startsWith',
    value: 50, // Average order value
  },
]
```

### SaaS Goals

```typescript
const saasGoals = [
  {
    name: 'Signup Started',
    type: 'pageview',
    pattern: '/signup',
    matchType: 'exact',
  },
  {
    name: 'Signup Complete',
    type: 'pageview',
    pattern: '/welcome',
    matchType: 'exact',
    value: 0, // Free tier
  },
  {
    name: 'Subscription Started',
    type: 'event',
    pattern: 'subscription_started',
    matchType: 'exact',
    value: 29, // Monthly price
  },
  {
    name: 'Engaged User',
    type: 'duration',
    pattern: '180', // 3 minutes
    matchType: 'gte',
  },
]
```

### Content Goals

```typescript
const contentGoals = [
  {
    name: 'Newsletter Signup',
    type: 'event',
    pattern: 'newsletter_subscribe',
    matchType: 'exact',
    value: 5,
  },
  {
    name: 'Article Complete',
    type: 'event',
    pattern: 'scroll_depth',
    matchType: 'exact',
    // Properties: { depth: 100 }
  },
  {
    name: 'Share',
    type: 'event',
    pattern: 'share',
    matchType: 'contains',
  },
]
```

## Aggregated Goal Stats

Goals are aggregated with other metrics:

```typescript
// During hourly aggregation
const goalStats = {
  siteId: 'my-site',
  period: 'hour',
  periodStart: new Date('2024-01-15T10:00:00Z'),
  goalId: 'signup',
  conversions: 45,
  totalValue: 450,
  conversionRate: 0.025,
  topPaths: [
    { path: '/blog/post-1', conversions: 15 },
    { path: '/pricing', conversions: 12 },
  ],
}
```

## Best Practices

1. **Set clear goal values** - Assign monetary values to track ROI
2. **Use specific patterns** - Avoid overly broad matches
3. **Test your goals** - Verify patterns match expected pages
4. **Monitor conversion rates** - Set up alerts for significant changes
5. **Review regularly** - Update goals as your site evolves

## Next Steps

- [Funnel Analysis](/features/funnels) - Analyze conversion paths
- [Dashboard Components](/guide/dashboard) - Display goal metrics
- [API Endpoints](/guide/api) - Goals API reference
