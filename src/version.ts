/**
 * Tracker/library version (#179) — embedded in the generated script, sent on
 * every beacon (`v`), and aggregated into the hourly ingest counters, so
 * support can tell exactly which tracker build a site is running instead of
 * guessing at cache states.
 *
 * ## Why this is a literal and not `pkg.version`
 *
 * Importing ../package.json to derive it works, and was measured: Bun inlines
 * the WHOLE file into the published bundle, so every consumer would receive our
 * devDependencies and their versions as part of the library. Four kilobytes and
 * a build-metadata leak to save one edit per release is the wrong trade.
 *
 * ## Keeping it honest
 *
 * A test asserts this equals package.json's version, and `bun build.ts` refuses
 * to build when they disagree. The test alone was not enough: it has been red
 * since 0.1.1 and a release shipped past it anyway, which left every beacon in
 * the field reporting 0.1.0 — the exact "guessing at cache states" this constant
 * exists to prevent, except confidently wrong rather than merely absent.
 *
 * Bump this in the same commit as package.json.
 */
export const TRACKER_VERSION: string = '0.1.14'
