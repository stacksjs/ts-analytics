/**
 * Shared dashboard filter layer.
 *
 * Parses the common filter dimensions from a stats request's query params and
 * applies them uniformly to session/pageview records, so every report can be
 * sliced by browser/device/OS/country/referrer/channel/UTM — not just country.
 */

import { getReferrerSourceChannel } from './geolocation'

export interface StatFilters {
  country?: string
  region?: string
  city?: string
  /** Maps to the record's deviceType */
  device?: string
  browser?: string
  os?: string
  /** Maps to the record's referrerSource */
  referrerSource?: string
  /** Acquisition channel (derived from referrerSource at match time) */
  channel?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}

/**
 * Extract the supported filter dimensions from query params. Accepts both the
 * dashboard's short names (device, referrer) and the canonical UTM names.
 */
export function parseFilters(query: Record<string, string>): StatFilters {
  return {
    country: query.country || undefined,
    region: query.region || undefined,
    city: query.city || undefined,
    device: query.device || undefined,
    browser: query.browser || undefined,
    os: query.os || undefined,
    referrerSource: query.referrer || query.referrerSource || undefined,
    channel: query.channel || undefined,
    utmSource: query.utm_source || query.utmSource || undefined,
    utmMedium: query.utm_medium || query.utmMedium || undefined,
    utmCampaign: query.utm_campaign || query.utmCampaign || undefined,
  }
}

/** Whether any filter dimension is active. */
export function hasFilters(filters: StatFilters): boolean {
  return Object.values(filters).some(v => v !== undefined && v !== '')
}

/**
 * Whether a session/pageview record matches every active filter. Records expose
 * the filtered fields directly (deviceType, browser, country, referrerSource,
 * utm*), except `channel`, which is derived from referrerSource.
 */
export function matchesFilters(item: Record<string, any>, filters: StatFilters): boolean {
  if (filters.country && item.country !== filters.country) return false
  if (filters.region && item.region !== filters.region) return false
  if (filters.city && item.city !== filters.city) return false
  if (filters.device && item.deviceType !== filters.device) return false
  if (filters.browser && item.browser !== filters.browser) return false
  if (filters.os && item.os !== filters.os) return false
  if (filters.referrerSource && item.referrerSource !== filters.referrerSource) return false
  if (filters.channel && getReferrerSourceChannel(item.referrerSource) !== filters.channel) return false
  if (filters.utmSource && item.utmSource !== filters.utmSource) return false
  if (filters.utmMedium && item.utmMedium !== filters.utmMedium) return false
  if (filters.utmCampaign && item.utmCampaign !== filters.utmCampaign) return false
  return true
}
