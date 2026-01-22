---
title: ts-analytics
description: Privacy-first analytics toolkit for web applications
---

# ts-analytics

A privacy-first analytics toolkit for web applications, powered by DynamoDB single-table design.

## Why ts-analytics?

- **Privacy-First**: No cookies required, no personal data collection, GDPR-compliant by design
- **Self-Hosted**: Full control over your analytics data in your own AWS account
- **Real-time**: Live visitor tracking and dashboard updates
- **Cost-Effective**: DynamoDB single-table design minimizes AWS costs
- **Framework Agnostic**: Works with Bun, Express, Hono, AWS Lambda, and more
- **TypeScript Native**: Built from the ground up with TypeScript

## Quick Example

```typescript
import { AnalyticsStore, generateTrackingScript } from '@stacksjs/ts-analytics'

// Generate a tracking script for your website
const script = generateTrackingScript({
  siteId: 'my-site',
  apiEndpoint: 'https://analytics.example.com/api/analytics',
  trackOutboundLinks: true,
  honorDnt: true,
})

// Add to your HTML
const html = `<html><head>${script}</head>...</html>`
```

## Features at a Glance

| Feature | Description |
|---------|-------------|
| Page View Tracking | Automatic tracking of page views and navigation |
| Custom Events | Track any custom event with properties |
| Goal Tracking | Define and monitor conversion goals |
| Funnel Analysis | Analyze user journeys and drop-off points |
| Real-time Dashboard | Live visitor counts and activity feed |
| Vue Components | Ready-to-use dashboard UI components |
| DynamoDB Single-Table | Efficient, scalable storage design |
| Privacy Compliant | No cookies, hashed visitor IDs |

## Getting Started

```bash
bun add @stacksjs/ts-analytics
```

Check out the [Quick Start Guide](/guide/getting-started) to set up your analytics in minutes.

## Framework Support

ts-analytics works with any JavaScript/TypeScript runtime:

- **Bun** - Native support with optimal performance
- **AWS Lambda** - Serverless deployment
- **Cloudflare Workers** - Edge analytics
- **Hono** - Lightweight web framework
- **Express** - Traditional Node.js apps
- **Stacks** - First-class integration

## Open Source

ts-analytics is MIT licensed and open source. Contributions are welcome!

- [GitHub Repository](https://github.com/stacksjs/ts-analytics)
- [Discord Community](https://discord.gg/stacksjs)
- [Report Issues](https://github.com/stacksjs/ts-analytics/issues)
