/**
 * SQS-Based Write Buffering
 *
 * High-throughput event ingestion using SQS as a buffer between
 * the /collect endpoint and DynamoDB writes. This architecture:
 *
 * 1. Handles traffic spikes by queuing events
 * 2. Enables batch writes to DynamoDB (25 items per batch)
 * 3. Provides automatic retry with exponential backoff
 * 4. Reduces Lambda execution time for /collect (faster responses)
 * 5. Decouples ingestion from storage
 *
 * Architecture:
 * [Browser] -> [Lambda /collect] -> [SQS Queue] -> [Lambda Consumer] -> [DynamoDB]
 *
 * Based on learnings from Fathom Analytics about scaling DynamoDB:
 * - Avoid per-request connection overhead
 * - Use batching for efficient writes
 * - Buffer writes during traffic spikes
 *
 * Extends ts-cloud for infrastructure and AWS clients.
 * @see cloud.config.ts for infrastructure definitions
 */

import type { CustomEvent, PageView, Session } from './types'

// Re-export ts-cloud compatible types for convenience
export interface SQSRawMessage {
  MessageId: string
  ReceiptHandle: string
  Body: string
  Attributes?: Record<string, string>
  MessageAttributes?: Record<string, unknown>
}

export interface QueueAttributes {
  QueueUrl: string
  QueueArn?: string
  ApproximateNumberOfMessages?: string
  ApproximateNumberOfMessagesNotVisible?: string
  VisibilityTimeout?: string
  MessageRetentionPeriod?: string
}

// ============================================================================
// Types
// ============================================================================

export interface SQSConfig {
  /** SQS Queue URL for event buffering */
  queueUrl?: string
  /** Enable SQS buffering (default: false for backward compatibility) */
  enabled: boolean
  /** Batch size for SQS messages (max 10) */
  batchSize: number
  /** Maximum messages per Lambda invocation */
  maxMessagesPerInvocation: number
  /** Visibility timeout in seconds */
  visibilityTimeout: number
  /** Message retention in seconds (max 14 days) */
  messageRetention: number
  /** Dead letter queue URL for failed messages */
  deadLetterQueueUrl?: string
  /** Max receive count before sending to DLQ */
  maxReceiveCount: number
}

export interface AnalyticsEvent {
  type: 'pageview' | 'session' | 'event' | 'realtime'
  siteId: string
  timestamp: string
  data: PageView | Session | CustomEvent | RealtimeUpdate
}

export interface RealtimeUpdate {
  siteId: string
  minute: string
  path: string
  visitorId: string
}

export interface SQSMessage {
  events: AnalyticsEvent[]
  batchId: string
  timestamp: string
  retryCount?: number
}

export interface SQSSendResult {
  successful: number
  failed: number
  messageId?: string
}

export interface SQSClient {
  sendMessage: (input: SQSSendMessageInput) => Promise<SQSSendMessageOutput>
  sendMessageBatch: (input: SQSSendMessageBatchInput) => Promise<SQSSendMessageBatchOutput>
  receiveMessage: (input: SQSReceiveMessageInput) => Promise<SQSReceiveMessageOutput>
  deleteMessage: (input: SQSDeleteMessageInput) => Promise<void>
  deleteMessageBatch: (input: SQSDeleteMessageBatchInput) => Promise<SQSDeleteMessageBatchOutput>
}

interface SQSSendMessageInput {
  QueueUrl: string
  MessageBody: string
  MessageGroupId?: string
  MessageDeduplicationId?: string
}

interface SQSSendMessageOutput {
  MessageId?: string
}

interface SQSSendMessageBatchInput {
  QueueUrl: string
  Entries: Array<{
    Id: string
    MessageBody: string
    MessageGroupId?: string
    MessageDeduplicationId?: string
  }>
}

interface SQSSendMessageBatchOutput {
  Successful?: Array<{ Id: string, MessageId: string }>
  Failed?: Array<{ Id: string, Code: string, Message: string }>
}

interface SQSReceiveMessageInput {
  QueueUrl: string
  MaxNumberOfMessages?: number
  VisibilityTimeout?: number
  WaitTimeSeconds?: number
}

interface SQSReceiveMessageOutput {
  Messages?: Array<{
    MessageId: string
    ReceiptHandle: string
    Body: string
  }>
}

interface SQSDeleteMessageInput {
  QueueUrl: string
  ReceiptHandle: string
}

interface SQSDeleteMessageBatchInput {
  QueueUrl: string
  Entries: Array<{
    Id: string
    ReceiptHandle: string
  }>
}

interface SQSDeleteMessageBatchOutput {
  Successful?: Array<{ Id: string }>
  Failed?: Array<{ Id: string, Code: string }>
}

// ============================================================================
// Default Configuration
// ============================================================================

export const defaultSQSConfig: SQSConfig = {
  enabled: false,
  batchSize: 10, // SQS max batch size
  maxMessagesPerInvocation: 100,
  visibilityTimeout: 30,
  messageRetention: 86400, // 1 day
  maxReceiveCount: 3,
}

// ============================================================================
// Event Buffer (in-memory for Lambda warm starts)
// ============================================================================

/**
 * In-memory event buffer for batching before SQS send
 */
export class EventBuffer {
  private buffer: AnalyticsEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly maxSize: number
  private readonly flushIntervalMs: number
  private readonly onFlush: (events: AnalyticsEvent[]) => Promise<void>

  constructor(options: {
    maxSize?: number
    flushIntervalMs?: number
    onFlush: (events: AnalyticsEvent[]) => Promise<void>
  }) {
    this.maxSize = options.maxSize ?? 100
    this.flushIntervalMs = options.flushIntervalMs ?? 1000
    this.onFlush = options.onFlush
  }

  add(event: AnalyticsEvent): void {
    this.buffer.push(event)

    if (this.buffer.length >= this.maxSize) {
      this.flush()
    }
    else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs)
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (this.buffer.length === 0) return

    const events = this.buffer.splice(0, this.buffer.length)
    await this.onFlush(events)
  }

  get size(): number {
    return this.buffer.length
  }
}

// ============================================================================
// SQS Event Producer
// ============================================================================

/**
 * Sends analytics events to SQS queue
 */
export class SQSEventProducer {
  private readonly client: SQSClient
  private readonly queueUrl: string
  private readonly batchSize: number

  constructor(client: SQSClient, queueUrl: string, batchSize: number = 10) {
    this.client = client
    this.queueUrl = queueUrl
    this.batchSize = Math.min(batchSize, 10) // SQS limit
  }

  /**
   * Send a single event to SQS
   */
  async sendEvent(event: AnalyticsEvent): Promise<SQSSendResult> {
    return this.sendEvents([event])
  }

  /**
   * Send multiple events to SQS (batched)
   */
  async sendEvents(events: AnalyticsEvent[]): Promise<SQSSendResult> {
    if (events.length === 0) {
      return { successful: 0, failed: 0 }
    }

    const message: SQSMessage = {
      events,
      batchId: generateBatchId(),
      timestamp: new Date().toISOString(),
    }

    try {
      const result = await this.client.sendMessage({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        // Use FIFO queue with site-based grouping for ordering
        MessageGroupId: events[0]?.siteId || 'default',
        MessageDeduplicationId: message.batchId,
      })

      return {
        successful: events.length,
        failed: 0,
        messageId: result.MessageId,
      }
    }
    catch (error) {
      console.error('[SQS] Failed to send events:', error)
      return {
        successful: 0,
        failed: events.length,
      }
    }
  }

  /**
   * Send events in batches using SQS batch API
   */
  async sendEventsBatch(events: AnalyticsEvent[]): Promise<SQSSendResult> {
    let successful = 0
    let failed = 0

    // Group events by site for better batching
    const bySite = groupEventsBySite(events)

    for (const [siteId, siteEvents] of Object.entries(bySite)) {
      // Chunk into SQS batch size
      for (let i = 0; i < siteEvents.length; i += this.batchSize) {
        const chunk = siteEvents.slice(i, i + this.batchSize)
        const entries = chunk.map((event, idx) => ({
          Id: `${i + idx}`,
          MessageBody: JSON.stringify({
            events: [event],
            batchId: generateBatchId(),
            timestamp: new Date().toISOString(),
          } as SQSMessage),
          MessageGroupId: siteId,
          MessageDeduplicationId: generateBatchId(),
        }))

        try {
          const result = await this.client.sendMessageBatch({
            QueueUrl: this.queueUrl,
            Entries: entries,
          })

          successful += result.Successful?.length ?? 0
          failed += result.Failed?.length ?? 0

          if (result.Failed && result.Failed.length > 0) {
            console.error('[SQS] Batch send failures:', result.Failed)
          }
        }
        catch (error) {
          console.error('[SQS] Batch send error:', error)
          failed += chunk.length
        }
      }
    }

    return { successful, failed }
  }
}

// ============================================================================
// SQS Event Consumer
// ============================================================================

/**
 * Processes analytics events from SQS queue
 */
export class SQSEventConsumer {
  private readonly client: SQSClient
  private readonly queueUrl: string
  private readonly processor: EventProcessor

  constructor(
    client: SQSClient,
    queueUrl: string,
    processor: EventProcessor,
  ) {
    this.client = client
    this.queueUrl = queueUrl
    this.processor = processor
  }

  /**
   * Process a batch of SQS messages (called by Lambda trigger)
   */
  async processBatch(messages: SQSLambdaMessage[]): Promise<ProcessResult> {
    const results: ProcessResult = {
      successful: 0,
      failed: 0,
      errors: [],
    }

    for (const message of messages) {
      try {
        const sqsMessage: SQSMessage = JSON.parse(message.body)
        await this.processor.processEvents(sqsMessage.events)
        results.successful++
      }
      catch (error) {
        console.error('[SQS Consumer] Failed to process message:', error)
        results.failed++
        results.errors.push({
          messageId: message.messageId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return results
  }

  /**
   * Poll for messages (for non-Lambda environments)
   */
  async poll(maxMessages: number = 10): Promise<ProcessResult> {
    const results: ProcessResult = {
      successful: 0,
      failed: 0,
      errors: [],
    }

    try {
      const response = await this.client.receiveMessage({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Math.min(maxMessages, 10),
        VisibilityTimeout: 30,
        WaitTimeSeconds: 20, // Long polling
      })

      if (!response.Messages || response.Messages.length === 0) {
        return results
      }

      const deleteEntries: Array<{ Id: string, ReceiptHandle: string }> = []

      for (const message of response.Messages) {
        try {
          const sqsMessage: SQSMessage = JSON.parse(message.Body)
          await this.processor.processEvents(sqsMessage.events)
          results.successful++
          deleteEntries.push({
            Id: message.MessageId,
            ReceiptHandle: message.ReceiptHandle,
          })
        }
        catch (error) {
          console.error('[SQS Consumer] Processing error:', error)
          results.failed++
          results.errors.push({
            messageId: message.MessageId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Delete successfully processed messages
      if (deleteEntries.length > 0) {
        await this.client.deleteMessageBatch({
          QueueUrl: this.queueUrl,
          Entries: deleteEntries,
        })
      }
    }
    catch (error) {
      console.error('[SQS Consumer] Poll error:', error)
    }

    return results
  }
}

// ============================================================================
// Event Processor Interface
// ============================================================================

export interface EventProcessor {
  processEvents(events: AnalyticsEvent[]): Promise<void>
}

export interface SQSLambdaMessage {
  messageId: string
  receiptHandle: string
  body: string
}

export interface ProcessResult {
  successful: number
  failed: number
  errors: Array<{ messageId: string, error: string }>
}

// ============================================================================
// Partition Key Strategy for Scale
// ============================================================================

/**
 * Generate a partition key with time-based sharding to avoid hot partitions
 *
 * For high-volume sites, we add a shard suffix based on the current minute
 * to distribute writes across multiple partitions.
 *
 * Pattern: SITE#{siteId}#SHARD#{shardId}
 *
 * This helps with:
 * - Distributing write throughput across partitions
 * - Avoiding hot partition throttling
 * - Supporting burst traffic patterns
 */
export function getShardedPartitionKey(
  siteId: string,
  shardCount: number = 10,
): string {
  // Use current minute for deterministic sharding
  const minute = new Date().getMinutes()
  const shardId = minute % shardCount
  return `SITE#${siteId}#SHARD#${shardId}`
}

/**
 * Generate partition key with random sharding for even distribution
 */
export function getRandomShardedPartitionKey(
  siteId: string,
  shardCount: number = 10,
): string {
  const shardId = Math.floor(Math.random() * shardCount)
  return `SITE#${siteId}#SHARD#${shardId}`
}

/**
 * Get all shard keys for a site (used for queries)
 */
export function getAllShardKeys(
  siteId: string,
  shardCount: number = 10,
): string[] {
  return Array.from({ length: shardCount }, (_, i) => `SITE#${siteId}#SHARD#${i}`)
}

// ============================================================================
// Write Coalescing
// ============================================================================

/**
 * Coalesce multiple writes to the same key within a time window
 * This reduces write costs and avoids unnecessary overwrites
 */
export class WriteCoalescer<T> {
  private pending: Map<string, { data: T, timer: ReturnType<typeof setTimeout> }> = new Map()
  private readonly windowMs: number
  private readonly onWrite: (key: string, data: T) => Promise<void>

  constructor(options: {
    windowMs?: number
    onWrite: (key: string, data: T) => Promise<void>
  }) {
    this.windowMs = options.windowMs ?? 100
    this.onWrite = options.onWrite
  }

  /**
   * Queue a write - if a write for the same key is pending, it will be replaced
   */
  write(key: string, data: T): void {
    const existing = this.pending.get(key)
    if (existing) {
      clearTimeout(existing.timer)
    }

    const timer = setTimeout(async () => {
      this.pending.delete(key)
      try {
        await this.onWrite(key, data)
      }
      catch (error) {
        console.error('[WriteCoalescer] Write failed:', key, error)
      }
    }, this.windowMs)

    this.pending.set(key, { data, timer })
  }

  /**
   * Flush all pending writes immediately
   */
  async flush(): Promise<void> {
    const entries = Array.from(this.pending.entries())
    this.pending.clear()

    for (const [key, { data, timer }] of entries) {
      clearTimeout(timer)
      try {
        await this.onWrite(key, data)
      }
      catch (error) {
        console.error('[WriteCoalescer] Flush write failed:', key, error)
      }
    }
  }

  get size(): number {
    return this.pending.size
  }
}

// ============================================================================
// Utilities
// ============================================================================

function generateBatchId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function groupEventsBySite(events: AnalyticsEvent[]): Record<string, AnalyticsEvent[]> {
  const grouped: Record<string, AnalyticsEvent[]> = {}
  for (const event of events) {
    const siteId = event.siteId || 'unknown'
    if (!grouped[siteId]) {
      grouped[siteId] = []
    }
    grouped[siteId].push(event)
  }
  return grouped
}

// ============================================================================
// CloudFormation/SAM Template Helper
// ============================================================================

/**
 * Generate CloudFormation resources for SQS-based buffering
 */
export function generateSQSResources(config: {
  queueName: string
  deadLetterQueueName?: string
  visibilityTimeout?: number
  messageRetention?: number
  maxReceiveCount?: number
  fifo?: boolean
}): Record<string, unknown> {
  const resources: Record<string, unknown> = {}
  const fifoSuffix = config.fifo ? '.fifo' : ''

  // Dead Letter Queue
  if (config.deadLetterQueueName) {
    resources.AnalyticsDeadLetterQueue = {
      Type: 'AWS::SQS::Queue',
      Properties: {
        QueueName: `${config.deadLetterQueueName}${fifoSuffix}`,
        MessageRetentionPeriod: 1209600, // 14 days
        ...(config.fifo && {
          FifoQueue: true,
          ContentBasedDeduplication: true,
        }),
      },
    }
  }

  // Main Queue
  resources.AnalyticsEventQueue = {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: `${config.queueName}${fifoSuffix}`,
      VisibilityTimeout: config.visibilityTimeout ?? 30,
      MessageRetentionPeriod: config.messageRetention ?? 86400,
      ...(config.fifo && {
        FifoQueue: true,
        ContentBasedDeduplication: true,
      }),
      ...(config.deadLetterQueueName && {
        RedrivePolicy: {
          deadLetterTargetArn: { 'Fn::GetAtt': ['AnalyticsDeadLetterQueue', 'Arn'] },
          maxReceiveCount: config.maxReceiveCount ?? 3,
        },
      }),
    },
  }

  return resources
}

// ============================================================================
// ts-cloud Integration
// ============================================================================

/**
 * Create an SQS event producer using ts-cloud configuration
 *
 * @example
 * ```ts
 * import { createAnalyticsProducer } from 'ts-analytics'
 *
 * // Uses queue URL from environment or cloud.config.ts
 * const producer = await createAnalyticsProducer()
 *
 * // Or specify queue URL directly
 * const producer = await createAnalyticsProducer({
 *   queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/analytics-events',
 *   region: 'us-east-1',
 * })
 *
 * // Send events
 * await producer.sendEvent({
 *   type: 'pageview',
 *   siteId: 'my-site',
 *   timestamp: new Date().toISOString(),
 *   data: pageViewData,
 * })
 * ```
 */
export async function createAnalyticsProducer(options?: {
  queueUrl?: string
  region?: string
}): Promise<SQSEventProducer> {
  // Try to load from environment or cloud.config.ts
  const queueUrl = options?.queueUrl
    || process.env.SQS_QUEUE_URL
    || process.env.ANALYTICS_SQS_QUEUE_URL

  if (!queueUrl) {
    throw new Error(
      'SQS queue URL not configured. Set SQS_QUEUE_URL environment variable or pass queueUrl option.',
    )
  }

  const region = options?.region || process.env.AWS_REGION || 'us-east-1'

  // Dynamic import to avoid bundling ts-cloud in browser builds
  // Falls back to a minimal implementation if ts-cloud is not available
  let clientAdapter: SQSClient

  try {
    const tsCloud = await import('ts-cloud')
    const sqsClient = new tsCloud.SQSClient(region)

    // Create adapter to match our interface using ts-cloud client
    clientAdapter = {
      sendMessage: async (input) => {
        const result = await sqsClient.sendMessage({
          queueUrl: input.QueueUrl,
          messageBody: input.MessageBody,
          messageGroupId: input.MessageGroupId,
          messageDeduplicationId: input.MessageDeduplicationId,
        })
        return { MessageId: result.MessageId }
      },
      sendMessageBatch: async (input) => {
        // ts-cloud may not have sendMessageBatch, fall back to individual sends
        const results = await Promise.allSettled(
          input.Entries.map(e =>
            sqsClient.sendMessage({
              queueUrl: input.QueueUrl,
              messageBody: e.MessageBody,
              messageGroupId: e.MessageGroupId,
              messageDeduplicationId: e.MessageDeduplicationId,
            }).then(r => ({ Id: e.Id, MessageId: r.MessageId })),
          ),
        )
        return {
          Successful: results
            .filter((r): r is PromiseFulfilledResult<{ Id: string, MessageId: string }> => r.status === 'fulfilled')
            .map(r => r.value),
          Failed: results
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map((r, i) => ({ Id: input.Entries[i].Id, Code: 'SendFailed', Message: String(r.reason) })),
        }
      },
      receiveMessage: async (input) => {
        const result = await sqsClient.receiveMessages({
          queueUrl: input.QueueUrl,
          maxMessages: input.MaxNumberOfMessages,
          visibilityTimeout: input.VisibilityTimeout,
          waitTimeSeconds: input.WaitTimeSeconds,
        })
        return {
          Messages: result.Messages?.map(m => ({
            MessageId: m.MessageId || '',
            ReceiptHandle: m.ReceiptHandle || '',
            Body: m.Body || '',
          })),
        }
      },
      deleteMessage: async (input) => {
        await sqsClient.deleteMessage(input.QueueUrl, input.ReceiptHandle)
      },
      deleteMessageBatch: async (input) => {
        // ts-cloud may not have deleteMessageBatch, fall back to individual deletes
        const results = await Promise.allSettled(
          input.Entries.map(e =>
            sqsClient.deleteMessage(input.QueueUrl, e.ReceiptHandle).then(() => ({ Id: e.Id })),
          ),
        )
        return {
          Successful: results
            .filter((r): r is PromiseFulfilledResult<{ Id: string }> => r.status === 'fulfilled')
            .map(r => r.value),
          Failed: results
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map((r, i) => ({ Id: input.Entries[i].Id, Code: 'DeleteFailed' })),
        }
      },
    }
  }
  catch {
    throw new Error(
      'ts-cloud package is required for SQS integration. Install with: bun add ts-cloud',
    )
  }

  return new SQSEventProducer(clientAdapter, queueUrl)
}

/**
 * Check if SQS buffering is enabled based on configuration
 */
export function isSQSBufferingEnabled(): boolean {
  return (
    process.env.SQS_BUFFERING_ENABLED === 'true'
    || process.env.ANALYTICS_SQS_ENABLED === 'true'
    || Boolean(process.env.SQS_QUEUE_URL)
  )
}

// ============================================================================
// Export Default Config
// ============================================================================

export { defaultSQSConfig as sqsConfig }
