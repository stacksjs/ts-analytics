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
export const TABLE_NAME: string = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'
export const REGION: string = process.env.AWS_REGION || 'us-east-1'

// Configure analytics models on module load
configureAnalytics({
  tableName: TABLE_NAME,
  region: REGION,
})

// Create native DynamoDB client for direct queries (used in dashboard handlers)
export const dynamodb: ReturnType<typeof createClient> = createClient({ region: REGION })

// Re-export marshalling utilities
export { marshall, unmarshall }

/**
 * Whether an error is a DynamoDB conditional-check failure. Matches BOTH the
 * AWS SDK shape (name === 'ConditionalCheckFailedException') and the ts-cloud
 * client's wrapped form (a generic Error whose message contains
 * "The conditional request failed") — code that checked only e.name silently
 * misclassified expected condition failures as real errors.
 */
export function isConditionalCheckFailed(e: unknown): boolean {
  const err = e as { name?: string, message?: string } | null
  return !!err && (
    String(err.name || '').includes('ConditionalCheckFailed')
    || /conditional request failed/i.test(String(err.message || err))
  )
}


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
 * Query every page of a key condition and return the raw (still-marshalled)
 * items. Drop-in for `dynamodb.query(...)` at call sites that read `.Items` and
 * `.map(unmarshall)` themselves, but it no longer silently truncates at
 * DynamoDB's 1MB page limit (#151). A high safety cap guards against pathological
 * partitions and is logged when hit — never a silent drop.
 */
export async function queryAllItems(
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
  cap = 100_000,
): Promise<{ Items: any[], Count: number }> {
  const items: any[] = []
  let lastKey: Record<string, any> | undefined
  do {
    const page = await dynamodb.query({ ...params, ExclusiveStartKey: lastKey }) as { Items?: any[], LastEvaluatedKey?: Record<string, any> }
    if (page.Items)
      items.push(...page.Items)
    lastKey = page.LastEvaluatedKey
    if (items.length >= cap) {
      console.warn(`[queryAllItems] hit ${cap}-item cap (table ${String(params.TableName)}) — results truncated; counts may undercount`)
      break
    }
  } while (lastKey)
  return { Items: items, Count: items.length }
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
