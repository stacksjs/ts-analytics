import { addImports, addPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'

export interface ErrorTrackerModuleOptions {
  token?: string
  endpoint?: string
  environment?: string
  maxBreadcrumbs?: number
  captureConsoleErrors?: boolean
  captureUnhandledRejections?: boolean
}

export default defineNuxtModule<ErrorTrackerModuleOptions>({
  meta: {
    name: '@stacksjs/error-tracker',
    configKey: 'errorTracker',
    compatibility: {
      nuxt: '>=3.0.0',
    },
  },
  defaults: {
    environment: 'production',
    maxBreadcrumbs: 20,
    captureConsoleErrors: false,
    captureUnhandledRejections: true,
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Merge module options into runtimeConfig.public.errorTracker
    nuxt.options.runtimeConfig.public.errorTracker = {
      ...options,
      ...nuxt.options.runtimeConfig.public.errorTracker as Record<string, unknown>,
    }

    // Register client and server plugins
    addPlugin({
      src: resolve('./runtime/plugin.client'),
      mode: 'client',
    })

    addPlugin({
      src: resolve('./runtime/plugin.server'),
      mode: 'server',
    })

    // Auto-import useErrorTracker composable
    addImports({
      name: 'useErrorTracker',
      from: resolve('./runtime/composables/useErrorTracker'),
    })
  },
})
