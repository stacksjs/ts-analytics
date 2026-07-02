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

// Reverse lookup: display name → ISO code (countries are stored by display
// name when COUNTRY_NAMES knows them, bare ISO code otherwise).
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_NAMES).map(([code, name]) => [name, code]),
)

/** ISO-3166 alpha-2 code for a stored country value (name or code). */
export function countryCodeOf(nameOrCode: string): string | undefined {
  if (/^[A-Z]{2}$/i.test(nameOrCode))
    return nameOrCode.toUpperCase()
  return NAME_TO_CODE[nameOrCode]
}

/** Emoji flag (regional indicator pair) for an ISO alpha-2 code — Fathom-style. */
export function countryFlagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/i.test(code))
    return ''
  const cc = code.toUpperCase()
  return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65)
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
/**
 * Reduce an IP's precision before it leaves the system (e.g. to a third-party
 * geo API), per config.privacy.ipAnonymization (#144). 'partial' drops the host
 * portion (IPv4 /24, IPv6 /48) — still country-accurate; 'full' drops it
 * entirely; 'none' passes through.
 */
export function anonymizeIp(ip: string, mode: string = 'partial'): string {
  if (!ip || mode === 'none')
    return ip
  if (mode === 'full')
    return ''
  if (ip.includes(':')) {
    const parts = ip.split(':')
    return `${parts.slice(0, 3).join(':')}::`
  }
  const octets = ip.split('.')
  if (octets.length === 4) {
    octets[3] = '0'
    return octets.join('.')
  }
  return ip
}

export async function getCountryFromIP(ip: string): Promise<string | undefined> {
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) {
    return undefined
  }

  // Check cache first
  const cached = ipGeoCache.get(ip)
  if (cached && cached.expires > Date.now()) {
    return cached.country
  }

  // HTTPS-only geolocation services — the plaintext-HTTP ip-api.com provider was
  // removed so visitor IPs never traverse the network in the clear (#144).
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
    }
catch (err) {
      // Try next service
      console.log(`[GeoIP] Service failed for ${ip}:`, err)
    }
  }

  console.log(`[GeoIP] Failed to resolve country for ${ip}`)
  return undefined
}

/**
 * Marketing channel a referrer belongs to.
 */
export type ReferrerChannel = 'Search' | 'Social' | 'AI' | 'Email' | 'Referral' | 'Paid' | 'Direct'

interface ReferrerEntry {
  /** Substring match (broad, for ccTLD coverage e.g. google.*) or RegExp (precise, for short ambiguous hosts e.g. t.co). */
  match: string | RegExp
  name: string
  channel: ReferrerChannel
}

// Ordered: the first match wins, so more-specific hosts come before broader ones
// (e.g. mail.google / gemini.google before google; reddit before t.co).
const REFERRER_MAP: ReferrerEntry[] = [
  // Webmail (before search engines so mail.google != Google)
  { match: 'mail.google', name: 'Gmail', channel: 'Email' },
  { match: 'mail.yahoo', name: 'Yahoo Mail', channel: 'Email' },
  { match: 'outlook.', name: 'Outlook', channel: 'Email' },
  { match: 'mail.proton', name: 'Proton Mail', channel: 'Email' },

  // AI assistants (before search; gemini.google contains "google")
  { match: 'chatgpt.', name: 'ChatGPT', channel: 'AI' },
  { match: 'chat.openai', name: 'ChatGPT', channel: 'AI' },
  { match: 'openai.', name: 'ChatGPT', channel: 'AI' },
  { match: 'perplexity', name: 'Perplexity', channel: 'AI' },
  { match: 'gemini.google', name: 'Gemini', channel: 'AI' },
  { match: 'bard.google', name: 'Gemini', channel: 'AI' },
  { match: 'claude.ai', name: 'Claude', channel: 'AI' },
  { match: 'copilot.microsoft', name: 'Copilot', channel: 'AI' },
  { match: /(^|\.)you\.com$/, name: 'You.com', channel: 'AI' },
  { match: 'phind.', name: 'Phind', channel: 'AI' },

  // Search engines
  { match: 'google', name: 'Google', channel: 'Search' },
  { match: 'bing', name: 'Bing', channel: 'Search' },
  { match: 'duckduckgo', name: 'DuckDuckGo', channel: 'Search' },
  { match: 'yahoo', name: 'Yahoo', channel: 'Search' },
  { match: 'yandex', name: 'Yandex', channel: 'Search' },
  { match: 'baidu', name: 'Baidu', channel: 'Search' },
  { match: 'ecosia', name: 'Ecosia', channel: 'Search' },
  { match: 'startpage', name: 'Startpage', channel: 'Search' },
  { match: 'search.brave', name: 'Brave Search', channel: 'Search' },
  { match: 'qwant', name: 'Qwant', channel: 'Search' },
  { match: 'search.marginalia', name: 'Marginalia', channel: 'Search' },
  { match: /(^|\.)ask\.com$/, name: 'Ask', channel: 'Search' },

  // Social (reddit before t.co; precise regex for short ambiguous hosts)
  { match: 'reddit', name: 'Reddit', channel: 'Social' },
  { match: 'facebook', name: 'Facebook', channel: 'Social' },
  { match: /(^|\.)fb\.com$/, name: 'Facebook', channel: 'Social' },
  { match: /(^|\.)fb\.me$/, name: 'Facebook', channel: 'Social' },
  { match: 'instagram', name: 'Instagram', channel: 'Social' },
  { match: /^t\.co$/, name: 'Twitter', channel: 'Social' },
  { match: 'twitter', name: 'Twitter', channel: 'Social' },
  { match: /(^|\.)x\.com$/, name: 'Twitter', channel: 'Social' },
  { match: 'linkedin', name: 'LinkedIn', channel: 'Social' },
  { match: /(^|\.)lnkd\.in$/, name: 'LinkedIn', channel: 'Social' },
  { match: 'youtube', name: 'YouTube', channel: 'Social' },
  { match: /(^|\.)youtu\.be$/, name: 'YouTube', channel: 'Social' },
  { match: 'pinterest', name: 'Pinterest', channel: 'Social' },
  { match: 'tiktok', name: 'TikTok', channel: 'Social' },
  { match: 'threads.net', name: 'Threads', channel: 'Social' },
  { match: 'mastodon', name: 'Mastodon', channel: 'Social' },
  { match: 'quora', name: 'Quora', channel: 'Social' },
  { match: 'snapchat', name: 'Snapchat', channel: 'Social' },
  { match: 'tumblr', name: 'Tumblr', channel: 'Social' },
  { match: 'telegram', name: 'Telegram', channel: 'Social' },
  { match: /^t\.me$/, name: 'Telegram', channel: 'Social' },
  { match: 'news.ycombinator', name: 'Hacker News', channel: 'Social' },
  { match: 'ycombinator', name: 'Hacker News', channel: 'Social' },

  // Dev / community / content
  { match: 'github', name: 'GitHub', channel: 'Referral' },
  { match: 'gitlab', name: 'GitLab', channel: 'Referral' },
  { match: 'stackoverflow', name: 'Stack Overflow', channel: 'Referral' },
  { match: 'medium.com', name: 'Medium', channel: 'Referral' },
  { match: 'dev.to', name: 'DEV', channel: 'Referral' },
]

function matchReferrer(host: string): ReferrerEntry | undefined {
  return REFERRER_MAP.find(e => typeof e.match === 'string' ? host.includes(e.match) : e.match.test(host))
}

/**
 * Parse a referrer URL into a normalized, human-readable source name
 * (e.g. "Google", "Reddit", "ChatGPT"). Unknown hosts fall back to the
 * bare domain (www. stripped). Empty → "Direct", invalid → "Unknown".
 */
export function parseReferrerSource(referrer?: string): string {
  if (!referrer) return 'Direct'
  try {
    const host = new URL(referrer).hostname.toLowerCase()
    const entry = matchReferrer(host)
    if (entry) return entry.name
    return host.startsWith('www.') ? host.slice(4) : host
  }
catch {
    return 'Unknown'
  }
}

/**
 * Classify traffic into a marketing channel. Paid/email are inferred from
 * UTM medium and ad click IDs (gclid/fbclid); otherwise from the referrer.
 */
export function getReferrerChannel(opts: {
  referrer?: string
  utmMedium?: string
  gclid?: string
  fbclid?: string
}): ReferrerChannel {
  const medium = (opts.utmMedium || '').toLowerCase()
  if (opts.gclid || opts.fbclid
    || ['cpc', 'ppc', 'paid', 'paidsearch', 'paid-search', 'paid_search', 'display', 'cpm', 'retargeting', 'affiliate'].includes(medium)) {
    return 'Paid'
  }
  if (medium === 'email' || medium === 'newsletter') return 'Email'
  if (medium === 'social' || medium === 'social-media') return 'Social'
  if (medium === 'organic' || medium === 'search') return 'Search'
  if (medium === 'referral') return 'Referral'
  if (!opts.referrer) return 'Direct'
  try {
    const host = new URL(opts.referrer).hostname.toLowerCase()
    return matchReferrer(host)?.channel ?? 'Referral'
  }
catch {
    return 'Direct'
  }
}

/**
 * Channel for an already-normalized source name (e.g. a stored referrerSource).
 * Used at query time where the original referrer/UTM is no longer available, so
 * it can only classify Search/Social/AI/Referral/Direct (not Paid/Email).
 */
export function getReferrerSourceChannel(source?: string): ReferrerChannel {
  if (!source || source === 'Direct' || source === 'direct') return 'Direct'
  const entry = REFERRER_MAP.find(e => e.name === source)
  return entry?.channel ?? 'Referral'
}

// Known referral-spam / ghost-spam domains whose hits are fabricated by bots.
const SPAM_REFERRERS: string[] = [
  'semalt.com', 'buttons-for-website.com', 'buttons-for-your-website.com',
  'darodar.com', 'best-seo-offer.com', 'best-seo-solution.com',
  'free-share-buttons.com', 'free-social-buttons.com', 'get-free-traffic-now.com',
  'social-buttons.com', 'success-seo.com', 'trafficmonetizer.org',
  'simple-share-buttons.com', '4webmasters.org', 'ilovevitaly.com',
  'priceg.com', 'blackhatworth.com', 'econom.co', 'savetubevideo.com',
  'kambasoft.com', 'voucherssite.com', 'sharebutton.net', 'sitevaluation.org',
  'dailyrank.net', 'lifehacĸer.com', 'o-o-6-o-o.com', 'humanorightswatch.org',
  'guardlink.org', 'cenoval.ru', 'descargar-musica-gratis.net',
]

/**
 * Whether a referrer is a known referral-spam domain (so its hits can be dropped).
 */
export function isSpamReferrer(referrer?: string): boolean {
  if (!referrer) return false
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '')
    return SPAM_REFERRERS.some(d => host === d || host.endsWith(`.${d}`))
  }
catch {
    return false
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
