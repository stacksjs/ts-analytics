---
title: Privacy First
description: Privacy-focused analytics without compromising insights
---

# Privacy First

ts-analytics is designed with privacy at its core, providing powerful analytics without invasive tracking.

## No Cookies Required

Unlike traditional analytics, ts-analytics works without cookies:

```typescript
// Session management uses sessionStorage, not cookies
const sessionData = sessionStorage.getItem('sa_session')

// Visitor identification uses hashed, rotating identifiers
const visitorId = await AnalyticsStore.hashVisitorId(
  ip,
  userAgent,
  siteId,
  dailySalt // Rotates every day
)
```

This means:
- No cookie consent banners needed
- Works with strict browser privacy settings
- No cross-site tracking possible

## Hashed Visitor IDs

Visitor identification is privacy-preserving:

```typescript
// IP + User Agent + Site ID + Daily Salt = Hashed ID
const hash = crypto.subtle.digest('SHA-256', data)

// The hash changes daily, preventing long-term tracking
// Day 1: visitor-abc123
// Day 2: visitor-xyz789 (same person, different hash)
```

This approach:
- Provides accurate session tracking
- Prevents user identification
- Makes cross-day tracking impossible
- No personal data is ever stored

## Do Not Track Support

Respect browser DNT settings:

```typescript
generateFullTrackingScript({
  honorDnt: true, // Default: true
})
```

When enabled:
- Checks `navigator.doNotTrack` header
- Completely disables tracking if DNT is set
- No data is sent to the server

## IP Anonymization

Multiple levels of IP privacy:

```typescript
const config = {
  privacy: {
    ipAnonymization: 'full',    // No IP data stored
    // or: 'partial',           // Last octet zeroed
    // or: 'none',              // Full IP (not recommended)
  },
}
```

### Full Anonymization (Default)

```
Original: 192.168.1.123
Stored: (only used for hashing, then discarded)
```

### Partial Anonymization

```
Original: 192.168.1.123
Stored: 192.168.1.0
```

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
