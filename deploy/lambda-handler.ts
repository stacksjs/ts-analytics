/**
 * AWS Lambda Handler for ts-analytics API
 *
 * This handler wraps the analytics API for deployment to AWS Lambda.
 * It uses API Gateway for HTTP routing and Eloquent-like models for data access.
 */

import {
  generateTrackingScript,
  generateMinimalTrackingScript,
  generateId,
  hashVisitorId,
  getDailySalt,
} from '../src/index'
import type { Session as SessionType } from '../src/types'
import {
  PageView as PageViewModel,
  Session as SessionModel,
  CustomEvent as CustomEventModel,
  HeatmapClick,
  HeatmapMovement,
  HeatmapScroll,
  Goal,
  Conversion,
  configureAnalytics,
  createClient,
  marshall,
  unmarshall,
} from '../src/models/orm'

// Configuration
const TABLE_NAME = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'
const REGION = process.env.AWS_REGION || 'us-east-1'

// Configure analytics models
configureAnalytics({
  tableName: TABLE_NAME,
  region: REGION,
})

// Create native DynamoDB client for direct queries (used in dashboard handlers)
const dynamodb = createClient({ region: REGION })

// In-memory session cache (resets on cold start)
const sessionCache = new Map<string, { session: SessionType; expires: number }>()

// Helper functions
function getSession(key: string): SessionType | null {
  const cached = sessionCache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.session
  }
  sessionCache.delete(key)
  return null
}

function setSession(key: string, session: SessionType, ttlSeconds = 1800): void {
  sessionCache.set(key, {
    session,
    expires: Date.now() + ttlSeconds * 1000,
  })
}

// ============================================================================
// Goal Caching & Matching
// ============================================================================

// Goal cache - stores goals per site for fast lookup during collect
const goalCache = new Map<string, { goals: Goal[]; expires: number }>()
const GOAL_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Session conversion deduplication - prevents same goal from converting multiple times per session
const sessionConversions = new Map<string, Set<string>>()

async function getGoalsForSite(siteId: string): Promise<Goal[]> {
  const cached = goalCache.get(siteId)
  if (cached && cached.expires > Date.now()) {
    return cached.goals
  }

  try {
    const goals = await Goal.forSite(siteId).active().get()
    goalCache.set(siteId, {
      goals,
      expires: Date.now() + GOAL_CACHE_TTL,
    })
    return goals
  } catch (err) {
    console.error('[Goals] Failed to fetch goals:', err)
    return []
  }
}

function invalidateGoalCache(siteId: string): void {
  goalCache.delete(siteId)
}

interface GoalMatchContext {
  path: string
  eventName?: string
  sessionDurationMinutes?: number
}

function matchGoal(goal: Goal, context: GoalMatchContext): boolean {
  if (!goal.isActive) return false

  switch (goal.type) {
    case 'pageview':
      return matchPattern(goal.pattern, context.path, goal.matchType)

    case 'event':
      if (!context.eventName) return false
      return matchPattern(goal.pattern, context.eventName, goal.matchType)

    case 'duration':
      if (context.sessionDurationMinutes === undefined) return false
      const threshold = goal.durationMinutes || 0
      return context.sessionDurationMinutes >= threshold

    default:
      return false
  }
}

function matchPattern(pattern: string, value: string, matchType: string): boolean {
  if (!pattern || !value) return false

  switch (matchType) {
    case 'exact':
      return value === pattern

    case 'contains':
      return value.includes(pattern)

    case 'regex':
      try {
        const regex = new RegExp(pattern)
        return regex.test(value)
      } catch {
        console.warn(`[Goals] Invalid regex pattern: ${pattern}`)
        return false
      }

    default:
      return value === pattern
  }
}

interface ConversionMetadata {
  referrerSource?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}

async function checkAndRecordConversions(
  siteId: string,
  visitorId: string,
  sessionId: string,
  context: GoalMatchContext,
  metadata: ConversionMetadata
): Promise<void> {
  try {
    const goals = await getGoalsForSite(siteId)
    if (goals.length === 0) return

    const timestamp = new Date()

    // Track which goals this session has already converted (prevent duplicates)
    const sessionKey = `${siteId}:${sessionId}`
    const convertedGoals = sessionConversions.get(sessionKey) || new Set<string>()

    for (const goal of goals) {
      // Skip if already converted in this session
      if (convertedGoals.has(goal.id)) continue

      if (matchGoal(goal, context)) {
        // Record conversion
        await Conversion.record({
          id: generateId(),
          siteId,
          goalId: goal.id,
          visitorId,
          sessionId,
          value: goal.value,
          path: context.path,
          referrerSource: metadata.referrerSource,
          utmSource: metadata.utmSource,
          utmMedium: metadata.utmMedium,
          utmCampaign: metadata.utmCampaign,
          timestamp,
        })

        convertedGoals.add(goal.id)
        console.log(`[Goals] Conversion recorded: ${goal.name} for session ${sessionId}`)
      }
    }

    sessionConversions.set(sessionKey, convertedGoals)

    // Clean up old session conversion entries (keep last 1000)
    if (sessionConversions.size > 1000) {
      const keysToDelete = Array.from(sessionConversions.keys()).slice(0, 100)
      keysToDelete.forEach(k => sessionConversions.delete(k))
    }
  } catch (err) {
    console.error('[Goals] Error checking conversions:', err)
  }
}

function parseUserAgent(ua: string) {
  if (!ua || ua === 'unknown') {
    return { deviceType: 'desktop', browser: 'Unknown', os: 'Unknown' }
  }

  // Detect device type
  let deviceType = 'desktop'
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    deviceType = 'mobile'
  } else if (/ipad|tablet|playbook|silk/i.test(ua)) {
    deviceType = 'tablet'
  }

  // Detect browser - order matters (more specific first)
  let browser = 'Unknown'
  if (/edg/i.test(ua)) browser = 'Edge'
  else if (/opr|opera/i.test(ua)) browser = 'Opera'
  else if (/brave/i.test(ua)) browser = 'Brave'
  else if (/vivaldi/i.test(ua)) browser = 'Vivaldi'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/chrome|chromium|crios/i.test(ua)) browser = 'Chrome'
  else if (/safari/i.test(ua) && !/chrome|chromium/i.test(ua)) browser = 'Safari'
  else if (/trident|msie/i.test(ua)) browser = 'IE'
  else if (/bot|crawl|spider|slurp|bingpreview/i.test(ua)) browser = 'Bot'

  // Detect OS
  let os = 'Unknown'
  if (/windows nt 10/i.test(ua)) os = 'Windows 10'
  else if (/windows nt 11/i.test(ua)) os = 'Windows 11'
  else if (/windows/i.test(ua)) os = 'Windows'
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS'
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/linux/i.test(ua)) os = 'Linux'
  else if (/cros/i.test(ua)) os = 'Chrome OS'

  return { deviceType, browser, os }
}

// Country code to name mapping
const COUNTRY_NAMES: Record<string, string> = {
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

function getCountryFromHeaders(headers: Record<string, string> | undefined): string | undefined {
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

// IP geolocation cache (in-memory, resets on cold start)
const ipGeoCache = new Map<string, { country: string; expires: number }>()

async function getCountryFromIP(ip: string): Promise<string | undefined> {
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

function parseReferrerSource(referrer?: string): string {
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
  }
  catch {
    return 'unknown'
  }
}

// Note: marshalPageView, marshalSession, marshalCustomEvent functions removed
// Now using Eloquent models from ../src/models/eloquent

// Response helper
function response(body: unknown, statusCode = 200, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }
}

// Helper to parse date range from query params
function parseDateRange(query: Record<string, string> | undefined): { startDate: Date; endDate: Date } {
  const now = new Date()
  const endDate = query?.endDate ? new Date(query.endDate) : now
  let startDate: Date

  if (query?.startDate) {
    startDate = new Date(query.startDate)
  } else {
    // Default to last 30 days
    startDate = new Date(now)
    startDate.setDate(startDate.getDate() - 30)
  }

  return { startDate, endDate }
}

// Helper to format duration in mm:ss
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

// Note: unmarshall function removed - now using imported unmarshall from models/eloquent

// Dashboard HTML (embedded for single-file deployment)
function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analytics Dashboard</title>
  <script>
    const urlParams = new URLSearchParams(window.location.search)
    const API_ENDPOINT = window.ANALYTICS_API_ENDPOINT || urlParams.get('api') || window.location.origin
    const SITE_ID = urlParams.get('siteId') || window.ANALYTICS_SITE_ID || ''

    let siteName = "Analytics Dashboard"
    let siteId = SITE_ID
    let availableSites = []
    let currentSite = null
    let dateRange = '30d'
    let isLoading = false
    let lastUpdated = null
    let refreshInterval = null
    let previousStats = null

    // Load cached stats from localStorage
    function loadCachedStats() {
      try {
        const cached = localStorage.getItem('ts-analytics-stats-' + siteId)
        if (cached) {
          const data = JSON.parse(cached)
          // Only use cache if less than 24 hours old
          if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
            return data.stats
          }
        }
      } catch (e) {}
      return null
    }

    function saveCachedStats(statsData) {
      try {
        localStorage.setItem('ts-analytics-stats-' + siteId, JSON.stringify({
          stats: statsData,
          timestamp: Date.now()
        }))
      } catch (e) {}
    }

    // Animate number transitions
    function animateValue(element, start, end, duration, formatter) {
      // Ensure numeric values for comparison and animation
      const startNum = typeof start === 'number' ? start : (parseFloat(start) || 0)
      const endNum = typeof end === 'number' ? end : (parseFloat(end) || 0)

      if (startNum === endNum) {
        element.textContent = formatter ? formatter(endNum) : endNum
        return
      }

      const startTime = performance.now()

      function update(currentTime) {
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / duration, 1)
        // Ease out cubic for smooth deceleration
        const easeProgress = 1 - Math.pow(1 - progress, 3)
        const current = Math.round(startNum + (endNum - startNum) * easeProgress)
        element.textContent = formatter ? formatter(current) : current

        if (progress < 1) {
          requestAnimationFrame(update)
        }
      }
      requestAnimationFrame(update)
    }

    const cachedStats = loadCachedStats()
    let stats = cachedStats || { realtime: 0, sessions: 0, people: 0, views: 0, avgTime: "00:00", bounceRate: 0, events: 0 }
    let pages = [], referrers = [], deviceTypes = [], browsers = [], countries = [], campaigns = [], events = [], timeSeriesData = []
    let goals = [], goalStats = null
    let siteHostname = null
    let showGoalModal = false
    let editingGoal = null

    // Browser icons (SVG)
    const browserIcons = {
      'Chrome': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#4285F4" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#4285F4"/><path d="M12 2v6" stroke="#EA4335" stroke-width="2"/><path d="M5 17l5-3" stroke="#FBBC05" stroke-width="2"/><path d="M19 17l-5-3" stroke="#34A853" stroke-width="2"/></svg>',
      'Safari': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#0FB5EE" stroke-width="2"/><path d="M12 2L14 12L12 22" stroke="#FF5722" stroke-width="1"/><path d="M2 12L12 10L22 12" stroke="#0FB5EE" stroke-width="1"/></svg>',
      'Firefox': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#FF6611" stroke-width="2" fill="#FFBD4F"/><path d="M8 8c2-2 6-2 8 0s2 6 0 8" stroke="#FF6611" stroke-width="2"/></svg>',
      'Edge': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#0078D7" stroke-width="2"/><path d="M6 12c0-4 3-6 6-6s6 2 6 6" stroke="#0078D7" stroke-width="2"/></svg>',
      'Opera': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><ellipse cx="12" cy="12" rx="6" ry="10" stroke="#FF1B2D" stroke-width="2"/></svg>',
      'Brave': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><path d="M12 2L4 6v6c0 5.5 3.5 10.7 8 12 4.5-1.3 8-6.5 8-12V6l-8-4z" stroke="#FB542B" stroke-width="2"/></svg>',
      'IE': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#0076D6" stroke-width="2"/><path d="M4 12h16" stroke="#0076D6" stroke-width="2"/></svg>',
      'Bot': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="2"/><circle cx="15" cy="14" r="2"/><path d="M12 2v4M6 6l2 2M18 6l-2 2"/></svg>',
    }
    function getBrowserIcon(name) {
      return browserIcons[name] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px;opacity:0.5"><circle cx="12" cy="12" r="10"/></svg>'
    }

    // Country name to flag emoji (ISO 3166-1)
    const countryFlags = {
      'United States': '\u{1F1FA}\u{1F1F8}', 'United Kingdom': '\u{1F1EC}\u{1F1E7}', 'Canada': '\u{1F1E8}\u{1F1E6}',
      'Australia': '\u{1F1E6}\u{1F1FA}', 'Germany': '\u{1F1E9}\u{1F1EA}', 'France': '\u{1F1EB}\u{1F1F7}',
      'Japan': '\u{1F1EF}\u{1F1F5}', 'China': '\u{1F1E8}\u{1F1F3}', 'India': '\u{1F1EE}\u{1F1F3}',
      'Brazil': '\u{1F1E7}\u{1F1F7}', 'Mexico': '\u{1F1F2}\u{1F1FD}', 'Spain': '\u{1F1EA}\u{1F1F8}',
      'Italy': '\u{1F1EE}\u{1F1F9}', 'Netherlands': '\u{1F1F3}\u{1F1F1}', 'Sweden': '\u{1F1F8}\u{1F1EA}',
      'Norway': '\u{1F1F3}\u{1F1F4}', 'Denmark': '\u{1F1E9}\u{1F1F0}', 'Finland': '\u{1F1EB}\u{1F1EE}',
      'Switzerland': '\u{1F1E8}\u{1F1ED}', 'Austria': '\u{1F1E6}\u{1F1F9}', 'Belgium': '\u{1F1E7}\u{1F1EA}',
      'Poland': '\u{1F1F5}\u{1F1F1}', 'Russia': '\u{1F1F7}\u{1F1FA}', 'South Korea': '\u{1F1F0}\u{1F1F7}',
      'Singapore': '\u{1F1F8}\u{1F1EC}', 'Hong Kong': '\u{1F1ED}\u{1F1F0}', 'Taiwan': '\u{1F1F9}\u{1F1FC}',
      'New Zealand': '\u{1F1F3}\u{1F1FF}', 'Ireland': '\u{1F1EE}\u{1F1EA}', 'Portugal': '\u{1F1F5}\u{1F1F9}',
      'Czech Republic': '\u{1F1E8}\u{1F1FF}', 'Greece': '\u{1F1EC}\u{1F1F7}', 'Israel': '\u{1F1EE}\u{1F1F1}',
      'South Africa': '\u{1F1FF}\u{1F1E6}', 'Argentina': '\u{1F1E6}\u{1F1F7}', 'Chile': '\u{1F1E8}\u{1F1F1}',
      'Colombia': '\u{1F1E8}\u{1F1F4}', 'Philippines': '\u{1F1F5}\u{1F1ED}', 'Thailand': '\u{1F1F9}\u{1F1ED}',
      'Malaysia': '\u{1F1F2}\u{1F1FE}', 'Indonesia': '\u{1F1EE}\u{1F1E9}', 'Vietnam': '\u{1F1FB}\u{1F1F3}',
      'UAE': '\u{1F1E6}\u{1F1EA}', 'Saudi Arabia': '\u{1F1F8}\u{1F1E6}', 'Turkey': '\u{1F1F9}\u{1F1F7}',
      'Ukraine': '\u{1F1FA}\u{1F1E6}', 'Romania': '\u{1F1F7}\u{1F1F4}', 'Hungary': '\u{1F1ED}\u{1F1FA}',
    }
    function getCountryFlag(name) {
      return countryFlags[name] || '\u{1F30D}'
    }

    // Device icons
    const deviceIcons = {
      'desktop': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
      'mobile': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
      'tablet': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
    }
    function getDeviceIcon(type) {
      return deviceIcons[type?.toLowerCase()] || deviceIcons['desktop']
    }

    async function fetchSites() {
      const container = document.getElementById('site-list')
      container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading sites...</p></div>'
      try {
        const res = await fetch(\`\${API_ENDPOINT}/api/sites\`)
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        availableSites = data.sites || []
        renderSiteSelector()
      } catch (err) {
        container.innerHTML = '<div class="error"><p>Failed to load sites</p><button onclick="fetchSites()">Retry</button></div>'
      }
    }

    function renderSiteSelector() {
      const container = document.getElementById('site-list')
      if (availableSites.length === 0) {
        container.innerHTML = \`<div class="empty">
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <p>No sites found</p>
          <p style="font-size:0.75rem;margin-top:0.5rem">Create a site using the CLI to start tracking</p>
          <code style="font-size:0.75rem;background:#2d3344;padding:0.5rem 1rem;border-radius:4px;margin-top:1rem">cloud analytics:sites:create "My Site" --domain example.com</code>
        </div>\`
        return
      }
      container.innerHTML = availableSites.map(s => \`
        <button class="site-card" onclick="selectSite('\${s.id}', '\${(s.name || '').replace(/'/g, "\\\\'")}')">
          <div class="site-icon"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg></div>
          <div class="site-info"><span class="site-name">\${s.name || 'Unnamed'}</span><span class="site-domain">\${s.domains?.[0] || s.id}</span></div>
          <svg class="arrow" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
        </button>
      \`).join('')
    }

    function selectSite(id, name) {
      siteId = id
      siteName = name || 'Analytics Dashboard'
      currentSite = availableSites.find(s => s.id === id)
      document.getElementById('site-selector').style.display = 'none'
      document.getElementById('dashboard').style.display = 'block'
      document.getElementById('current-site-name').textContent = siteName
      const url = new URL(window.location.href)
      url.searchParams.set('siteId', id)
      window.history.pushState({}, '', url)

      // Load and display cached stats immediately
      const cached = loadCachedStats()
      if (cached) {
        stats = cached
        previousStats = null
        renderDashboard(false)
      }

      fetchDashboardData()
      if (refreshInterval) clearInterval(refreshInterval)
      refreshInterval = setInterval(fetchDashboardData, 30000)
    }

    function goBack() {
      if (refreshInterval) clearInterval(refreshInterval)
      siteId = ''
      currentSite = null
      document.getElementById('site-selector').style.display = 'flex'
      document.getElementById('dashboard').style.display = 'none'
      const url = new URL(window.location.href)
      url.searchParams.delete('siteId')
      window.history.pushState({}, '', url)
      fetchSites()
    }

    function setDateRange(range) {
      dateRange = range
      document.querySelectorAll('.date-btn').forEach(btn => btn.classList.remove('active'))
      document.querySelector(\`[data-range="\${range}"]\`).classList.add('active')
      fetchDashboardData()
    }

    function getDateRangeParams() {
      const now = new Date()
      const end = now.toISOString()
      let start
      switch(dateRange) {
        case '24h': start = new Date(now - 24*60*60*1000); break
        case '7d': start = new Date(now - 7*24*60*60*1000); break
        case '30d': start = new Date(now - 30*24*60*60*1000); break
        case '90d': start = new Date(now - 90*24*60*60*1000); break
        default: start = new Date(now - 30*24*60*60*1000)
      }
      return \`?startDate=\${start.toISOString()}&endDate=\${end}\`
    }

    async function fetchDashboardData() {
      if (isLoading) return
      isLoading = true
      document.getElementById('refresh-btn').classList.add('spinning')

      const baseUrl = \`\${API_ENDPOINT}/api/sites/\${siteId}\`
      const params = getDateRangeParams()

      try {
        const [statsRes, realtimeRes, pagesRes, referrersRes, devicesRes, browsersRes, countriesRes, timeseriesRes, eventsRes, campaignsRes, goalsRes] = await Promise.all([
          fetch(\`\${baseUrl}/stats\${params}\`).then(r => r.json()).catch(() => ({})),
          fetch(\`\${baseUrl}/realtime\`).then(r => r.json()).catch(() => ({ currentVisitors: 0 })),
          fetch(\`\${baseUrl}/pages\${params}\`).then(r => r.json()).catch(() => ({ pages: [] })),
          fetch(\`\${baseUrl}/referrers\${params}\`).then(r => r.json()).catch(() => ({ referrers: [] })),
          fetch(\`\${baseUrl}/devices\${params}\`).then(r => r.json()).catch(() => ({ deviceTypes: [] })),
          fetch(\`\${baseUrl}/browsers\${params}\`).then(r => r.json()).catch(() => ({ browsers: [] })),
          fetch(\`\${baseUrl}/countries\${params}\`).then(r => r.json()).catch(() => ({ countries: [] })),
          fetch(\`\${baseUrl}/timeseries\${params}\`).then(r => r.json()).catch(() => ({ timeSeries: [] })),
          fetch(\`\${baseUrl}/events\${params}\`).then(r => r.json()).catch(() => ({ events: [] })),
          fetch(\`\${baseUrl}/campaigns\${params}\`).then(r => r.json()).catch(() => ({ campaigns: [] })),
          fetch(\`\${baseUrl}/goals\${params}\`).then(r => r.json()).catch(() => ({ goals: [] })),
        ])

        previousStats = { ...stats }
        stats = {
          realtime: realtimeRes.currentVisitors || 0,
          sessions: statsRes.sessions || 0,
          people: statsRes.people || 0,
          views: statsRes.views || 0,
          avgTime: statsRes.avgTime || "00:00",
          bounceRate: statsRes.bounceRate || 0,
          events: statsRes.events || 0
        }
        saveCachedStats(stats)
        pages = pagesRes.pages || []
        siteHostname = pagesRes.hostname || null
        referrers = referrersRes.referrers || []
        deviceTypes = devicesRes.deviceTypes || []
        browsers = browsersRes.browsers || []
        countries = countriesRes.countries || []
        campaigns = campaignsRes.campaigns || []
        events = eventsRes.events || []
        goals = goalsRes.goals || []
        timeSeriesData = timeseriesRes.timeSeries || []
        lastUpdated = new Date()

        renderDashboard(true)
      } catch (error) {
        console.error('Failed to fetch:', error)
      } finally {
        isLoading = false
        document.getElementById('refresh-btn').classList.remove('spinning')
      }
    }

    function fmt(n) {
      if (n === undefined || n === null) return '0'
      return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n)
    }

    function hasAnyData() {
      return stats.views > 0 || stats.sessions > 0 || stats.people > 0 || pages.length > 0
    }

    function renderDashboard(animate = false) {
      const duration = 600 // Animation duration in ms

      // Update stats with animation
      if (animate && previousStats) {
        animateValue(document.getElementById('stat-realtime'), previousStats.realtime, stats.realtime, duration, fmt)
        animateValue(document.getElementById('stat-sessions'), previousStats.sessions, stats.sessions, duration, fmt)
        animateValue(document.getElementById('stat-people'), previousStats.people, stats.people, duration, fmt)
        animateValue(document.getElementById('stat-views'), previousStats.views, stats.views, duration, fmt)
        animateValue(document.getElementById('stat-bounce'), previousStats.bounceRate, stats.bounceRate, duration, v => v + '%')
        document.getElementById('stat-avgtime').textContent = stats.avgTime
      } else {
        document.getElementById('stat-realtime').textContent = fmt(stats.realtime)
        document.getElementById('stat-sessions').textContent = fmt(stats.sessions)
        document.getElementById('stat-people').textContent = fmt(stats.people)
        document.getElementById('stat-views').textContent = fmt(stats.views)
        document.getElementById('stat-bounce').textContent = stats.bounceRate + '%'
        document.getElementById('stat-avgtime').textContent = stats.avgTime
      }
      document.getElementById('realtime-count').textContent = stats.realtime === 1 ? '1 visitor online' : stats.realtime + ' visitors online'

      // Update last updated time
      if (lastUpdated) {
        document.getElementById('last-updated').textContent = 'Updated ' + lastUpdated.toLocaleTimeString()
      }

      // Show setup instructions if no data
      const noDataMsg = document.getElementById('no-data-msg')
      const mainContent = document.getElementById('main-content')

      if (!hasAnyData()) {
        noDataMsg.style.display = 'block'
        mainContent.style.display = 'none'
        document.getElementById('tracking-script').textContent = '<script src="' + API_ENDPOINT + '/sites/' + siteId + '/script" defer></' + 'script>'
        return
      }

      noDataMsg.style.display = 'none'
      mainContent.style.display = 'block'

      // Render tables
      document.getElementById('pages-body').innerHTML = pages.length
        ? pages.slice(0,10).map(p => {
            const pageUrl = siteHostname ? \`https://\${siteHostname}\${p.path}\` : p.path
            const linkHtml = siteHostname
              ? \`<a href="\${pageUrl}" target="_blank" rel="noopener" class="page-link" title="Visit \${pageUrl}">\${p.path}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:4px;opacity:0.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg></a>\`
              : p.path
            return \`<tr><td class="name" title="\${p.path}">\${linkHtml}</td><td class="value">\${fmt(p.entries||0)}</td><td class="value">\${fmt(p.visitors||0)}</td><td class="value">\${fmt(p.views||0)}</td></tr>\`
          }).join('')
        : '<tr><td colspan="4" class="empty-cell">No page data</td></tr>'

      document.getElementById('referrers-body').innerHTML = referrers.length
        ? referrers.slice(0,10).map(r => {
            const source = r.source || 'Direct'
            const sourceLower = source.toLowerCase()
            const isLink = sourceLower !== 'direct' && !source.includes('(') && source.includes('.')
            const domain = source.replace(/^https?:\\/\\//, '').split('/')[0]
            const favicon = isLink ? \`<img src="https://www.google.com/s2/favicons?domain=\${domain}&sz=16" width="14" height="14" style="vertical-align:middle;margin-right:6px;border-radius:2px" onerror="this.style.display='none'">\` : ''
            const linkHtml = isLink
              ? \`<a href="\${source.startsWith('http') ? source : 'https://' + source}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:4px">\${favicon}\${source}<svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="opacity:0.5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>\`
              : source
            return \`<tr><td class="name">\${linkHtml}</td><td class="value">\${fmt(r.visitors||0)}</td><td class="value">\${fmt(r.views||0)}</td></tr>\`
          }).join('')
        : '<tr><td colspan="3" class="empty-cell">No referrer data</td></tr>'

      document.getElementById('devices-body').innerHTML = deviceTypes.length
        ? deviceTypes.map(d => \`<tr><td class="name">\${getDeviceIcon(d.type)}\${d.type}</td><td class="value">\${fmt(d.visitors||0)}</td><td class="value">\${d.percentage || 0}%</td></tr>\`).join('')
        : '<tr><td colspan="3" class="empty-cell">No device data</td></tr>'

      document.getElementById('browsers-body').innerHTML = browsers.length
        ? browsers.slice(0,8).map(b => \`<tr><td class="name">\${getBrowserIcon(b.name)}\${b.name}</td><td class="value">\${fmt(b.visitors||0)}</td><td class="value">\${b.percentage || 0}%</td></tr>\`).join('')
        : '<tr><td colspan="3" class="empty-cell">No browser data</td></tr>'

      document.getElementById('countries-body').innerHTML = countries.length
        ? countries.slice(0,8).map(c => \`<tr><td class="name"><span style="margin-right:6px">\${getCountryFlag(c.name)}</span>\${c.name || c.code || 'Unknown'}</td><td class="value">\${fmt(c.visitors||0)}</td></tr>\`).join('')
        : '<tr><td colspan="2" class="empty-cell">No location data</td></tr>'

      document.getElementById('campaigns-body').innerHTML = campaigns.length
        ? campaigns.slice(0,8).map(c => \`<tr><td class="name">\${c.name || c.source || 'Unknown'}</td><td class="value">\${fmt(c.visitors||0)}</td><td class="value">\${fmt(c.views||0)}</td></tr>\`).join('')
        : '<tr><td colspan="3" class="empty-cell">No campaign data</td></tr>'

      document.getElementById('events-container').innerHTML = events.length
        ? \`<table class="data-table"><thead><tr><th>Event</th><th style="text-align:right">Count</th><th style="text-align:right">Unique</th></tr></thead><tbody>\${events.slice(0,10).map(e => \`<tr><td class="name">\${e.name}</td><td class="value">\${fmt(e.count||0)}</td><td class="value">\${fmt(e.unique||e.visitors||0)}</td></tr>\`).join('')}</tbody></table>\`
        : '<div class="empty-cell" style="padding:1rem">No custom events tracked</div>'

      renderChart()
      renderGoals()
    }

    function renderGoals() {
      const container = document.getElementById('goals-container')
      if (!container) return

      if (!goals.length) {
        container.innerHTML = '<div class="empty-cell" style="padding:1rem">No goals configured. Click "+ Add Goal" to create one.</div>'
        return
      }

      container.innerHTML = \`
        <table class="data-table">
          <thead><tr>
            <th>Goal</th>
            <th>Type</th>
            <th style="text-align:right">Conversions</th>
            <th style="text-align:right">Value</th>
            <th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>
            \${goals.map(g => \`
              <tr>
                <td class="name">\${g.name}</td>
                <td><span class="goal-type-badge \${g.type}">\${g.type}</span></td>
                <td class="value">\${fmt(g.conversions || 0)}</td>
                <td class="value">\${g.totalValue ? '$' + g.totalValue.toFixed(2) : '-'}</td>
                <td class="value">
                  <button onclick="editGoal('\${g.id}')" class="icon-btn" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button onclick="deleteGoal('\${g.id}')" class="icon-btn danger" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      \`
    }

    function showCreateGoalModal() {
      editingGoal = null
      document.getElementById('goal-modal-title').textContent = 'Create Goal'
      document.getElementById('goal-form').reset()
      document.getElementById('goal-modal').style.display = 'flex'
      updateGoalForm()
    }

    function editGoal(goalId) {
      const goal = goals.find(g => g.id === goalId)
      if (!goal) return

      editingGoal = goal
      document.getElementById('goal-modal-title').textContent = 'Edit Goal'
      document.getElementById('goal-name').value = goal.name || ''
      document.getElementById('goal-type').value = goal.type || 'pageview'
      document.getElementById('goal-pattern').value = goal.pattern || ''
      document.getElementById('goal-match-type').value = goal.matchType || 'exact'
      document.getElementById('goal-duration').value = goal.durationMinutes || 5
      document.getElementById('goal-value').value = goal.value || ''
      document.getElementById('goal-modal').style.display = 'flex'
      updateGoalForm()
    }

    function updateGoalForm() {
      const type = document.getElementById('goal-type').value
      document.getElementById('goal-pattern-group').style.display = type !== 'duration' ? 'block' : 'none'
      document.getElementById('goal-duration-group').style.display = type === 'duration' ? 'block' : 'none'
    }

    function closeGoalModal() {
      document.getElementById('goal-modal').style.display = 'none'
      editingGoal = null
    }

    async function saveGoal(e) {
      e.preventDefault()

      const type = document.getElementById('goal-type').value
      const data = {
        name: document.getElementById('goal-name').value,
        type,
        pattern: type !== 'duration' ? document.getElementById('goal-pattern').value : '',
        matchType: type !== 'duration' ? document.getElementById('goal-match-type').value : 'exact',
        durationMinutes: type === 'duration' ? Number(document.getElementById('goal-duration').value) : undefined,
        value: document.getElementById('goal-value').value ? Number(document.getElementById('goal-value').value) : undefined,
        isActive: true,
      }

      const url = editingGoal
        ? \`\${API_ENDPOINT}/api/sites/\${siteId}/goals/\${editingGoal.id}\`
        : \`\${API_ENDPOINT}/api/sites/\${siteId}/goals\`
      const method = editingGoal ? 'PUT' : 'POST'

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })
        if (res.ok) {
          closeGoalModal()
          fetchDashboardData()
        } else {
          const err = await res.json()
          alert(err.error || 'Failed to save goal')
        }
      } catch (err) {
        console.error('Save goal error:', err)
        alert('Failed to save goal')
      }
    }

    async function deleteGoal(goalId) {
      if (!confirm('Delete this goal? Conversion data will be preserved.')) return

      try {
        const res = await fetch(\`\${API_ENDPOINT}/api/sites/\${siteId}/goals/\${goalId}\`, { method: 'DELETE' })
        if (res.ok) {
          fetchDashboardData()
        }
      } catch (err) {
        console.error('Delete goal error:', err)
      }
    }

    function renderChart() {
      const canvas = document.getElementById('chart')
      const chartEmpty = document.getElementById('chart-empty')

      if (!canvas) return

      if (!timeSeriesData.length) {
        canvas.style.display = 'none'
        chartEmpty.style.display = 'flex'
        return
      }

      canvas.style.display = 'block'
      chartEmpty.style.display = 'none'

      const ctx = canvas.getContext('2d')
      const rect = canvas.parentElement.getBoundingClientRect()
      canvas.width = rect.width - 48
      canvas.height = 200
      const pad = { top: 20, right: 20, bottom: 30, left: 50 }
      const w = canvas.width - pad.left - pad.right
      const h = canvas.height - pad.top - pad.bottom
      const maxV = Math.max(...timeSeriesData.map(d => d.views || d.count || 0), 1)
      const xS = w / (timeSeriesData.length - 1 || 1)
      const yS = h / maxV

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Grid lines
      ctx.strokeStyle = '#374151'
      ctx.lineWidth = 1
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (h/4)*i
        ctx.beginPath()
        ctx.moveTo(pad.left, y)
        ctx.lineTo(pad.left+w, y)
        ctx.stroke()
      }

      // Line
      ctx.beginPath()
      ctx.strokeStyle = '#818cf8'
      ctx.lineWidth = 2
      timeSeriesData.forEach((d, i) => {
        const x = pad.left + i*xS
        const y = pad.top + h - (d.views || d.count || 0)*yS
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y)
      })
      ctx.stroke()

      // Fill
      ctx.beginPath()
      ctx.fillStyle = 'rgba(129,140,248,0.1)'
      timeSeriesData.forEach((d, i) => {
        const x = pad.left + i*xS
        const y = pad.top + h - (d.views || d.count || 0)*yS
        i===0 ? (ctx.moveTo(x,pad.top+h), ctx.lineTo(x,y)) : ctx.lineTo(x,y)
      })
      ctx.lineTo(pad.left + (timeSeriesData.length-1)*xS, pad.top+h)
      ctx.closePath()
      ctx.fill()

      // Y-axis labels
      ctx.fillStyle = '#6b7280'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'right'
      for (let i = 0; i <= 4; i++) {
        ctx.fillText(fmt(Math.round(maxV - (maxV/4)*i)), pad.left-10, pad.top+(h/4)*i+3)
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      if (siteId) {
        currentSite = { id: siteId }
        document.getElementById('site-selector').style.display = 'none'
        document.getElementById('dashboard').style.display = 'block'

        // Load and display cached stats immediately before fetching
        const cached = loadCachedStats()
        if (cached) {
          stats = cached
          previousStats = null
          renderDashboard(false)
        }

        fetchDashboardData()
        refreshInterval = setInterval(fetchDashboardData, 30000)
      } else {
        document.getElementById('site-selector').style.display = 'flex'
        document.getElementById('dashboard').style.display = 'none'
        fetchSites()
      }
    })

    window.addEventListener('resize', () => { if (timeSeriesData.length) renderChart() })
  </script>
  <style>
    :root { --bg: #0f1117; --bg2: #1a1d27; --bg3: #252836; --text: #f3f4f6; --text2: #9ca3af; --muted: #6b7280; --accent: #6366f1; --accent2: #818cf8; --success: #10b981; --border: #2d3139; --warning: #f59e0b }
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; min-height: 100vh }

    /* Site Selector */
    .site-selector { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem }
    .site-selector h1 { font-size: 1.5rem; margin-bottom: 0.5rem }
    .site-selector p { color: var(--text2); margin-bottom: 2rem }
    .site-list { width: 100%; max-width: 500px; display: flex; flex-direction: column; gap: 0.75rem }
    .site-card { display: flex; align-items: center; gap: 1rem; padding: 1rem; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; text-align: left; width: 100%; transition: all 0.15s; color: inherit }
    .site-card:hover { background: var(--bg3); border-color: var(--accent) }
    .site-icon { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--bg3); border-radius: 8px; color: var(--accent) }
    .site-info { flex: 1; display: flex; flex-direction: column; gap: 0.25rem }
    .site-info .site-name { font-weight: 500; color: var(--text) }
    .site-info .site-domain { font-size: 0.75rem; color: var(--muted); font-family: monospace }
    .site-card .arrow { color: var(--muted) }
    .site-card:hover .arrow { color: var(--accent) }
    .loading, .error, .empty { display: flex; flex-direction: column; align-items: center; padding: 3rem; color: var(--muted); gap: 1rem; text-align: center }
    .spinner { width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite }
    @keyframes spin { to { transform: rotate(360deg) } }
    .error button { background: var(--accent); color: white; border: none; padding: 0.5rem 1.5rem; border-radius: 6px; cursor: pointer }

    /* Dashboard */
    .dash { max-width: 1400px; margin: 0 auto; padding: 1rem }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; border-bottom: 1px solid var(--border); margin-bottom: 1rem; gap: 1rem; flex-wrap: wrap }
    .header-left { display: flex; align-items: center; gap: 1rem }
    .back-btn { background: none; border: none; color: var(--muted); cursor: pointer; padding: 0.5rem; border-radius: 6px; display: flex; align-items: center; justify-content: center }
    .back-btn:hover { background: var(--bg2); color: var(--text) }
    .site-name-header { font-size: 1.25rem; font-weight: 600 }
    .header-right { display: flex; align-items: center; gap: 1rem }
    .realtime-badge { display: flex; align-items: center; gap: 0.5rem; background: var(--bg2); padding: 0.5rem 1rem; border-radius: 9999px; font-size: 0.875rem }
    .pulse { width: 8px; height: 8px; background: var(--success); border-radius: 50%; animation: pulse 2s infinite }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }

    /* Controls */
    .controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; gap: 1rem; flex-wrap: wrap }
    .date-range { display: flex; gap: 0.25rem; background: var(--bg2); padding: 0.25rem; border-radius: 8px }
    .date-btn { background: none; border: none; color: var(--muted); padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; transition: all 0.15s }
    .date-btn:hover { color: var(--text) }
    .date-btn.active { background: var(--accent); color: white }
    .refresh-group { display: flex; align-items: center; gap: 0.75rem }
    .last-updated { font-size: 0.75rem; color: var(--muted) }
    .refresh-btn { background: var(--bg2); border: 1px solid var(--border); color: var(--text2); padding: 0.5rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s }
    .refresh-btn:hover { border-color: var(--accent); color: var(--text) }
    .refresh-btn.spinning svg { animation: spinReverse 1s linear infinite }
    @keyframes spinReverse { to { transform: rotate(-360deg) } }

    /* Stats */
    .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1rem; margin-bottom: 1.5rem }
    .stat { background: var(--bg2); padding: 1.25rem; border-radius: 8px; text-align: center; border: 1px solid var(--border) }
    .stat-val { font-size: 1.75rem; font-weight: 600; color: var(--text) }
    .stat-lbl { font-size: 0.75rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.25rem }
    .stat.highlight { border-color: var(--accent); background: linear-gradient(135deg, var(--bg2) 0%, rgba(99,102,241,0.1) 100%) }
    .stat-icon { color: var(--accent); margin-bottom: 0.5rem; display: block; margin-left: auto; margin-right: auto }
    .stat.highlight .stat-icon { color: var(--accent2) }

    /* Chart */
    .chart-box { background: var(--bg2); border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; min-height: 250px; border: 1px solid var(--border); position: relative }
    .chart-title { font-size: 0.875rem; font-weight: 500; margin-bottom: 1rem; color: var(--text2) }
    .chart-empty { display: none; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: var(--muted); text-align: center }

    /* Grid & Panels */
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem }
    .panel { background: var(--bg2); border-radius: 8px; padding: 1rem; border: 1px solid var(--border) }
    .panel-title { font-size: 0.875rem; font-weight: 500; margin-bottom: 1rem; color: var(--text2); display: flex; align-items: center; gap: 0.5rem }

    /* Tables */
    .data-table { width: 100%; font-size: 0.8125rem; border-collapse: collapse }
    .data-table th { text-align: left; color: var(--muted); font-weight: 500; padding: 0.5rem 0; border-bottom: 1px solid var(--border); font-size: 0.6875rem; text-transform: uppercase }
    .data-table td { padding: 0.625rem 0; border-bottom: 1px solid var(--bg3) }
    .data-table tr:last-child td { border-bottom: none }
    .data-table .name { color: var(--text); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
    .data-table .value { color: var(--text2); text-align: right; white-space: nowrap }
    .empty-cell { text-align: center; color: var(--muted); padding: 1rem }
    .page-link { color: var(--text); text-decoration: none; display: inline-flex; align-items: center }
    .page-link:hover { color: var(--accent); text-decoration: underline }

    /* Events */
    .events { background: var(--bg2); border-radius: 8px; padding: 1.5rem; border: 1px solid var(--border) }

    /* Goals */
    .goals-section { background: var(--bg2); border-radius: 8px; padding: 1.5rem; border: 1px solid var(--border); margin-top: 1.5rem }
    .create-goal-btn { background: var(--accent); color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 500 }
    .create-goal-btn:hover { background: var(--accent2) }
    .icon-btn { background: none; border: none; color: var(--muted); cursor: pointer; padding: 0.25rem; border-radius: 4px; margin-left: 0.25rem }
    .icon-btn:hover { background: var(--bg3); color: var(--text) }
    .icon-btn.danger:hover { color: #ef4444 }
    .goal-type-badge { font-size: 0.7rem; padding: 0.2rem 0.5rem; border-radius: 4px; text-transform: uppercase; font-weight: 500 }
    .goal-type-badge.pageview { background: rgba(99,102,241,0.2); color: var(--accent) }
    .goal-type-badge.event { background: rgba(16,185,129,0.2); color: #10b981 }
    .goal-type-badge.duration { background: rgba(245,158,11,0.2); color: #f59e0b }

    /* Modal */
    .modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000 }
    .modal-content { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; max-width: 420px; width: 90% }
    .modal-content h3 { margin-bottom: 1.5rem; font-size: 1.125rem; color: var(--text) }
    .modal-content label { display: block; margin-bottom: 1rem; font-size: 0.8125rem; color: var(--text2) }
    .modal-content input, .modal-content select { width: 100%; padding: 0.625rem; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); margin-top: 0.375rem; font-size: 0.875rem }
    .modal-content input:focus, .modal-content select:focus { outline: none; border-color: var(--accent) }
    .modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border) }
    .modal-actions button { padding: 0.625rem 1.25rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; font-weight: 500 }
    .modal-actions button[type="button"] { background: var(--bg3); border: 1px solid var(--border); color: var(--text) }
    .modal-actions button[type="button"]:hover { background: var(--bg) }
    .modal-actions button[type="submit"] { background: var(--accent); border: none; color: white }
    .modal-actions button[type="submit"]:hover { background: var(--accent2) }

    /* No Data Message */
    .no-data { background: var(--bg2); border-radius: 8px; padding: 3rem; text-align: center; border: 1px solid var(--border); margin-bottom: 1.5rem }
    .no-data h3 { margin-bottom: 0.5rem; color: var(--warning) }
    .no-data p { color: var(--text2); margin-bottom: 1rem }
    .no-data code { display: block; background: var(--bg); padding: 1rem; border-radius: 6px; font-size: 0.75rem; margin-top: 1rem; color: var(--accent2); word-break: break-all; text-align: left }
    .no-data .step { display: flex; align-items: flex-start; gap: 1rem; text-align: left; margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border) }
    .no-data .step-num { background: var(--accent); color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; flex-shrink: 0 }
    .no-data .step-content { flex: 1 }
    .no-data .step-content h4 { font-size: 0.875rem; margin-bottom: 0.25rem }
    .no-data .step-content p { font-size: 0.8125rem; color: var(--muted); margin: 0 }

    /* Responsive */
    @media (max-width: 1024px) { .stats { grid-template-columns: repeat(3, 1fr) } .grid { grid-template-columns: 1fr } }
    @media (max-width: 640px) { .stats { grid-template-columns: repeat(2, 1fr) } .header { flex-direction: column; align-items: flex-start } .header-right { width: 100%; justify-content: space-between } .controls { flex-direction: column; align-items: stretch } .date-range { justify-content: center } }
  </style>
</head>
<body>
  <div id="site-selector" class="site-selector" style="display:none">
    <h1>Analytics Dashboard</h1>
    <p>Select a site to view analytics</p>
    <div id="site-list" class="site-list"></div>
  </div>

  <div id="dashboard" class="dash" style="display:none">
    <header class="header">
      <div class="header-left">
        <button class="back-btn" onclick="goBack()" title="Back to sites">
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
        </button>
        <span id="current-site-name" class="site-name-header">Analytics Dashboard</span>
      </div>
      <div class="header-right">
        <div class="realtime-badge"><span class="pulse"></span><span id="realtime-count">0 visitors online</span></div>
      </div>
    </header>

    <div class="controls">
      <div class="date-range">
        <button class="date-btn" data-range="24h" onclick="setDateRange('24h')">24h</button>
        <button class="date-btn" data-range="7d" onclick="setDateRange('7d')">7 days</button>
        <button class="date-btn active" data-range="30d" onclick="setDateRange('30d')">30 days</button>
        <button class="date-btn" data-range="90d" onclick="setDateRange('90d')">90 days</button>
      </div>
      <div class="refresh-group">
        <span id="last-updated" class="last-updated"></span>
        <button id="refresh-btn" class="refresh-btn" onclick="fetchDashboardData()" title="Refresh data">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
        </button>
      </div>
    </div>

    <div class="stats">
      <div class="stat highlight"><svg class="stat-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg><div class="stat-val" id="stat-realtime">—</div><div class="stat-lbl">Realtime</div></div>
      <div class="stat"><svg class="stat-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><div class="stat-val" id="stat-sessions">—</div><div class="stat-lbl">Sessions</div></div>
      <div class="stat"><svg class="stat-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg><div class="stat-val" id="stat-people">—</div><div class="stat-lbl">Visitors</div></div>
      <div class="stat"><svg class="stat-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg><div class="stat-val" id="stat-views">—</div><div class="stat-lbl">Pageviews</div></div>
      <div class="stat"><svg class="stat-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><div class="stat-val" id="stat-avgtime">—</div><div class="stat-lbl">Avg Time</div></div>
      <div class="stat"><svg class="stat-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"/></svg><div class="stat-val" id="stat-bounce">—</div><div class="stat-lbl">Bounce Rate</div></div>
    </div>
    <script>
      // Immediately populate from cache before any other JS runs
      (function() {
        try {
          var urlParams = new URLSearchParams(window.location.search);
          var siteId = urlParams.get('siteId') || window.ANALYTICS_SITE_ID || '';
          if (!siteId) return;
          var cached = localStorage.getItem('ts-analytics-stats-' + siteId);
          if (!cached) return;
          var data = JSON.parse(cached);
          if (!data.timestamp || Date.now() - data.timestamp > 24 * 60 * 60 * 1000) return;
          var s = data.stats;
          var fmt = function(n) { return n >= 1000 ? (n/1000).toFixed(1) + 'k' : String(n); };
          if (s.realtime !== undefined) document.getElementById('stat-realtime').textContent = fmt(s.realtime);
          if (s.sessions !== undefined) document.getElementById('stat-sessions').textContent = fmt(s.sessions);
          if (s.people !== undefined) document.getElementById('stat-people').textContent = fmt(s.people);
          if (s.views !== undefined) document.getElementById('stat-views').textContent = fmt(s.views);
          if (s.avgTime !== undefined) document.getElementById('stat-avgtime').textContent = s.avgTime;
          if (s.bounceRate !== undefined) document.getElementById('stat-bounce').textContent = s.bounceRate + '%';
        } catch(e) {}
      })();
    </script>

    <div id="no-data-msg" class="no-data" style="display:none">
      <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:var(--warning);margin-bottom:1rem"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
      <h3>No analytics data yet</h3>
      <p>Add the tracking script to your website to start collecting data.</p>
      <code id="tracking-script"></code>
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <h4>Copy the script tag</h4>
          <p>Copy the code above and paste it in your HTML</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <h4>Add to your pages</h4>
          <p>Place it in the &lt;head&gt; section of your website</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <h4>View your analytics</h4>
          <p>Data will appear here within a few seconds of your first visit</p>
        </div>
      </div>
    </div>

    <div id="main-content">
      <div class="chart-box">
        <div class="chart-title">Pageviews Over Time</div>
        <canvas id="chart"></canvas>
        <div id="chart-empty" class="chart-empty">
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="opacity:0.5;margin-bottom:0.5rem"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          <p>No time series data available</p>
        </div>
      </div>

      <div class="grid">
        <div class="panel">
          <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>Top Pages</div>
          <table class="data-table">
            <thead><tr><th>Path</th><th style="text-align:right">Entries</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th></tr></thead>
            <tbody id="pages-body"><tr><td colspan="4" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
        <div class="panel">
          <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>Top Referrers</div>
          <table class="data-table">
            <thead><tr><th>Source</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th></tr></thead>
            <tbody id="referrers-body"><tr><td colspan="3" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="grid">
        <div class="panel">
          <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>Devices</div>
          <table class="data-table">
            <thead><tr><th>Type</th><th style="text-align:right">Visitors</th><th style="text-align:right">%</th></tr></thead>
            <tbody id="devices-body"><tr><td colspan="3" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
        <div class="panel">
          <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>Browsers</div>
          <table class="data-table">
            <thead><tr><th>Browser</th><th style="text-align:right">Visitors</th><th style="text-align:right">%</th></tr></thead>
            <tbody id="browsers-body"><tr><td colspan="3" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="grid">
        <div class="panel">
          <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Countries</div>
          <table class="data-table">
            <thead><tr><th>Country</th><th style="text-align:right">Visitors</th></tr></thead>
            <tbody id="countries-body"><tr><td colspan="2" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
        <div class="panel">
          <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg>Campaigns</div>
          <table class="data-table">
            <thead><tr><th>Campaign</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th></tr></thead>
            <tbody id="campaigns-body"><tr><td colspan="3" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="events">
        <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>Custom Events</div>
        <div id="events-container"><div class="empty-cell">Loading...</div></div>
      </div>

      <div class="goals-section">
        <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center">
          <span><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Goals</span>
          <button onclick="showCreateGoalModal()" class="create-goal-btn">+ Add Goal</button>
        </div>
        <div id="goals-container"><div class="empty-cell">Loading...</div></div>
      </div>
    </div>

    <!-- Goal Modal -->
    <div id="goal-modal" class="modal" style="display:none">
      <div class="modal-content">
        <h3 id="goal-modal-title">Create Goal</h3>
        <form id="goal-form" onsubmit="saveGoal(event)">
          <label>Name<input type="text" id="goal-name" required placeholder="e.g. Sign Up Completed"></label>
          <label>Type
            <select id="goal-type" onchange="updateGoalForm()">
              <option value="pageview">Destination (Page Path)</option>
              <option value="event">Event</option>
              <option value="duration">Duration (Time on Site)</option>
            </select>
          </label>
          <div id="goal-pattern-group">
            <label>Pattern<input type="text" id="goal-pattern" placeholder="/thank-you or /checkout/*"></label>
            <label>Match Type
              <select id="goal-match-type">
                <option value="exact">Exact Match</option>
                <option value="contains">Contains</option>
                <option value="regex">Regular Expression</option>
              </select>
            </label>
          </div>
          <div id="goal-duration-group" style="display:none">
            <label>Minutes on Site<input type="number" id="goal-duration" min="1" value="5"></label>
          </div>
          <label>Value per Conversion (optional)<input type="number" id="goal-value" step="0.01" placeholder="0.00"></label>
          <div class="modal-actions">
            <button type="button" onclick="closeGoalModal()">Cancel</button>
            <button type="submit">Save Goal</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</body>
</html>`
}

// Route handlers
async function handleCollect(event: LambdaEvent) {
  try {
    const payload = JSON.parse(event.body || '{}')

    if (!payload?.s || !payload?.e || !payload?.u) {
      return response({ error: 'Missing required fields: s, e, u' }, 400)
    }

    // Support both v1 and v2 formats for source IP
    const ip = event.requestContext?.http?.sourceIp || event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
    const userAgent = event.requestContext?.http?.userAgent || event.headers?.['user-agent'] || 'unknown'
    console.log(`[Collect] IP: ${ip}, UA: ${userAgent?.substring(0, 50)}...`)
    const salt = getDailySalt()
    const visitorId = await hashVisitorId(ip, userAgent, payload.s, salt)

    let parsedUrl: URL
    try {
      parsedUrl = new URL(payload.u)
    }
    catch {
      return response({ error: 'Invalid URL' }, 400)
    }

    const timestamp = new Date()
    const sessionId = payload.sid

    const sessionKey = `${payload.s}:${sessionId}`
    let session = getSession(sessionKey)

    // If not in memory cache, try to load from DynamoDB
    if (!session) {
      try {
        const sessionResult = await dynamodb.getItem({
          TableName: TABLE_NAME,
          Key: {
            pk: { S: `SITE#${payload.s}` },
            sk: { S: `SESSION#${sessionId}` },
          },
        })
        if (sessionResult.Item) {
          session = unmarshall(sessionResult.Item) as SessionType
          // Ensure startedAt is a Date
          if (typeof session.startedAt === 'string') {
            session.startedAt = new Date(session.startedAt)
          }
          setSession(sessionKey, session)
        }
      } catch (e) {
        console.log('[Collect] Failed to load session from DB:', e)
      }
    }

    const isNewSession = !session

    if (payload.e === 'pageview') {
      const deviceInfo = parseUserAgent(userAgent)
      const referrerSource = parseReferrerSource(payload.r)

      // Get country from headers (CloudFront/Cloudflare) or fallback to IP geolocation
      let country = getCountryFromHeaders(event.headers)
      console.log(`[Collect] Country from headers: ${country || 'none'}`)
      if (!country) {
        country = await getCountryFromIP(ip)
        console.log(`[Collect] Country from IP (${ip}): ${country || 'unknown'}`)
      }

      // Record page view using Eloquent model
      await PageViewModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        path: parsedUrl.pathname,
        hostname: parsedUrl.hostname,
        title: payload.t,
        referrer: payload.r,
        referrerSource,
        utmSource: parsedUrl.searchParams.get('utm_source') || undefined,
        utmMedium: parsedUrl.searchParams.get('utm_medium') || undefined,
        utmCampaign: parsedUrl.searchParams.get('utm_campaign') || undefined,
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        country,
        screenWidth: payload.sw,
        screenHeight: payload.sh,
        isUnique: isNewSession,
        isBounce: isNewSession,
        timestamp,
      })

      if (session) {
        session.pageViewCount += 1
        session.exitPath = parsedUrl.pathname
        session.endedAt = timestamp
        session.isBounce = false
        // Ensure startedAt is a Date object for duration calculation
        const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt)
        session.duration = timestamp.getTime() - startedAt.getTime()
      }
      else {
        session = {
          id: sessionId,
          siteId: payload.s,
          visitorId,
          entryPath: parsedUrl.pathname,
          exitPath: parsedUrl.pathname,
          referrer: payload.r,
          referrerSource,
          utmSource: parsedUrl.searchParams.get('utm_source') || undefined,
          utmMedium: parsedUrl.searchParams.get('utm_medium') || undefined,
          utmCampaign: parsedUrl.searchParams.get('utm_campaign') || undefined,
          deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          country,
          pageViewCount: 1,
          eventCount: 0,
          isBounce: true,
          duration: 0,
          startedAt: timestamp,
          endedAt: timestamp,
        }
      }

      // Upsert session using ORM
      await SessionModel.upsert(session)
      setSession(sessionKey, session)

      // Check for destination (pageview) goal conversions
      await checkAndRecordConversions(
        payload.s,
        visitorId,
        sessionId,
        { path: parsedUrl.pathname },
        {
          referrerSource,
          utmSource: parsedUrl.searchParams.get('utm_source') || undefined,
          utmMedium: parsedUrl.searchParams.get('utm_medium') || undefined,
          utmCampaign: parsedUrl.searchParams.get('utm_campaign') || undefined,
        }
      )
    }
    else if (payload.e === 'event') {
      // Handle custom events (e.g., button clicks, form submissions)
      const props = payload.p || {}
      const eventName = props.name || 'unnamed'
      const eventValue = typeof props.value === 'number' ? props.value : undefined

      // Record custom event using Eloquent model
      await CustomEventModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        name: eventName,
        value: eventValue,
        path: parsedUrl.pathname,
        timestamp,
      })

      // Update session event count
      if (session) {
        session.eventCount += 1
        session.endedAt = timestamp
        // Ensure startedAt is a Date object for duration calculation
        const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt)
        session.duration = timestamp.getTime() - startedAt.getTime()

        await SessionModel.upsert(session)
        setSession(sessionKey, session)
      }

      // Check for event goal conversions
      await checkAndRecordConversions(
        payload.s,
        visitorId,
        sessionId,
        { path: parsedUrl.pathname, eventName },
        {
          referrerSource: session?.referrerSource,
          utmSource: session?.utmSource,
          utmMedium: session?.utmMedium,
          utmCampaign: session?.utmCampaign,
        }
      )
    }
    else if (payload.e === 'outbound') {
      // Handle outbound link clicks
      const props = payload.p || {}

      // Record outbound event using Eloquent model
      await CustomEventModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        name: 'outbound',
        properties: { url: props.url || '' },
        path: parsedUrl.pathname,
        timestamp,
      })

      // Update session event count
      if (session) {
        session.eventCount += 1
        session.endedAt = timestamp
        // Ensure startedAt is a Date object for duration calculation
        const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt)
        session.duration = timestamp.getTime() - startedAt.getTime()

        await SessionModel.upsert(session)
        setSession(sessionKey, session)
      }
    }
    else if (payload.e === 'hm_click') {
      // Handle heatmap click event
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      await HeatmapClick.record({
        id: generateId(),
        siteId: payload.s,
        sessionId,
        visitorId,
        path: payload.u,
        viewportX: props.vx || 0,
        viewportY: props.vy || 0,
        documentX: props.dx || 0,
        documentY: props.dy || 0,
        viewportWidth: props.vw || 0,
        viewportHeight: props.vh || 0,
        selector: props.selector || '',
        elementTag: props.tag || '',
        elementText: props.text,
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        timestamp,
      })
    }
    else if (payload.e === 'hm_move') {
      // Handle heatmap movement batch event
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      if (props.points && Array.isArray(props.points) && props.points.length > 0) {
        await HeatmapMovement.record({
          id: generateId(),
          siteId: payload.s,
          sessionId,
          visitorId,
          path: payload.u,
          points: props.points,
          viewportWidth: props.vw || 0,
          viewportHeight: props.vh || 0,
          deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
          timestamp,
        })
      }
    }
    else if (payload.e === 'hm_scroll') {
      // Handle heatmap scroll data event
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      await HeatmapScroll.upsert({
        id: `${sessionId}-${encodeURIComponent(payload.u)}`,
        siteId: payload.s,
        sessionId,
        visitorId,
        path: payload.u,
        maxScrollDepth: props.maxDepth || 0,
        scrollDepths: props.depths || {},
        documentHeight: props.docHeight || 0,
        viewportHeight: props.vh || 0,
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        timestamp,
      })
    }

    return response(null, 204)
  }
  catch (error) {
    console.error('Collect error:', error)
    return response({ error: 'Internal server error' }, 500)
  }
}

async function handleHealth() {
  return response({ status: 'ok', timestamp: new Date().toISOString() })
}

async function handleDashboard() {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
    body: getDashboardHtml(),
  }
}

async function handleScript(event: LambdaEvent) {
  // Extract siteId from path (v2 format: /sites/{siteId}/script)
  const path = event.rawPath || event.path || ''
  const pathMatch = path.match(/\/sites\/([^/]+)\/script/)
  const siteId = event.pathParameters?.siteId || (pathMatch ? pathMatch[1] : null)
  const apiEndpoint = event.queryStringParameters?.api || `https://${event.requestContext?.domainName}`
  const minimal = event.queryStringParameters?.minimal === 'true'

  if (!siteId) {
    return response({ error: 'Missing siteId' }, 400)
  }

  const script = minimal
    ? generateMinimalTrackingScript({ siteId, apiEndpoint, honorDnt: true })
    : generateTrackingScript({ siteId, apiEndpoint, honorDnt: true, trackOutboundLinks: true })

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
    body: script,
  }
}

// ============================================================================
// Dashboard Query Handlers
// ============================================================================

async function handleGetStats(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const startDateStr = startDate.toISOString().slice(0, 10)
    const endDateStr = endDate.toISOString().slice(0, 10)

    // Query pageviews for the date range
    const pageviewsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${startDate.toISOString()}` },
        ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
      },
    }) as { Items?: any[]; Count?: number }

    // Query sessions for the date range
    const sessionsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[]; Count?: number }

    // Query realtime visitors (last 2 minutes)
    const realtimeCutoff = new Date(Date.now() - 2 * 60 * 1000)
    const realtimeResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${realtimeCutoff.toISOString()}` },
        ':end': { S: 'PAGEVIEW#Z' }, // Ensure we only match PAGEVIEW# prefix
      },
    }) as { Items?: any[] }
    const realtimePageviews = (realtimeResult.Items || []).map(unmarshall)
    const realtimeVisitors = new Set(realtimePageviews.map(pv => pv.visitorId)).size

    const pageviews = pageviewsResult.Items || []
    const sessions = (sessionsResult.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Calculate stats
    const uniqueVisitors = new Set(pageviews.map((pv: any) => pv.visitorId?.S)).size
    const totalViews = pageviews.length
    const totalSessions = sessions.length
    const bounces = sessions.filter(s => s.isBounce).length
    const bounceRate = totalSessions > 0 ? Math.round((bounces / totalSessions) * 100) : 0
    const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0)
    const avgDuration = totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0
    const totalEvents = sessions.reduce((sum, s) => sum + (s.eventCount || 0), 0)

    return response({
      realtime: realtimeVisitors,
      people: uniqueVisitors,
      views: totalViews,
      avgTime: formatDuration(avgDuration),
      avgTimeMs: avgDuration,
      bounceRate,
      events: totalEvents,
      sessions: totalSessions,
      dateRange: { start: startDateStr, end: endDateStr },
    })
  } catch (error) {
    console.error('Stats error:', error)
    return response({ error: 'Failed to fetch stats' }, 500)
  }
}

async function handleGetRealtime(siteId: string, event: LambdaEvent) {
  try {
    const minutes = Number(event.queryStringParameters?.minutes) || 2
    const cutoff = new Date(Date.now() - minutes * 60 * 1000)

    // Query recent pageviews
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${cutoff.toISOString()}` },
        ':end': { S: 'PAGEVIEW#Z' }, // Ensure we only match PAGEVIEW# prefix
      },
    }) as { Items?: any[] }

    const pageviews = (result.Items || []).map(unmarshall)
    const uniqueVisitors = new Set(pageviews.map(pv => pv.visitorId)).size

    // Get active pages
    const pageCounts: Record<string, number> = {}
    for (const pv of pageviews) {
      pageCounts[pv.path] = (pageCounts[pv.path] || 0) + 1
    }

    const topActivePages = Object.entries(pageCounts)
      .map(([path, count]) => ({ name: path, value: count, percentage: 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)

    const total = topActivePages.reduce((sum, p) => sum + p.value, 0)
    topActivePages.forEach(p => {
      p.percentage = total > 0 ? Math.round((p.value / total) * 100) : 0
    })

    return response({
      currentVisitors: uniqueVisitors,
      pageViewsLastHour: pageviews.length,
      topActivePages,
    })
  } catch (error) {
    console.error('Realtime error:', error)
    return response({ error: 'Failed to fetch realtime data' }, 500)
  }
}

async function handleGetPages(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query pageviews
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${startDate.toISOString()}` },
        ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const pageviews = (result.Items || []).map(unmarshall)

    // Get the hostname from the first pageview (all should be same site)
    const siteHostname = pageviews.length > 0 ? pageviews[0].hostname : null

    // Aggregate by path
    const pageStats: Record<string, { views: number; visitors: Set<string>; entries: number }> = {}
    for (const pv of pageviews) {
      if (!pageStats[pv.path]) {
        pageStats[pv.path] = { views: 0, visitors: new Set(), entries: 0 }
      }
      pageStats[pv.path].views++
      pageStats[pv.path].visitors.add(pv.visitorId)
      if (pv.isUnique) pageStats[pv.path].entries++
    }

    const pages = Object.entries(pageStats)
      .map(([path, stats]) => ({
        path,
        views: stats.views,
        visitors: stats.visitors.size,
        entries: stats.entries,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, limit)

    return response({ pages, hostname: siteHostname })
  } catch (error) {
    console.error('Pages error:', error)
    return response({ error: 'Failed to fetch pages' }, 500)
  }
}

async function handleGetReferrers(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Aggregate by referrer source
    const referrerStats: Record<string, { visitors: Set<string>; views: number }> = {}
    for (const s of sessions) {
      const source = s.referrerSource || 'direct'
      if (!referrerStats[source]) {
        referrerStats[source] = { visitors: new Set(), views: 0 }
      }
      referrerStats[source].visitors.add(s.visitorId)
      referrerStats[source].views += s.pageViewCount || 1
    }

    const referrers = Object.entries(referrerStats)
      .map(([source, stats]) => ({
        source,
        visitors: stats.visitors.size,
        views: stats.views,
      }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ referrers })
  } catch (error) {
    console.error('Referrers error:', error)
    return response({ error: 'Failed to fetch referrers' }, 500)
  }
}

async function handleGetDevices(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Aggregate by device type
    const deviceStats: Record<string, Set<string>> = {}
    const osStats: Record<string, Set<string>> = {}

    for (const s of sessions) {
      const device = s.deviceType || 'unknown'
      const os = s.os || 'Unknown'

      if (!deviceStats[device]) deviceStats[device] = new Set()
      deviceStats[device].add(s.visitorId)

      if (!osStats[os]) osStats[os] = new Set()
      osStats[os].add(s.visitorId)
    }

    const totalVisitors = sessions.length > 0 ? new Set(sessions.map(s => s.visitorId)).size : 0

    const deviceTypes = Object.entries(deviceStats)
      .map(([type, visitors]) => ({
        type: type.charAt(0).toUpperCase() + type.slice(1),
        visitors: visitors.size,
        percentage: totalVisitors > 0 ? Math.round((visitors.size / totalVisitors) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors)

    const operatingSystems = Object.entries(osStats)
      .map(([name, visitors]) => ({
        name,
        visitors: visitors.size,
        percentage: totalVisitors > 0 ? Math.round((visitors.size / totalVisitors) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors)

    return response({ deviceTypes, operatingSystems })
  } catch (error) {
    console.error('Devices error:', error)
    return response({ error: 'Failed to fetch devices' }, 500)
  }
}

async function handleGetBrowsers(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Aggregate by browser
    const browserStats: Record<string, Set<string>> = {}
    for (const s of sessions) {
      const browser = s.browser || 'Unknown'
      if (!browserStats[browser]) browserStats[browser] = new Set()
      browserStats[browser].add(s.visitorId)
    }

    const totalVisitors = sessions.length > 0 ? new Set(sessions.map(s => s.visitorId)).size : 0

    const browsers = Object.entries(browserStats)
      .map(([name, visitors]) => ({
        name,
        visitors: visitors.size,
        percentage: totalVisitors > 0 ? Math.round((visitors.size / totalVisitors) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ browsers })
  } catch (error) {
    console.error('Browsers error:', error)
    return response({ error: 'Failed to fetch browsers' }, 500)
  }
}

async function handleGetCountries(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Aggregate by country (note: country tracking requires geolocation which may not be enabled)
    const countryStats: Record<string, Set<string>> = {}
    for (const s of sessions) {
      const country = s.country || 'Unknown'
      if (!countryStats[country]) countryStats[country] = new Set()
      countryStats[country].add(s.visitorId)
    }

    const countries = Object.entries(countryStats)
      .map(([name, visitors]) => ({ name, code: '', flag: '', visitors: visitors.size }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ countries })
  } catch (error) {
    console.error('Countries error:', error)
    return response({ error: 'Failed to fetch countries' }, 500)
  }
}

async function handleGetTimeSeries(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const period = event.queryStringParameters?.period || 'day'

    // Query pageviews
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${startDate.toISOString()}` },
        ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const pageviews = (result.Items || []).map(unmarshall)

    // Group by period
    const buckets: Record<string, { views: number; visitors: Set<string>; sessions: Set<string> }> = {}

    for (const pv of pageviews) {
      const date = new Date(pv.timestamp)
      let key: string

      if (period === 'hour') {
        key = `${date.toISOString().slice(0, 13)}:00:00`
      } else if (period === 'month') {
        key = date.toISOString().slice(0, 7)
      } else {
        key = date.toISOString().slice(0, 10)
      }

      if (!buckets[key]) {
        buckets[key] = { views: 0, visitors: new Set(), sessions: new Set() }
      }
      buckets[key].views++
      buckets[key].visitors.add(pv.visitorId)
      buckets[key].sessions.add(pv.sessionId)
    }

    const timeSeries = Object.entries(buckets)
      .map(([date, stats]) => ({
        date,
        views: stats.views,
        visitors: stats.visitors.size,
        sessions: stats.sessions.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return response({ timeSeries })
  } catch (error) {
    console.error('TimeSeries error:', error)
    return response({ error: 'Failed to fetch time series' }, 500)
  }
}

async function handleGetEvents(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query events
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `EVENT#${startDate.toISOString()}` },
        ':end': { S: `EVENT#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const events = (result.Items || []).map(unmarshall)

    // Aggregate by event name
    const eventStats: Record<string, { count: number; visitors: Set<string>; totalValue: number }> = {}
    for (const e of events) {
      const name = e.name || 'unnamed'
      if (!eventStats[name]) {
        eventStats[name] = { count: 0, visitors: new Set(), totalValue: 0 }
      }
      eventStats[name].count++
      eventStats[name].visitors.add(e.visitorId)
      if (e.value) eventStats[name].totalValue += e.value
    }

    const eventList = Object.entries(eventStats)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        unique: stats.visitors.size,
        totalValue: stats.totalValue,
        avgValue: stats.count > 0 ? stats.totalValue / stats.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    return response({ events: eventList })
  } catch (error) {
    console.error('Events error:', error)
    return response({ error: 'Failed to fetch events' }, 500)
  }
}

async function handleGetCampaigns(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && s.utmCampaign
    })

    // Aggregate by UTM campaign
    const campaignStats: Record<string, { visitors: Set<string>; views: number }> = {}
    const sourceStats: Record<string, { visitors: Set<string>; views: number }> = {}
    const mediumStats: Record<string, { visitors: Set<string>; views: number }> = {}

    for (const s of sessions) {
      if (s.utmCampaign) {
        if (!campaignStats[s.utmCampaign]) campaignStats[s.utmCampaign] = { visitors: new Set(), views: 0 }
        campaignStats[s.utmCampaign].visitors.add(s.visitorId)
        campaignStats[s.utmCampaign].views += s.pageViewCount || 1
      }
      if (s.utmSource) {
        if (!sourceStats[s.utmSource]) sourceStats[s.utmSource] = { visitors: new Set(), views: 0 }
        sourceStats[s.utmSource].visitors.add(s.visitorId)
        sourceStats[s.utmSource].views += s.pageViewCount || 1
      }
      if (s.utmMedium) {
        if (!mediumStats[s.utmMedium]) mediumStats[s.utmMedium] = { visitors: new Set(), views: 0 }
        mediumStats[s.utmMedium].visitors.add(s.visitorId)
        mediumStats[s.utmMedium].views += s.pageViewCount || 1
      }
    }

    const campaigns = Object.entries(campaignStats)
      .map(([name, stats]) => ({ name, visitors: stats.visitors.size, views: stats.views }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    const sources = Object.entries(sourceStats)
      .map(([name, stats]) => ({ name, visitors: stats.visitors.size, views: stats.views }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    const mediums = Object.entries(mediumStats)
      .map(([name, stats]) => ({ name, visitors: stats.visitors.size, views: stats.views }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ campaigns, sources, mediums })
  } catch (error) {
    console.error('Campaigns error:', error)
    return response({ error: 'Failed to fetch campaigns' }, 500)
  }
}

// ============================================================================
// Goal CRUD Handlers
// ============================================================================

async function handleCreateGoal(siteId: string, event: LambdaEvent) {
  try {
    const body = JSON.parse(event.body || '{}')

    if (!body.name || !body.type) {
      return response({ error: 'Missing required fields: name, type' }, 400)
    }

    // Validate type
    if (!['pageview', 'event', 'duration'].includes(body.type)) {
      return response({ error: 'Invalid type. Must be: pageview, event, or duration' }, 400)
    }

    // For pageview/event goals, pattern is required
    if ((body.type === 'pageview' || body.type === 'event') && !body.pattern) {
      return response({ error: 'Pattern is required for pageview and event goals' }, 400)
    }

    // For duration goals, durationMinutes is required
    if (body.type === 'duration' && (!body.durationMinutes || body.durationMinutes < 1)) {
      return response({ error: 'durationMinutes is required for duration goals (min: 1)' }, 400)
    }

    const goal = await Goal.create({
      id: generateId(),
      siteId,
      name: body.name,
      type: body.type,
      pattern: body.pattern || '',
      matchType: body.matchType || 'exact',
      durationMinutes: body.durationMinutes,
      value: body.value,
      isActive: body.isActive ?? true,
    })

    invalidateGoalCache(siteId)
    return response({ goal }, 201)
  } catch (error) {
    console.error('Create goal error:', error)
    return response({ error: 'Failed to create goal' }, 500)
  }
}

async function handleGetGoals(siteId: string, event: LambdaEvent) {
  try {
    const includeInactive = event.queryStringParameters?.includeInactive === 'true'
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)

    // Query goals using ORM
    const queryBuilder = Goal.forSite(siteId)
    if (!includeInactive) {
      queryBuilder.active()
    }
    const goals = await queryBuilder.get()

    // Get conversion counts for each goal using ORM
    const goalsWithStats = await Promise.all(goals.map(async (goal) => {
      let conversions: Conversion[] = []
      try {
        conversions = await Conversion.forGoal(siteId, goal.id)
          .since(startDate)
          .until(endDate)
          .get()
      } catch (e) {
        console.log('[GetGoals] Conversion query failed:', e)
      }

      const uniqueVisitors = new Set(conversions.map(c => c.visitorId)).size
      const totalValue = conversions.reduce((sum, c) => sum + (c.value || 0), 0)

      return {
        id: goal.id,
        name: goal.name,
        type: goal.type,
        pattern: goal.pattern,
        matchType: goal.matchType,
        durationMinutes: goal.durationMinutes,
        value: goal.value,
        isActive: goal.isActive,
        conversions: conversions.length,
        uniqueConversions: uniqueVisitors,
        totalValue,
        createdAt: goal.createdAt,
      }
    }))

    return response({ goals: goalsWithStats })
  } catch (error) {
    console.error('Get goals error:', error)
    return response({ error: 'Failed to fetch goals' }, 500)
  }
}

async function handleUpdateGoal(siteId: string, goalId: string, event: LambdaEvent) {
  try {
    const body = JSON.parse(event.body || '{}')

    // Validate type if provided
    if (body.type && !['pageview', 'event', 'duration'].includes(body.type)) {
      return response({ error: 'Invalid type. Must be: pageview, event, or duration' }, 400)
    }

    const goal = await Goal.update(siteId, goalId, {
      name: body.name,
      type: body.type,
      pattern: body.pattern,
      matchType: body.matchType,
      durationMinutes: body.durationMinutes,
      value: body.value,
      isActive: body.isActive,
    })

    invalidateGoalCache(siteId)
    return response({ goal })
  } catch (error) {
    console.error('Update goal error:', error)
    return response({ error: 'Failed to update goal' }, 500)
  }
}

async function handleDeleteGoal(siteId: string, goalId: string) {
  try {
    await Goal.delete(siteId, goalId)
    invalidateGoalCache(siteId)
    return response({ success: true })
  } catch (error) {
    console.error('Delete goal error:', error)
    return response({ error: 'Failed to delete goal' }, 500)
  }
}

async function handleGetGoalStats(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)

    // Get all goals for this site
    const goals = await Goal.forSite(siteId).get()

    // Get total sessions for conversion rate calculation
    const sessionsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
      Select: 'COUNT',
    }) as { Count?: number }
    const totalSessions = sessionsResult.Count || 0

    // Get stats for each goal
    const goalStats = await Promise.all(goals.map(async (goal) => {
      const conversions = await Conversion.forGoal(siteId, goal.id)
        .since(startDate)
        .until(endDate)
        .get()

      const uniqueVisitors = new Set(conversions.map(c => c.visitorId)).size
      const totalValue = conversions.reduce((sum, c) => sum + (c.value || 0), 0)

      return {
        goalId: goal.id,
        goalName: goal.name,
        goalType: goal.type,
        conversions: conversions.length,
        uniqueConversions: uniqueVisitors,
        conversionRate: totalSessions > 0
          ? Math.round((uniqueVisitors / totalSessions) * 10000) / 100
          : 0,
        totalValue,
        isActive: goal.isActive,
      }
    }))

    // Calculate totals
    const totalConversions = goalStats.reduce((sum, g) => sum + g.conversions, 0)
    const totalValue = goalStats.reduce((sum, g) => sum + g.totalValue, 0)

    return response({
      goals: goalStats,
      summary: {
        totalGoals: goals.length,
        activeGoals: goals.filter(g => g.isActive).length,
        totalConversions,
        totalValue,
        totalSessions,
      },
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
    })
  } catch (error) {
    console.error('Get goal stats error:', error)
    return response({ error: 'Failed to fetch goal stats' }, 500)
  }
}

// ============================================================================
// Heatmap Query Handlers
// ============================================================================

async function handleGetHeatmapClicks(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const path = event.queryStringParameters?.path
    const device = event.queryStringParameters?.device // 'desktop' | 'mobile' | 'tablet' | 'all'
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 1000, 10000)

    // Query heatmap clicks
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `HMCLICK#${startDate.toISOString()}` },
        ':end': { S: `HMCLICK#${endDate.toISOString()}` },
      },
      Limit: limit,
    }) as { Items?: any[] }

    let clicks = (result.Items || []).map(unmarshall)

    // Filter by path if specified
    if (path) {
      clicks = clicks.filter(c => c.path === path || c.path === decodeURIComponent(path))
    }

    // Filter by device type if specified
    if (device && device !== 'all') {
      clicks = clicks.filter(c => c.deviceType === device)
    }

    // Aggregate clicks by position for heatmap visualization
    // Group clicks into grid cells for density calculation
    const gridSize = Number(event.queryStringParameters?.gridSize) || 20 // pixels
    const clickGrid: Record<string, { count: number; elements: Record<string, number> }> = {}

    for (const click of clicks) {
      // Use document coordinates for consistent positioning
      const gridX = Math.floor(click.documentX / gridSize) * gridSize
      const gridY = Math.floor(click.documentY / gridSize) * gridSize
      const key = `${gridX},${gridY}`

      if (!clickGrid[key]) {
        clickGrid[key] = { count: 0, elements: {} }
      }
      clickGrid[key].count++

      // Track clicked elements
      if (click.selector) {
        clickGrid[key].elements[click.selector] = (clickGrid[key].elements[click.selector] || 0) + 1
      }
    }

    // Convert grid to array format for visualization
    const heatmapData = Object.entries(clickGrid).map(([key, data]) => {
      const [x, y] = key.split(',').map(Number)
      const topElement = Object.entries(data.elements)
        .sort((a, b) => b[1] - a[1])[0]

      return {
        x,
        y,
        count: data.count,
        topElement: topElement ? { selector: topElement[0], count: topElement[1] } : null,
      }
    })

    // Also return top clicked elements
    const elementStats: Record<string, { count: number; tag: string; text?: string }> = {}
    for (const click of clicks) {
      if (click.selector) {
        if (!elementStats[click.selector]) {
          elementStats[click.selector] = { count: 0, tag: click.elementTag || '', text: click.elementText }
        }
        elementStats[click.selector].count++
      }
    }

    const topElements = Object.entries(elementStats)
      .map(([selector, stats]) => ({
        selector,
        tag: stats.tag,
        text: stats.text,
        count: stats.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    return response({
      clicks: heatmapData,
      topElements,
      totalClicks: clicks.length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Heatmap clicks error:', error)
    return response({ error: 'Failed to fetch heatmap clicks' }, 500)
  }
}

async function handleGetHeatmapScroll(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const path = event.queryStringParameters?.path
    const device = event.queryStringParameters?.device

    // Query heatmap scroll data
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'HMSCROLL#' },
      },
    }) as { Items?: any[] }

    let scrollData = (result.Items || []).map(unmarshall).filter(s => {
      const timestamp = new Date(s.timestamp)
      return timestamp >= startDate && timestamp <= endDate
    })

    // Filter by path if specified
    if (path) {
      scrollData = scrollData.filter(s => s.path === path || s.path === decodeURIComponent(path))
    }

    // Filter by device type if specified
    if (device && device !== 'all') {
      scrollData = scrollData.filter(s => s.deviceType === device)
    }

    // Aggregate scroll depth data
    const depthBuckets: Record<number, { sessions: number; totalTime: number }> = {}
    let totalSessions = 0
    let totalMaxDepth = 0

    for (const scroll of scrollData) {
      totalSessions++
      totalMaxDepth += scroll.maxScrollDepth || 0

      // Aggregate time spent at each depth bucket
      const depths = scroll.scrollDepths || {}
      for (const [depth, time] of Object.entries(depths)) {
        const depthNum = Number(depth)
        if (!depthBuckets[depthNum]) {
          depthBuckets[depthNum] = { sessions: 0, totalTime: 0 }
        }
        depthBuckets[depthNum].sessions++
        depthBuckets[depthNum].totalTime += time as number
      }
    }

    // Calculate reach percentage for each depth (what % of sessions reached this depth)
    const scrollDepths = Object.entries(depthBuckets)
      .map(([depth, data]) => ({
        depth: Number(depth),
        reachPercentage: totalSessions > 0 ? Math.round((data.sessions / totalSessions) * 100) : 0,
        avgTimeMs: data.sessions > 0 ? Math.round(data.totalTime / data.sessions) : 0,
        sessions: data.sessions,
      }))
      .sort((a, b) => a.depth - b.depth)

    // Calculate average max scroll depth
    const avgMaxDepth = totalSessions > 0 ? Math.round(totalMaxDepth / totalSessions) : 0

    return response({
      scrollDepths,
      avgMaxDepth,
      totalSessions,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Heatmap scroll error:', error)
    return response({ error: 'Failed to fetch heatmap scroll data' }, 500)
  }
}

async function handleGetHeatmapPages(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 20, 100)

    // Query heatmap clicks to find pages with data
    const clicksResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `HMCLICK#${startDate.toISOString()}` },
        ':end': { S: `HMCLICK#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    // Query heatmap scroll data
    const scrollResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'HMSCROLL#' },
      },
    }) as { Items?: any[] }

    const clicks = (clicksResult.Items || []).map(unmarshall)
    const scrolls = (scrollResult.Items || []).map(unmarshall).filter(s => {
      const timestamp = new Date(s.timestamp)
      return timestamp >= startDate && timestamp <= endDate
    })

    // Aggregate by page path
    const pageStats: Record<string, {
      clicks: number
      scrollSessions: number
      avgScrollDepth: number
      totalScrollDepth: number
    }> = {}

    for (const click of clicks) {
      const path = click.path
      if (!pageStats[path]) {
        pageStats[path] = { clicks: 0, scrollSessions: 0, avgScrollDepth: 0, totalScrollDepth: 0 }
      }
      pageStats[path].clicks++
    }

    for (const scroll of scrolls) {
      const path = scroll.path
      if (!pageStats[path]) {
        pageStats[path] = { clicks: 0, scrollSessions: 0, avgScrollDepth: 0, totalScrollDepth: 0 }
      }
      pageStats[path].scrollSessions++
      pageStats[path].totalScrollDepth += scroll.maxScrollDepth || 0
    }

    // Calculate averages and format response
    const pages = Object.entries(pageStats)
      .map(([path, stats]) => ({
        path,
        clicks: stats.clicks,
        scrollSessions: stats.scrollSessions,
        avgScrollDepth: stats.scrollSessions > 0
          ? Math.round(stats.totalScrollDepth / stats.scrollSessions)
          : 0,
        hasClickData: stats.clicks > 0,
        hasScrollData: stats.scrollSessions > 0,
      }))
      .sort((a, b) => (b.clicks + b.scrollSessions) - (a.clicks + a.scrollSessions))
      .slice(0, limit)

    return response({
      pages,
      totalPages: Object.keys(pageStats).length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Heatmap pages error:', error)
    return response({ error: 'Failed to fetch heatmap pages' }, 500)
  }
}

// Handler to list all sites
async function handleGetSites() {
  try {
    // Query all Site records from DynamoDB
    // Sites have PK and SK both starting with SITE#
    const result = await dynamodb.scan({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(pk, :sitePrefix) AND begins_with(sk, :sitePrefix)',
      ExpressionAttributeValues: {
        ':sitePrefix': { S: 'SITE#' },
      },
      ProjectionExpression: 'id, #n, domains, isActive, createdAt',
      ExpressionAttributeNames: {
        '#n': 'name',
      },
    })

    const sites = (result.Items || []).map((item: any) => ({
      id: item.id?.S || '',
      name: item.name?.S || 'Unnamed Site',
      domains: item.domains?.L?.map((d: any) => d.S) || [],
      isActive: item.isActive?.BOOL ?? true,
      createdAt: item.createdAt?.S || '',
    })).filter((site: any) => site.id && site.isActive)

    // Sort by name
    sites.sort((a: any, b: any) => a.name.localeCompare(b.name))

    return response({
      sites,
      total: sites.length,
    })
  } catch (error) {
    console.error('Get sites error:', error)
    return response({ error: 'Failed to fetch sites' }, 500)
  }
}

// Types for API Gateway HTTP API (v2) format
interface LambdaEvent {
  version?: string
  routeKey?: string
  rawPath?: string
  rawQueryString?: string
  headers?: Record<string, string>
  queryStringParameters?: Record<string, string>
  pathParameters?: Record<string, string>
  body?: string
  isBase64Encoded?: boolean
  requestContext?: {
    accountId?: string
    apiId?: string
    domainName?: string
    domainPrefix?: string
    http?: {
      method: string
      path: string
      protocol: string
      sourceIp: string
      userAgent: string
    }
    requestId?: string
    routeKey?: string
    stage?: string
    time?: string
    timeEpoch?: number
  }
  // Legacy v1 format support
  httpMethod?: string
  path?: string
  resource?: string
}

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

// Extract siteId from API path
function extractSiteId(path: string): string | null {
  const match = path.match(/\/api\/sites\/([^/]+)/)
  return match ? match[1] : null
}

// Main Lambda handler - supports both API Gateway v1 and v2 formats
export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  console.log('Event:', JSON.stringify(event))

  // Determine method and path (v2 vs v1 format)
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET'
  const path = event.rawPath || event.path || event.resource || '/'

  // Handle OPTIONS (CORS preflight)
  if (method === 'OPTIONS') {
    return response(null, 204)
  }

  // Route handling
  if (path === '/health' && method === 'GET') {
    return handleHealth()
  }

  if ((path === '/dashboard' || path === '/') && method === 'GET') {
    return handleDashboard()
  }

  if (path === '/collect' && method === 'POST') {
    return handleCollect(event)
  }

  if (path.match(/\/sites\/[^/]+\/script/) && method === 'GET') {
    return handleScript(event)
  }

  // Dashboard API routes
  if (method === 'GET') {
    // /api/sites - list all sites
    if (path === '/api/sites') {
      return handleGetSites()
    }

    const siteId = extractSiteId(path)

    if (siteId) {
      // /api/sites/{siteId}/stats
      if (path.endsWith('/stats')) {
        return handleGetStats(siteId, event)
      }
      // /api/sites/{siteId}/realtime
      if (path.endsWith('/realtime')) {
        return handleGetRealtime(siteId, event)
      }
      // /api/sites/{siteId}/pages
      if (path.endsWith('/pages')) {
        return handleGetPages(siteId, event)
      }
      // /api/sites/{siteId}/referrers
      if (path.endsWith('/referrers')) {
        return handleGetReferrers(siteId, event)
      }
      // /api/sites/{siteId}/devices
      if (path.endsWith('/devices')) {
        return handleGetDevices(siteId, event)
      }
      // /api/sites/{siteId}/browsers
      if (path.endsWith('/browsers')) {
        return handleGetBrowsers(siteId, event)
      }
      // /api/sites/{siteId}/countries
      if (path.endsWith('/countries')) {
        return handleGetCountries(siteId, event)
      }
      // /api/sites/{siteId}/timeseries
      if (path.endsWith('/timeseries')) {
        return handleGetTimeSeries(siteId, event)
      }
      // /api/sites/{siteId}/events
      if (path.endsWith('/events')) {
        return handleGetEvents(siteId, event)
      }
      // /api/sites/{siteId}/campaigns
      if (path.endsWith('/campaigns')) {
        return handleGetCampaigns(siteId, event)
      }
      // /api/sites/{siteId}/goals/stats
      if (path.endsWith('/goals/stats')) {
        return handleGetGoalStats(siteId, event)
      }
      // /api/sites/{siteId}/goals (GET only - POST/PUT/DELETE handled below)
      if (path.endsWith('/goals')) {
        return handleGetGoals(siteId, event)
      }
      // /api/sites/{siteId}/heatmap/clicks
      if (path.includes('/heatmap/clicks')) {
        return handleGetHeatmapClicks(siteId, event)
      }
      // /api/sites/{siteId}/heatmap/scroll
      if (path.includes('/heatmap/scroll')) {
        return handleGetHeatmapScroll(siteId, event)
      }
      // /api/sites/{siteId}/heatmap/pages
      if (path.includes('/heatmap/pages')) {
        return handleGetHeatmapPages(siteId, event)
      }
    }
  }

  // Goal CRUD routes (POST/PUT/DELETE)
  const siteId = extractSiteId(path)
  if (siteId) {
    // /api/sites/{siteId}/goals
    if (path.endsWith('/goals') && method === 'POST') {
      return handleCreateGoal(siteId, event)
    }
    // /api/sites/{siteId}/goals/{goalId}
    const goalIdMatch = path.match(/\/goals\/([^/]+)$/)
    if (goalIdMatch) {
      const goalId = goalIdMatch[1]
      if (method === 'PUT') {
        return handleUpdateGoal(siteId, goalId, event)
      }
      if (method === 'DELETE') {
        return handleDeleteGoal(siteId, goalId)
      }
    }
  }

  return response({ error: 'Not found' }, 404)
}
