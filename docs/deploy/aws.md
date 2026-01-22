---
title: AWS Deployment
description: Deploy ts-analytics to AWS using ts-cloud
---

# AWS Deployment

ts-analytics uses [ts-cloud](https://ts-cloud.stacksjs.com) for seamless AWS deployment.

## Prerequisites

1. AWS account with appropriate permissions
2. AWS credentials configured in your environment
3. ts-cloud linked to your project

```bash
# Link ts-cloud to your project
bun link ts-cloud
```

## Configuration

### Environment Variables

Create a `.env` file with your AWS credentials:

```bash
# .env
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_DEFAULT_REGION=us-east-1
```

ts-cloud automatically reads these credentials from your environment.

### Cloud Configuration

Create a `cloud.config.ts` in your project root:

```typescript
import type { CloudConfig } from '@ts-cloud/types'

const config: CloudConfig = {
  project: {
    name: 'ts-analytics',
    slug: 'ts-analytics',
    region: 'us-east-1',
  },

  mode: 'serverless',

  environments: {
    production: {
      type: 'production',
      region: 'us-east-1',
      variables: {
        NODE_ENV: 'production',
        ANALYTICS_TABLE: 'AnalyticsTable',
      },
    },
    staging: {
      type: 'staging',
      region: 'us-east-1',
      variables: {
        NODE_ENV: 'staging',
        ANALYTICS_TABLE: 'AnalyticsTable-staging',
      },
    },
  },

  infrastructure: {
    // DynamoDB for analytics storage
    databases: {
      analytics: {
        engine: 'dynamodb',
        billingMode: 'PAY_PER_REQUEST',
      },
    },

    // Serverless compute for the API
    compute: {
      mode: 'serverless',
      serverless: {
        cpu: 512,
        memory: 1024,
        desiredCount: 2,
      },
    },

    // CDN for the tracking script
    cdn: {
      analytics: {
        origin: 'ts-analytics-production.s3.us-east-1.amazonaws.com',
        customDomain: 'analytics.yourdomain.com',
      },
    },

    // DNS configuration
    dns: {
      domain: 'yourdomain.com',
    },
  },
}

export default config
```

## Deployment Commands

### Deploy to Production

```bash
# Deploy all infrastructure
cloud deploy

# Deploy to specific environment
cloud deploy --env production
```

### Preview Changes

```bash
# See what will be deployed
cloud diff

# Generate CloudFormation preview
cloud generate:preview
```

### Check Status

```bash
# View deployment status
cloud deploy:status

# View current configuration
cloud config
```

### Rollback

```bash
# Rollback to previous deployment
cloud deploy:rollback
```

## Deployment Workflow

### 1. Validate Configuration

```bash
cloud config:validate
```

### 2. Generate Infrastructure

```bash
cloud generate
```

This generates CloudFormation templates based on your configuration.

### 3. Deploy

```bash
cloud deploy
```

ts-cloud will:
1. Create the DynamoDB table with proper indexes
2. Set up the serverless compute (ECS Fargate or Lambda)
3. Configure the CDN for the tracking script
4. Set up DNS records
5. Enable monitoring and alarms

### 4. Verify

```bash
cloud deploy:status
```

## Infrastructure Components

### DynamoDB Table

ts-cloud creates the analytics table with:
- Single-table design (pk, sk)
- GSI1 for site + date queries
- GSI2 for visitor queries
- TTL enabled for automatic data cleanup
- On-demand billing mode

### Serverless API

The analytics API runs on:
- ECS Fargate for containerized deployment, or
- AWS Lambda for serverless functions

### CDN (CloudFront)

The tracking script is served via CloudFront:
- Global edge caching
- HTTPS by default
- Custom domain support

### DNS (Route53)

ts-cloud manages DNS:
- A records for your domain
- SSL certificates via ACM
- Automatic validation

## Custom Domain Setup

### Using ts-cloud

```typescript
// cloud.config.ts
infrastructure: {
  cdn: {
    analytics: {
      customDomain: 'analytics.yourdomain.com',
    },
  },
  dns: {
    domain: 'yourdomain.com',
    // Optional: use existing hosted zone
    // hostedZoneId: 'Z1234567890',
  },
}
```

Deploy with:

```bash
cloud deploy
```

ts-cloud automatically:
1. Creates the Route53 hosted zone (if needed)
2. Requests an ACM certificate
3. Validates the certificate via DNS
4. Creates CloudFront distribution
5. Sets up DNS records

## Environment Variables

Manage environment-specific variables:

```bash
# Set a variable
cloud config:env set ANALYTICS_TABLE AnalyticsTable

# Get a variable
cloud config:env get ANALYTICS_TABLE

# List all variables
cloud config:env list
```

## Secrets Management

Store sensitive values securely:

```bash
# Store a secret in AWS Secrets Manager
cloud config:secrets set API_KEY my-secret-key

# Reference in your code
process.env.API_KEY
```

## Monitoring

ts-cloud sets up monitoring automatically:

```typescript
// cloud.config.ts
infrastructure: {
  monitoring: {
    dashboards: true,
    alarms: [
      {
        name: 'HighErrorRate',
        metric: 'Errors',
        threshold: 10,
      },
      {
        name: 'HighLatency',
        metric: 'Duration',
        threshold: 1000,
      },
    ],
  },
}
```

View logs:

```bash
cloud logs
```

## Multi-Region Deployment

Deploy to multiple regions:

```typescript
// cloud.config.ts
environments: {
  'production-us': {
    type: 'production',
    region: 'us-east-1',
  },
  'production-eu': {
    type: 'production',
    region: 'eu-west-1',
  },
}
```

Deploy to all:

```bash
cloud deploy --env production-us
cloud deploy --env production-eu
```

## Cost Optimization

ts-cloud uses cost-effective defaults:

- **DynamoDB**: On-demand billing (pay per request)
- **Serverless**: Scale to zero when idle
- **CDN**: Only pay for data transfer

Estimated monthly costs:

| Traffic | DynamoDB | Compute | CDN | Total |
|---------|----------|---------|-----|-------|
| 10K events/day | ~$5 | ~$10 | ~$1 | ~$16 |
| 100K events/day | ~$50 | ~$30 | ~$5 | ~$85 |
| 1M events/day | ~$500 | ~$100 | ~$20 | ~$620 |

## Troubleshooting

### Deployment Failed

```bash
# Check status
cloud deploy:status

# View detailed logs
cloud logs --verbose
```

### Permission Errors

Ensure your AWS credentials have sufficient permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "dynamodb:*",
        "ecs:*",
        "ecr:*",
        "lambda:*",
        "cloudfront:*",
        "route53:*",
        "acm:*",
        "iam:*",
        "logs:*"
      ],
      "Resource": "*"
    }
  ]
}
```

### DNS Not Resolving

```bash
# Check DNS propagation
cloud dns:status

# Force DNS refresh
cloud dns:refresh
```

## Next Steps

- [Local Development](/deploy/local) - Set up development environment
- [Framework Integrations](/deploy/integrations) - Use with Hono, Express
- [Configuration](/config) - Full configuration reference
