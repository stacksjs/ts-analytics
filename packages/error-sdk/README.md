# @stacksjs/error-tracker

A framework-agnostic error tracking SDK with first-class support for Vue 3 and Nuxt. Captures errors, breadcrumbs, and context to send to your analytics endpoint.

## Installation

```bash
bun add @stacksjs/error-tracker
```

```bash
npm install @stacksjs/error-tracker
```

## Usage

### Vanilla JavaScript / TypeScript

```typescript
import { createErrorTracker } from '@stacksjs/error-tracker'

const tracker = createErrorTracker({
  token: 'your-api-token',
  endpoint: 'https://analytics.example.com/errors',
  environment: 'production',
})

// Initialize global error handlers
tracker.init()

// Manually capture an error
tracker.captureError(new Error('Something went wrong'))

// Capture a message
tracker.captureMessage('User completed checkout', 'info')

// Add breadcrumbs for debugging
tracker.addBreadcrumb({ category: 'navigation', message: 'User visited /dashboard' })

// Set user context
tracker.setUser({ id: '123', email: 'user@example.com' })
```

### Vue 3

```typescript
import { createApp } from 'vue'
import { createVueErrorTracker } from '@stacksjs/error-tracker/vue'
import App from './App.vue'

const app = createApp(App)

app.use(createVueErrorTracker({
  token: 'your-api-token',
  endpoint: 'https://analytics.example.com/errors',
  captureVueErrors: true,
  captureVueWarnings: false,
}))

app.mount('#app')
```

```typescript
// Inside a Vue component
import { useErrorTracker } from '@stacksjs/error-tracker/vue'

const tracker = useErrorTracker()
tracker.captureMessage('Component loaded')
```

### Nuxt

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@stacksjs/error-tracker/nuxt'],
})
```

## Features

- Framework-agnostic core with Vue 3 and Nuxt integrations
- Automatic capture of `window.onerror` and unhandled promise rejections
- Breadcrumb collection for debugging context
- Error fingerprinting for deduplication
- Automatic environment context (browser, OS, device type, screen size)
- User context and custom tags
- Configurable error filtering with `ignoreErrors` and `beforeSend` hooks
- Lightweight transport layer

## License

MIT
