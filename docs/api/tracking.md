---
title: Tracking Script API
description: API reference for tracking script generators
---

# Tracking Script API

Generate client-side tracking scripts.

## Functions

### generateFullTrackingScript

Generate a complete tracking script with all features.

```typescript
import { generateFullTrackingScript } from '@stacksjs/ts-analytics'

const script = generateFullTrackingScript({
  siteId: 'my-site',
  apiEndpoint: 'https://analytics.example.com/api/analytics',
  autoPageView: true,
  trackHashChanges: false,
  trackOutboundLinks: true,
  trackScrollDepth: [25, 50, 75, 100],
  trackTimeOnPage: [30, 60, 120, 300],
  honorDnt: true,
  sessionTimeout: 30,
  debug: false,
  minify: true,
})
```

### generateTrackingSnippet

Generate an async loader snippet.

```typescript
import { generateTrackingSnippet } from '@stacksjs/ts-analytics'

const snippet = generateTrackingSnippet({
  siteId: 'my-site',
  apiEndpoint: 'https://analytics.example.com/api/analytics',
})

// Output:
// <script>
// (function(w,d,s,a){...})(window,document,'script');
// sa('init','my-site');
// </script>
```

### generateInlineTrackingScript

Generate an inline script with `<script>` tags.

```typescript
import { generateInlineTrackingScript } from '@stacksjs/ts-analytics'

const html = generateInlineTrackingScript({
  siteId: 'my-site',
  apiEndpoint: 'https://analytics.example.com/api/analytics',
})
```

### generateMinimalTrackingScript

Generate a minimal page view only script.

```typescript
import { generateMinimalTrackingScript } from '@stacksjs/ts-analytics'

const script = generateMinimalTrackingScript({
  siteId: 'my-site',
  apiEndpoint: 'https://analytics.example.com/api/analytics',
  honorDnt: true,
})

// ~500 bytes minified
```

### generateGA4StyleScript

Generate a Google Analytics 4-style script.

```typescript
import { generateGA4StyleScript } from '@stacksjs/ts-analytics'

const script = generateGA4StyleScript({
  siteId: 'my-site',
  apiEndpoint: 'https://analytics.example.com/api/analytics',
  autoPageView: true,
  cookieDomain: 'auto',
})
```

## Configuration

### TrackingScriptConfig

```typescript
interface TrackingScriptConfig {
  // Required
  siteId: string
  apiEndpoint: string

  // Page tracking
  autoPageView?: boolean        // Default: true
  trackHashChanges?: boolean    // Default: false

  // Engagement tracking
  trackOutboundLinks?: boolean  // Default: false
  trackScrollDepth?: number[]   // e.g., [25, 50, 75, 100]
  trackTimeOnPage?: number[]    // e.g., [30, 60, 120] (seconds)

  // Privacy
  honorDnt?: boolean            // Default: true
  excludePaths?: string[]       // Regex patterns
  excludeQueryParams?: boolean  // Default: false

  // Session
  sessionTimeout?: number       // Minutes, default: 30
  cookieDomain?: string         // For cross-subdomain

  // Customization
  dataAttributePrefix?: string  // Default: 'sa'

  // Development
  debug?: boolean               // Default: false
  onError?: string              // Error callback function name

  // Output
  minify?: boolean              // Default: false
}
```

## Client-Side API

Once the tracking script is loaded, use the `sa()` function:

### Initialize

```javascript
sa('init', 'my-site-id')
```

### Track Page Views

```javascript
// Automatic (on load and navigation)

// Manual
sa('trackPageView', '/custom-path', 'Custom Title')
```

### Track Events

```javascript
// Basic event
sa('event', 'button_click')

// With properties
sa('event', 'download', { file: 'report.pdf' })

// With category and value
sa('event', 'purchase', { product: 'pro' }, 'conversion', 99.99)
```

### Identify Users

```javascript
sa('identify', 'user-123')
```

### Set Properties

```javascript
sa('setProperty', 'plan', 'enterprise')
```

### Debug Mode

```javascript
sa('debug', true)  // Enable
sa('debug', false) // Disable
```

## Data Attributes

Track elements declaratively:

```html
<!-- Basic -->
<button data-sa-track="signup_click">Sign Up</button>

<!-- With category -->
<button
  data-sa-track="download"
  data-sa-track-category="engagement"
>Download</button>

<!-- With value -->
<button
  data-sa-track="purchase"
  data-sa-track-category="conversion"
  data-sa-track-value="99"
>Buy Now</button>
```

Custom prefix:

```typescript
generateFullTrackingScript({
  dataAttributePrefix: 'analytics',
})

// Then use: data-analytics-track="event_name"
```

## Event Payload

Events sent to the API:

```typescript
{
  s: string      // Site ID
  sid: string    // Session ID
  e: string      // Event type: 'pageview', 'event', 'outbound'
  u: string      // Current URL
  r?: string     // Referrer
  t?: string     // Page title
  sw?: number    // Screen width
  sh?: number    // Screen height
  ts: number     // Timestamp
  en?: string    // Event name (for custom events)
  ec?: string    // Event category
  ev?: number    // Event value
  p?: object     // Event properties
}
```

## See Also

- [Tracking Script Guide](/guide/tracking-script) - Usage guide
- [Privacy Features](/features/privacy) - Privacy configuration
- [API Endpoints](/guide/api) - Collect endpoint
