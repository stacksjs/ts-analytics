---
title: Privacy First
description: Privacy-focused analytics without compromising insights
---

## How visitor IPs are handled

Raw IPs are never stored on any analytics record. They are used transiently
for two things and then discarded:

1. **Visitor hashing** — the daily-rotating visitor id is a salted hash of
   IP + user agent + hostname; the inputs are discarded after hashing, and the
   salt rotates every UTC day, so ids cannot be linked across days.
2. **Geolocation** (only when country can't be resolved from privacy-safe
   sources first: CDN headers, then the browser timezone). What the geo lookup
   sees is controlled by `privacy.ipAnonymization`:

```ts
{
  privacy: {
    ipAnonymization: 'partial', // Default: last octet zeroed before geo lookup
    // or: 'full',              // IP never used for geo at all
    // or: 'none',              // Full IP used for geo (not recommended)
  },
}
```

### Partial Anonymization (default)

```
Original: 192.168.1.123
Used for geo lookup: 192.168.1.0 — then discarded, never stored
```

### Full Anonymization

The IP is used only for visitor hashing (then discarded); geolocation relies
solely on CDN headers and the browser timezone.

> Operational note: production never logs IPs or user agents. The one
> diagnostic log line that includes them is emitted only when
> `ANALYTICS_DEBUG=true` is set for local debugging.

## Data retention

- **Raw rows** (pageviews, sessions, events, clicks, engagement, vitals)
  expire per your site's retention setting (Settings → Data), clamped by your
  plan and stamped at write time — changing the setting affects rows written
  after the change.
- **Daily aggregates** (what the dashboard reads for history) are kept
  indefinitely; they contain no visitor identifiers.
- **GDPR endpoints**: `/gdpr/export` and `/gdpr/delete` cover every raw record
  type for a visitor id. Because ids rotate daily, one id maps to roughly one
  UTC day — that's the privacy design (no cross-day linkage exists to export).

## No Personal Data Collection

ts-analytics never collects:

- Names or emails
- Full IP addresses
- Device fingerprints
- Precise geolocation
- User accounts/logins

What is collected:

- Anonymized session data
- Page paths (not full URLs with query params)
- Device type (mobile/desktop/tablet)
- Browser family (not fingerprints)
- Referrer domain (not full URL)

## How Unique Visitors Are Counted

A **unique visitor** is a daily-salted hash:

```
visitorId = SHA-256(ip, userAgent, siteId, salt)
salt      = HMAC-SHA256(ANALYTICS_SALT_SECRET, YYYY-MM-DD)
```

Properties that follow from this definition:

- **No cookies, no stored identifiers** — the hash is computed per event and the inputs are discarded.
- **Tabs and repeat sessions don't double-count**: the same person on the same day always produces the same hash, and every report deduplicates by it.
- **The salt rotates daily and is secret-seeded**, so hashes cannot be reproduced (or correlated across days) without the server secret. This is deliberate: a visitor returning on a different day counts as a new daily unique — multi-day "people" totals are **sums of daily uniques** (the same model Fathom uses). Cross-day deduplication is impossible by design, which is what makes the visitor id non-tracking.
- **Within a single day**, counts are exact uniques.

All reports — summary, time series, and every breakdown — count visitors by deduplicating this same hash, so numbers are consistent across panels.

## Path Exclusion

Exclude sensitive pages from tracking:

```typescript
generateFullTrackingScript({
  excludePaths: [
    '/admin/*',           // Admin pages
    '/api/*',             // API endpoints
    '/account/*',         // Account settings
    '/checkout/payment',  // Payment forms
  ],
})
```

## Query Parameter Stripping

Remove sensitive query parameters:

```typescript
generateFullTrackingScript({
  excludeQueryParams: true,
})

// URL: /search?q=private+medical+condition
// Tracked: /search (no query params)
```

## Data Retention

Automatic data expiration:

```typescript
const config = {
  retention: {
    rawEventTtl: 30 * 24 * 60 * 60,        // Raw events: 30 days
    hourlyAggregateTtl: 90 * 24 * 60 * 60, // Hourly stats: 90 days
    dailyAggregateTtl: 2 * 365 * 24 * 60 * 60, // Daily: 2 years
    monthlyAggregateTtl: 0,                 // Monthly: forever (aggregated only)
  },
}
```

DynamoDB TTL ensures automatic deletion:

- No manual cleanup required
- Data is permanently deleted after TTL
- Cannot be recovered once expired

## Self-Hosted Data

Your data stays in your AWS account:

- No third-party access
- Full data ownership
- Comply with data residency requirements
- Export and delete at any time

## GDPR Compliance

ts-analytics helps you comply with GDPR:

| GDPR Requirement | ts-analytics Solution |
|-----------------|----------------------|
| Lawful basis | No personal data = no consent needed |
| Data minimization | Only aggregate data stored long-term |
| Purpose limitation | Analytics only, no profiling |
| Storage limitation | Automatic TTL-based deletion |
| Right to erasure | Delete by site ID or time range |
| Data portability | Export via DynamoDB tools |

## Export and Delete Data

### Export Site Data

```typescript
// Export all data for a site
const command = store.querySiteDataCommand('my-site', {
  start: new Date('2024-01-01'),
  end: new Date('2024-12-31'),
})

const result = await executeCommand(command)
const exportData = JSON.stringify(result.Items)
```

### Delete Site Data

```typescript
// Delete all data for a site
const deleteCommand = store.deleteSiteDataCommand('my-site')
await executeCommand(deleteCommand)
```

## Privacy Best Practices

1. **Enable DNT respect** - Always honor Do Not Track
2. **Use short TTL** - Delete raw events within 30 days
3. **Exclude sensitive paths** - Don't track admin/account pages
4. **Strip query params** - Remove potentially sensitive data
5. **Document your practices** - Update your privacy policy

## Privacy Policy Template

Add to your privacy policy:

```
We use ts-analytics for website analytics. This service:

- Does not use cookies
- Does not collect personal information
- Does not track you across websites
- Respects Do Not Track browser settings
- Automatically deletes raw data after 30 days
- Stores all data in our own infrastructure

The anonymized data helps us understand:

- Which pages are popular
- How visitors find our site
- What devices and browsers are used
- General traffic patterns

```

## Next Steps

- [Configuration](/config) - Configure privacy settings
- [Tracking Script](/guide/tracking-script) - Set up privacy-respecting tracking
- [Infrastructure](/guide/infrastructure) - Self-host your analytics
