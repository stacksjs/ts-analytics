---
title: Scaling & Capacity
description: Load-test results, DynamoDB capacity model, limits and guardrails
---

# Scaling & Capacity

Measured with `bun scripts/load-test.ts` (June 2026, single-table on-demand DynamoDB in us-east-1, API on Bun). Absolute latencies below include ~150ms client→region RTT per DynamoDB round trip — in-region (Lambda/ECS) they drop roughly 10×; the *shape* (how many sequential round trips and scanned pages) is what scales.

## Write path (ingest)

One pageview = **3–5 sequential DynamoDB calls**: site check (cached after first), session `GetItem`, pageview `PutItem`, session upsert, goal-conversion check.

- Measured: ~19 req/s at concurrency 25 from a remote client (RTT-bound — each request is a chain of sequential round trips).
- In-region, the same chain is ~20–50ms → a single instance sustains hundreds of events/sec; instances scale horizontally with no coordination (all state is in DynamoDB).

**The real write ceiling is the partition.** All of a site's items share `pk = SITE#{siteId}`, and a DynamoDB partition sustains **1,000 WCU/sec**. At ~2–3 writes per pageview that is roughly **300–400 pageviews/sec per site** (~25–30M events/day for one site) before write sharding becomes necessary. Aggregate throughput across many sites is effectively unbounded (different partitions).

## Read path (dashboard)

Raw queries page through events at ~1MB per sequential page (~3,000 small items/page). Pre-aggregation (`ROLLUP#DAY#`, see `src/lib/rollups.ts`) replaces that with one bounded query over day buckets.

Measured on a 5-day range (cache disabled; day-aligned ranges):

| Volume in range | `/timeseries` raw | `/timeseries` rollups |
|---|---|---|
| 5k events | p50 616ms / p95 2,675ms | p50 535ms / p95 602ms |
| 20k events | p50 937ms (≈6 pages) | p50 ~600–900ms (2 queries, flat) |

- **Raw grows linearly** with events in range (pages × RTT): ~100k events ≈ 30 sequential pages ≈ multi-second.
- **Rollups are O(days)**: one query for the rollup range + one raw query for today, regardless of history volume.
- The **read-through cache** (on by default, 30–120s TTLs) absorbs repeated dashboard polls: measured 852ms → 15ms on a repeat hit.

## Known limits & hot spots

1. **Sessions are id-keyed (`SESSION#{sessionId}`), not time-keyed** — `/stats` still scans the session prefix for the live window (bounded by the 90-day session TTL). This is the dominant remaining cost in `/stats` (~1.1s at 20k events locally). Fix when needed: time-keyed session keys or a session-count rollup field.
2. **Per-site partition throughput** (above): ~300–400 pageviews/sec sustained per site. Mitigation: sharded partition keys (`SITE#{id}#SHARD{n}` — helpers already exist in `src/sqs-buffering.ts`) — only worth it past ~10M events/day/site.
3. **Item TTLs bound storage**: pageviews 30d (raw), sessions 90d, clicks/engagement 90d, errors 30d. History beyond TTL survives only in rollups — which is the design: dashboards read rollups for the past.
4. **1MB query pages**: any endpoint still reading raw events degrades linearly. Covered today: stats/timeseries (rollups), errors list (`ERROR_GROUP#` rollups), plus the read cache on all breakdowns. Breakdown endpoints (pages/referrers/etc.) still scan raw within range — next candidates for per-dimension rollup fields if ranges grow.

## Cost model (on-demand, us-east-1)

- Writes: ~$1.25/M WCU → a pageview (~3 writes, <1KB each) ≈ **$3.75 per million pageviews**.
- Reads: rollup-backed dashboard load ≈ a few RCU; raw scan of 100k events ≈ ~12,500 RCU ($0.25/M) — another reason rollups + cache matter.
- Storage: ~$0.25/GB-month; TTLs keep raw event storage flat.

## Guardrails in place

- Per-project **monthly event quota** (`ANALYTICS_MONTHLY_EVENT_QUOTA`, 429 over cap) and **per-key rate limiting** on error ingest (`ANALYTICS_ERROR_RATE_LIMIT`, default 300/min).
- Bot and referrer-spam drops happen **before any write**.
- The rollup job is idempotent and hourly; a missed run self-heals on the next tick.

## Re-running the load test

```bash
PORT=3001 bun server/index.ts &
bun scripts/load-test.ts --ingest 500 --concurrency 25 --seed 5000 --days 5
```

It uses a dedicated `loadtest-98` site; clean up afterwards by deleting that site (Settings → delete, or the owner-only `DELETE /api/sites/loadtest-98`).
