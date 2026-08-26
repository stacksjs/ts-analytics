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
  getBrowserFamily,
  isBot,
  type ParsedUserAgent,
  parseUserAgent,
} from './utils/user-agent'

export {
  anonymizeIp,
  countryCodeOf,
  countryFlagEmoji,
  getCountryFromHeaders,
  getRegionFromHeaders,
  isSpamReferrer,
  parseReferrerSource,
} from './utils/geolocation'
