---
title: Infrastructure
description: Generate infrastructure code for AWS deployment
---

# Infrastructure

ts-analytics can generate infrastructure code for deploying to AWS.

## CloudFormation

Generate CloudFormation templates:

```typescript
import {
  generateCloudFormationTemplate,
  generateCloudFormationJson,
  generateCloudFormationYaml,
} from '@stacksjs/ts-analytics'

// Get the template object
const template = generateCloudFormationTemplate({
  tableName: 'AnalyticsTable',
  billingMode: 'PAY_PER_REQUEST',
})

// Or get JSON string
const json = generateCloudFormationJson({
  tableName: 'AnalyticsTable',
})

// Or get YAML string
const yaml = generateCloudFormationYaml({
  tableName: 'AnalyticsTable',
})
```

Deploy with AWS CLI:

```bash
aws cloudformation create-stack \
  --stack-name analytics \
  --template-body file://template.json \
  --capabilities CAPABILITY_IAM
```

## AWS CDK

Generate CDK code:

```typescript
import { generateCdkCode, generateCdkTableCode } from '@stacksjs/ts-analytics'

// Full CDK stack
const cdkStack = generateCdkCode({
  tableName: 'AnalyticsTable',
  stackName: 'AnalyticsStack',
})

// Just the table construct
const tableCode = generateCdkTableCode({
  tableName: 'AnalyticsTable',
})

console.log(cdkStack)
```

Output:

```typescript
import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'

export class AnalyticsStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const table = new dynamodb.Table(this, 'AnalyticsTable', {
      tableName: 'AnalyticsTable',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    })

    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    })
  }
}
```

## SAM (Serverless Application Model)

Generate SAM templates:

```typescript
import { generateSamTemplate, generateSamYaml } from '@stacksjs/ts-analytics'

const samTemplate = generateSamTemplate({
  tableName: 'AnalyticsTable',
  functionName: 'AnalyticsFunction',
})

const samYaml = generateSamYaml({
  tableName: 'AnalyticsTable',
})
```

Deploy with SAM CLI:

```bash
sam deploy \
  --template-file template.yaml \
  --stack-name analytics-api \
  --capabilities CAPABILITY_IAM
```

## AWS CLI Commands

Generate direct AWS CLI commands:

```typescript
import { generateAwsCliCommands, generateAwsCliCommand } from '@stacksjs/ts-analytics'

// Full setup commands
const commands = generateAwsCliCommands({
  tableName: 'AnalyticsTable',
  region: 'us-east-1',
})

console.log(commands)
```

Output:

```bash
# Create DynamoDB table
aws dynamodb create-table \
  --table-name AnalyticsTable \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
    AttributeName=gsi1pk,AttributeType=S \
    AttributeName=gsi1sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes \
    "IndexName=gsi1,KeySchema=[{AttributeName=gsi1pk,KeyType=HASH},{AttributeName=gsi1sk,KeyType=RANGE}],Projection={ProjectionType=ALL}" \
  --region us-east-1
```

## Table Setup

### Create Table Programmatically

```typescript
import { createAnalyticsTable } from '@stacksjs/ts-analytics'
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'us-east-1' })

const result = await createAnalyticsTable(
  client,
  {
    tableName: 'AnalyticsTable',
    billingMode: 'PAY_PER_REQUEST',
  },
  { CreateTableCommand, DescribeTableCommand }
)

console.log('Table created:', result.TableDescription?.TableName)
```

### Check Table Status

```typescript
import { checkTableStatus } from '@stacksjs/ts-analytics'

const status = await checkTableStatus(client, 'AnalyticsTable')
console.log('Table status:', status)
// { exists: true, status: 'ACTIVE', itemCount: 1500 }
```

### Enable TTL

```typescript
import { enableTtl } from '@stacksjs/ts-analytics'

await enableTtl(client, 'AnalyticsTable', 'ttl')
```

## Migrations

Run database migrations:

```typescript
import {
  runMigrations,
  createTimeBasedGsiMigration,
  createStreamsMigration,
  createPitrMigration,
} from '@stacksjs/ts-analytics'

// Run all pending migrations
const results = await runMigrations(client, 'AnalyticsTable', [
  createTimeBasedGsiMigration(),
  createStreamsMigration(),
  createPitrMigration(),
])

for (const result of results) {
  console.log(`${result.name}: ${result.success ? 'Success' : result.error}`)
}
```

### Available Migrations

| Migration | Description |
|-----------|-------------|
| `createTimeBasedGsiMigration` | Add time-based GSI for efficient date queries |
| `createStreamsMigration` | Enable DynamoDB Streams for real-time triggers |
| `createPitrMigration` | Enable Point-in-Time Recovery for backups |

## Setup Instructions

Print setup instructions:

```typescript
import { printSetupInstructions } from '@stacksjs/ts-analytics'

printSetupInstructions({
  tableName: 'AnalyticsTable',
  region: 'us-east-1',
})
```

Output:

```
=== ts-analytics Setup Instructions ===

1. Create DynamoDB Table:
   Run: aws dynamodb create-table ...

2. Configure Environment:
   AWS_ACCESS_KEY_ID=your-key
   AWS_SECRET_ACCESS_KEY=your-secret
   AWS_REGION=us-east-1
   ANALYTICS_TABLE=AnalyticsTable

3. Initialize the Store:
   const store = new AnalyticsStore({ tableName: 'AnalyticsTable' })

4. Add Tracking Script:
   <script src="https://your-api.com/sites/your-site/tracker.js"></script>
```

## DynamoDB Single-Table Design

ts-analytics uses a single-table design for efficiency:

### Key Patterns

| Entity | PK | SK |
|--------|----|----|
| Site | `SITE#{siteId}` | `METADATA` |
| PageView | `SITE#{siteId}` | `PV#{timestamp}#{id}` |
| Session | `SITE#{siteId}` | `SESSION#{sessionId}` |
| CustomEvent | `SITE#{siteId}` | `EVENT#{timestamp}#{id}` |
| Goal | `SITE#{siteId}` | `GOAL#{goalId}` |
| Stats | `SITE#{siteId}` | `STATS#{period}#{timestamp}` |
| Realtime | `SITE#{siteId}` | `REALTIME#{minute}` |

### GSI1 (Site + Date Queries)

| Entity | GSI1PK | GSI1SK |
|--------|--------|--------|
| PageView | `SITE#{siteId}` | `DATE#{date}` |
| Stats | `SITE#{siteId}` | `PERIOD#{period}#{date}` |

### GSI2 (Visitor Queries)

| Entity | GSI2PK | GSI2SK |
|--------|--------|--------|
| Session | `VISITOR#{visitorId}` | `{timestamp}` |

## Generate Design Documentation

```typescript
import { generateAnalyticsDesignDoc } from '@stacksjs/ts-analytics'

const doc = generateAnalyticsDesignDoc()
console.log(doc)
// Markdown documentation of the single-table design
```

## Next Steps

- [AWS Deployment](/deploy/aws) - Complete deployment guide
- [Local Development](/deploy/local) - Set up local environment
- [DynamoDB Features](/features/dynamodb) - Learn about the data model
