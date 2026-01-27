/**
 * AWS Lambda Handler for ts-analytics API
 *
 * This is the slim entry point that uses bun-router for routing.
 * All handlers are organized in the handlers/ directory.
 *
 * Supports optional SQS buffering for high-throughput scenarios.
 * Enable by setting SQS_BUFFERING_ENABLED=true and SQS_QUEUE_URL env vars.
 */

import { router } from '../src/router'
import { handleLambdaEvent, type LambdaEvent, type LambdaContext, type LambdaResponse } from './lambda-adapter'

/**
 * Main Lambda handler entry point
 *
 * Converts AWS Lambda events to standard Request objects,
 * routes them through bun-router, and returns Lambda-compatible responses.
 */
export async function handler(event: LambdaEvent, context: LambdaContext): Promise<LambdaResponse> {
  // Log request for debugging (can be disabled in production)
  if (process.env.DEBUG_REQUESTS === 'true') {
    console.log('Incoming request:', {
      path: event.rawPath || event.path,
      method: event.requestContext?.http?.method || event.httpMethod,
      queryParams: event.queryStringParameters,
    })
  }

  try {
    return await handleLambdaEvent(router, event)
  }
  catch (error) {
    console.error('Lambda handler error:', error)

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      isBase64Encoded: false,
    }
  }
}

/**
 * Warmup handler for Lambda provisioned concurrency
 * or scheduled warmup invocations
 */
export async function warmup(event: LambdaEvent): Promise<LambdaResponse> {
  if (event.source === 'serverless-plugin-warmup' || event.source === 'aws.events') {
    console.log('Warmup invocation')
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Lambda warmed up' }),
      isBase64Encoded: false,
    }
  }

  // Not a warmup, process normally
  return handler(event, {} as LambdaContext)
}

// Re-export types for external use
export type { LambdaEvent, LambdaContext, LambdaResponse } from './lambda-adapter'
