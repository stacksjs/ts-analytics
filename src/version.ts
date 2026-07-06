/**
 * Tracker/library version (#179) — embedded in the generated script, sent on
 * every beacon (`v`), and aggregated into the hourly ingest counters, so
 * support can tell exactly which tracker build a site is running instead of
 * guessing at cache states. Kept in sync with package.json by a test.
 */
export const TRACKER_VERSION: string = '0.1.0'
