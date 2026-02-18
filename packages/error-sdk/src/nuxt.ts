/**
 * Nuxt 3 module for automatic error tracking.
 *
 * Usage in nuxt.config.ts:
 *   export default defineNuxtConfig({
 *     modules: ['@stacksjs/error-tracker/nuxt'],
 *
 *     errorTracker: {
 *       token: 'ak_...',
 *       endpoint: 'https://analytics.example.com',
 *     },
 *   })
 *
 * The module auto-registers client and server plugins, installs
 * Vue error handlers, and auto-imports the `useErrorTracker()` composable.
 *
 * Env var overrides via Nuxt runtime config:
 *   NUXT_PUBLIC_ERROR_TRACKER_TOKEN
 *   NUXT_PUBLIC_ERROR_TRACKER_ENDPOINT
 *   NUXT_PUBLIC_ERROR_TRACKER_ENVIRONMENT
 */
export { default } from './nuxt/module'
export type { ErrorTrackerModuleOptions } from './nuxt/module'
