/**
 * ts-analytics Cloud Configuration
 *
 * Extends ts-cloud for infrastructure deployment.
 * Defines DynamoDB tables, SQS queues, Lambda functions, and more.
 *
 * @see https://github.com/stacksjs/ts-cloud for documentation
 */

// Type-safe configuration without requiring ts-cloud types at compile time
// eslint-disable-next-line ts/consistent-type-definitions
type CloudConfig = {
  project: { name: string, slug: string, region: string }
  environments: Record<string, unknown>
  infrastructure?: Record<string, unknown>
  tags?: Record<string, string>
  features?: Record<string, boolean>
}

const config: CloudConfig = {
  project: {
    name: 'ts-analytics',
    slug: 'ts-analytics',
    region: 'us-east-1',
  },

  environments: {
    production: {
      type: 'production',
      domain: 'analytics.stacksjs.com',
      variables: {
        LOG_LEVEL: 'info',
      },
    },
    staging: {
      type: 'staging',
      domain: 'staging.analytics.stacksjs.com',
      variables: {
        LOG_LEVEL: 'debug',
      },
    },
    development: {
      type: 'development',
      variables: {
        LOG_LEVEL: 'debug',
        DYNAMODB_ENDPOINT: 'http://localhost:8000',
      },
    },
  },

  infrastructure: {
    // =========================================================================
    // DynamoDB Tables
    // =========================================================================
    databases: {
      analytics: {
        engine: 'dynamodb',
        name: 'ts-analytics',
        partitionKey: 'pk',
        sortKey: 'sk',
        billingMode: 'PAY_PER_REQUEST',
        pointInTimeRecovery: true,
        encryption: true,
        ttlAttribute: 'ttl',
        globalSecondaryIndexes: [
          {
            name: 'gsi1',
            partitionKey: 'gsi1pk',
            sortKey: 'gsi1sk',
            projection: 'ALL',
          },
          {
            name: 'gsi2',
            partitionKey: 'gsi2pk',
            sortKey: 'gsi2sk',
            projection: 'ALL',
          },
        ],
        // Enable DAX for production read caching
        dax: {
          enabled: true,
          nodeType: 'dax.t3.small',
          nodeCount: 1,
          environments: ['production'],
        },
      },
    },

    // =========================================================================
    // SQS Queues for Event Buffering
    // =========================================================================
    queues: {
      // Main analytics event queue
      analyticsEvents: {
        visibilityTimeout: 60,
        messageRetentionPeriod: 86400, // 1 day
        receiveMessageWaitTime: 20, // Long polling
        deadLetterQueue: true,
        maxReceiveCount: 3,
        encrypted: true,
        // Lambda trigger for processing events
        trigger: {
          functionName: 'sqsConsumer',
          batchSize: 10,
          batchWindow: 5,
        },
        // CloudWatch alarms
        alarms: {
          enabled: true,
          queueDepthThreshold: 10000,
          messageAgeThreshold: 3600,
        },
      },

      // High-priority realtime updates queue
      realtimeUpdates: {
        visibilityTimeout: 30,
        messageRetentionPeriod: 3600, // 1 hour
        receiveMessageWaitTime: 0, // Short polling for low latency
        deadLetterQueue: true,
        maxReceiveCount: 2,
        encrypted: true,
        trigger: {
          functionName: 'realtimeConsumer',
          batchSize: 25,
          batchWindow: 1,
        },
      },

      // Aggregation job queue
      aggregationJobs: {
        visibilityTimeout: 300, // 5 minutes for aggregation
        messageRetentionPeriod: 345600, // 4 days
        receiveMessageWaitTime: 20,
        deadLetterQueue: true,
        maxReceiveCount: 3,
        encrypted: true,
        trigger: {
          functionName: 'aggregationWorker',
          batchSize: 1,
        },
      },
    },

    // =========================================================================
    // Lambda Functions
    // =========================================================================
    functions: {
      // Main API handler
      api: {
        handler: 'deploy/lambda-handler.handler',
        runtime: 'nodejs20.x',
        memorySize: 512,
        timeout: 30,
        environment: {
          DYNAMODB_TABLE: '${database.analytics.tableName}',
          SQS_QUEUE_URL: '${queue.analyticsEvents.url}',
          SQS_BUFFERING_ENABLED: 'true',
        },
        // API Gateway integration
        events: [
          { http: { method: 'ANY', path: '/{proxy+}' } },
          { http: { method: 'ANY', path: '/' } },
        ],
      },

      // SQS consumer for batch writes
      sqsConsumer: {
        handler: 'deploy/sqs-consumer-handler.handler',
        runtime: 'nodejs20.x',
        memorySize: 512,
        timeout: 60,
        reservedConcurrency: 10,
        environment: {
          DYNAMODB_TABLE: '${database.analytics.tableName}',
        },
      },

      // Realtime updates consumer
      realtimeConsumer: {
        handler: 'deploy/realtime-consumer-handler.handler',
        runtime: 'nodejs20.x',
        memorySize: 256,
        timeout: 30,
        reservedConcurrency: 5,
        environment: {
          DYNAMODB_TABLE: '${database.analytics.tableName}',
        },
      },

      // Aggregation worker
      aggregationWorker: {
        handler: 'deploy/aggregation-handler.handler',
        runtime: 'nodejs20.x',
        memorySize: 1024,
        timeout: 300,
        reservedConcurrency: 3,
        environment: {
          DYNAMODB_TABLE: '${database.analytics.tableName}',
        },
      },

      // Scheduled aggregation trigger
      aggregationScheduler: {
        handler: 'deploy/scheduler-handler.handler',
        runtime: 'nodejs20.x',
        memorySize: 256,
        timeout: 60,
        environment: {
          AGGREGATION_QUEUE_URL: '${queue.aggregationJobs.url}',
        },
        events: [
          // Run hourly aggregation every hour
          { schedule: { rate: 'rate(1 hour)', input: { type: 'hourly' } } },
          // Run daily aggregation at midnight UTC
          { schedule: { rate: 'cron(0 0 * * ? *)', input: { type: 'daily' } } },
          // Run monthly aggregation on the 1st of each month
          { schedule: { rate: 'cron(0 1 1 * ? *)', input: { type: 'monthly' } } },
        ],
      },
    },

    // =========================================================================
    // API Gateway
    // =========================================================================
    apiGateway: {
      type: 'HTTP',
      cors: {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: 86400,
      },
      throttling: {
        rateLimit: 10000,
        burstLimit: 5000,
      },
    },

    // =========================================================================
    // Monitoring & Alarms
    // =========================================================================
    monitoring: {
      enabled: true,
      dashboards: true,
      alarms: {
        lambda: {
          errorRate: { threshold: 5, period: 300 },
          duration: { threshold: 10000, period: 300 },
          throttles: { threshold: 10, period: 300 },
        },
        dynamodb: {
          throttledRequests: { threshold: 10, period: 300 },
          systemErrors: { threshold: 1, period: 300 },
        },
      },
    },
  },

  // Global tags applied to all resources
  tags: {
    Project: 'ts-analytics',
    ManagedBy: 'ts-cloud',
    Repository: 'github.com/stacksjs/ts-analytics',
  },

  // Feature flags
  features: {
    sqsBuffering: true,
    daxCaching: true,
    realtimeUpdates: true,
  },
}

export default config
