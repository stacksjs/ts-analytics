/**
 * Per-site raw-data retention, honored at ingest (#178).
 *
 * The Settings UI has always written a RETENTION_SETTINGS item (plan-clamped),
 * but nothing ever read it — every raw row got the global config TTL, making
 * the setting decorative. Collect now loads the site's setting (cached
 * in-process for 5 minutes) and every raw write stamps its TTL from it.
 *
 * Honest limitation: TTLs are stamped at WRITE time. Changing retention
 * affects rows written after the change; existing rows keep their original
 * expiry (a rewrite sweep would cost a full-partition scan per change).
 */
import { getConfig } from '../config'

const CACHE_MS = 5 * 60 * 1000
const cache = new Map<string, { seconds: number | null, at: number }>()

/**
 * Load (cached) the site's retention override in seconds, or null when the
 * site has none configured.
 */
export async function ensureSiteRetentionLoaded(siteId: string): Promise<void> {
  const hit = cache.get(siteId)
  if (hit && Date.now() - hit.at < CACHE_MS)
    return
  try {
    // Lazy import: the ORM imports this module for rawTtlForSite, and
    // lib/dynamodb imports the ORM — a static import here would recreate the
    // circular-import TDZ crash (#177).
    const { dynamodb, TABLE_NAME, unmarshall } = await import('./dynamodb')
    const res = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: `SITE#${siteId}` }, sk: { S: 'RETENTION_SETTINGS' } },
    })
    const days = res.Item ? Number(unmarshall(res.Item).retentionDays) : Number.NaN
    cache.set(siteId, { seconds: Number.isFinite(days) && days > 0 ? days * 24 * 60 * 60 : null, at: Date.now() })
  }
  catch {
    // Unreachable settings must never drop events — fall back to global TTL.
    cache.set(siteId, { seconds: null, at: Date.now() })
  }
}

/** Raw-row TTL epoch for a site: its configured retention, else global config. */
export function rawTtlForSite(siteId: string): number {
  const now = Math.floor(Date.now() / 1000)
  const override = cache.get(siteId)?.seconds
  if (override)
    return now + override
  return now + getConfig().retention.rawEventTtl
}

/** Test hook. */
export function clearSiteRetentionCache(): void {
  cache.clear()
}
