import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import { createErrorTracker } from '../../core'

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public.errorTracker as Record<string, unknown>

  const token = config.token as string | undefined
  const endpoint = config.endpoint as string | undefined

  if (!token || !endpoint) {
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
    captureConsoleErrors: false,
    captureUnhandledRejections: false,
    framework: 'nuxt',
  })

  // Hook into Nuxt error events for SSR error capture
  // NOTE: Do NOT call tracker.init() — there is no `window` on the server
  nuxtApp.hook('vue:error', (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err))
    tracker.captureError(error, { source: 'vue:error hook (ssr)' })
  })

  nuxtApp.hook('app:error', (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err))
    tracker.captureError(error, { source: 'app:error hook (ssr)' })
  })

  return {
    provide: {
      errorTracker: tracker,
    },
  }
})
