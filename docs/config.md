---
title: Configuration
description: Configure ts-analytics for your needs
---
    trackUtmParams: true,
    trackDeviceType: true,
    trackHashChanges: false,     // SPA hash-based routing
    trackOutboundLinks: true,
  },

  // API Settings
  api: {
    basePath: '/api/analytics',
    corsOrigins: ['_'],          // Configure for production
  },

  // Aggregation Settings
  aggregation: {
    batchSize: 100,
    hourlyEnabled: true,
    dailyEnabled: true,
    monthlyEnabled: true,
  },
}
```

## Environment-Specific Configuration

Use environment variables to override configuration:

```typescript
import { defineConfig, getConfig } from '@stacksjs/ts-analytics'

const config = defineConfig({
  table: {
    tableName: process.env.ANALYTICS_TABLE || 'AnalyticsTable',
  },
  region: process.env.AWS_REGION || 'us-east-1',
  api: {
    corsOrigins: process.env.NODE_ENV === 'production'
      ? ['https://yourdomain.com']
      : ['_'],
  },
})

export default config
```

## Tracking Script Configuration

Configure the client-side tracking script:

```typescript
import { generateFullTrackingScript } from '@stacksjs/ts-analytics'

const script = generateFullTrackingScript({
  // Required
  siteId: 'my-site',
  apiEndpoint: 'https://analytics.example.com/api/analytics',

  // Page View Tracking
  autoPageView: true,           // Auto-track page views
  trackHashChanges: false,      // Track hash changes as page views

  // Engagement Tracking
  trackOutboundLinks: true,     // Track clicks to external links
  trackScrollDepth: [25, 50, 75, 100], // Track scroll percentages
  trackTimeOnPage: [30, 60, 120, 300], // Track time intervals (seconds)

  // Privacy
  honorDnt: true,               // Respect Do Not Track
  excludePaths: ['/admin/_', '/api/_'], // Exclude paths from tracking
  excludeQueryParams: false,    // Strip query params from URLs

  // Session
  sessionTimeout: 30,           // Session timeout in minutes
  cookieDomain: '.example.com', // Cross-subdomain tracking

  // Development
  debug: false,                 // Enable console logging
  minify: true,                 // Minify output script
})
```

## Site Settings

Configure per-site settings:

```typescript
import type { SiteSettings } from '@stacksjs/ts-analytics'

const siteSettings: SiteSettings = {
  collectGeolocation: false,    // Geo IP lookup
  trackReferrers: true,         // Track traffic sources
  trackUtmParams: true,         // Track UTM campaign params
  trackDeviceType: true,        // Track device/browser/OS
  publicDashboard: false,       // Public stats page
  excludedPaths: ['/admin'],    // Paths to exclude
  excludedIps: ['127.0.0.1'],   // IPs to exclude
  dataRetentionDays: 365,       // Data retention period
}
```

## API Configuration

Configure the Analytics API:

```typescript
import { AnalyticsAPI } from '@stacksjs/ts-analytics'

const api = new AnalyticsAPI({
  tableName: 'AnalyticsTable',
  corsOrigins: ['https://yourdomain.com'],
  useTtl: true,
  rawEventTtl: 30 _ 24 _ 60 * 60, // 30 days
  basePath: '/api/analytics',
})
```

## Default Configuration

Access the default configuration:

```typescript
import { defaultConfig, defaultAnalyticsConfig } from '@stacksjs/ts-analytics'

console.log(defaultConfig)
// {
//   table: { tableName: 'AnalyticsTable', billingMode: 'PAY_PER_REQUEST', ... },
//   region: 'us-east-1',
//   retention: { rawEventTtl: 2592000, ... },
//   privacy: { hashVisitorIds: true, ... },
//   ...
// }
```

## Runtime Configuration

Update configuration at runtime:

```typescript
import { setConfig, getConfig, resetConfig } from '@stacksjs/ts-analytics'

// Update config
setConfig({
  table: { tableName: 'CustomTable' },
})

// Get current config
const current = getConfig()

// Reset to defaults
resetConfig()
```

## Next Steps

- [Tracking Script Guide](/guide/tracking-script) - Add tracking to your site
- [API Endpoints](/guide/api) - Set up the analytics API
- [AWS Deployment](/deploy/aws) - Deploy to production
