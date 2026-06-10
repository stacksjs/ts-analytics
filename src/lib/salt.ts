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

/** Daily-rotating, secret-seeded salt for visitor ID hashing. */
export function getDailySalt(): string {
  const today = new Date().toISOString().slice(0, 10)
  return createHmac('sha256', getSaltSecret()).update(today).digest('hex')
}
