/**
 * Nuxt plugin for error tracking.
 *
 * Usage in nuxt.config.ts:
 *   export default defineNuxtConfig({
 *     runtimeConfig: {
 *       public: {
 *         analyticsToken: 'ak_...',
 *         analyticsEndpoint: 'https://analytics.example.com',
 *         analyticsEnvironment: 'production',
 *       },
 *     },
 *   })
 *
 * Then create plugins/error-tracker.ts:
 *   import { errorTrackerPlugin } from '@stacksjs/error-tracker/nuxt'
 *   export default errorTrackerPlugin
 */

import { createErrorTracker } from './core'
import type { ErrorTrackerConfig } from './types'

/**
 * Create a Nuxt plugin function.
 * Uses Nuxt's defineNuxtPlugin pattern.
 */
export function createNuxtErrorTracker(config: ErrorTrackerConfig) {
  return (nuxtApp: any) => {
    const tracker = createErrorTracker({
      ...config,
      framework: 'nuxt',
    })

    // Install Vue error handler
    nuxtApp.vueApp.config.errorHandler = (err: unknown, instance: any, info: string) => {
      const error = err instanceof Error ? err : new Error(String(err))
      tracker.captureError(error, {
        componentName: instance?.$options?.name || instance?.$options?.__name || undefined,
        lifecycle: info,
      })
    }

    // Hook into Nuxt vue:error
    nuxtApp.hook('vue:error', (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err))
      tracker.captureError(error, { source: 'vue:error hook' })
    })

    // Hook into app:error for SSR
    nuxtApp.hook('app:error', (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err))
      tracker.captureError(error, { source: 'app:error hook' })
    })

    tracker.init()

    return {
      provide: {
        errorTracker: tracker,
      },
    }
  }
}

/**
 * Pre-built plugin that reads from Nuxt runtime config.
 * Expects public.analyticsToken, public.analyticsEndpoint, public.analyticsEnvironment.
 */
export const errorTrackerPlugin = (nuxtApp: any) => {
  const config = nuxtApp.$config?.public || nuxtApp.payload?.config?.public || {}

  const token = config.analyticsToken
  const endpoint = config.analyticsEndpoint

  if (!token || !endpoint) {
    console.warn('[error-tracker] Missing analyticsToken or analyticsEndpoint in runtimeConfig.public')
    return
  }

  const plugin = createNuxtErrorTracker({
    token,
    endpoint,
    environment: config.analyticsEnvironment || 'production',
  })

  return plugin(nuxtApp)
}
