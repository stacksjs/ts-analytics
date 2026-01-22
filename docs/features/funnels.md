---
title: Funnel Analysis
description: Analyze user journeys and conversion paths
---

# Funnel Analysis

Track and analyze multi-step user journeys to identify conversion opportunities and drop-off points.

## Overview

Funnel analysis helps you understand:
- How users progress through key flows
- Where users drop off
- Conversion rates at each step
- Optimization opportunities

## Creating Funnels

### Define a Funnel

```typescript
import { createFunnel } from '@stacksjs/ts-analytics'

const checkoutFunnel = createFunnel({
  id: 'checkout',
  name: 'Checkout Flow',
  steps: [
    {
      name: 'View Product',
      type: 'pageview',
      pattern: '/product/*',
      matchType: 'startsWith',
    },
    {
      name: 'Add to Cart',
      type: 'event',
      pattern: 'add_to_cart',
      matchType: 'exact',
    },
    {
      name: 'View Cart',
      type: 'pageview',
      pattern: '/cart',
      matchType: 'exact',
    },
    {
      name: 'Checkout',
      type: 'pageview',
      pattern: '/checkout',
      matchType: 'startsWith',
    },
    {
      name: 'Purchase',
      type: 'pageview',
      pattern: '/order/confirmation',
      matchType: 'startsWith',
    },
  ],
})
```

## Built-in Funnels

ts-analytics includes pre-built funnels for common use cases:

### E-commerce Checkout

```typescript
import { ecommerceCheckoutFunnel } from '@stacksjs/ts-analytics'

// Steps: Product View → Add to Cart → Cart → Checkout → Purchase
```

### SaaS Signup

```typescript
import { saasSignupFunnel } from '@stacksjs/ts-analytics'

// Steps: Landing → Signup → Email Verify → Onboarding → Activated
```

### Content Engagement

```typescript
import { contentEngagementFunnel } from '@stacksjs/ts-analytics'

// Steps: Article View → Scroll 50% → Scroll 100% → Share/Subscribe
```

## Analyzing Funnels

### FunnelAnalyzer

```typescript
import { FunnelAnalyzer } from '@stacksjs/ts-analytics'

const analyzer = new FunnelAnalyzer()

// Analyze user journeys against a funnel
const analysis = analyzer.analyze(checkoutFunnel, userJourneys)

console.log(analysis)
// {
//   funnel: { id: 'checkout', name: 'Checkout Flow', ... },
//   steps: [
//     { name: 'View Product', entered: 10000, completed: 10000, dropOff: 0, rate: 1.0 },
//     { name: 'Add to Cart', entered: 10000, completed: 3500, dropOff: 6500, rate: 0.35 },
//     { name: 'View Cart', entered: 3500, completed: 2800, dropOff: 700, rate: 0.80 },
//     { name: 'Checkout', entered: 2800, completed: 2100, dropOff: 700, rate: 0.75 },
//     { name: 'Purchase', entered: 2100, completed: 1500, dropOff: 600, rate: 0.71 },
//   ],
//   totalConversionRate: 0.15,
//   totalEntries: 10000,
//   totalConversions: 1500,
// }
```

### Calculate Drop-Off Rate

```typescript
import { calculateDropOffRate } from '@stacksjs/ts-analytics'

const dropOff = calculateDropOffRate(3500, 2800)
// 0.20 (20% drop-off)
```

### Identify Drop-Off Points

```typescript
import { identifyDropOffPoints } from '@stacksjs/ts-analytics'

const problems = identifyDropOffPoints(analysis, {
  threshold: 0.30, // Flag steps with >30% drop-off
})

// Returns steps where drop-off exceeds threshold
```

## User Journeys

### Collecting Journey Data

```typescript
// Track user journey through the session
const journey = {
  visitorId: 'visitor-hash',
  sessionId: 'session-123',
  steps: [
    { type: 'pageview', path: '/product/shoes', timestamp: '...' },
    { type: 'event', name: 'add_to_cart', timestamp: '...' },
    { type: 'pageview', path: '/cart', timestamp: '...' },
    { type: 'pageview', path: '/checkout', timestamp: '...' },
    // User abandoned here
  ],
}
```

### Query Journeys from Store

```typescript
// Get sessions with their events for funnel analysis
const sessionsCommand = store.querySessionsCommand('my-site', {
  start: new Date('2024-01-01'),
  end: new Date('2024-01-31'),
})

const sessions = await executeCommand(sessionsCommand)

// For each session, get the events
const journeys = await Promise.all(
  sessions.Items.map(async (session) => {
    const eventsCommand = store.querySessionEventsCommand(session.id)
    const events = await executeCommand(eventsCommand)
    return {
      sessionId: session.id,
      steps: events.Items,
    }
  })
)
```

## Dashboard Component

### FunnelChart

```vue
<template>
  <FunnelChart
    :steps="[
      { name: 'View Product', count: 10000 },
      { name: 'Add to Cart', count: 3500 },
      { name: 'View Cart', count: 2800 },
      { name: 'Checkout', count: 2100 },
      { name: 'Purchase', count: 1500 },
    ]"
    :show-percentages="true"
    :show-drop-off="true"
  />
</template>
```

### Funnel Report

```vue
<template>
  <div class="funnel-report">
    <h2>{{ funnel.name }}</h2>

    <div class="overall-stats">
      <StatCard
        title="Conversion Rate"
        :value="analysis.totalConversionRate"
        format="percentage"
      />
      <StatCard
        title="Total Conversions"
        :value="analysis.totalConversions"
      />
    </div>

    <FunnelChart :steps="analysis.steps" />

    <DataTable
      :columns="[
        { key: 'name', label: 'Step' },
        { key: 'entered', label: 'Entered' },
        { key: 'completed', label: 'Completed' },
        { key: 'rate', label: 'Rate', format: 'percentage' },
        { key: 'dropOff', label: 'Drop-off' },
      ]"
      :data="analysis.steps"
    />
  </div>
</template>
```

## Funnel Report Generation

### Text Report

```typescript
import { formatFunnelReport } from '@stacksjs/ts-analytics'

const report = formatFunnelReport(analysis)
console.log(report)

// Output:
// Checkout Flow Funnel Analysis
// =============================
//
// Overall Conversion: 15.0% (1,500 / 10,000)
//
// Step Breakdown:
// 1. View Product: 10,000 → 10,000 (100.0%)
// 2. Add to Cart: 10,000 → 3,500 (35.0%) ⚠️ High drop-off
// 3. View Cart: 3,500 → 2,800 (80.0%)
// 4. Checkout: 2,800 → 2,100 (75.0%)
// 5. Purchase: 2,100 → 1,500 (71.4%)
//
// Recommendations:
// - Add to Cart step has 65% drop-off - consider improving product pages
```

## Best Practices

### 1. Define Clear Steps

Each step should represent a distinct user action:

```typescript
// Good: Clear, measurable steps
const goodFunnel = createFunnel({
  steps: [
    { name: 'Landing Page', type: 'pageview', pattern: '/' },
    { name: 'Pricing Page', type: 'pageview', pattern: '/pricing' },
    { name: 'Signup Click', type: 'event', pattern: 'signup_click' },
    { name: 'Signup Complete', type: 'pageview', pattern: '/welcome' },
  ],
})

// Avoid: Ambiguous or overlapping steps
```

### 2. Order Steps Sequentially

Funnel steps should follow the natural user flow:

```typescript
// ✅ Correct order
const funnel = createFunnel({
  steps: [
    { name: 'Browse', ... },
    { name: 'Add to Cart', ... },
    { name: 'Checkout', ... },
    { name: 'Purchase', ... },
  ],
})
```

### 3. Set Appropriate Thresholds

Define what constitutes a problematic drop-off:

```typescript
// Different thresholds for different funnel types
const thresholds = {
  checkout: 0.25,    // Expect ≤25% drop-off per step
  signup: 0.35,      // More drop-off acceptable
  onboarding: 0.20,  // Less drop-off expected
}
```

### 4. Segment Your Analysis

Analyze funnels by user segments:

```typescript
// Analyze by device type
const mobileJourneys = journeys.filter(j => j.device === 'mobile')
const desktopJourneys = journeys.filter(j => j.device === 'desktop')

const mobileAnalysis = analyzer.analyze(funnel, mobileJourneys)
const desktopAnalysis = analyzer.analyze(funnel, desktopJourneys)

// Compare conversion rates
console.log('Mobile:', mobileAnalysis.totalConversionRate)
console.log('Desktop:', desktopAnalysis.totalConversionRate)
```

## Next Steps

- [Goal Tracking](/features/goals) - Track individual conversions
- [Dashboard Components](/guide/dashboard) - Display funnel charts
- [DynamoDB Design](/features/dynamodb) - Data storage patterns
