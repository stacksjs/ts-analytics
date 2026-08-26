---
title: Installation
description: Install ts-analytics in your project
---

## Create the Table

### Option 1: Using the CLI

```bash

# Generate AWS CLI command

bunx analytics create-table --table-name AnalyticsTable --region us-east-1
```

### Option 2: Using CloudFormation

```typescript
import { generateCloudFormationTemplate } from '@ts-analytics/tracking'

const template = generateCloudFormationTemplate({
  tableName: 'AnalyticsTable',
})

// Deploy with AWS CLI
// aws cloudformation create-stack --stack-name analytics --template-body file://template.json
```

### Option 3: Using CDK

```typescript
import { generateCdkCode } from '@ts-analytics/tracking'

const cdkCode = generateCdkCode({
  tableName: 'AnalyticsTable',
})

console.log(cdkCode)
// Copy to your CDK stack
```

### Option 4: Programmatically

```typescript
import { createAnalyticsTable } from '@ts-analytics/tracking'
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'us-east-1' })

await createAnalyticsTable(client, {
  tableName: 'AnalyticsTable',
  billingMode: 'PAY_PER_REQUEST',
}, { CreateTableCommand, DescribeTableCommand })
```

## Verify Installation

Test your setup:

```typescript
import { AnalyticsStore } from '@ts-analytics/tracking'

const store = new AnalyticsStore({
  tableName: 'AnalyticsTable',
})

// Create a test site
const siteCommand = store.createSiteCommand({
  id: 'test-site',
  name: 'Test Site',
  domains: ['localhost'],
  ownerId: 'test-user',
  timezone: 'UTC',
  isActive: true,
  settings: {
    collectGeolocation: false,
    trackReferrers: true,
    trackUtmParams: true,
    trackDeviceType: true,
    publicDashboard: false,
    excludedPaths: [],
    excludedIps: [],
    dataRetentionDays: 365,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
})

console.log('Setup complete!')
```

## Local Development

For local development, use DynamoDB Local:

```bash

# Generate Docker Compose file

bunx analytics docker-compose --port 8000
```

This creates a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  dynamodb-local:
    image: amazon/dynamodb-local:latest
    ports:

      - "8000:8000"

    command: ["-jar", "DynamoDBLocal.jar", "-sharedDb"]
```

Then configure your store:

```typescript
const store = new AnalyticsStore({
  tableName: 'AnalyticsTable',
  // DynamoDB Local endpoint is automatically detected
})
```

## Next Steps

- [Quick Start Guide](/guide/getting-started) - Set up tracking in minutes
- [Configuration](/config) - Customize your analytics setup
- [Tracking Script](/guide/tracking-script) - Add tracking to your website
