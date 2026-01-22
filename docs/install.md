---
title: Installation
description: Install ts-analytics in your project
---

# Installation

## Package Installation

Install ts-analytics using your preferred package manager:

::: code-group

```bash [bun]
bun add @stacksjs/ts-analytics
```

```bash [npm]
npm install @stacksjs/ts-analytics
```

```bash [pnpm]
pnpm add @stacksjs/ts-analytics
```

```bash [yarn]
yarn add @stacksjs/ts-analytics
```

:::

## AWS Setup

ts-analytics uses DynamoDB for storage. You'll need:

1. An AWS account
2. AWS credentials with DynamoDB permissions
3. A DynamoDB table (can be created automatically)

### Environment Variables

Set up your AWS credentials:

```bash
# .env
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_DEFAULT_REGION=us-east-1
```

### IAM Permissions

Your AWS user/role needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DescribeTable",
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/AnalyticsTable*"
    }
  ]
}
```

## Create the Table

### Option 1: Using the CLI

```bash
# Generate AWS CLI command
bunx analytics create-table --table-name AnalyticsTable --region us-east-1
```

### Option 2: Using CloudFormation

```typescript
import { generateCloudFormationTemplate } from '@stacksjs/ts-analytics'

const template = generateCloudFormationTemplate({
  tableName: 'AnalyticsTable',
})

// Deploy with AWS CLI
// aws cloudformation create-stack --stack-name analytics --template-body file://template.json
```

### Option 3: Using CDK

```typescript
import { generateCdkCode } from '@stacksjs/ts-analytics'

const cdkCode = generateCdkCode({
  tableName: 'AnalyticsTable',
})

console.log(cdkCode)
// Copy to your CDK stack
```

### Option 4: Programmatically

```typescript
import { createAnalyticsTable } from '@stacksjs/ts-analytics'
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
import { AnalyticsStore } from '@stacksjs/ts-analytics'

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
