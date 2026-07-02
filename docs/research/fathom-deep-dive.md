# Fathom Analytics — Deep Dive (research brief)

> Multi-angle research run 2026-07-03 (4 researchers + synthesis; findings verified
> against Fathom's live public demo dashboard and its shipped JS/CSS bundles where
> noted). Purpose: learn from Fathom's minimalism for ts-analytics — **not** to
> clone it; ts-analytics differentiates with integrated error tracking.

## 1. Why Fathom's minimalism works (principles, not features)

- **One screen, zero navigation.** Everything lives on a single-page dashboard;
  depth is *behind* it (click a box → detail drawer with pagination + secondary
  dimensions), never spread across pages. Simplicity is the entry point; depth
  is opt-in.
- **Subtraction as practice, with public reasoning.** They shipped uptime
  monitoring, then killed it (Nov 2023: "whole companies do this as their sole
  focus"). They built ad-blocker custom domains, then retired them when uBlock
  defeated the scheme ("hundreds of dev hours nullified by a single line of code
  on the ad-blocker's part"). Lesson: retire complexity rather than maintain it,
  and say why.
- **Principled refusals define the boundary.** No free plan ("we sell software,
  not data"), no AMP, no session replay / heatmaps / funnels — because those
  require individual-level tracking that conflicts with the cookieless model.
  Every omission has a stated reason, which converts missing features into trust.
- **Conservative iteration.** July 2024 redesign: "things are different only if
  they have to be, and then only as minimally different as necessary."
- **Speed is UX.** The Mar 2026 rebuild's headline was query speed via
  pre-aggregation — "All Time" loads as fast as daily. (Maps directly onto our
  DynamoDB rollup pipeline.)
- **Softness via typography, not decoration.** Custom rounded-Inter variable
  font at non-standard weights (body 380, headings 460, bold 510) — the narrow
  soft weight band drives the "friendly" feel more than color does.
- **Interaction economy.** One gesture (click a row) does the most valuable
  thing (filter the entire dashboard); the escape hatch (Cmd/Ctrl+click opens
  the URL) is hidden. Deliberate discoverability tradeoff to keep rows chrome-free.

## 2. How the dashboard renders (verified from shipped bundles)

**Row-bar width — four denominators by context** (from `rowWidthPercent` in
`dashboard-CI1mWHPd.js`):

1. **Main dashboard boxes:** `round(rowValue / SITE-WIDE total for the current
   range/filters * 100)`, capped at 100 — *not* column max. Bars in a panel
   visually sum toward 100%. (ts-analytics adopted this — `_bar` in
   `resources/stores/analytics.ts`.)
2. **Drill-down/child panels:** normalized to the column max (top row = full width).
3. **Google Search Console panel:** normalized to the max-clicks row.
4. **Realtime view:** share of current visitors.

**Bar mechanics** (from `dashboard-BMzbWzf7.css`): each row gets a `w{0..100}`
class; the bar is an `:after` pseudo-element behind the text — purple `#846bff`,
`border-radius 0.3rem`, `z-index:-1`, opacity 0.1 light / 0.2 dark, animated
width transition on data change. Child rows use gray, detail views blue,
realtime a stronger purple.

**Palette:** brand lavender `#9580ff`; light purple scale `#eeebff → #301b98`;
grays subtly green-tinted (`#f7f8f7`, `#eff1ef`, …). Dark mode via
prefers-color-scheme + force classes.

**Other verified behaviors:** headline stat cards click to switch the chart
metric; Highcharts area/bar with Auto/Hourly→Yearly grouping; date range in the
URL (`?range=last_7_days`, shareable), timezone-aware per site; comparison mode
adds per-row up/down deltas; panel empty state is plain "No data to display";
numbers compact millify-style (12.4k); Laravel + Inertia + Vue with per-box lazy
hydration; public share links serve the same dashboard read-only.

## 3. Tech / privacy model

- **Visitor identity:** SHA-256 of (per-site salt + IP + User-Agent + hostname
  (+ site ID)); a second hash adds pathname for per-page uniques. Salt rotates
  daily at midnight — cross-day returning-visitor tracking is *impossible by
  design*. (ts-analytics uses the same construction.)
- **IPs:** processed briefly (hash + country geo), then discarded — never stored.
  Long-term storage: site id, the two hashes, path, referrer hostname,
  hour-rounded timestamp, counters.
- **No-consent-banner argument:** ePrivacy Art. 5(3) only covers terminal-equipment
  storage (they store nothing client-side) + GDPR legitimate interest for the
  transient IP/UA processing. Their legal position, not a regulator ruling.
- **EU isolation:** ingest via bunny.net (Slovenian CDN) → Hetzner (German)
  proxy clusters hash EU visitors' data with an EU-only secret before anything
  reaches US infrastructure.
- **Script:** single `script.js` + `data-site` tag; ~6.9 KB raw / ~2.1 KB
  compressed (the "under 2KB" claim is transfer size), served from CDN edge.
- **Bots:** filtered at ingestion, always-on: UA lists + datacenter-IP
  classification + malformed-header checks, with a visible blocked-bot count.

## 4. Product scope

**Included:** totals box (visitors/views/avg time/bounce/event completions, all
filter-responsive); Pages (+ entry/exit); Referrers + Sources + `?ref=`;
Device/OS/Browser; Locations to city; dynamic events (no pre-registration,
monetary `_value` in cents, configurable conversion rate); UTMs; realtime;
GSC integration; RegEx filters; saved views; chart milestones; all-sites rollup;
email reports (external recipients); CSV/custom exports; REST API; GA importer;
server-side firewall; forever retention.

**Deliberately omitted:** automatic outbound-click tracking (DIY recipes only),
funnels, cohorts, paths, session replay, heatmaps, scroll depth, A/B testing,
free plan, AMP, self-hosting (Fathom Lite frozen ~2020), white-labeling.

**Quirks:** API calls and events count against the pageview quota; events can't
be renamed; 2 months over-quota auto-upgrades the plan.

## 5. Market position

$15/mo floor (100K pageviews) → $470/mo (25M); no free tier; 50 sites on every
plan; never discounts. Customers overwhelmingly indie/SMB (77% are 1-10-person
companies) with big-logo marketing (IBM, GitHub, Laravel). Wins vs GA on
no-banner + simplicity + script weight; wins vs Plausible on value at scale,
the all-sites dashboard, compliance paperwork, forever retention. Loses
switchers over: **no funnels/cohorts/paths** (the #1 complaint), weak per-page
metric breakdowns, closed source / no self-hosting, $15 entry price, no
cross-vendor import.

## 6. Adopt / Skip / Differentiate for ts-analytics

**Adopt**
- Bar semantics exactly (done): main panels = share of site total, capped 100;
  column-max only in drill-downs; ~10%-opacity rounded bar behind text with
  animated width.
- Click-row-to-filter as the universal interaction (`is` filter refreshes chart +
  totals + all panels; `is not` for exclusion; modifier-click opens the URL).
- Date range in the URL + per-site timezone + comparison deltas per row.
- Quiet empty states ("No data to display"); "Direct/unknown" bucket rather than
  hiding rows.
- Pre-aggregation so "All Time" is as fast as daily (rollups pipeline).
- Ingestion-time bot filtering incl. datacenter-IP ranges + visible blocked count.
- All-sites rollup dashboard (killer feature for multi-site owners).
- Publicly-reasoned scope decisions.

**Skip**
- Ad-blocker-bypass custom domains (Fathom already lost that arms race).
- Uptime monitoring (their canonical cut; our second pillar is error tracking).
- Charging API calls against the pageview quota.
- Session replay/heatmap-style individual tracking that would forfeit the
  no-consent posture.
- A commissioned custom typeface (imitate the soft variable-weight band with an
  existing variable font instead).

**Differentiate**
- **Error tracking is the wedge Fathom vacated** (they killed their only site-
  health feature). Errors as a first-class panel on the same one-page dashboard;
  error spikes as chart annotations; click-an-error-to-filter which
  pages/browsers/countries hit it — same row/bar/filter grammar.
- Attack the complaint list: session-scoped funnels (privacy-bounded), per-page
  metric breakdowns, automatic outbound-click tracking (we already do this),
  self-hostability, cross-vendor import, agency reporting, friendlier entry
  price/trial.
- Extend the privacy story where Fathom never had to: documented PII-scrubbing
  for error payloads (stack traces can contain PII).

## Sources

usefathom.com (features, docs, pricing, privacy, data, blog: anonymization /
eu-isolation / branding / new-fathom / announcing-fathom-v4 / free-plan,
changelogs 2023–2026), the live public demo dashboard + its shipped
`dashboard-*.js` / `dashboard-*.css` bundles (bar semantics verified from code),
direct curl of cdn.usefathom.com/script.js (2026-07-03), PostHog/StatCounter/
prettyinsights/regpaq/harrk.dev reviews, HN threads, github.com/usefathom/fathom.
