/**
 * Analytics Configuration
 *
 * Configuration for the analytics system using DynamoDB single-table design.
 * Integrates with dynamodb-tooling for table management.
 */

import type {
  AnalyticsTableConfig,
  BillingMode,
  GSIDefinition,
  SingleTableDesignConfig,
} from './types'

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default single-table design configuration
 */
export const defaultSingleTableConfig: SingleTableDesignConfig = {
  enabled: true,
  partitionKeyName: 'pk',
  sortKeyName: 'sk',
  gsi1pkName: 'gsi1pk',
  gsi1skName: 'gsi1sk',
  gsi2pkName: 'gsi2pk',
  gsi2skName: 'gsi2sk',
  entityTypeAttribute: '_et',
  pkPrefix: '{ENTITY}#',
  skPrefix: '{ENTITY}#',
  gsiCount: 2,
  keyDelimiter: '#',
}

/**
 * Default GSI definitions for analytics
 */
export const defaultGSIs: GSIDefinition[] = [
  {
    name: 'gsi1',
    partitionKey: 'gsi1pk',
    sortKey: 'gsi1sk',
    projection: { type: 'ALL' },
  },
  {
    name: 'gsi2',
    partitionKey: 'gsi2pk',
    sortKey: 'gsi2sk',
    projection: { type: 'ALL' },
  },
]

/**
 * Default analytics table configuration
 */
export const defaultAnalyticsConfig: AnalyticsTableConfig = {
  tableName: 'AnalyticsTable',
  billingMode: 'PAY_PER_REQUEST',
  singleTable: defaultSingleTableConfig,
  globalSecondaryIndexes: defaultGSIs,
  localSecondaryIndexes: [],
  ttlAttributeName: 'ttl',
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Analytics configuration options
 */
export interface AnalyticsConfig {
  /** DynamoDB table configuration */
  table: AnalyticsTableConfig

  /** AWS region */
  region: string

  /** Custom endpoint (for local development) */
  endpoint?: string

  /** Data retention settings */
  retention: {
    /** Raw event TTL in seconds (default: 30 days) */
    rawEventTtl: number
    /** Hourly aggregate TTL in seconds (default: 90 days) */
    hourlyAggregateTtl: number
    /** Daily aggregate TTL in seconds (default: 2 years) */
    dailyAggregateTtl: number
    /** Monthly aggregates kept forever by default */
    monthlyAggregateTtl?: number
  }

  /** Privacy settings */
  privacy: {
    /** Hash visitor IDs for privacy */
    hashVisitorIds: boolean
    /** Collect geolocation data */
    collectGeolocation: boolean
    /** Honor Do Not Track header */
    honorDnt: boolean
    /** IP anonymization level: 'none' | 'partial' | 'full' */
    ipAnonymization: 'none' | 'partial' | 'full'
  }

  /** Tracking settings */
  tracking: {
    /** Track referrers */
    trackReferrers: boolean
    /** Track UTM parameters */
    trackUtmParams: boolean
    /** Track device type */
    trackDeviceType: boolean
    /** Track hash changes as page views */
    trackHashChanges: boolean
    /** Track outbound link clicks */
    trackOutboundLinks: boolean
  }

  /** API settings */
  api: {
    /** Base path for API routes */
    basePath: string
    /** CORS allowed origins */
    corsOrigins: string[]
  }

  /** Aggregation settings */
  aggregation: {
    /** Batch size for processing events */
    batchSize: number
    /** Enable hourly aggregation */
    hourlyEnabled: boolean
    /** Enable daily aggregation */
    dailyEnabled: boolean
    /** Enable monthly aggregation */
    monthlyEnabled: boolean
  }

  /**
   * Scale settings for high-throughput scenarios
   * Based on learnings from Fathom Analytics' DynamoDB experience
   */
  scale: {
    /**
     * Enable SQS-based write buffering
     * Routes /collect writes through SQS for better handling of traffic spikes
     */
    sqsBuffering: {
      enabled: boolean
      /** SQS Queue URL */
      queueUrl?: string
      /** Dead letter queue URL for failed messages */
      deadLetterQueueUrl?: string
      /** Max retries before sending to DLQ */
      maxRetries: number
    }

    /**
     * DAX (DynamoDB Accelerator) caching for reads
     * Dramatically reduces read latency and cost for hot data
     */
    daxCaching: {
      enabled: boolean
      /** DAX cluster endpoint */
      endpoint?: string
      /** TTL for cached items in seconds */
      ttlSeconds: number
    }

    /**
     * Partition sharding for high-volume sites
     * Distributes writes across multiple partitions to avoid throttling
     */
    partitionSharding: {
      enabled: boolean
      /** Number of shards per site (default: 10) */
      shardCount: number
      /** Sites that require sharding (empty = all sites) */
      enabledSiteIds: string[]
    }

    /**
     * Write coalescing to reduce duplicate writes
     * Combines multiple updates to same key within a time window
     */
    writeCoalescing: {
      enabled: boolean
      /** Window in milliseconds to coalesce writes */
      windowMs: number
    }

    /**
     * Batch write settings
     */
    batchWrites: {
      enabled: boolean
      /** Max items per batch (DynamoDB limit: 25) */
      maxBatchSize: number
      /** Flush interval in milliseconds */
      flushIntervalMs: number
    }
  }
}

/**
 * Partial configuration for user overrides
 */
export type UserAnalyticsConfig = {
  [K in keyof AnalyticsConfig]?: K extends 'table'
    ? Partial<AnalyticsTableConfig>
    : K extends 'retention' | 'privacy' | 'tracking' | 'api' | 'aggregation'
      ? Partial<AnalyticsConfig[K]>
      : K extends 'scale'
        ? {
            sqsBuffering?: Partial<AnalyticsConfig['scale']['sqsBuffering']>
            daxCaching?: Partial<AnalyticsConfig['scale']['daxCaching']>
            partitionSharding?: Partial<AnalyticsConfig['scale']['partitionSharding']>
            writeCoalescing?: Partial<AnalyticsConfig['scale']['writeCoalescing']>
            batchWrites?: Partial<AnalyticsConfig['scale']['batchWrites']>
          }
        : AnalyticsConfig[K]
}

// ============================================================================
// Default Values
// ============================================================================

const ONE_DAY = 24 * 60 * 60
const THIRTY_DAYS = 30 * ONE_DAY
const NINETY_DAYS = 90 * ONE_DAY
const TWO_YEARS = 2 * 365 * ONE_DAY

/**
 * Complete default configuration
 */
export const defaultConfig: AnalyticsConfig = {
  table: defaultAnalyticsConfig,
  region: 'us-east-1',
  endpoint: undefined,

  retention: {
    rawEventTtl: THIRTY_DAYS,
    hourlyAggregateTtl: NINETY_DAYS,
    dailyAggregateTtl: TWO_YEARS,
    monthlyAggregateTtl: undefined, // Keep forever
  },

  privacy: {
    hashVisitorIds: true,
    collectGeolocation: false,
    honorDnt: true,
    ipAnonymization: 'partial',
  },

  tracking: {
    trackReferrers: true,
    trackUtmParams: true,
    trackDeviceType: true,
    trackHashChanges: false,
    trackOutboundLinks: true,
  },

  api: {
    basePath: '/api/analytics',
    corsOrigins: ['*'],
  },

  aggregation: {
    batchSize: 100,
    hourlyEnabled: true,
    dailyEnabled: true,
    monthlyEnabled: true,
  },

  // Scale settings - disabled by default for simplicity
  // Enable these for high-traffic sites (>10k req/sec)
  scale: {
    sqsBuffering: {
      enabled: false,
      queueUrl: undefined,
      deadLetterQueueUrl: undefined,
      maxRetries: 3,
    },
    daxCaching: {
      enabled: false,
      endpoint: undefined,
      ttlSeconds: 300, // 5 minutes default cache
    },
    partitionSharding: {
      enabled: false,
      shardCount: 10,
      enabledSiteIds: [], // Empty = disabled
    },
    writeCoalescing: {
      enabled: true, // Enabled by default - reduces redundant writes
      windowMs: 100,
    },
    batchWrites: {
      enabled: true, // Enabled by default - more efficient
      maxBatchSize: 25, // DynamoDB limit
      flushIntervalMs: 1000,
    },
  },
}

// ============================================================================
// Configuration Functions
// ============================================================================

/**
 * Merge user config with defaults
 */
export function defineConfig(userConfig: UserAnalyticsConfig = {}): AnalyticsConfig {
  return {
    table: {
      ...defaultConfig.table,
      ...userConfig.table,
      singleTable: {
        ...defaultConfig.table.singleTable,
        ...userConfig.table?.singleTable,
      },
      globalSecondaryIndexes: userConfig.table?.globalSecondaryIndexes ?? defaultConfig.table.globalSecondaryIndexes,
      localSecondaryIndexes: userConfig.table?.localSecondaryIndexes ?? defaultConfig.table.localSecondaryIndexes,
    },
    region: userConfig.region ?? defaultConfig.region,
    endpoint: userConfig.endpoint ?? defaultConfig.endpoint,
    retention: {
      ...defaultConfig.retention,
      ...userConfig.retention,
    },
    privacy: {
      ...defaultConfig.privacy,
      ...userConfig.privacy,
    },
    tracking: {
      ...defaultConfig.tracking,
      ...userConfig.tracking,
    },
    api: {
      ...defaultConfig.api,
      ...userConfig.api,
    },
    aggregation: {
      ...defaultConfig.aggregation,
      ...userConfig.aggregation,
    },
    scale: {
      sqsBuffering: {
        ...defaultConfig.scale.sqsBuffering,
        ...userConfig.scale?.sqsBuffering,
      },
      daxCaching: {
        ...defaultConfig.scale.daxCaching,
        ...userConfig.scale?.daxCaching,
      },
      partitionSharding: {
        ...defaultConfig.scale.partitionSharding,
        ...userConfig.scale?.partitionSharding,
      },
      writeCoalescing: {
        ...defaultConfig.scale.writeCoalescing,
        ...userConfig.scale?.writeCoalescing,
      },
      batchWrites: {
        ...defaultConfig.scale.batchWrites,
        ...userConfig.scale?.batchWrites,
      },
    },
  }
}

/**
 * Create table configuration from analytics config
 */
export function getTableConfig(config: AnalyticsConfig): {
  tableName: string
  billingMode: BillingMode
  partitionKey: string
  sortKey: string
  gsis: GSIDefinition[]
  ttlAttribute?: string
} {
  return {
    tableName: config.table.tableName,
    billingMode: config.table.billingMode,
    partitionKey: config.table.singleTable.partitionKeyName,
    sortKey: config.table.singleTable.sortKeyName,
    gsis: config.table.globalSecondaryIndexes,
    ttlAttribute: config.table.ttlAttributeName,
  }
}

/**
 * Get TTL value for a given entity type
 */
export function getTtlForEntity(
  config: AnalyticsConfig,
  entityType: 'raw' | 'hourly' | 'daily' | 'monthly',
): number | undefined {
  const now = Math.floor(Date.now() / 1000)

  switch (entityType) {
    case 'raw':
      return now + config.retention.rawEventTtl
    case 'hourly':
      return now + config.retention.hourlyAggregateTtl
    case 'daily':
      return now + config.retention.dailyAggregateTtl
    case 'monthly':
      return config.retention.monthlyAggregateTtl
        ? now + config.retention.monthlyAggregateTtl
        : undefined
    default:
      return undefined
  }
}

// ============================================================================
// Config Singleton
// ============================================================================

let _config: AnalyticsConfig | null = null

/**
 * Set global analytics configuration
 */
export function setConfig(config: UserAnalyticsConfig): AnalyticsConfig {
  _config = defineConfig(config)
  return _config
}

/**
 * Get current analytics configuration
 */
export function getConfig(): AnalyticsConfig {
  if (!_config) {
    _config = defaultConfig
  }
  return _config
}

/**
 * Reset configuration to defaults
 */
export function resetConfig(): void {
  _config = null
}
