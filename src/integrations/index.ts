/**
 * Framework Integrations
 *
 * Pre-built integrations for popular frameworks.
 */

export {
  analyticsMiddleware,
  createAnalyticsRoutes,
  mountAnalyticsRoutes,
  type AnalyticsMiddlewareOptions,
} from './hono'

export {
  createAnalyticsHandler,
  createD1Adapter,
  type CloudflareEnv,
  type CloudflareHandlerOptions,
  type StorageAdapter,
} from './cloudflare'

export {
  DEFAULT_API_ENDPOINT,
  generateAppId,
  resolveApiEndpoint,
  type StxAnalyticsConfig,
  type StxHeadScript,
  tsAnalytics,
  type TsAnalyticsOptions,
  tsAnalyticsStxConfig,
  tsAnalyticsTag,
} from './stx'
