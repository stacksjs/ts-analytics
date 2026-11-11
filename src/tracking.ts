/**
 * `@ts-analytics/tracking/tracking`
 *
 * A dependency-free entry point exposing the backend-agnostic tracking +
 * privacy primitives, split out from the main barrel so consumers (e.g. the
 * ghostanalytics app) can use them WITHOUT pulling in the DynamoDB/router/
 * aggregation graph that the root `@ts-analytics/tracking` export carries.
 *
 * Everything re-exported here comes from `src/utils/*`, which have no imports.
 */

export {
  APP_CLIENT_TOKEN,
  type BotCheckOptions,
  getBrowserFamily,
  isAppClientUserAgent,
  isBot,
  isBotRequest,
  type ParsedUserAgent,
  parseUserAgent,
} from './utils/user-agent'

// The event client for native and desktop apps: no DOM, no storage, `fetch`
// only. Also importable on its own as `@ts-analytics/tracking/app`.
export {
  type AppClient,
  type AppClientOptions,
  type AppEventProperties,
  type AppOs,
  appUserAgent,
  createAppClient,
  isValidInstallId,
} from './app-client'

export {
  anonymizeIp,
  countryCodeOf,
  countryFlagEmoji,
  getCountryFromHeaders,
  getRegionFromHeaders,
  isSpamReferrer,
  parseReferrerSource,
} from './utils/geolocation'
