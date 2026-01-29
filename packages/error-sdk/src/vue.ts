/**
 * Vue 3 plugin for error tracking.
 *
 * Usage:
 *   import { createVueErrorTracker } from '@stacksjs/error-tracker/vue'
 *
 *   const app = createApp(App)
 *   app.use(createVueErrorTracker({
 *     token: 'ak_...',
 *     endpoint: 'https://analytics.example.com',
 *   }))
 */

import type { App, ComponentPublicInstance } from 'vue'
import { inject } from 'vue'
import { ErrorReporter, createErrorTracker } from './core'
import type { ErrorTrackerConfig } from './types'

export interface VueErrorTrackerOptions extends ErrorTrackerConfig {
  /** Capture Vue component errors via app.config.errorHandler (defaults to true) */
  captureVueErrors?: boolean
  /** Capture Vue warnings via app.config.warnHandler (defaults to false) */
  captureVueWarnings?: boolean
}

const ERROR_TRACKER_KEY = Symbol('errorTracker')

export function createVueErrorTracker(options: VueErrorTrackerOptions) {
  const tracker = createErrorTracker({
    ...options,
    framework: 'vue',
  })

  return {
    install(app: App) {
      const captureErrors = options.captureVueErrors !== false

      if (captureErrors) {
        const originalErrorHandler = app.config.errorHandler
        app.config.errorHandler = (err: unknown, instance: ComponentPublicInstance | null, info: string) => {
          const error = err instanceof Error ? err : new Error(String(err))
          tracker.captureError(error, {
            componentName: instance?.$options?.name || instance?.$options?.__name || undefined,
            lifecycle: info,
          })

          if (originalErrorHandler) {
            originalErrorHandler(err, instance, info)
          }
        }
      }

      if (options.captureVueWarnings) {
        const originalWarnHandler = app.config.warnHandler
        app.config.warnHandler = (msg: string, instance: ComponentPublicInstance | null, trace: string) => {
          tracker.captureMessage(`Vue warning: ${msg}`)

          if (originalWarnHandler) {
            originalWarnHandler(msg, instance, trace)
          }
        }
      }

      // Provide tracker for injection
      app.provide(ERROR_TRACKER_KEY, tracker)
      app.config.globalProperties.$errorTracker = tracker

      // Initialize global error handlers
      tracker.init()
    },
  }
}

/** Composable for accessing the tracker inside setup() */
export function useErrorTracker(): ErrorReporter {
  const tracker = inject<ErrorReporter>(ERROR_TRACKER_KEY)
  if (!tracker) {
    throw new Error(
      'ErrorTracker not installed. Call app.use(createVueErrorTracker({ ... })) first.',
    )
  }
  return tracker
}

export { ErrorReporter }
