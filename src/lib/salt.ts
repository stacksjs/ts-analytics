/**
 * Visitor-hash salt (#88).
 *
 * The cookieless visitor id is hash(ip, ua, siteId, salt). The salt used to be
 * `analytics-${date}` — predictable, so anyone could reproduce/correlate
 * visitor hashes. It is now HMAC-SHA256(secret, date): rotates daily, and
 * cannot be reproduced without the server secret.
 *
 * The secret comes from ANALYTICS_SALT_SECRET. When unset, a process-random
 * secret is generated so hashes stay non-reproducible — but they then differ
 * across instances/restarts (unique-visitor counts reset), so production
 * should always set the env var.
 */
import { createHmac, randomBytes } from 'node:crypto'

let ephemeralSecret: string | null = null

function getSaltSecret(): string {
  const configured = process.env.ANALYTICS_SALT_SECRET
  if (configured)
    return configured
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString('hex')
    console.warn('[analytics] ANALYTICS_SALT_SECRET is not set — using an ephemeral salt secret. Visitor hashes will not be stable across restarts/instances; set ANALYTICS_SALT_SECRET in production.')
  }
  return ephemeralSecret
}

/** Daily-rotating, secret-seeded salt for visitor ID hashing.
 *
 * NOTE: process-local — on multi-instance deployments prefer
 * {@link getSharedDailySalt}, which persists the day's salt in DynamoDB so
 * every instance hashes with the same value.
 */
export function getDailySalt(): string {
  const today = new Date().toISOString().slice(0, 10)
  return createHmac('sha256', getSaltSecret()).update(today).digest('hex')
}

// In-process cache of the shared salt: one DynamoDB read per instance per day.
let sharedSaltDay: string | null = null
let sharedSaltValue: string | null = null

/**
 * Cluster-consistent daily salt (#165). The process-local salt differs per
 * instance when ANALYTICS_SALT_SECRET is unset (Lambda concurrency, restarts),
 * which inflates unique-visitor counts — the same visitor hashes differently on
 * every instance. Persist the day's salt as a SALT item via conditional put
 * (first writer wins) so all instances converge, with the process-local value
 * as both the candidate and the fallback when DynamoDB is unreachable.
 */
export async function getSharedDailySalt(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10)
  if (sharedSaltDay === today && sharedSaltValue)
    return sharedSaltValue

  const local = getDailySalt()
  const key = { pk: { S: 'SALT' }, sk: { S: `DAY#${today}` } }
  try {
    // Deferred import so the legacy sync path never touches DynamoDB.
    const { dynamodb, TABLE_NAME } = await import('./dynamodb')
    try {
      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: {
          ...key,
          salt: { S: local },
          // Keep a few days so the settle window can still hash consistently.
          ttl: { N: String(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60) },
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      })
      sharedSaltDay = today
      sharedSaltValue = local
      return local
    }
    catch (e: any) {
      const { isConditionalCheckFailed } = await import('./dynamodb')
      if (!isConditionalCheckFailed(e))
        throw e
      // Another instance won the race — adopt its salt.
      const res = await dynamodb.getItem({ TableName: TABLE_NAME, Key: key }) as { Item?: { salt?: { S?: string } } }
      const winner = res.Item?.salt?.S
      if (winner) {
        sharedSaltDay = today
        sharedSaltValue = winner
        return winner
      }
      return local
    }
  }
  catch {
    // DynamoDB unreachable — fall back to the process-local salt rather than
    // failing ingest; counts degrade to per-instance behavior until it heals.
    return local
  }
}
