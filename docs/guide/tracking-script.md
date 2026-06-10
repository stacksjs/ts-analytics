---
title: Tracking Script
description: Add analytics tracking to your website
---
})

// Outputs a loader that fetches /sites/{siteId}/tracker.js
```

### Inline Script

Embed the full script inline:

```typescript
import { generateInlineTrackingScript } from '@stacksjs/ts-analytics'

const script = generateInlineTrackingScript({
  siteId: 'my-site',
  apiEndpoint: 'https://analytics.example.com/api/analytics',
})

// Complete script wrapped in <script> tags
```

## Cross-Domain Installs (CORS)

The tracking script and error SDK work when your site (`https://app.example.com`) posts to an analytics API on a different origin (`https://analytics.example.com`). Because beacons are sent as JSON — and the error SDK adds an `X-Analytics-Token` header — browsers send a CORS preflight (`OPTIONS`) before each cross-origin request.

The API handles this out of the box: every collect endpoint (`/collect`, `/t`, `/p`, `/errors/collect`, `/issues/report`) answers preflights with `Access-Control-Allow-Origin: *`, allows the `Content-Type` and `X-Analytics-Token` headers, and caches the preflight for 24 hours. No configuration is needed — but if you put a proxy or CDN in front of the API, make sure it forwards `OPTIONS` requests and does not strip `Access-Control-*` response headers.

To confirm, from your site's origin run:

```bash
curl -i -X OPTIONS https://your-analytics-host/collect \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

A `204` with `Access-Control-Allow-Origin: *` means cross-domain installs will work.

## Adding to Your Website

### Static HTML

```html
<!DOCTYPE html>
<html>
<head>
  <script>
  (function(w,d,s,a){
    w.sa=w.sa||function(){(w.sa.q=w.sa.q||[]).push(arguments)};
    var f=d.getElementsByTagName(s)[0],j=d.createElement(s);
    j.async=1;j.src='https://analytics.example.com/api/analytics/sites/my-site/tracker.js';
    f.parentNode.insertBefore(j,f);
  })(window,document,'script');
  sa('init','my-site');
  </script>
</head>
<body>
  <!-- Your content -->
</body>
</html>
```

### React/Next.js

```tsx
// components/Analytics.tsx
'use client'

import { useEffect } from 'react'

export function Analytics() {
  useEffect(() => {
    // @ts-ignore
    window.sa = window.sa || function() { (window.sa.q = window.sa.q || []).push(arguments) }

    const script = document.createElement('script')
    script.src = 'https://analytics.example.com/api/analytics/sites/my-site/tracker.js'
    script.async = true
    document.head.appendChild(script)

    // @ts-ignore
    window.sa('init', 'my-site')
  }, [])

  return null
}

// app/layout.tsx
import { Analytics } from '@/components/Analytics'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
```

### Vue/Nuxt

```vue
<!-- components/Analytics.vue -->
<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  window.sa = window.sa || function() { (window.sa.q = window.sa.q || []).push(arguments) }

  const script = document.createElement('script')
  script.src = 'https://analytics.example.com/api/analytics/sites/my-site/tracker.js'
  script.async = true
  document.head.appendChild(script)

  window.sa('init', 'my-site')
})
</script>

<template>
  <div />
</template>
```

## Client-Side API

Once loaded, use the `sa()` function to track events:

### Track Page Views

```javascript
// Automatic (default behavior)
// Page views are tracked automatically on load and navigation

// Manual tracking
sa('trackPageView', '/custom-path', 'Custom Page Title')
```

### Track Custom Events

```javascript
// Basic event
sa('event', 'button*click')

// Event with properties
sa('event', 'download', { file: 'guide.pdf', size: '2.4MB' })

// Event with category and value
sa('event', 'purchase', { product: 'pro-plan' }, 'conversion', 99.99)
```

### Identify Users

```javascript
// Associate events with a user ID
sa('identify', 'user-123')
```

### Set Properties

```javascript
// Set properties that persist for the session
sa('setProperty', 'plan', 'enterprise')
sa('setProperty', 'cohort', '2024-Q1')
```

### Debug Mode

```javascript
// Enable debug logging
sa('debug', true)

// Disable debug logging
sa('debug', false)
```

## Data Attributes

Track elements automatically with data attributes:

```html
<!-- Basic tracking -->
<button data-sa-track="signup*click">Sign Up</button>

<!-- With category -->
<button
  data-sa-track="download"
  data-sa-track-category="engagement"
>
  Download PDF
</button>

<!-- With value -->
<button
  data-sa-track="purchase"
  data-sa-track-category="conversion"
  data-sa-track-value="99"
>
  Buy Now
</button>
```

Custom prefix:

```typescript
generateFullTrackingScript({
  dataAttributePrefix: 'analytics',
  // ...
})

// Then use: data-analytics-track="event*name"
```

## Tracking Features

### Scroll Depth

Track how far users scroll:

```typescript
generateFullTrackingScript({
  trackScrollDepth: [25, 50, 75, 100],
})

// Events fired:
// { name: 'scroll*depth', properties: { depth: 25 }, category: 'engagement' }
// { name: 'scroll*depth', properties: { depth: 50 }, category: 'engagement' }
// ...
```

### Time on Page

Track engagement time:

```typescript
generateFullTrackingScript({
  trackTimeOnPage: [30, 60, 120, 300],
})

// Events fired after 30s, 60s, 2min, 5min on page
```

### Outbound Links

Track clicks to external sites:

```typescript
generateFullTrackingScript({
  trackOutboundLinks: true,
})

// Events: { name: 'outbound*click', properties: { url, text, hostname } }
```

### SPA Navigation

Track navigation in single-page apps:

```typescript
generateFullTrackingScript({
  trackHashChanges: true, // For hash-based routing
  autoPageView: true,     // Track history.pushState
})
```

## Privacy Features

### Do Not Track

Respect the browser's DNT setting:

```typescript
generateFullTrackingScript({
  honorDnt: true, // Default: true
})
```

### Exclude Paths

Don't track certain pages:

```typescript
generateFullTrackingScript({
  excludePaths: [
    '/admin/*',
    '/api/*',
    '/internal',
  ],
})
```

### Strip Query Params

Remove query parameters from tracked URLs:

```typescript
generateFullTrackingScript({
  excludeQueryParams: true,
})
```

## Server-Side Rendering

For SSR, generate the script at build time:

```typescript
// build-tracking.ts
import { writeFileSync } from 'fs'
import { generateFullTrackingScript } from '@stacksjs/ts-analytics'

const script = generateFullTrackingScript({
  siteId: process.env.SITE*ID!,
  apiEndpoint: process.env.ANALYTICS*ENDPOINT!,
  minify: true,
})

writeFileSync('public/tracker.js', script)
```

## Next Steps

- [API Endpoints](/guide/api) - Set up the server-side API
- [Dashboard Components](/guide/dashboard) - Display analytics data
- [Privacy Features](/features/privacy) - Learn about privacy options
