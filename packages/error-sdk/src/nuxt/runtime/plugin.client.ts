import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import { createErrorTracker } from '../../core'

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public.errorTracker as Record<string, unknown>

  const token = config.token as string | undefined
  const endpoint = config.endpoint as string | undefined

  if (!token || !endpoint) {
    console.warn('[error-tracker] Missing token or endpoint in errorTracker config — skipping initialization')
    return {
      provide: {
        errorTracker: null,
      },
    }
  }

  const tracker = createErrorTracker({
    token,
    endpoint,
    environment: (config.environment as string) || 'production',
    maxBreadcrumbs: (config.maxBreadcrumbs as number) || 20,
    captureConsoleErrors: (config.captureConsoleErrors as boolean) || false,
    captureUnhandledRejections: (config.captureUnhandledRejections as boolean) !== false,
    framework: 'nuxt',
  })

  // Install Vue error handler
  const originalErrorHandler = nuxtApp.vueApp.config.errorHandler
  nuxtApp.vueApp.config.errorHandler = (err: unknown, instance: any, info: string) => {
    const error = err instanceof Error ? err : new Error(String(err))
    tracker.captureError(error, {
      componentName: instance?.$options?.name || instance?.$options?.__name || undefined,
      lifecycle: info,
    })

    if (originalErrorHandler) {
      originalErrorHandler(err, instance, info)
    }
  }

  // Hook into Nuxt error events
  nuxtApp.hook('vue:error', (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err))
    tracker.captureError(error, { source: 'vue:error hook' })
  })

  nuxtApp.hook('app:error', (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err))
    tracker.captureError(error, { source: 'app:error hook' })
  })

  // Initialize global error handlers (window.onerror, unhandledrejection)
  tracker.init()

  return {
    provide: {
      errorTracker: tracker,
    },
  }
})
