/**
 * DynamoDB error classification. Lives in its own dependency-free module so
 * both src/lib/dynamodb and the ORM can import it without creating a circular
 * import (the ORM must never import lib/dynamodb — lib/dynamodb imports the
 * ORM, and the cycle trips a TDZ depending on entry order, #177).
 */

/**
 * Whether an error is a DynamoDB conditional-check failure. Matches BOTH the
 * AWS SDK shape (name === 'ConditionalCheckFailedException') and the ts-cloud
 * client's wrapping (generic Error whose message contains the DynamoDB
 * error text "The conditional request failed").
 */
export function isConditionalCheckFailed(e: unknown): boolean {
  const err = e as { name?: string, message?: string } | null
  return !!err && (
    String(err.name || '').includes('ConditionalCheckFailed')
    || /conditional request failed/i.test(String(err.message || err))
  )
}
