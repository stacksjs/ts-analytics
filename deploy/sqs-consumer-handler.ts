/**
 * SQS Consumer Lambda Handler
 *
 * Processes analytics events from SQS queue and writes to DynamoDB in batches.
 * This handler is triggered by SQS events (Lambda integration).
 *
 * Architecture:
 * [SQS Queue] -> [This Lambda] -> [DynamoDB BatchWriteItem]
 *
 * Benefits:
 * - Batch writes (25 items per batch) reduce write costs
 * - Automatic retry with exponential backoff
 * - Dead letter queue for failed messages
 * - Handles traffic spikes gracefully
 *
 * Extends ts-cloud for infrastructure - see cloud.config.ts
 */

import {
  configureAnalytics,
  createClient,
} from '../src/models/orm'
import type { AnalyticsEvent, SQSMessage } from '../src/sqs-buffering'

// SQS Event types (inline to avoid aws-lambda dependency)
interface SQSEvent {
  Records: SQSRecord[]
}

interface SQSRecord {
  messageId: string
  receiptHandle: string
  body: string
  attributes: Record<string, string>
  messageAttributes: Record<string, unknown>
  md5OfBody: string
  eventSource: string
  eventSourceARN: string
  awsRegion: string
}

interface Context {
  functionName: string
  functionVersion: string
  invokedFunctionArn: string
  memoryLimitInMB: string
  awsRequestId: string
  logGroupName: string
  logStreamName: string
  getRemainingTimeInMillis(): number
}

interface SQSBatchResponse {
  batchItemFailures: SQSBatchItemFailure[]
}

interface SQSBatchItemFailure {
  itemIdentifier: string
}

// ============================================================================
// Configuration
// ============================================================================

const TABLE_NAME = process.env.DYNAMODB_TABLE || process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'
const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const MAX_BATCH_SIZE = 25 // DynamoDB limit
const MAX_RETRIES = 3

// Configure analytics and create DynamoDB client using ts-cloud
configureAnalytics({
  tableName: TABLE_NAME,
  region: AWS_REGION,
})

const dynamodb = createClient({ region: AWS_REGION })

// ============================================================================
// Types
// ============================================================================

interface AttributeValue {
  S?: string
  N?: string
  BOOL?: boolean
  L?: AttributeValue[]
  M?: Record<string, AttributeValue>
  NULL?: boolean
}

interface WriteRequest {
  PutRequest: {
    Item: Record<string, AttributeValue>
  }
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Lambda handler for processing SQS messages
 * Returns partial batch response for failed items (automatic retry)
 */
export async function handler(
  event: SQSEvent,
  context: Context,
): Promise<SQSBatchResponse> {
  console.log(`[SQS Consumer] Processing ${event.Records.length} messages`)

  const batchItemFailures: SQSBatchItemFailure[] = []

  // Process each SQS message
  for (const record of event.Records) {
    try {
      await processRecord(record)
    }
    catch (error) {
      console.error(`[SQS Consumer] Failed to process message ${record.messageId}:`, error)
      // Report this message as failed for retry
      batchItemFailures.push({
        itemIdentifier: record.messageId,
      })
    }
  }

  console.log(`[SQS Consumer] Completed. Success: ${event.Records.length - batchItemFailures.length}, Failed: ${batchItemFailures.length}`)

  return { batchItemFailures }
}

// ============================================================================
// Record Processing
// ============================================================================

async function processRecord(record: SQSRecord): Promise<void> {
  const message: SQSMessage = JSON.parse(record.body)
  const events = message.events

  if (!events || events.length === 0) {
    console.log('[SQS Consumer] Empty events array, skipping')
    return
  }

  console.log(`[SQS Consumer] Processing batch ${message.batchId} with ${events.length} events`)

  // Convert events to DynamoDB write requests
  const writeRequests: WriteRequest[] = []

  for (const event of events) {
    try {
      const request = eventToWriteRequest(event)
      if (request) {
        writeRequests.push(request)
      }
    }
    catch (error) {
      console.error(`[SQS Consumer] Failed to convert event:`, error, event)
    }
  }

  if (writeRequests.length === 0) {
    console.log('[SQS Consumer] No valid write requests, skipping')
    return
  }

  // Batch write to DynamoDB (chunks of 25)
  await batchWriteToDynamoDB(writeRequests)
}

// ============================================================================
// DynamoDB Batch Write
// ============================================================================

async function batchWriteToDynamoDB(requests: WriteRequest[]): Promise<void> {
  // Split into chunks of MAX_BATCH_SIZE
  for (let i = 0; i < requests.length; i += MAX_BATCH_SIZE) {
    const chunk = requests.slice(i, i + MAX_BATCH_SIZE)
    await writeBatchWithRetry(chunk)
  }
}

async function writeBatchWithRetry(requests: WriteRequest[], retryCount = 0): Promise<void> {
  try {
    const result = await dynamodb.batchWriteItem({
      RequestItems: {
        [TABLE_NAME]: requests,
      },
    })

    // Handle unprocessed items (throttling)
    const unprocessed = result.UnprocessedItems?.[TABLE_NAME]
    if (unprocessed && unprocessed.length > 0) {
      console.log(`[SQS Consumer] ${unprocessed.length} unprocessed items, retrying...`)

      if (retryCount < MAX_RETRIES) {
        // Exponential backoff
        const delay = Math.min(100 * Math.pow(2, retryCount), 5000)
        await sleep(delay)
        await writeBatchWithRetry(unprocessed as WriteRequest[], retryCount + 1)
      }
      else {
        console.error(`[SQS Consumer] Max retries exceeded for ${unprocessed.length} items`)
        throw new Error(`Failed to write ${unprocessed.length} items after ${MAX_RETRIES} retries`)
      }
    }
  }
  catch (error) {
    if (retryCount < MAX_RETRIES && isRetryableError(error)) {
      const delay = Math.min(100 * Math.pow(2, retryCount), 5000)
      console.log(`[SQS Consumer] Retryable error, waiting ${delay}ms...`)
      await sleep(delay)
      await writeBatchWithRetry(requests, retryCount + 1)
    }
    else {
      throw error
    }
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const name = error.name
    return (
      name === 'ProvisionedThroughputExceededException' ||
      name === 'ThrottlingException' ||
      name === 'ServiceUnavailable' ||
      name === 'InternalServerError'
    )
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// Event to DynamoDB Item Conversion
// ============================================================================

function eventToWriteRequest(event: AnalyticsEvent): WriteRequest | null {
  const timestamp = new Date(event.timestamp)
  const dateStr = timestamp.toISOString().split('T')[0]

  switch (event.type) {
    case 'pageview':
      return pageViewToWriteRequest(event, timestamp, dateStr)
    case 'session':
      return sessionToWriteRequest(event, timestamp)
    case 'event':
      return customEventToWriteRequest(event, timestamp, dateStr)
    case 'realtime':
      return realtimeToWriteRequest(event)
    default:
      console.warn(`[SQS Consumer] Unknown event type: ${(event as { type: string }).type}`)
      return null
  }
}

function pageViewToWriteRequest(
  event: AnalyticsEvent,
  timestamp: Date,
  dateStr: string,
): WriteRequest {
  const data = event.data as unknown as Record<string, unknown>
  const id = data.id as string || generateId()

  return {
    PutRequest: {
      Item: {
        pk: { S: `SITE#${event.siteId}` },
        sk: { S: `PV#${timestamp.toISOString()}#${id}` },
        gsi1pk: { S: `SITE#${event.siteId}#DATE#${dateStr}` },
        gsi1sk: { S: `PATH#${data.path || '/'}#${id}` },
        id: { S: id },
        siteId: { S: event.siteId },
        visitorId: { S: (data.visitorId as string) || 'unknown' },
        sessionId: { S: (data.sessionId as string) || 'unknown' },
        path: { S: (data.path as string) || '/' },
        hostname: { S: (data.hostname as string) || '' },
        ...(data.title && { title: { S: data.title as string } }),
        ...(data.referrer && { referrer: { S: data.referrer as string } }),
        ...(data.referrerSource && { referrerSource: { S: data.referrerSource as string } }),
        ...(data.deviceType && { deviceType: { S: data.deviceType as string } }),
        ...(data.browser && { browser: { S: data.browser as string } }),
        ...(data.os && { os: { S: data.os as string } }),
        ...(data.country && { country: { S: data.country as string } }),
        ...(data.screenWidth && { screenWidth: { N: String(data.screenWidth) } }),
        ...(data.screenHeight && { screenHeight: { N: String(data.screenHeight) } }),
        isUnique: { BOOL: Boolean(data.isUnique) },
        isBounce: { BOOL: Boolean(data.isBounce) },
        timestamp: { S: timestamp.toISOString() },
        _et: { S: 'pageview' },
        // TTL: 30 days
        ttl: { N: String(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) },
      },
    },
  }
}

function sessionToWriteRequest(
  event: AnalyticsEvent,
  timestamp: Date,
): WriteRequest {
  const data = event.data as unknown as Record<string, unknown>
  const sessionId = (data.id as string) || (data.sessionId as string) || generateId()
  const dateStr = timestamp.toISOString().split('T')[0]

  return {
    PutRequest: {
      Item: {
        pk: { S: `SITE#${event.siteId}` },
        sk: { S: `SESSION#${sessionId}` },
        gsi1pk: { S: `SITE#${event.siteId}#SESSIONS#${dateStr}` },
        gsi1sk: { S: `SESSION#${sessionId}` },
        id: { S: sessionId },
        siteId: { S: event.siteId },
        visitorId: { S: (data.visitorId as string) || 'unknown' },
        entryPath: { S: (data.entryPath as string) || '/' },
        exitPath: { S: (data.exitPath as string) || '/' },
        ...(data.referrer && { referrer: { S: data.referrer as string } }),
        ...(data.referrerSource && { referrerSource: { S: data.referrerSource as string } }),
        ...(data.deviceType && { deviceType: { S: data.deviceType as string } }),
        ...(data.browser && { browser: { S: data.browser as string } }),
        ...(data.os && { os: { S: data.os as string } }),
        ...(data.country && { country: { S: data.country as string } }),
        pageViewCount: { N: String(data.pageViewCount || 1) },
        eventCount: { N: String(data.eventCount || 0) },
        isBounce: { BOOL: Boolean(data.isBounce) },
        duration: { N: String(data.duration || 0) },
        startedAt: { S: (data.startedAt as string) || timestamp.toISOString() },
        endedAt: { S: (data.endedAt as string) || timestamp.toISOString() },
        _et: { S: 'session' },
        // TTL: 30 days
        ttl: { N: String(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) },
      },
    },
  }
}

function customEventToWriteRequest(
  event: AnalyticsEvent,
  timestamp: Date,
  dateStr: string,
): WriteRequest {
  const data = event.data as unknown as Record<string, unknown>
  const id = (data.id as string) || generateId()
  const eventName = (data.name as string) || 'unnamed'

  return {
    PutRequest: {
      Item: {
        pk: { S: `SITE#${event.siteId}` },
        sk: { S: `EVENT#${timestamp.toISOString()}#${id}` },
        gsi1pk: { S: `SITE#${event.siteId}#EVENTNAME#${eventName}` },
        gsi1sk: { S: `EVENT#${timestamp.toISOString()}` },
        id: { S: id },
        siteId: { S: event.siteId },
        visitorId: { S: (data.visitorId as string) || 'unknown' },
        sessionId: { S: (data.sessionId as string) || 'unknown' },
        name: { S: eventName },
        ...(data.category && { category: { S: data.category as string } }),
        ...(data.value !== undefined && { value: { N: String(data.value) } }),
        ...(data.properties && { properties: { S: JSON.stringify(data.properties) } }),
        path: { S: (data.path as string) || '/' },
        timestamp: { S: timestamp.toISOString() },
        _et: { S: 'event' },
        // TTL: 30 days
        ttl: { N: String(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) },
      },
    },
  }
}

function realtimeToWriteRequest(event: AnalyticsEvent): WriteRequest {
  const data = event.data as unknown as Record<string, unknown>
  const minute = (data.minute as string) || new Date().toISOString().slice(0, 16)

  return {
    PutRequest: {
      Item: {
        pk: { S: `SITE#${event.siteId}` },
        sk: { S: `REALTIME#${minute}` },
        siteId: { S: event.siteId },
        minute: { S: minute },
        currentVisitors: { N: '1' },
        pageViews: { N: '1' },
        activePages: { S: JSON.stringify({ [(data.path as string) || '/']: 1 }) },
        _et: { S: 'realtime' },
        // TTL: 10 minutes
        ttl: { N: String(Math.floor(Date.now() / 1000) + 600) },
      },
    },
  }
}

// ============================================================================
// Utilities
// ============================================================================

function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 11)
  return `${timestamp}${random}`
}

// ============================================================================
// Export for testing
// ============================================================================

export {
  processRecord,
  eventToWriteRequest,
  batchWriteToDynamoDB,
}
