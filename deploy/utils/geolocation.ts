/**
 * Geolocation utilities
 */

// Country code to name mapping
export const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', JP: 'Japan', CN: 'China', IN: 'India',
  BR: 'Brazil', MX: 'Mexico', ES: 'Spain', IT: 'Italy', NL: 'Netherlands',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', CH: 'Switzerland',
  AT: 'Austria', BE: 'Belgium', PL: 'Poland', RU: 'Russia', KR: 'South Korea',
  SG: 'Singapore', HK: 'Hong Kong', TW: 'Taiwan', NZ: 'New Zealand',
  IE: 'Ireland', PT: 'Portugal', CZ: 'Czech Republic', GR: 'Greece',
  IL: 'Israel', ZA: 'South Africa', AR: 'Argentina', CL: 'Chile',
  CO: 'Colombia', PH: 'Philippines', TH: 'Thailand', MY: 'Malaysia',
  ID: 'Indonesia', VN: 'Vietnam', AE: 'UAE', SA: 'Saudi Arabia',
  TR: 'Turkey', UA: 'Ukraine', RO: 'Romania', HU: 'Hungary',
}

// IP geolocation cache (in-memory, resets on cold start)
const ipGeoCache = new Map<string, { country: string; expires: number }>()

/**
 * Get country from CloudFront/Cloudflare headers
 */
export function getCountryFromHeaders(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined

  // CloudFront provides country code in these headers
  const countryCode = headers['cloudfront-viewer-country']
    || headers['CloudFront-Viewer-Country']
    || headers['x-country-code']
    || headers['cf-ipcountry'] // Cloudflare

  if (countryCode && countryCode !== 'XX') {
    return COUNTRY_NAMES[countryCode.toUpperCase()] || countryCode.toUpperCase()
  }

  return undefined
}

/**
 * Get country from IP address using geolocation services
 */
export async function getCountryFromIP(ip: string): Promise<string | undefined> {
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) {
    return undefined
  }

  // Check cache first
  const cached = ipGeoCache.get(ip)
  if (cached && cached.expires > Date.now()) {
    return cached.country
  }

  // Try multiple geolocation services
  const services = [
    // ipapi.co - HTTPS, free tier 1000/day
    async () => {
      const response = await fetch(`https://ipapi.co/${ip}/json/`, {
        signal: AbortSignal.timeout(3000),
        headers: { 'User-Agent': 'ts-analytics/1.0' },
      })
      if (!response.ok) return null
      const data = await response.json() as { country_name?: string; error?: boolean }
      if (data.error) return null
      return data.country_name
    },
    // ip-api.com - HTTP only, 45/min
    async () => {
      const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) return null
      const data = await response.json() as { status: string; country?: string }
      if (data.status !== 'success') return null
      return data.country
    },
  ]

  for (const service of services) {
    try {
      const country = await service()
      if (country) {
        // Cache for 24 hours
        ipGeoCache.set(ip, { country, expires: Date.now() + 24 * 60 * 60 * 1000 })
        console.log(`[GeoIP] Resolved ${ip} to ${country}`)
        return country
      }
    } catch (err) {
      // Try next service
      console.log(`[GeoIP] Service failed for ${ip}:`, err)
    }
  }

  console.log(`[GeoIP] Failed to resolve country for ${ip}`)
  return undefined
}

/**
 * Parse referrer URL to get source
 */
export function parseReferrerSource(referrer?: string): string {
  if (!referrer) return 'direct'
  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()
    if (host.includes('google')) return 'google'
    if (host.includes('bing')) return 'bing'
    if (host.includes('twitter') || host.includes('x.com')) return 'twitter'
    if (host.includes('facebook')) return 'facebook'
    if (host.includes('linkedin')) return 'linkedin'
    if (host.includes('github')) return 'github'
    return host
  } catch {
    return 'unknown'
  }
}

/**
 * Get region from headers (CloudFront/Cloudflare)
 */
export function getRegionFromHeaders(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined
  return headers['cloudfront-viewer-country-region-name']
    || headers['CloudFront-Viewer-Country-Region-Name']
    || headers['cf-region']
}

/**
 * Get city from headers (CloudFront/Cloudflare)
 */
export function getCityFromHeaders(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined
  return headers['cloudfront-viewer-city']
    || headers['CloudFront-Viewer-City']
    || headers['cf-ipcity']
}
