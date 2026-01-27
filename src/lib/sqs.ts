/**
 * SQS producer for buffered writes
 */

import { isSQSBufferingEnabled, createAnalyticsProducer } from '../../src/index'

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL
const SQS_ENABLED = isSQSBufferingEnabled()
const REGION = process.env.AWS_REGION || 'us-east-1'

// SQS client for buffered writes (lazy initialized)
let sqsProducer: Awaited<ReturnType<typeof createAnalyticsProducer>> | null = null

/**
 * Get or initialize the SQS producer
 */
export async function getSQSProducer() {
  if (!sqsProducer && SQS_ENABLED && SQS_QUEUE_URL) {
    sqsProducer = await createAnalyticsProducer({
      queueUrl: SQS_QUEUE_URL,
      region: REGION,
    })
  }
  return sqsProducer
}

/**
 * Check if SQS buffering is enabled
 */
export function isSQSEnabled(): boolean {
  return SQS_ENABLED && !!SQS_QUEUE_URL
}

/**
 * Send an event to SQS for buffered processing
 */
export async function sendToSQS<T extends Record<string, unknown>>(event: T): Promise<boolean> {
  const producer = await getSQSProducer()
  if (!producer) return false

  try {
    await producer.send(event)
    return true
  } catch (error) {
    console.error('[SQS] Failed to send event:', error)
    return false
  }
}

/**
 * Send multiple events to SQS
 */
export async function sendBatchToSQS<T extends Record<string, unknown>>(events: T[]): Promise<boolean> {
  const producer = await getSQSProducer()
  if (!producer) return false

  try {
    await producer.sendBatch(events)
    return true
  } catch (error) {
    console.error('[SQS] Failed to send batch:', error)
    return false
  }
}
