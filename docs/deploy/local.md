---
title: Local Development
description: Set up ts-analytics for local development
---

# Local Development

Set up a local development environment with DynamoDB Local.

## Quick Start

### 1. Generate Docker Compose

```bash
bunx analytics docker-compose --port 8000
```

This creates `docker-compose.yml`:

```yaml
version: '3.8'
services:
  dynamodb-local:
    image: amazon/dynamodb-local:latest
    container_name: analytics-dynamodb
    ports:
      - "8000:8000"
    command: ["-jar", "DynamoDBLocal.jar", "-sharedDb", "-inMemory"]
    volumes:
      - dynamodb-data:/home/dynamodblocal/data

volumes:
  dynamodb-data:
```

### 2. Start DynamoDB Local

```bash
docker-compose up -d
```

### 3. Create the Table

```typescript
import { createAnalyticsTable } from '@stacksjs/ts-analytics'
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({
  region: 'local',
  endpoint: 'http://localhost:8000',
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  },
})

await createAnalyticsTable(client, {
  tableName: 'AnalyticsTable',
  billingMode: 'PAY_PER_REQUEST',
}, { CreateTableCommand, DescribeTableCommand })
```

### 4. Run the Development Server

```typescript
// server.ts
import { AnalyticsAPI, createBunRouter, generateTrackingScript } from '@stacksjs/ts-analytics'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({
  region: 'local',
  endpoint: 'http://localhost:8000',
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  },
})

const api = new AnalyticsAPI({
  tableName: 'AnalyticsTable',
  corsOrigins: ['*'],
})

async function executeCommand(cmd: { command: string; input: Record<string, unknown> }) {
  const Command = await import('@aws-sdk/client-dynamodb').then(m => m[cmd.command])
  return client.send(new Command(cmd.input))
}

const router = createBunRouter(api, executeCommand)

Bun.serve({
  port: 3000,
  fetch(request) {
    const url = new URL(request.url)

    // Serve a test page
    if (url.pathname === '/') {
      const script = generateTrackingScript({
        siteId: 'test-site',
        apiEndpoint: 'http://localhost:3000/api/analytics',
        debug: true,
      })

      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Analytics Test</title>
          ${script}
        </head>
        <body>
          <h1>Analytics Test Page</h1>
          <p>Open the browser console to see tracking events.</p>
          <button onclick="sa('event', 'button_click', { button: 'test' })">
            Track Event
          </button>
          <a href="https://example.com">Outbound Link</a>
        </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    return router.fetch(request)
  },
})

console.log('Analytics server running at http://localhost:3000')
```

Run with:

```bash
bun run server.ts
```

## Seed Data

Generate test data for development:

```bash
bunx analytics seed --sites 3 --page-views 1000 --sessions 200 --days 30
```

Or programmatically:

```typescript
import { generateSeedData } from '@stacksjs/ts-analytics'

const seedData = generateSeedData({
  sites: 3,
  pageViewsPerSite: 1000,
  sessionsPerSite: 200,
  daysOfHistory: 30,
})

// Insert into DynamoDB
for (const item of seedData) {
  const command = {
    TableName: 'AnalyticsTable',
    Item: item,
  }
  await client.send(new PutItemCommand(command))
}
```

## CLI Commands

The analytics CLI helps with local development:

```bash
# Print setup instructions
bunx analytics setup

# Generate AWS CLI command for table creation
bunx analytics create-table --table-name AnalyticsTable

# Generate Docker Compose file
bunx analytics docker-compose --port 8000

# Generate seed data
bunx analytics seed --sites 3

# Generate tracking script
bunx analytics tracking-script --site-id test-site --api-endpoint http://localhost:3000
```

## Environment Configuration

Create a `.env.local` file:

```bash
# .env.local
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
AWS_REGION=local
DYNAMODB_ENDPOINT=http://localhost:8000
ANALYTICS_TABLE=AnalyticsTable
```

Load in your application:

```typescript
import { config } from 'dotenv'
config({ path: '.env.local' })

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.DYNAMODB_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})
```

## Testing

### Unit Tests

```typescript
import { describe, test, expect } from 'bun:test'
import { AnalyticsStore, GoalMatcher } from '@stacksjs/ts-analytics'

describe('GoalMatcher', () => {
  test('matches exact pageview goal', () => {
    const goals = [{
      id: 'signup',
      type: 'pageview' as const,
      pattern: '/signup/complete',
      matchType: 'exact' as const,
    }]

    const matcher = new GoalMatcher(goals)
    const matches = matcher.matchPageView('/signup/complete')

    expect(matches).toHaveLength(1)
    expect(matches[0].goalId).toBe('signup')
  })
})
```

### Integration Tests

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { createAnalyticsTable, AnalyticsStore } from '@stacksjs/ts-analytics'

describe('AnalyticsStore Integration', () => {
  let client: DynamoDBClient
  let store: AnalyticsStore

  beforeAll(async () => {
    client = new DynamoDBClient({
      region: 'local',
      endpoint: 'http://localhost:8000',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    })

    await createAnalyticsTable(client, {
      tableName: 'TestAnalytics',
    }, { CreateTableCommand, DescribeTableCommand })

    store = new AnalyticsStore({ tableName: 'TestAnalytics' })
  })

  test('creates and retrieves site', async () => {
    const site = {
      id: 'test-site',
      name: 'Test Site',
      domains: ['test.com'],
      // ...
    }

    const createCommand = store.createSiteCommand(site)
    await executeCommand(client, createCommand)

    const getCommand = store.getSiteCommand('test-site')
    const result = await executeCommand(client, getCommand)

    expect(result.Item).toBeDefined()
  })
})
```

Run tests:

```bash
bun test
```

## Debugging

### Enable Debug Mode

```typescript
const script = generateTrackingScript({
  siteId: 'test-site',
  apiEndpoint: 'http://localhost:3000',
  debug: true, // Enables console logging
})
```

### DynamoDB Shell

Access DynamoDB Local directly:

```bash
# Install NoSQL Workbench or use AWS CLI
aws dynamodb scan \
  --table-name AnalyticsTable \
  --endpoint-url http://localhost:8000
```

### View Table Contents

```typescript
import { ScanCommand } from '@aws-sdk/client-dynamodb'

const result = await client.send(new ScanCommand({
  TableName: 'AnalyticsTable',
  Limit: 10,
}))

console.log('Items:', result.Items)
```

## Hot Reload

Use Bun's watch mode for development:

```bash
bun --watch run server.ts
```

Or with nodemon:

```bash
bunx nodemon --exec "bun run" server.ts
```

## VS Code Configuration

Add to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "bun",
      "request": "launch",
      "name": "Debug Analytics Server",
      "program": "${workspaceFolder}/server.ts",
      "cwd": "${workspaceFolder}",
      "env": {
        "AWS_ACCESS_KEY_ID": "local",
        "AWS_SECRET_ACCESS_KEY": "local",
        "DYNAMODB_ENDPOINT": "http://localhost:8000"
      }
    }
  ]
}
```

## Troubleshooting

### DynamoDB Local Not Starting

```bash
# Check if port is in use
lsof -i :8000

# Try different port
docker-compose up -d -e "PORT=8001"
```

### Table Already Exists

```bash
# Delete and recreate
aws dynamodb delete-table \
  --table-name AnalyticsTable \
  --endpoint-url http://localhost:8000
```

### Permission Errors

DynamoDB Local doesn't enforce permissions. If you see errors, check your endpoint configuration.

## Next Steps

- [AWS Deployment](/deploy/aws) - Deploy to production
- [Framework Integrations](/deploy/integrations) - Use with Hono, Express
- [API Endpoints](/guide/api) - Test the full API
