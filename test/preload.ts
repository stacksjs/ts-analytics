/**
 * Test preload (#177): runs before every test file.
 *
 * Starts the in-process DynamoDB fake and points BOTH client paths
 * (src/lib/dynamodb + the ORM models) at it via ANALYTICS_DYNAMODB_ENDPOINT —
 * env must be set before any src module loads, which is exactly what a
 * preload guarantees. No test can ever touch real AWS.
 */
import { startFakeDynamo } from './harness/dynamo-fake'

process.env.ANALYTICS_DYNAMODB_ENDPOINT = startFakeDynamo()
process.env.AWS_ACCESS_KEY_ID ??= 'test'
process.env.AWS_SECRET_ACCESS_KEY ??= 'test'
process.env.ANALYTICS_SALT_SECRET ??= 'test-salt-secret'
process.env.ANALYTICS_REQUIRE_AUTH ??= 'false'
