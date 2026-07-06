---
title: Migrate from Google Analytics
description: Bring your GA4 history with you — CSV upload or direct API import
---

Migrating shouldn't mean starting from zero. Both importers write your GA
history into the same daily aggregates the dashboard reads, merge cleanly
with live tracking (tracked days are never overwritten), and are idempotent —
re-running an import is safe.

## Option 1: Direct API import (recommended)

Pulls the property's full daily history straight from the GA4 Data API.

1. In Google Cloud Console, create (or reuse) a project and enable the
   **Google Analytics Data API**.
2. Create a **service account** (IAM → Service Accounts) and download its
   **JSON key**.
3. In GA4, open **Admin → Property access management** and add the service
   account's email with the **Viewer** role.
4. In the dashboard: **Settings → Manage → Import from Google Analytics →
   Automatic import**, enter your numeric GA4 property ID, pick the JSON key,
   and click **Import from GA4 API**.

The key is used for this one import and never stored. No OAuth consent
screens, no app verification.

## Option 2: CSV upload

Works without any Google Cloud setup (and for retired UA properties whose
exports you kept).

1. In GA4, open the report you want (Pages, Traffic acquisition, Devices,
   Browsers, Geo, Events) and **add a Date dimension** (easiest via
   Explore → free-form with Date as a row).
2. Export each as CSV.
3. **Settings → Manage → Import from Google Analytics**: pick all the files
   at once and click Import. File types are detected automatically from
   their headers.

A traffic file (Date + Views/Users/Sessions) gives the most accurate daily
totals; with only dimension files, totals are derived from them.

## What gets imported

| GA4 | ts-analytics |
| --- | --- |
| Views / Active users / Sessions / Bounce rate / Avg session duration | Daily totals |
| Page path | Pages |
| Session source / channel group | Referrer sources (`(direct)` → Direct) |
| Device category / Browser / OS | Devices / Browsers / Operating systems |
| Country / Region / City | Locations |
| Event name + count | Events |

Imported days are marked internally (`source: ga-import`), never overwrite
days you tracked live, and gaps are zero-filled so long-range queries stay
fast and complete.
