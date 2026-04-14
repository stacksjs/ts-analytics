---
title: Why ts-analytics
description: The motivation behind building a privacy-first analytics toolkit
---
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
