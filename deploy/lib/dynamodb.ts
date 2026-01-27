/**
 * DynamoDB client configuration and utilities
 */

import {
  configureAnalytics,
  createClient,
  marshall,
  unmarshall,
} from '../../src/models/orm'

// Configuration
export const TABLE_NAME = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'
export const REGION = process.env.AWS_REGION || 'us-east-1'

// Configure analytics models on module load
configureAnalytics({
  tableName: TABLE_NAME,
  region: REGION,
})

// Create native DynamoDB client for direct queries (used in dashboard handlers)
export const dynamodb = createClient({ region: REGION })

// Re-export marshalling utilities
export { marshall, unmarshall }

/**
 * Build a DynamoDB query expression for date range
 */
export function buildDateRangeExpression(
  startDate: Date,
  endDate: Date,
  timestampField = 'timestamp'
): {
  expression: string
  names: Record<string, string>
  values: Record<string, unknown>
} {
  return {
    expression: `#${timestampField} BETWEEN :startDate AND :endDate`,
    names: { [`#${timestampField}`]: timestampField },
    values: {
      ':startDate': { S: startDate.toISOString() },
      ':endDate': { S: endDate.toISOString() },
    },
  }
}

/**
 * Build a DynamoDB key condition for site queries
 */
export function buildSiteKeyCondition(siteId: string): {
  expression: string
  values: Record<string, unknown>
} {
  return {
    expression: 'pk = :pk',
    values: { ':pk': { S: `SITE#${siteId}` } },
  }
}

/**
 * Execute a paginated DynamoDB query
 */
export async function paginatedQuery<T>(
  params: {
    TableName: string
    KeyConditionExpression: string
    ExpressionAttributeValues: Record<string, unknown>
    ExpressionAttributeNames?: Record<string, string>
    FilterExpression?: string
    Limit?: number
    ScanIndexForward?: boolean
    IndexName?: string
  },
  maxItems = 1000
): Promise<T[]> {
  const items: T[] = []
  let lastKey: Record<string, unknown> | undefined

  do {
    const response = await dynamodb.query({
      ...params,
      ExclusiveStartKey: lastKey,
    })

    if (response.Items) {
      for (const item of response.Items) {
        items.push(unmarshall(item) as T)
        if (items.length >= maxItems) {
          return items
        }
      }
    }

    lastKey = response.LastEvaluatedKey
  } while (lastKey)

  return items
}

/**
 * Batch get items from DynamoDB
 */
export async function batchGet<T>(
  keys: Array<{ pk: string; sk: string }>
): Promise<T[]> {
  if (keys.length === 0) return []

  const items: T[] = []
  const batches: Array<Array<{ pk: string; sk: string }>> = []

  // Split into batches of 100 (DynamoDB limit)
  for (let i = 0; i < keys.length; i += 100) {
    batches.push(keys.slice(i, i + 100))
  }

  for (const batch of batches) {
    const response = await dynamodb.batchGetItem({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: batch.map(key => ({
            pk: { S: key.pk },
            sk: { S: key.sk },
          })),
        },
      },
    })

    const tableItems = response.Responses?.[TABLE_NAME]
    if (tableItems) {
      for (const item of tableItems) {
        items.push(unmarshall(item) as T)
      }
    }
  }

  return items
}
