/**
 * Event Batching Utility
 *
 * High-performance event batching for handling large volumes of analytics events.
 * Uses DynamoDB BatchWriteItem for efficient bulk writes.
 */

import type { CustomEvent, PageView, Session } from './types'
import { getConfig } from './config'
import { generateId, KeyPatterns } from './dynamodb'

// ============================================================================
// Types
// ============================================================================

export interface BatchItem {
  type: 'pageview' | 'session' | 'event'
  data: PageView | Session | CustomEvent
}

export interface BatchWriteResult {
  successful: number
  failed: number
  unprocessedItems: BatchItem[]
}

export interface BatchQueueOptions {
  /** Maximum items per batch (DynamoDB limit is 25) */
  maxBatchSize?: number
  /** Flush interval in milliseconds */
  flushIntervalMs?: number
  /** Maximum queue size before auto-flush */
  maxQueueSize?: number
  /** Callback for batch write errors */
  onError?: (error: Error, items: BatchItem[]) => void
  /** Callback when batch is flushed */
  onFlush?: (result: BatchWriteResult) => void
}

export interface DynamoDBBatchClient {
  batchWriteItem: (input: BatchWriteInput) => Promise<BatchWriteOutput>
}

interface BatchWriteInput {
  RequestItems: Record<string, WriteRequest[]>
}

interface BatchWriteOutput {
  UnprocessedItems?: Record<string, WriteRequest[]>
}

interface WriteRequest {
  PutRequest?: {
    Item: Record<string, AttributeValue>
  }
}

interface AttributeValue {
  S?: string
  N?: string
  BOOL?: boolean
  L?: AttributeValue[]
  M?: Record<string, AttributeValue>
}

// ============================================================================
// Event Batch Queue
// ============================================================================

/**
 * High-performance event batch queue
 *
 * @example
 * ```ts
 * const queue = new EventBatchQueue(dynamoClient, {
 *   maxBatchSize: 25,
 *   flushIntervalMs: 5000,
 *   onFlush: (result) => console.log(`Flushed ${result.successful} items`),
 * })
 *
 * // Add events (auto-batched)
 * queue.addPageView(pageView)
 * queue.addSession(session)
 *
 * // Manual flush if needed
 * await queue.flush()
 *
 * // Shutdown gracefully
 * await queue.close()
 * ```
 */
export class EventBatchQueue {
  private queue: BatchItem[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private isClosing = false
  private flushPromise: Promise<void> | null = null

  private readonly client: DynamoDBBatchClient
  private readonly tableName: string
  private readonly maxBatchSize: number
  private readonly flushIntervalMs: number
  private readonly maxQueueSize: number
  private readonly onError?: (error: Error, items: BatchItem[]) => void
  private readonly onFlush?: (result: BatchWriteResult) => void

  constructor(client: DynamoDBBatchClient, options: BatchQueueOptions = {}) {
    this.client = client
    this.tableName = getConfig().table.tableName
    this.maxBatchSize = Math.min(options.maxBatchSize ?? 25, 25) // DynamoDB limit
    this.flushIntervalMs = options.flushIntervalMs ?? 5000
    this.maxQueueSize = options.maxQueueSize ?? 100
    this.onError = options.onError
    this.onFlush = options.onFlush

    // Start periodic flush
    this.startFlushTimer()
  }

  /**
   * Add a page view to the queue
   */
  addPageView(pageView: PageView): void {
    this.add({ type: 'pageview', data: pageView })
  }

  /**
   * Add a session to the queue
   */
  addSession(session: Session): void {
    this.add({ type: 'session', data: session })
  }

  /**
   * Add a custom event to the queue
   */
  addEvent(event: CustomEvent): void {
    this.add({ type: 'event', data: event })
  }

  /**
   * Add a batch item to the queue
   */
  add(item: BatchItem): void {
    if (this.isClosing) {
      throw new Error('Cannot add items to a closing queue')
    }

    this.queue.push(item)

    // Auto-flush if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.flush()
    }
  }

  /**
   * Flush all queued items to DynamoDB
   */
  async flush(): Promise<BatchWriteResult> {
    // Wait for any in-progress flush
    if (this.flushPromise) {
      await this.flushPromise
    }

    if (this.queue.length === 0) {
      return { successful: 0, failed: 0, unprocessedItems: [] }
    }

    const itemsToFlush = this.queue.splice(0, this.queue.length)
    let totalResult: BatchWriteResult = { successful: 0, failed: 0, unprocessedItems: [] }

    this.flushPromise = (async () => {
      // Process in batches of maxBatchSize
      for (let i = 0; i < itemsToFlush.length; i += this.maxBatchSize) {
        const batch = itemsToFlush.slice(i, i + this.maxBatchSize)
        const result = await this.writeBatch(batch)

        totalResult.successful += result.successful
        totalResult.failed += result.failed
        totalResult.unprocessedItems.push(...result.unprocessedItems)
      }

      this.onFlush?.(totalResult)
    })()

    await this.flushPromise
    this.flushPromise = null

    return totalResult
  }

  /**
   * Close the queue and flush remaining items
   */
  async close(): Promise<void> {
    this.isClosing = true
    this.stopFlushTimer()
    await this.flush()
  }

  /**
   * Get current queue size
   */
  get size(): number {
    return this.queue.length
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0) {
        this.flush()
      }
    }, this.flushIntervalMs)
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  private async writeBatch(items: BatchItem[]): Promise<BatchWriteResult> {
    const writeRequests = items.map(item => this.toWriteRequest(item))

    try {
      const result = await this.client.batchWriteItem({
        RequestItems: {
          [this.tableName]: writeRequests,
        },
      })

      const unprocessedCount = result.UnprocessedItems?.[this.tableName]?.length ?? 0
      const successCount = items.length - unprocessedCount

      // Convert unprocessed items back to BatchItem format
      const unprocessedItems: BatchItem[] = []
      if (unprocessedCount > 0) {
        // Note: DynamoDB doesn't preserve order, so we return all as failed
        unprocessedItems.push(...items.slice(-unprocessedCount))
      }

      return {
        successful: successCount,
        failed: unprocessedCount,
        unprocessedItems,
      }
    }
    catch (error) {
      this.onError?.(error as Error, items)
      return {
        successful: 0,
        failed: items.length,
        unprocessedItems: items,
      }
    }
  }

  private toWriteRequest(item: BatchItem): WriteRequest {
    switch (item.type) {
      case 'pageview':
        return { PutRequest: { Item: this.marshalPageView(item.data as PageView) } }
      case 'session':
        return { PutRequest: { Item: this.marshalSession(item.data as Session) } }
      case 'event':
        return { PutRequest: { Item: this.marshalCustomEvent(item.data as CustomEvent) } }
    }
  }

  private marshalPageView(pv: PageView): Record<string, AttributeValue> {
    return {
      pk: { S: KeyPatterns.pageView.pk(pv.siteId) },
      sk: { S: KeyPatterns.pageView.sk(pv.timestamp, pv.id) },
      id: { S: pv.id },
      siteId: { S: pv.siteId },
      visitorId: { S: pv.visitorId },
      sessionId: { S: pv.sessionId },
      path: { S: pv.path },
      hostname: { S: pv.hostname },
      ...(pv.title && { title: { S: pv.title } }),
      ...(pv.referrer && { referrer: { S: pv.referrer } }),
      ...(pv.referrerSource && { referrerSource: { S: pv.referrerSource } }),
      ...(pv.deviceType && { deviceType: { S: pv.deviceType } }),
      ...(pv.browser && { browser: { S: pv.browser } }),
      ...(pv.os && { os: { S: pv.os } }),
      isUnique: { BOOL: pv.isUnique },
      isBounce: { BOOL: pv.isBounce },
      timestamp: { S: pv.timestamp.toISOString() },
      entityType: { S: 'pageview' },
    }
  }

  private marshalSession(s: Session): Record<string, AttributeValue> {
    return {
      pk: { S: KeyPatterns.session.pk(s.siteId) },
      sk: { S: KeyPatterns.session.sk(s.id) },
      id: { S: s.id },
      siteId: { S: s.siteId },
      visitorId: { S: s.visitorId },
      entryPath: { S: s.entryPath },
      exitPath: { S: s.exitPath },
      ...(s.referrer && { referrer: { S: s.referrer } }),
      ...(s.referrerSource && { referrerSource: { S: s.referrerSource } }),
      ...(s.deviceType && { deviceType: { S: s.deviceType } }),
      ...(s.browser && { browser: { S: s.browser } }),
      ...(s.os && { os: { S: s.os } }),
      pageViewCount: { N: String(s.pageViewCount) },
      eventCount: { N: String(s.eventCount) },
      isBounce: { BOOL: s.isBounce },
      duration: { N: String(s.duration) },
      startedAt: { S: s.startedAt.toISOString() },
      endedAt: { S: s.endedAt.toISOString() },
      entityType: { S: 'session' },
    }
  }

  private marshalCustomEvent(e: CustomEvent): Record<string, AttributeValue> {
    return {
      pk: { S: KeyPatterns.event.pk(e.siteId) },
      sk: { S: KeyPatterns.event.sk(e.timestamp, e.id) },
      id: { S: e.id },
      siteId: { S: e.siteId },
      visitorId: { S: e.visitorId },
      sessionId: { S: e.sessionId },
      name: { S: e.name },
      ...(e.category && { category: { S: e.category } }),
      ...(e.value !== undefined && { value: { N: String(e.value) } }),
      ...(e.properties && { properties: { S: JSON.stringify(e.properties) } }),
      path: { S: e.path },
      timestamp: { S: e.timestamp.toISOString() },
      entityType: { S: 'event' },
    }
  }
}

// ============================================================================
// Batch Processing Utilities
// ============================================================================

/**
 * Create a batch processor for processing events in bulk
 */
export function createBatchProcessor<T>(
  processor: (batch: T[]) => Promise<void>,
  options: { batchSize?: number, delayMs?: number } = {},
): {
    add: (item: T) => void
    flush: () => Promise<void>
    size: () => number
  } {
  const batchSize = options.batchSize ?? 100
  const delayMs = options.delayMs ?? 0
  let queue: T[] = []
  let processing = false

  async function processQueue(): Promise<void> {
    if (processing || queue.length === 0) return
    processing = true

    while (queue.length > 0) {
      const batch = queue.splice(0, batchSize)

      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      await processor(batch)
    }

    processing = false
  }

  return {
    add(item: T): void {
      queue.push(item)
      if (queue.length >= batchSize) {
        processQueue()
      }
    },
    async flush(): Promise<void> {
      await processQueue()
    },
    size(): number {
      return queue.length
    },
  }
}

/**
 * Retry helper with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number, baseDelayMs?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3
  const baseDelayMs = options.baseDelayMs ?? 100
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    }
    catch (error) {
      lastError = error as Error

      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * 2 ** attempt
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

/**
 * Chunk an array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Process items in parallel with concurrency limit
 */
export async function parallelProcess<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 5,
): Promise<R[]> {
  const results: R[] = []
  const queue = [...items]

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item !== undefined) {
        results.push(await processor(item))
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)

  return results
}
