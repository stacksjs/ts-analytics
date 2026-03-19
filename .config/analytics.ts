/**
 * Analytics Configuration
 *
 * This is the configuration file for @stacksjs/analytics.
 * Copy this file to your project and customize as needed.
 *
 * @see https://github.com/stacksjs/analytics
 */

import { defineConfig } from '@stacksjs/analytics'

export default defineConfig({
  // DynamoDB Table Configuration
  table: {
    tableName: 'AnalyticsTable',
    billingMode: 'PAY_PER_REQUEST', // or 'PROVISIONED'
  },

  // AWS Configuration
  region: 'us-east-1',
  // endpoint: 'http://localhost:8000', // Uncomment for local development

  // Data Retention (in seconds)
  retention: {
    rawEventTtl: 30 * 24 * 60 * 60, // 30 days
    hourlyAggregateTtl: 90 * 24 * 60 * 60, // 90 days
    dailyAggregateTtl: 2 * 365 * 24 * 60 * 60, // 2 years
    // monthlyAggregateTtl: undefined, // Keep forever
  },

  // Privacy Settings
  privacy: {
    hashVisitorIds: true, // Hash visitor IDs for privacy
    collectGeolocation: false, // Disable IP-based geolocation
    honorDnt: true, // Respect Do Not Track header
    ipAnonymization: 'partial', // 'none' | 'partial' | 'full'
  },

  // Tracking Settings
  tracking: {
    trackReferrers: true,
    trackUtmParams: true,
    trackDeviceType: true,
    trackHashChanges: false,
    trackOutboundLinks: true,
  },

  // API Settings
  api: {
    basePath: '/api/analytics',
    corsOrigins: ['*'], // Configure for production
  },

  // Aggregation Settings
  aggregation: {
    batchSize: 100,
    hourlyEnabled: true,
    dailyEnabled: true,
    monthlyEnabled: true,
  },
})
