# Production-Readiness Audit — what we lack to be rock-solid and Fathom-accurate

> Four-lens audit run 2026-07-03 (counting-model accuracy / ingest robustness /
> scale & infrastructure / operational hygiene; 4 parallel auditors + synthesis,
> ~200 tool calls, findings live-probed against the real table where marked [V]).
> Companion to [fathom-deep-dive.md](./fathom-deep-dive.md).

# ts-analytics Production-Readiness Report — Synthesis of Four Audits (accuracy / ingest / scale / ops)

Verification key: **[V]** = empirically verified (live probe on PIPETEST1, replay test, or code-path confirmed at cited lines). **[S]** = structural inference / estimate, not demonstrated. Issue refs given where an audit cited one; "unfiled" where an audit explicitly said so.

---

## 1. Executive Verdict

Not production-ready, and — more importantly — not yet *accuracy*-ready: on identical traffic these numbers would not match Fathom's today, and several headline metrics (uniques, sessions, bounce rate, avg time) are load- and time-dependent artifacts rather than measurements. The bones are genuinely good — first-touch session-persistent attribution, atomic session increments (da339d3), server-side timestamps everywhere, a sane rollup scaffold with settle semantics — but five structural failures sit on the counting core: uniques inflate with process count because the daily salt is process-random unless an env var nobody's deploy sets is set [V]; sessions never time out in the wired path [V]; bot filtering is a 9-token regex that stores HeadlessChrome, curl, and empty-UA traffic as humans [V]; rollups are scalar-only, never run on either documented production deploy path, and raw rows TTL out at 30 days — so every breakdown panel silently loses all history [V]; and the read side full-scans the entire session partition on ~14 endpoints with silent truncation at scale, meaning numbers become *wrong*, not just slow [V]. Around that core: no idempotency (retries double-count [V]), no ingress firewall (anyone can poison any site's numbers [V]), a test suite that partly tests copy-pasted copies of itself [V], zero operational telemetry (the CORS bug that zeroed cross-origin traffic shipped twice with nothing to detect it), and deploy scripts that crash from a clean clone [V]. The fix list is tractable — the top four accuracy items are each under ~100 lines — but until at least salt persistence, session timeout, jobs wiring, and bot hardening land, the visitor and session numbers should not be marketed as trustworthy.

---

## 2. THE ACCURACY GAP — why our numbers would not match Fathom's, ranked by distortion size

**A1. CRITICAL [V] — Unique visitors inflate with instance/restart count.** Daily salt = HMAC(secret, date) where secret is process-random when `ANALYTICS_SALT_SECRET` is unset (`src/lib/salt.ts:16-27`), and **no deploy artifact sets it** — Lambda CFN ships only `ANALYTICS_TABLE_NAME` + `STEALTH_DOMAIN` (`deploy/api-lambda.ts:319-324`); absent from `deploy/api.ts`, Dockerfile, `.env`. Empirically shown: a server restart turned 1 visitor into 2 (people 6→7). On Lambda, every concurrent execution environment is a separate salt, so "people" scales with instance count. **Fix:** conditional-put a `SALT#DAY#{date}` item in DynamoDB (first writer wins, cache in-process); wire the env var into every deploy generator; hard-fail (not console.warn) in production when unset. ~100 lines. *Status: unfiled — #88's fix left this deploy hole.*

**A2. CRITICAL [V] — No session timeout, client or server (#135, worse than filed).** The wired tracker sets `_tsa_sid` in sessionStorage once, forever (`src/Analytics.ts:3254-3256` — the 30-min timeout at `src/tracking-script.ts:287-301` is in the legacy *unwired* generator); collect.ts loads any SESSION# regardless of age and extends duration (`src/handlers/collect.ts:216-241, 293-294`). A tab open across days = one multi-day session credited to its start day (`src/lib/rollups.ts:123-125`). Sessions/bounce/duration are incomparable to Fathom's ~30-min semantics; old sids are also replayable. **Fix:** at ingest, if `now - session.endedAt > 30min`, mint a new session server-side (~30 lines in collect.ts).

**A3. HIGH [V] — History silently evaporates; breakdowns capped at 30 days.** Raw PAGEVIEW/SESSION items get a 30-day TTL (`src/config.ts:249`, `src/models/orm/index.ts:175,390`); rollups only run under `ANALYTICS_ENABLE_JOBS=true` (`server/index.ts:30-33`) and hold **six scalars only** (`src/lib/rollups.ts:20-28`) — every breakdown (Pages, Referrers, Devices, Geo, UTM, entries, engagement) reads raw rows exclusively (`stats.ts:196-232, 250-263`). Meanwhile the free plan promises 365-day retention (`src/lib/plans.ts:27`) and the retention setting is never read by any write path. All Time is structurally impossible; totals show a full range while the panels beneath them silently shrink to 30 days. **Fix:** per-dimension day rollups (dormant `PageStats`/`ReferrerStats`/etc. models are ready-made schemas), rolled-prefix + raw-tail reads for every breakdown, backfill for any missing settled day (current `ensureDayRollups` only repairs trailing 3 days, `rollups.ts:179-183`). ~4-6 days — the biggest item, but it *is* Fathom's core property. *Related: #94 (scalar rollups exist), #137 (comparison ignores rollups), #143 (closed by adding this TTL).*

**A4. HIGH [V] — Bot filtering admits nearly everything.** `isBot` is one 9-token regex and an **empty UA returns human** (`src/utils/user-agent.ts:69-72`; only gate at `collect.ts:152`). Live-verified: HeadlessChrome/126, curl/8.7.1, and a missing UA header all returned 204 and were stored. No datacenter-IP classification, no header sanity checks, no blocked-bot counter (Fathom has all three). At production scale the ingest audit rates this the single largest inflation source. **Fix:** headless/http-library UA blocklist, empty/malformed-UA rejection, bundled cloud-ASN CIDR list, per-site blocked counter (~80 lines + list). *Status: needs a new issue — distinct from closed #158.*

**A5. HIGH [V] — Avg time on site is structurally wrong.** Headline avgTime = last-hit-minus-first-hit per session (`src/handlers/stats.ts:103,112,115`) so every bounce counts as 0s (probed: avgTime 00:00 at 100% bounce). The tracker already sends Fathom-style departure pings with real timeOnPage (`src/Analytics.ts:3339-3364` → `collect.ts:486-507`) but they only feed the separate engagement panel. Also: `engSent` never resets and SPA route changes don't reset `engStart/engMax` (`Analytics.ts:3301-3312, 3354-3358`) — SPA time is undercounted and misattributed to the first path. **Fix:** ADD activeTime into the session via `incrementMetrics` on the engagement branch; compute avgTime from active time; reset engagement state on SPA nav. ~60 lines.

**A6. HIGH [V] — Same query, different answer on different days (#146 confirmed).** /stats sums a cross-day-deduped raw window with per-day rolled uniques (`stats.ts:99,109`) — a visitor spanning both counts twice, and a fixed historical range changes value after yesterday settles. Classic trust-killer. **Fix:** bucket the raw window per-UTC-day before summing (~20 lines at `stats.ts:92-115`); optionally per-day HLL in rollups for true range dedupe.

**A7. MEDIUM [V] — Entry-page uniques race (#145 still real post-da339d3).** PAGEVIEW rows persist `isUnique/isBounce` from the pre-write session read (`collect.ts:241, 283-284`) *before* the conditional session create (:330) — two concurrent first hits both store isUnique=true. **Fix:** write PAGEVIEW after `createIfAbsent` and derive flags from its result (~15 lines).

**A8. MEDIUM [V] — Tracker double-include + lossy delivery (#138 confirmed).** No `window.__tsa` guard (`Analytics.ts:3248`): a twice-pasted snippet doubles views and collapses bounce rate toward 0 (duplicate pageview shares the sid, `collect.ts:288-304`). Pageviews — the headline metric — go by plain async XHR without keepalive (`Analytics.ts:3292-3297`; `b` truthy only for clicks/engagement/vitals), so navigation/tab-close races drop them; no retry, no offline buffer, sendBeacon's return value unchecked. **Fix:** init guard; send pageviews via beacon with `fetch({keepalive:true})` fallback; ~25 lines (offline buffer later, safe once idempotency lands — see B3).

**A9. MEDIUM [V] — Per-tab sessions + self-referral pollution.** sessionStorage is per-tab, so every same-site new-tab click mints a session whose referrer is your own hostname; `parseReferrerSource` never filters self-referrals (`src/utils/geolocation.ts:225-236`). Your own domain appears as a top referrer; sessions/bounces inflate with tab usage. Fathom treats same-site as Direct. **Fix:** null referrer when hostname matches payload hostname (server-side, ~10 lines).

**A10. MEDIUM [V] — Timezone math wrong and un-Fathom-like (#136 confirmed).** Timeseries bucket loop advances in server-LOCAL time while keying UTC (`stats.ts:695-715`: `setHours/setDate` vs `toISOString`) — off-by-one buckets on non-UTC servers/DST. `Site.timezone` exists (`src/models/Site.ts:61`) but nothing uses it; Fathom groups per-site timezone. **Fix:** use `setUTC*` consistently now (~10 lines); per-site timezone is a later design item.

**A11. LOW [S] — Hash construction diverges from Fathom.** No hostname in the visitor hash (`src/dynamodb.ts:289`: ip|ua|siteId|salt vs Fathom's +hostname), no per-page second hash, salt per-deployment not per-site, and full ISO-ms timestamps stored per row vs Fathom's hour-rounding — a privacy-posture gap more than a counting error. Also `isSpamReferrer` is a ~30-domain 2015-era static list (`geolocation.ts:279-303`).

**Sound foundations (for calibration):** first-touch attribution frozen on SESSION rows (`collect.ts:306-341`), Referrers/Campaigns read sessions not pageviews (`stats.ts:250-282`), conversions inherit session attribution, atomic increments fixed lost session counts, client `ts` is never trusted (`collect.ts:210`), session-id validation and event-prop caps are in place.

---

## 3. PRODUCTION BLOCKERS — breaks or lies under real load, ranked

**B1. [V] Read side full-scans the session partition on ~14 endpoints and silently truncates.** Sessions are keyed `sk=SESSION#{id}` with no time index (`src/models/orm/index.ts:386`), so referrers/devices/browsers/os/countries/regions/cities/campaigns/comparison/stats/flow/entry-exit/funnels/goal-stats/insights each read *every* session then filter in JS (call sites: `stats.ts:67-76, 250-257, 319-326, 388-395, 440-447, 491-498, 545-552, 597-604, 1052-1059, 1121-1128`; `sessions.ts:213-220, 294-301`; `funnels.ts:95-102`; `goals.ts:166-175`; `data.ts:282-289`). `queryAllItems` caps at 100k items with a console.warn (`src/lib/dynamodb.ts:121-133`) and sk order is random-id order — past 100k live sessions every panel computes from an arbitrary all-time subset: **wrong numbers, not slow numbers**. Worse, flow/entry-exit/funnels/goal-stats never got the #151 fix and cap at one 1MB page (~1,400 sessions); the goal-stats denominator is also all-time vs a date-bounded numerator (`goals.ts:173-195`). Cost/OOM estimates ($1-5k/month per open dashboard tab at 1M pv/mo; hundreds of MB unmarshalled in the ingest process) are [S] but directionally solid. **Fix:** startedAt-keyed GSI for sessions + convert all `begins_with(sk, SESSION#)` consumers to date-bounded queries (~1-2 days); finish #151 on the four missed endpoints (~0.5 day). Bonus [V]: session-detail timeline is *permanently empty* — it queries gsi1 with `SESSION#{id}` which can never match the DATE-keyed gsi1pk written on pageviews (`sessions.ts:119-141`).

**B2. [V] Background jobs are dead on both documented production paths.** `bootstrapJobs()` is called only in `server/index.ts:29` behind `ANALYTICS_ENABLE_JOBS=true`; `deploy/lambda-handler.ts` never calls it, so even `POST /api/jobs/tick` iterates an **empty** jobs array on Lambda; the Dockerfile doesn't set the flag; no deploy script provisions an EventBridge schedule; and CDK/CFN generators schedule a Lambda pointing at `index.aggregationHandler` which **does not exist in the repo** (`src/infrastructure/cdk.ts:291`, `cloudformation.ts:578`). Net: rollups, alerts, digests, webhooks, uptime never run in production — which converts A3 from "risk" to "guaranteed data loss." **Fix:** call bootstrapJobs from the router/lambda handler, default the flag on, emit an EventBridge rule → `/api/jobs/tick`, delete or implement the phantom handler. ~0.5-1 day; highest leverage-to-effort in this report.

**B3. [V] No idempotency anywhere → at-least-once delivery double-counts.** Every write mints a fresh server-side id (`orm/index.ts:168`; `collect.ts:376-387, 456, 581, 613`); replaying an identical event twice produced two stored rows (live-verified). The opt-in SQS consumer is explicitly at-least-once with no dedup (`deploy/sqs-consumer-handler.ts`, batchItemFailures redrive). **Fix:** tracker-minted per-event UUID → derive sk from it → `attribute_not_exists(sk)` conditional put; same in the SQS consumer. Small-medium. *Unfiled.*

**B4. [V] No ingress firewall — open auto-provisioning + unenforced domains.** `ensureSiteExists` auto-creates ANY site id on first event (`src/handlers/misc.ts:204-248`) and the seeded `domains` array is never checked on subsequent ingest (`collect.ts` reads hostname only to store it, :270). Site ids are public in the tag: anyone can poison a competitor's numbers or spray random ids as a DynamoDB write-cost attack. **Fix:** enforce hostname/Origin ∈ site.domains (204-drop otherwise); gate auto-creation behind config, default off. Small-medium. *Unfiled.*

**B5. [V] Rate limiting is per-process and the client IP is spoofable.** `rateLimitAllow` is an in-process Map (`src/lib/rate-limit.ts:10`; `collect.ts:171`) — on Lambda the ceiling is 1200/min × concurrency, i.e. unenforced [S on the multiplier, V on the mechanism]. On the Bun-server path, `getClientIP` trusts the first X-Forwarded-For hop with no trusted-proxy list (`deploy/lambda-adapter.ts:224-229`) — live-verified spoof: attacker-chosen XFF gives a fresh rate bucket, an attacker-chosen visitor hash, and bypasses IP exclusions (`collect.ts:180`). **Fix:** trusted-proxy config + DynamoDB token-bucket (or document per-instance limits honestly). Medium. *Related closed: #158.*

**B6. [V] Payload bounds incomplete (#134 residual).** Caps exist only on the event/heatmap paths (`collect.ts:366-374`); the pageview path stores title/referrer/path verbatim — a 2MB title 500'd against DynamoDB's item limit and the pageview was **lost** (live-verified). No body-size cap before `request.json()` (`collect.ts:133`) → memory-amplification DoS under Bun's 128MB default. **Fix:** reject bodies >~16KB pre-parse; slice pageview fields like the event caps. Small.

**B7. [V] Multi-instance conversion overcounting.** Goal dedup is a per-process Map capped at 1,000 sessions with arbitrary eviction (`src/utils/cache.ts:77-105`, used at `src/lib/goals.ts:124,145`) — the same session converts once per Lambda instance; restarts reset it. Revenue-grade metric, inflated. **Fix:** conditional put on `CONV#{sessionId}#{goalId}` with TTL (~30 lines).

**B8. [V] Deploys crash from a clean clone.** All three deploy scripts import `../../ts-cloud/...` — a sibling checkout that exists only on the author's machine (`deploy/dynamodb.ts:8`, `deploy/api.ts:10-12`, `deploy/api-lambda.ts:10-13`). No CI exercises any deploy path; PITR flag exists but no backup plan/restore runbook. **Fix:** vendor or publish ts-cloud; CI smoke deploy.

**B9. [S] Long-lived-server memory growth + scheduler races.** `sessionCache`/`genericCache` never evict unread entries (`src/utils/cache.ts:12-41, 116-138`; est. ~400MB/month at 1M pv); scheduler last-run write isn't conditional (`src/lib/scheduler.ts:34-57`) so two instances can double-run jobs — rollups are idempotent, **webhook delivery isn't**. All writes also share one `pk=SITE#{id}` so a viral spike plus dashboard scans contend on a single logical partition [S]. **Fix:** LRU bounds; conditional last-run write. ~1 day combined.

---

## 4. HYGIENE DEBT — ranked

**H1. [V] The test suite substantially tests itself, and the live ingest path has zero coverage.** ~1,800 lines across `test/api-responses.test.ts`, `data-aggregation`, `date-time`, `validation`, `user-agent` import only `bun:test` and assert on **local copies** of the functions; the flagship `test/analytics-api.test.ts` (589 lines) exercises `src/api.ts`, whose own header says "LEGACY — NOT the live request path." `src/handlers/collect.ts` (650 lines) and `stats.ts` are imported by no test. None of the recent correctness fixes (CORS ×2, vitals, error grouping, client-IP) got a regression test. **Fix:** rewire the self-testing suites to import from `src/utils/*` (half day, near-free coverage); build the DynamoDB Local integration harness the repo is 80% equipped for (`src/local.ts` + infrastructure generator) with golden-path specs: collect→rows→/stats, concurrency (#161, fixed), settle window (#162), rollup boundary (#146 — write the failing test first), GDPR round-trip, CORS preflight. 2-4 days, highest test ROI.

**H2. [V] Zero operational telemetry; the health check lies.** `handleHealth` returns static ok without touching DynamoDB (`src/handlers/misc.ts:18-20`) yet backs the App Runner probe (`deploy/api.ts:243-249`). No metrics, counters, or alarms anywhere; the CORS bug is the canonical failure — browsers drop beacons client-side, the server sees nothing, dashboards just show less traffic. An analytics vendor cannot detect that its numbers stopped arriving. **Fix:** health check does a cheap getItem; per-site hourly counters (collected/rejected/bot_blocked) in the same table + an ops endpoint + a day-over-day drop alert on the existing jobs runtime; a tiny leveled JSON logger replacing 197 unstructured console.* calls.

**H3. [V] Privacy posture contradicted by the code.** `collect.ts:192` logs raw IP+UA on **every hit** (streams PII to CloudWatch indefinitely — no LogGroup retention configured in deploy/), while `docs/features/privacy.md` promises inputs are discarded. Error ingest stores `body.user` and 20 breadcrumbs verbatim (`src/handlers/errors.ts:429,432`) with zero scrubbing; docs claim "full anonymization default" while code default is `'partial'` (`src/config.ts:259`). **Fix:** delete the log line today (XS); PII-scrub module for error payloads (S/M); log retention in deploy templates.

**H4. [V] Data lifecycle dishonesty.** Per-site retention settings are decorative — never read by any write path (`src/handlers/data.ts:91-95,141`; actual expiry is global 30d config + hardcoded 90d CLICK/ENGAGEMENT/VITAL and 30d ERROR at `collect.ts:467,505,592,631`, bypassing config). GDPR delete can only ever remove one day's rows under daily hash rotation yet returns success (`data.ts:218-226`); GDPR export omits CLICK/ENGAGEMENT/VITAL/ERROR rows (`data.ts:180-184`); regular export silently truncates at one 1MB page with first-item-only CSV headers (`data.ts:36-50`). **Fix:** read retention at ingest (clamped by plan) or display the true 30 days; unify TTLs through config; export all sk prefixes + paginate; document the hash-rotation limitation honestly.

**H5. [V] Tracker rollout + docs drift.** No version constant in the script, no ETag, 1-hour cache with no purge or ?v= convention (`src/utils/response.ts:65`, `views.ts:367-393`) — support can't tell which tracker a site runs. `docs/guide/tracking-script.md` is corrupted mid-code-block AND its CORS verification step reports a healthy deploy as broken (expects `*`, code echoes Origin since b7b54ba); `docs/install.md` documents the retired command API; `fathom.track()` and the data-site snippet are undocumented. **Fix:** version constant on beacons + ETag (S); docs truth pass + CI docs-lint (S/M).

**H6. [S] Supply chain.** CI runs lint/typecheck/test/publish only — no audit/CodeQL/secret scan — while buddy-bot auto-updates deps every 2 hours. Also `Secure` cookie flag hinges solely on `NODE_ENV=production` (`src/handlers/auth.ts:94`). **Fix:** add a dependency-review/audit gate (XS).

---

## 5. Roadmap

### Phase 1 — This week (each item issue-sized, mostly <100 lines; kills the worst lies)
1. **Salt persistence + mandatory secret** — DynamoDB `SALT#DAY` conditional put; wire `ANALYTICS_SALT_SECRET` into all deploy generators; hard-fail in prod. (A1, unfiled — file it)
2. **30-min session timeout at ingest** — `src/handlers/collect.ts`. (A2, #135)
3. **Wire the jobs runtime** — bootstrapJobs on all entrypoints, flag default on, EventBridge rule, delete phantom `aggregationHandler`. (B2)
4. **Delete the IP/UA log line** at `collect.ts:192`; add log retention to deploy templates. (H3)
5. **Empty-UA = bot + expanded UA regex** (HeadlessChrome, curl, python-requests, Go-http-client, Playwright…). (A4 phase 1 — file new issue, distinct from #158)
6. **#145 race** — write PAGEVIEW after createIfAbsent. (~15 lines)
7. **#146 determinism** — per-day bucketing in /stats raw window. (~20 lines)
8. **#136 timezone** — `setUTC*` in the bucket loop. (~10 lines)
9. **Tracker guard + keepalive + self-referral→Direct.** (A8/A9, #138)
10. **Finish #151** — queryAllItems/date-bound flow, entry-exit, funnels, goal denominator.
11. **Body-size cap + pageview field truncation.** (B6, #134 residual)

### Phase 2 — This month (the structural work)
1. **Dimensional day rollups + backfill + rolled-prefix reads for every breakdown** — the Fathom "All Time as fast as daily / forever retention" core; also serve /comparison from rollups (#137). 4-6 days. (A3, B1-adjacent)
2. **Time-keyed session GSI** + convert all SESSION# scanners; fix the empty session-timeline GSI mismatch. 1-2 days. (B1)
3. **Real avgTime** — fold engagement pings into sessions; fix SPA engagement reset. (A5)
4. **Idempotency keys** end-to-end incl. SQS consumer. (B3)
5. **Domain firewall + gated auto-provisioning.** (B4)
6. **Bot firewall phase 2** — datacenter-CIDR classification + per-site blocked-bot counter surfaced in the dashboard. (A4)
7. **Durable conversion dedup** (conditional put) and **trusted-proxy IP + DynamoDB rate bucket**. (B5, B7)
8. **Integration test harness** (DynamoDB Local) + regression specs for #146/#161/#162/CORS; rewire the self-testing suites. (H1)
9. **Observability minimum** — real health check, ingest counters, drop alert, leveled logger. (H2)
10. **Retention honesty + TTL unification + GDPR completeness + export pagination.** (H4)
11. **Vendor/publish ts-cloud** so deploys work from a clean clone. (B8)

### Phase 3 — Eventually
1. Per-site timezone for date ranges and rollup keys (Site.timezone exists, unused). (A10)
2. Per-day visitor HLL in rollups for true cross-day range dedupe. (A6+)
3. Offline beacon buffer + retry (safe once idempotency exists); sendBeacon-false fallback. (A8)
4. Tracker version identity + ETag + purge convention. (H5)
5. Docs truth pass + CI docs-lint; PII-scrub as a documented privacy differentiator. (H3/H5)
6. LRU cache bounds, conditional scheduler locks, hot-partition/queue-based ingest-report decoupling. (B9)
7. Hash-construction parity (hostname in hash, hour-rounded timestamps), modern spam-referrer list. (A11)
8. CI security gates, load test + RCU/WCU alarms, DynamoDB restore runbook. (B8/H6; closed #98 has no artifacts)

**Issue bookkeeping:** verified-open: #135, #136, #137, #138, #145, #146. Closed-but-incomplete: #88 (salt deploy hole), #134 (pageview path), #151 (four endpoints), #158 (adjacent, not bot filtering). Needs filing: salt persistence, bot firewall, idempotency, domain firewall, session time-index, retention-setting-is-decorative, jobs-dead-on-Lambda, test-suite-theater. Cross-check against the #129-163 parity epic (#163) before filing to avoid duplicates.
