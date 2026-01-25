/**
 * IP Geolocation Module
 *
 * Provides IP-to-location resolution for analytics tracking.
 * Uses ts-countries for geographic data enrichment.
 */

import {
  City,
  CityLoader,
  CountryLoader,
  findCity,
  GeoResolver,
  type GeoLocation,
} from 'ts-countries'

// ============================================================================
// Types
// ============================================================================

/**
 * IP geolocation result
 */
export interface IPGeoResult {
  /** IP address that was looked up */
  ip: string
  /** ISO 3166-1 alpha-2 country code */
  countryCode: string
  /** Country name */
  country: string
  /** Region/state code */
  regionCode?: string
  /** Region/state name */
  region?: string
  /** City name */
  city?: string
  /** Metro area */
  metro?: string
  /** Postal/ZIP code */
  postalCode?: string
  /** Latitude */
  latitude?: number
  /** Longitude */
  longitude?: number
  /** Timezone identifier */
  timezone?: string
  /** Accuracy radius in km */
  accuracyRadius?: number
  /** ISP name */
  isp?: string
  /** Organization name */
  organization?: string
  /** Autonomous System Number */
  asn?: number
}

/**
 * Geolocation provider interface
 */
export interface GeoProvider {
  name: string
  lookup: (ip: string) => Promise<IPGeoResult | null>
}

/**
 * Geolocation service configuration
 */
export interface GeoServiceConfig {
  /** Primary provider */
  provider?: GeoProvider
  /** Fallback providers */
  fallbackProviders?: GeoProvider[]
  /** Cache TTL in seconds */
  cacheTtlSeconds?: number
  /** Enable caching */
  enableCache?: boolean
  /** Privacy mode - anonymize city-level data */
  privacyMode?: boolean
}

// ============================================================================
// Built-in Providers
// ============================================================================

/**
 * Cloudflare headers provider - uses CF-* headers from Cloudflare
 */
export function createCloudflareProvider(): GeoProvider {
  return {
    name: 'cloudflare',
    lookup: async (ip: string): Promise<IPGeoResult | null> => {
      // This provider expects CF headers to be passed in a special format
      // In practice, you'd extract these from request headers
      return null
    },
  }
}

/**
 * MaxMind GeoLite2 provider
 * Requires maxmind package and GeoLite2-City.mmdb database
 */
export function createMaxMindProvider(databasePath?: string): GeoProvider {
  return {
    name: 'maxmind',
    lookup: async (ip: string): Promise<IPGeoResult | null> => {
      try {
        // Dynamic import to avoid requiring maxmind if not used
        const { Reader } = await import('maxmind')
        const dbPath = databasePath || process.env.MAXMIND_DB_PATH || './GeoLite2-City.mmdb'

        const reader = await Reader.open(dbPath)
        const result = reader.get(ip) as any

        if (!result) {
          return null
        }

        return {
          ip,
          countryCode: result.country?.iso_code || '',
          country: result.country?.names?.en || '',
          regionCode: result.subdivisions?.[0]?.iso_code,
          region: result.subdivisions?.[0]?.names?.en,
          city: result.city?.names?.en,
          postalCode: result.postal?.code,
          latitude: result.location?.latitude,
          longitude: result.location?.longitude,
          timezone: result.location?.time_zone,
          accuracyRadius: result.location?.accuracy_radius,
        }
      }
      catch {
        return null
      }
    },
  }
}

/**
 * IP-API.com free provider (limited to 45 req/min)
 */
export function createIpApiProvider(): GeoProvider {
  return {
    name: 'ip-api',
    lookup: async (ip: string): Promise<IPGeoResult | null> => {
      try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=66846719`)

        if (!response.ok) {
          return null
        }

        const data = await response.json() as any

        if (data.status !== 'success') {
          return null
        }

        return {
          ip,
          countryCode: data.countryCode || '',
          country: data.country || '',
          regionCode: data.region,
          region: data.regionName,
          city: data.city,
          postalCode: data.zip,
          latitude: data.lat,
          longitude: data.lon,
          timezone: data.timezone,
          isp: data.isp,
          organization: data.org,
          asn: data.as ? Number.parseInt(data.as.split(' ')[0].replace('AS', '')) : undefined,
        }
      }
      catch {
        return null
      }
    },
  }
}

/**
 * Get country name safely (handles missing data files)
 */
function getCountryName(countryCode: string): string {
  try {
    const country = CountryLoader.country(countryCode)
    return country?.getName() || countryCode
  }
  catch {
    // Country data files not available, return code as name
    return countryCode
  }
}

/**
 * Cloudflare request headers extractor
 */
export function extractCloudflareGeo(headers: Record<string, string>): IPGeoResult | null {
  const ip = headers['cf-connecting-ip'] || headers['x-forwarded-for']?.split(',')[0]?.trim()
  const countryCode = headers['cf-ipcountry']

  if (!ip || !countryCode) {
    return null
  }

  return {
    ip,
    countryCode,
    country: getCountryName(countryCode),
    regionCode: headers['cf-region-code'],
    region: headers['cf-region'],
    city: headers['cf-ipcity'],
    latitude: headers['cf-iplat'] ? Number.parseFloat(headers['cf-iplat']) : undefined,
    longitude: headers['cf-iplon'] ? Number.parseFloat(headers['cf-iplon']) : undefined,
    timezone: headers['cf-timezone'],
  }
}

/**
 * Vercel request headers extractor
 */
export function extractVercelGeo(headers: Record<string, string>): IPGeoResult | null {
  const ip = headers['x-forwarded-for']?.split(',')[0]?.trim() || headers['x-real-ip']
  const countryCode = headers['x-vercel-ip-country']

  if (!ip || !countryCode) {
    return null
  }

  return {
    ip,
    countryCode,
    country: getCountryName(countryCode),
    regionCode: headers['x-vercel-ip-country-region'],
    city: headers['x-vercel-ip-city'],
    latitude: headers['x-vercel-ip-latitude'] ? Number.parseFloat(headers['x-vercel-ip-latitude']) : undefined,
    longitude: headers['x-vercel-ip-longitude'] ? Number.parseFloat(headers['x-vercel-ip-longitude']) : undefined,
  }
}

// ============================================================================
// Geolocation Service
// ============================================================================

/**
 * Main geolocation service
 */
export class GeolocationService {
  private config: Required<GeoServiceConfig>
  private cache: Map<string, { result: IPGeoResult, expires: number }> = new Map()

  constructor(config: GeoServiceConfig = {}) {
    this.config = {
      provider: config.provider || createIpApiProvider(),
      fallbackProviders: config.fallbackProviders || [],
      cacheTtlSeconds: config.cacheTtlSeconds || 3600,
      enableCache: config.enableCache ?? true,
      privacyMode: config.privacyMode ?? false,
    }
  }

  /**
   * Lookup IP address
   */
  async lookup(ip: string): Promise<IPGeoResult | null> {
    // Skip private/local IPs
    if (this.isPrivateIP(ip)) {
      return null
    }

    // Check cache
    if (this.config.enableCache) {
      const cached = this.cache.get(ip)
      if (cached && cached.expires > Date.now()) {
        return cached.result
      }
    }

    // Try primary provider
    let result = await this.config.provider.lookup(ip)

    // Try fallback providers
    if (!result) {
      for (const provider of this.config.fallbackProviders) {
        result = await provider.lookup(ip)
        if (result) {
          break
        }
      }
    }

    if (!result) {
      return null
    }

    // Enrich with ts-countries data
    result = this.enrichResult(result)

    // Apply privacy mode
    if (this.config.privacyMode) {
      result = this.applyPrivacy(result)
    }

    // Cache result
    if (this.config.enableCache) {
      this.cache.set(ip, {
        result,
        expires: Date.now() + this.config.cacheTtlSeconds * 1000,
      })
    }

    return result
  }

  /**
   * Lookup from request headers (Cloudflare, Vercel, etc.)
   */
  lookupFromHeaders(headers: Record<string, string>): IPGeoResult | null {
    // Try Cloudflare first
    let result = extractCloudflareGeo(headers)

    // Try Vercel
    if (!result) {
      result = extractVercelGeo(headers)
    }

    if (!result) {
      return null
    }

    // Enrich with ts-countries data
    result = this.enrichResult(result)

    // Apply privacy mode
    if (this.config.privacyMode) {
      result = this.applyPrivacy(result)
    }

    return result
  }

  /**
   * Enrich result with ts-countries data
   */
  private enrichResult(result: IPGeoResult): IPGeoResult {
    try {
      // Try to enhance city/region info using ts-countries
      if (result.countryCode && result.latitude && result.longitude) {
        const geoLocation = GeoResolver.resolveCoordinates(
          result.latitude,
          result.longitude,
          { countryCodeHint: result.countryCode },
        )

        if (geoLocation) {
          // Use ts-countries data for more accurate city/metro info
          if (geoLocation.city && !result.city) {
            result.city = geoLocation.city
          }
          if (geoLocation.metro && !result.metro) {
            result.metro = geoLocation.metro
          }
          if (geoLocation.region && !result.region) {
            result.region = geoLocation.region
          }
          if (geoLocation.regionCode && !result.regionCode) {
            result.regionCode = geoLocation.regionCode
          }
          if (geoLocation.timezone && !result.timezone) {
            result.timezone = geoLocation.timezone
          }
        }
      }

      // Try to find city by name if we have city but no lat/lon
      if (result.city && result.countryCode && !result.latitude) {
        const city = findCity(result.city, result.countryCode, result.regionCode)
        if (city) {
          result.latitude = city.getLatitude()
          result.longitude = city.getLongitude()
          result.metro = city.getMetro()
          result.timezone = city.getTimezone()
        }
      }
    }
    catch {
      // ts-countries data not available, return result as-is
    }

    return result
  }

  /**
   * Apply privacy mode - remove city-level precision
   */
  private applyPrivacy(result: IPGeoResult): IPGeoResult {
    return {
      ...result,
      city: undefined,
      postalCode: undefined,
      // Round coordinates to region level (~10km)
      latitude: result.latitude ? Math.round(result.latitude * 10) / 10 : undefined,
      longitude: result.longitude ? Math.round(result.longitude * 10) / 10 : undefined,
    }
  }

  /**
   * Check if IP is private/local
   */
  private isPrivateIP(ip: string): boolean {
    // IPv4 private ranges
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./,
      /^0\./,
      /^::1$/,
      /^fc00:/i,
      /^fd00:/i,
      /^fe80:/i,
    ]

    return privateRanges.some(range => range.test(ip))
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number, hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0, // Would need to track hits/misses
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

let defaultService: GeolocationService | null = null

/**
 * Get or create default geolocation service
 */
export function getGeolocationService(config?: GeoServiceConfig): GeolocationService {
  if (!defaultService) {
    defaultService = new GeolocationService(config)
  }
  return defaultService
}

/**
 * Lookup IP address using default service
 */
export async function lookupIP(ip: string): Promise<IPGeoResult | null> {
  return getGeolocationService().lookup(ip)
}

/**
 * Lookup from request headers using default service
 */
export function lookupFromHeaders(headers: Record<string, string>): IPGeoResult | null {
  return getGeolocationService().lookupFromHeaders(headers)
}

/**
 * Format location for display
 */
export function formatGeoLocation(result: IPGeoResult): string {
  const parts: string[] = []

  if (result.city) {
    parts.push(result.city)
  }

  if (result.region) {
    parts.push(result.region)
  }
  else if (result.regionCode) {
    parts.push(result.regionCode)
  }

  if (result.country) {
    parts.push(result.country)
  }

  return parts.join(', ')
}

/**
 * Format short location (City, State/Region)
 */
export function formatGeoLocationShort(result: IPGeoResult): string {
  if (result.city && result.regionCode) {
    return `${result.city}, ${result.regionCode}`
  }

  if (result.city) {
    return result.city
  }

  if (result.region) {
    return result.region
  }

  return result.country || result.countryCode
}

// Re-export ts-countries utilities for convenience
export {
  City,
  CityLoader,
  CountryLoader,
  findCity,
  type GeoLocation,
  GeoResolver,
}
