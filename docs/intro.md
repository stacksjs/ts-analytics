---
title: Why ts-analytics
description: The motivation behind building a privacy-first analytics toolkit
---

```typescript
// No cookies needed - visitor IDs are hashed daily
const visitorId = await AnalyticsStore.hashVisitorId(
  ip,
  userAgent,
  siteId,
  dailySalt // Rotates every day, making tracking impossible
)
```

- **No Cookies**: Uses sessionStorage and hashed identifiers
- **IP Anonymization**: Visitor IDs are one-way hashed
- **DNT Respect**: Honors Do Not Track browser settings
- **GDPR Compliant**: No personal data retention

### Self-Hosted Control

Your analytics data stays in your AWS account:

- Full ownership of your data
- No third-party access
- Comply with data residency requirements
- Export and analyze data however you want

### Cost-Effective Architecture

DynamoDB single-table design minimizes costs:

```typescript
// One table handles all analytics data
const config = {
  table: {
    tableName: 'AnalyticsTable',
    billingMode: 'PAY_PER_REQUEST', // Only pay for what you use
  },
}
```

- Pay-per-request pricing
- Automatic scaling
- No idle costs
- Efficient key patterns

### TypeScript Native

Built from the ground up with TypeScript:

```typescript
import type { PageView, Session, Goal } from '@stacksjs/ts-analytics'

// Full type safety for all analytics operations
const pageView: PageView = {
  id: 'pv-123',
  siteId: 'site-1',
  path: '/blog/post',
  timestamp: new Date(),
  // TypeScript ensures all required fields
}
```

## Comparison

| Feature | ts-analytics | Google Analytics | Plausible | Fathom |
|---------|-------------|------------------|-----------|--------|
| Self-hosted | Yes | No | Partial | No |
| No cookies | Yes | No | Yes | Yes |
| Open source | Yes | No | Yes | No |
| TypeScript SDK | Yes | Partial | No | No |
| Vue Components | Yes | No | No | No |
| DynamoDB | Yes | No | No | No |
| Free tier | Unlimited | Yes | No | No |

## Use Cases

### SaaS Applications

Track user engagement, feature usage, and conversion funnels:

```typescript
// Track feature usage
sa('event', 'feature_used', { feature: 'export', plan: 'pro' })

// Track conversions
sa('event', 'subscription_started', { plan: 'enterprise', value: 499 })
```

### Content Sites

Monitor page performance and reader engagement:

```typescript
// Track scroll depth
generateFullTrackingScript({
  trackScrollDepth: [25, 50, 75, 100],
  trackTimeOnPage: [30, 60, 120, 300],
})
```

### E-commerce

Analyze shopping behavior and checkout funnels:

```typescript
import { ecommerceCheckoutFunnel, FunnelAnalyzer } from '@stacksjs/ts-analytics'

const analyzer = new FunnelAnalyzer()
const analysis = analyzer.analyze(ecommerceCheckoutFunnel, userJourneys)
```

## Getting Started

Ready to take control of your analytics? Check out the [Installation Guide](/install) to get started.
