/**
 * AWS Lambda Handler for ts-analytics API
 *
 * This handler wraps the analytics API for deployment to AWS Lambda.
 * It uses API Gateway for HTTP routing and Eloquent-like models for data access.
 *
 * Supports optional SQS buffering for high-throughput scenarios.
 * Enable by setting SQS_BUFFERING_ENABLED=true and SQS_QUEUE_URL env vars.
 * See cloud.config.ts for infrastructure configuration.
 */

import {
  generateTrackingScript,
  generateMinimalTrackingScript,
  generateId,
  hashVisitorId,
  getDailySalt,
  isSQSBufferingEnabled,
  type AnalyticsEvent,
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
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL
const SQS_ENABLED = isSQSBufferingEnabled()

// Configure analytics models
configureAnalytics({
  tableName: TABLE_NAME,
  region: REGION,
})

// Create native DynamoDB client for direct queries (used in dashboard handlers)
const dynamodb = createClient({ region: REGION })

// SQS client for buffered writes (lazy initialized)
let sqsProducer: Awaited<ReturnType<typeof import('../src/index').createAnalyticsProducer>> | null = null

async function getSQSProducer() {
  if (!sqsProducer && SQS_ENABLED && SQS_QUEUE_URL) {
    const { createAnalyticsProducer } = await import('../src/index')
    sqsProducer = await createAnalyticsProducer({
      queueUrl: SQS_QUEUE_URL,
      region: REGION,
    })
  }
  return sqsProducer
}

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
  if (/dia\//i.test(ua)) browser = 'Dia'
  else if (/arc\//i.test(ua)) browser = 'Arc'
  else if (/edg/i.test(ua)) browser = 'Edge'
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
    let dateRange = '6h'
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
    let siteHasHistoricalData = cachedStats ? true : false // Track if site has ever had data

    // New state for additional features
    let sessions = [], sessionDetail = null
    let vitals = [], errors = [], insights = []
    let activeTab = 'dashboard' // 'dashboard', 'sessions', 'vitals', 'errors', 'insights'
    let filters = { country: '', device: '', browser: '', referrer: '' }
    let comparisonStats = null

    // Theme management
    function getPreferredTheme() {
      const stored = localStorage.getItem('ts-analytics-theme')
      if (stored) return stored
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme)
      const darkIcon = document.getElementById('theme-icon-dark')
      const lightIcon = document.getElementById('theme-icon-light')
      if (darkIcon && lightIcon) {
        darkIcon.style.display = theme === 'dark' ? 'block' : 'none'
        lightIcon.style.display = theme === 'light' ? 'block' : 'none'
      }
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'dark'
      const newTheme = current === 'dark' ? 'light' : 'dark'
      localStorage.setItem('ts-analytics-theme', newTheme)
      applyTheme(newTheme)
      // Re-render chart with new theme colors
      if (timeSeriesData.length) renderChart()
    }

    // Initialize theme immediately
    applyTheme(getPreferredTheme())

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
        siteHasHistoricalData = true // Site has historical data if we have cached stats
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

    function navigateTo(section) {
      window.location.href = '/dashboard/' + section + '?siteId=' + encodeURIComponent(siteId)
    }

    function setDateRange(range) {
      dateRange = range
      document.querySelectorAll('.date-btn').forEach(btn => btn.classList.remove('active'))
      document.querySelector(\`[data-range="\${range}"]\`).classList.add('active')
      fetchDashboardData()
    }

    function getDateRangeParams(forTimeseries) {
      const now = new Date()
      const end = now.toISOString()
      let start, period = 'day'
      switch(dateRange) {
        case '1h': start = new Date(now - 1*60*60*1000); period = 'minute'; break
        case '6h': start = new Date(now - 6*60*60*1000); period = 'hour'; break
        case '12h': start = new Date(now - 12*60*60*1000); period = 'hour'; break
        case '24h': start = new Date(now - 24*60*60*1000); period = 'hour'; break
        case '7d': start = new Date(now - 7*24*60*60*1000); break
        case '30d': start = new Date(now - 30*24*60*60*1000); break
        case '90d': start = new Date(now - 90*24*60*60*1000); break
        default: start = new Date(now - 30*24*60*60*1000)
      }
      let params = \`?startDate=\${start.toISOString()}&endDate=\${end}\`
      if (forTimeseries) params += \`&period=\${period}\`
      return params
    }

    async function fetchDashboardData() {
      if (isLoading) return
      isLoading = true
      const spinStartTime = Date.now()
      document.getElementById('refresh-btn').classList.add('spinning')

      const baseUrl = \`\${API_ENDPOINT}/api/sites/\${siteId}\`
      const params = getDateRangeParams(false)
      const tsParams = getDateRangeParams(true)

      try {
        const [statsRes, realtimeRes, pagesRes, referrersRes, devicesRes, browsersRes, countriesRes, timeseriesRes, eventsRes, campaignsRes, goalsRes, vitalsRes, errorsRes, insightsRes] = await Promise.all([
          fetch(\`\${baseUrl}/stats\${params}\`).then(r => r.json()).catch(() => ({})),
          fetch(\`\${baseUrl}/realtime\`).then(r => r.json()).catch(() => ({ currentVisitors: 0 })),
          fetch(\`\${baseUrl}/pages\${params}\`).then(r => r.json()).catch(() => ({ pages: [] })),
          fetch(\`\${baseUrl}/referrers\${params}\`).then(r => r.json()).catch(() => ({ referrers: [] })),
          fetch(\`\${baseUrl}/devices\${params}\`).then(r => r.json()).catch(() => ({ deviceTypes: [] })),
          fetch(\`\${baseUrl}/browsers\${params}\`).then(r => r.json()).catch(() => ({ browsers: [] })),
          fetch(\`\${baseUrl}/countries\${params}\`).then(r => r.json()).catch(() => ({ countries: [] })),
          fetch(\`\${baseUrl}/timeseries\${tsParams}\`).then(r => r.json()).catch(() => ({ timeSeries: [] })),
          fetch(\`\${baseUrl}/events\${params}\`).then(r => r.json()).catch(() => ({ events: [] })),
          fetch(\`\${baseUrl}/campaigns\${params}\`).then(r => r.json()).catch(() => ({ campaigns: [] })),
          fetch(\`\${baseUrl}/goals\${params}\`).then(r => r.json()).catch(() => ({ goals: [] })),
          fetch(\`\${baseUrl}/vitals\${params}\`).then(r => r.json()).catch(() => ({ vitals: [] })),
          fetch(\`\${baseUrl}/errors\${params}\`).then(r => r.json()).catch(() => ({ errors: [] })),
          fetch(\`\${baseUrl}/insights\`).then(r => r.json()).catch(() => ({ insights: [] })),
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
        vitals = vitalsRes.vitals || []
        errors = errorsRes.errors || []
        insights = insightsRes.insights || []
        comparisonStats = insightsRes.stats || null
        lastUpdated = new Date()

        // Mark site as having data if we see any (don't show setup for empty time ranges)
        if (stats.views > 0 || stats.sessions > 0 || pages.length > 0 || timeSeriesData.some(t => t.views > 0)) {
          siteHasHistoricalData = true
        }

        renderDashboard(true)
      } catch (error) {
        console.error('Failed to fetch:', error)
      } finally {
        isLoading = false
        // Ensure spinner completes at least one full rotation (1s animation)
        const elapsed = Date.now() - spinStartTime
        const minSpinTime = 1000
        const remainingTime = Math.max(0, minSpinTime - elapsed)
        setTimeout(() => {
          document.getElementById('refresh-btn').classList.remove('spinning')
        }, remainingTime)
      }
    }

    function fmt(n) {
      if (n === undefined || n === null) return '0'
      return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n)
    }

    // Tab switching
    let flowData = null
    let revenueData = null

    function switchTab(tab) {
      activeTab = tab
      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab)
      })
      // Hide/show appropriate content
      const mainContent = document.getElementById('main-content')
      const statsSection = document.querySelector('.stats')
      const chartBox = document.querySelector('.chart-box')

      if (tab === 'dashboard') {
        if (statsSection) statsSection.style.display = 'grid'
        if (chartBox) chartBox.style.display = 'block'
        renderDashboard()
      } else if (tab === 'sessions') {
        if (statsSection) statsSection.style.display = 'none'
        if (chartBox) chartBox.style.display = 'none'
        fetchSessions()
      } else if (tab === 'flow') {
        if (statsSection) statsSection.style.display = 'none'
        if (chartBox) chartBox.style.display = 'none'
        fetchUserFlow()
      } else if (tab === 'vitals') {
        if (statsSection) statsSection.style.display = 'none'
        if (chartBox) chartBox.style.display = 'none'
        renderVitals()
      } else if (tab === 'errors') {
        if (statsSection) statsSection.style.display = 'none'
        if (chartBox) chartBox.style.display = 'none'
        renderErrors()
      } else if (tab === 'insights') {
        if (statsSection) statsSection.style.display = 'none'
        if (chartBox) chartBox.style.display = 'none'
        renderInsights()
      }
    }

    // Fetch user flow data
    async function fetchUserFlow() {
      const params = getDateRangeParams(false)
      try {
        const res = await fetch(\`\${API_ENDPOINT}/api/sites/\${siteId}/flow\${params}\`)
        flowData = await res.json()
        renderUserFlow()
      } catch (e) {
        console.error('Failed to fetch user flow:', e)
      }
    }

    // Render user flow visualization
    function renderUserFlow() {
      const grid = document.querySelector('.grid')
      if (!grid || !flowData) return

      const { nodes, links, totalSessions, analyzedSessions } = flowData

      // Group nodes by layer (approximation based on incoming/outgoing links)
      const entryNodes = nodes.filter(n => n.id === '/' || links.every(l => l.target !== n.id || l.source === n.id))
      const otherNodes = nodes.filter(n => !entryNodes.includes(n))

      grid.innerHTML = \`
        <div style="grid-column:1/-1">
          <h3 style="margin-bottom:0.5rem;font-size:1rem">User Flow</h3>
          <p style="font-size:0.75rem;color:var(--muted);margin-bottom:1.5rem">Showing top paths from \${analyzedSessions} of \${totalSessions} multi-page sessions</p>

          <div style="display:flex;gap:2rem;overflow-x:auto;padding-bottom:1rem">
            <!-- Entry pages -->
            <div style="min-width:200px">
              <h4 style="font-size:0.6875rem;text-transform:uppercase;color:var(--muted);margin-bottom:0.75rem">Entry Pages</h4>
              \${entryNodes.slice(0, 8).map(n => \`
                <div style="background:var(--bg);border:1px solid var(--border);padding:0.5rem 0.75rem;border-radius:6px;margin-bottom:0.5rem">
                  <div style="font-size:0.8125rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${n.id}</div>
                  <div style="font-size:0.6875rem;color:var(--muted)">\${n.count} visits</div>
                </div>
              \`).join('')}
            </div>

            <!-- Flow connections -->
            <div style="min-width:300px;flex:1">
              <h4 style="font-size:0.6875rem;text-transform:uppercase;color:var(--muted);margin-bottom:0.75rem">Top Flows</h4>
              \${links.slice(0, 15).map(l => \`
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;font-size:0.75rem">
                  <span style="background:var(--bg);padding:0.25rem 0.5rem;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">\${l.source}</span>
                  <span style="color:var(--accent)">→</span>
                  <span style="background:var(--bg);padding:0.25rem 0.5rem;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">\${l.target}</span>
                  <span style="color:var(--muted);margin-left:auto">\${l.value}x</span>
                </div>
              \`).join('')}
            </div>

            <!-- Top pages by traffic -->
            <div style="min-width:200px">
              <h4 style="font-size:0.6875rem;text-transform:uppercase;color:var(--muted);margin-bottom:0.75rem">Most Visited</h4>
              \${nodes.slice(0, 10).map((n, i) => \`
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
                  <span style="width:18px;height:18px;background:var(--accent);color:white;border-radius:50%;font-size:0.6875rem;display:flex;align-items:center;justify-content:center">\${i + 1}</span>
                  <span style="font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">\${n.id}</span>
                  <span style="font-size:0.6875rem;color:var(--muted)">\${n.count}</span>
                </div>
              \`).join('')}
            </div>
          </div>

          \${links.length === 0 ? '<div class="empty-cell">No flow data available. Users need to visit multiple pages in a session.</div>' : ''}
        </div>
      \`
    }

    // Fetch sessions list
    async function fetchSessions() {
      const params = getDateRangeParams(false)
      const filter = Object.values(filters).filter(f => f).join(' ')
      const filterParam = filter ? '&filter=' + encodeURIComponent(filter) : ''
      try {
        const res = await fetch(\`\${API_ENDPOINT}/api/sites/\${siteId}/sessions\${params}\${filterParam}\`)
        const data = await res.json()
        sessions = data.sessions || []
        renderSessions()
      } catch (e) {
        console.error('Failed to fetch sessions:', e)
      }
    }

    // Render sessions list
    function renderSessions() {
      const grid = document.querySelector('.grid')
      if (!grid) return
      grid.innerHTML = \`
        <div style="grid-column: 1/-1">
          <h3 style="margin-bottom:1rem;font-size:1rem">Sessions (\${sessions.length})</h3>
          <div class="session-list">
            \${sessions.length === 0 ? '<div class="empty-cell">No sessions found</div>' : sessions.map(s => \`
              <div class="session-card" onclick="viewSession('\${s.id}')">
                <div class="session-header">
                  <span style="font-weight:500">\${s.entryPath || '/'}</span>
                  <span style="font-size:0.75rem;color:var(--muted)">\${new Date(s.startedAt).toLocaleString()}</span>
                </div>
                <div class="session-meta">
                  <span>\${s.pageViewCount || 0} pages</span>
                  <span>\${formatDuration(s.duration)}</span>
                  <span>\${s.browser || 'Unknown'}</span>
                  <span>\${s.country || 'Unknown'}</span>
                  \${s.isBounce ? '<span style="color:var(--error)">Bounced</span>' : ''}
                </div>
              </div>
            \`).join('')}
          </div>
        </div>
      \`
    }

    // Format duration
    function formatDuration(ms) {
      if (!ms) return '0s'
      const s = Math.floor(ms / 1000)
      if (s < 60) return s + 's'
      const m = Math.floor(s / 60)
      return m + 'm ' + (s % 60) + 's'
    }

    // View session detail
    async function viewSession(sessionId) {
      try {
        const res = await fetch(\`\${API_ENDPOINT}/api/sites/\${siteId}/sessions/\${sessionId}\`)
        sessionDetail = await res.json()
        renderSessionModal()
      } catch (e) {
        console.error('Failed to fetch session:', e)
      }
    }

    // Render session modal with replay
    function renderSessionModal() {
      if (!sessionDetail) return
      let modal = document.getElementById('session-modal')
      if (!modal) {
        modal = document.createElement('div')
        modal.id = 'session-modal'
        modal.className = 'modal-overlay'
        modal.onclick = (e) => { if (e.target === modal) closeModal() }
        document.body.appendChild(modal)
      }
      const s = sessionDetail.session
      const timeline = sessionDetail.timeline || []
      const clicks = sessionDetail.clicks || []
      const pageviews = sessionDetail.pageviews || []

      // Group clicks by path
      const clicksByPath = {}
      for (const c of clicks) {
        const path = c.path || '/'
        if (!clicksByPath[path]) clicksByPath[path] = []
        clicksByPath[path].push(c)
      }

      // Get unique paths visited
      const paths = [...new Set(pageviews.map(p => p.path))]

      modal.innerHTML = \`
        <div class="modal" style="max-width:1000px">
          <div class="modal-header">
            <h3>Session: \${s.id?.slice(0,8) || 'Unknown'}</h3>
            <button class="modal-close" onclick="closeModal()">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem">
              <div class="stat" style="padding:1rem"><div class="stat-val" style="font-size:1.25rem">\${s.pageViewCount || 0}</div><div class="stat-lbl">Pages</div></div>
              <div class="stat" style="padding:1rem"><div class="stat-val" style="font-size:1.25rem">\${formatDuration(s.duration)}</div><div class="stat-lbl">Duration</div></div>
              <div class="stat" style="padding:1rem"><div class="stat-val" style="font-size:1.25rem">\${s.browser || '?'}</div><div class="stat-lbl">Browser</div></div>
              <div class="stat" style="padding:1rem"><div class="stat-val" style="font-size:1.25rem">\${s.country || '?'}</div><div class="stat-lbl">Country</div></div>
            </div>

            \${clicks.length > 0 ? \`
            <h4 style="margin-bottom:0.75rem;font-size:0.875rem;color:var(--muted)">Click Heatmap (\${clicks.length} clicks)</h4>
            <div style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap">
              \${paths.map((p, i) => \`<button class="date-btn \${i===0?'active':''}" onclick="showPathHeatmap('\${p}')">\${p}</button>\`).join('')}
            </div>
            <div id="heatmap-container" style="position:relative;width:100%;height:400px;background:var(--bg);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:1.5rem">
              <div id="heatmap-clicks" style="position:absolute;inset:0"></div>
              <div style="position:absolute;bottom:10px;right:10px;font-size:0.6875rem;color:var(--muted);background:var(--bg2);padding:0.25rem 0.5rem;border-radius:4px">
                Viewport: \${clicks[0]?.viewportWidth || '?'}x\${clicks[0]?.viewportHeight || '?'}
              </div>
            </div>
            \` : ''}

            <h4 style="margin-bottom:0.75rem;font-size:0.875rem;color:var(--muted)">Session Journey</h4>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1.5rem;flex-wrap:wrap">
              \${pageviews.map((p, i) => \`
                <div style="background:var(--bg);border:1px solid var(--border);padding:0.5rem 0.75rem;border-radius:6px;font-size:0.75rem">
                  <div style="color:var(--text)">\${p.path}</div>
                  <div style="color:var(--muted);font-size:0.6875rem">\${new Date(p.timestamp).toLocaleTimeString()}</div>
                </div>
                \${i < pageviews.length - 1 ? '<span style="color:var(--muted)">→</span>' : ''}
              \`).join('')}
            </div>

            <h4 style="margin-bottom:0.75rem;font-size:0.875rem;color:var(--muted)">Timeline (\${timeline.length} events)</h4>
            <div class="timeline" style="max-height:300px;overflow-y:auto">
              \${timeline.map(t => \`
                <div class="timeline-item">
                  <div class="timeline-type \${t.type === 'error' ? 'error' : ''}">\${t.type}</div>
                  <div class="timeline-content">
                    \${t.type === 'pageview' ? '<span style="color:var(--accent)">' + t.data.path + '</span>' : ''}
                    \${t.type === 'event' ? '<span style="color:var(--success)">' + t.data.name + '</span>' : ''}
                    \${t.type === 'click' ? 'Click at (' + t.data.viewportX + ', ' + t.data.viewportY + ') on <code>' + (t.data.elementTag || 'element') + '</code>' : ''}
                    \${t.type === 'vital' ? '<span style="color:var(--warning)">' + t.data.metric + '</span>: ' + t.data.value + 'ms (' + t.data.rating + ')' : ''}
                    \${t.type === 'error' ? '<span style="color:var(--error)">' + (t.data.message || '').slice(0,100) + '</span>' : ''}
                  </div>
                  <div class="timeline-time">\${new Date(t.timestamp).toLocaleTimeString()}</div>
                </div>
              \`).join('')}
            </div>
          </div>
        </div>
      \`
      modal.classList.add('active')

      // Render initial heatmap if we have clicks
      if (clicks.length > 0 && paths.length > 0) {
        renderHeatmapClicks(paths[0], clicksByPath)
      }
    }

    // Render clicks on heatmap
    function renderHeatmapClicks(path, clicksByPath) {
      const container = document.getElementById('heatmap-clicks')
      if (!container) return
      const pathClicks = clicksByPath[path] || []
      if (pathClicks.length === 0) {
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)">No clicks on this page</div>'
        return
      }

      // Get viewport size from first click
      const vw = pathClicks[0].viewportWidth || 1920
      const vh = pathClicks[0].viewportHeight || 1080

      // Scale factor to fit in container
      const containerRect = container.getBoundingClientRect()
      const scale = Math.min(containerRect.width / vw, containerRect.height / vh)

      container.innerHTML = pathClicks.map(c => {
        const x = (c.viewportX || 0) * scale
        const y = (c.viewportY || 0) * scale
        return \`<div style="position:absolute;left:\${x}px;top:\${y}px;width:20px;height:20px;background:rgba(239,68,68,0.5);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;box-shadow:0 0 10px rgba(239,68,68,0.5)"></div>\`
      }).join('')
    }

    window.showPathHeatmap = function(path) {
      if (!sessionDetail) return
      const clicks = sessionDetail.clicks || []
      const clicksByPath = {}
      for (const c of clicks) {
        const p = c.path || '/'
        if (!clicksByPath[p]) clicksByPath[p] = []
        clicksByPath[p].push(c)
      }

      // Update button states
      document.querySelectorAll('#session-modal .date-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === path)
      })

      renderHeatmapClicks(path, clicksByPath)
    }

    function closeModal() {
      const modal = document.getElementById('session-modal')
      if (modal) modal.classList.remove('active')
    }

    // Render vitals
    function renderVitals() {
      const grid = document.querySelector('.grid')
      if (!grid) return
      const getColor = (v) => {
        if (!v || v.samples === 0) return ''
        if (v.good >= 75) return 'good'
        if (v.poor >= 25) return 'poor'
        return 'needs-improvement'
      }
      const formatValue = (metric, value) => {
        if (metric === 'CLS') return (value / 1000).toFixed(3)
        return value + 'ms'
      }
      grid.innerHTML = \`
        <div style="grid-column:1/-1">
          <h3 style="margin-bottom:1rem;font-size:1rem">Core Web Vitals</h3>
          <div class="vitals-grid">
            \${vitals.map(v => \`
              <div class="vital-card">
                <div class="vital-name">\${v.metric}</div>
                <div class="vital-value \${getColor(v)}">\${v.samples > 0 ? formatValue(v.metric, v.p75) : '—'}</div>
                <div style="font-size:0.6875rem;color:var(--muted)">\${v.samples} samples</div>
                \${v.samples > 0 ? \`
                  <div class="vital-bar">
                    <span class="good" style="width:\${v.good}%"></span>
                    <span class="needs-improvement" style="width:\${v.needsImprovement}%"></span>
                    <span class="poor" style="width:\${v.poor}%"></span>
                  </div>
                \` : ''}
              </div>
            \`).join('')}
          </div>
          <p style="margin-top:1rem;font-size:0.75rem;color:var(--muted)">
            <strong>LCP</strong> (Largest Contentful Paint): Loading performance. <strong>FID</strong> (First Input Delay): Interactivity.
            <strong>CLS</strong> (Cumulative Layout Shift): Visual stability. <strong>TTFB</strong> (Time to First Byte): Server response.
            <strong>INP</strong> (Interaction to Next Paint): Responsiveness.
          </p>
        </div>
      \`
    }

    // Render errors
    function renderErrors() {
      const grid = document.querySelector('.grid')
      if (!grid) return
      grid.innerHTML = \`
        <div style="grid-column:1/-1">
          <h3 style="margin-bottom:1rem;font-size:1rem">JavaScript Errors (\${errors.length} unique)</h3>
          \${errors.length === 0 ? '<div class="empty-cell">No errors recorded</div>' : errors.map(e => \`
            <div class="error-card">
              <div class="error-message">\${e.message || 'Unknown error'}</div>
              <div class="error-meta">
                <span>\${e.count}x</span>
                <span>\${e.source ? e.source.split('/').pop() + ':' + e.line : 'Unknown source'}</span>
                <span>Last: \${new Date(e.lastSeen).toLocaleString()}</span>
                <span>Browsers: \${(e.browsers || []).join(', ')}</span>
              </div>
              \${e.stack ? '<div class="error-stack">' + e.stack + '</div>' : ''}
            </div>
          \`).join('')}
        </div>
      \`
    }

    // Render insights
    function renderInsights() {
      const grid = document.querySelector('.grid')
      if (!grid) return
      const icons = {
        traffic: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>',
        referrer: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101"/></svg>',
        page: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
        device: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>',
        engagement: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>'
      }
      grid.innerHTML = \`
        <div style="grid-column:1/-1">
          <h3 style="margin-bottom:1rem;font-size:1rem">Insights</h3>
          \${comparisonStats ? \`
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem">
              <div class="stat" style="padding:1rem">
                <div class="stat-val" style="font-size:1.25rem">\${fmt(comparisonStats.thisWeekViews)}</div>
                <div class="stat-lbl">Views This Week</div>
                \${comparisonStats.change !== 0 ? '<div class="stat-change ' + (comparisonStats.change > 0 ? 'positive' : 'negative') + '">' + (comparisonStats.change > 0 ? '+' : '') + comparisonStats.change + '%</div>' : ''}
              </div>
              <div class="stat" style="padding:1rem">
                <div class="stat-val" style="font-size:1.25rem">\${fmt(comparisonStats.lastWeekViews)}</div>
                <div class="stat-lbl">Views Last Week</div>
              </div>
              <div class="stat" style="padding:1rem">
                <div class="stat-val" style="font-size:1.25rem">\${comparisonStats.sessions || 0}</div>
                <div class="stat-lbl">Sessions</div>
              </div>
              <div class="stat" style="padding:1rem">
                <div class="stat-val" style="font-size:1.25rem">\${comparisonStats.bounceRate || 0}%</div>
                <div class="stat-lbl">Bounce Rate</div>
              </div>
            </div>
          \` : ''}
          \${insights.length === 0 ? '<div class="empty-cell">No insights available yet. Check back when you have more data.</div>' : insights.map(i => \`
            <div class="insight-card">
              <div class="insight-icon \${i.severity}">\${icons[i.type] || icons.traffic}</div>
              <div class="insight-content">
                <div class="insight-title">\${i.title}</div>
                <div class="insight-desc">\${i.description}</div>
              </div>
            </div>
          \`).join('')}
        </div>
      \`
    }

    // Apply filter
    function applyFilter(type, value) {
      filters[type] = value
      if (activeTab === 'sessions') {
        fetchSessions()
      } else {
        fetchDashboardData()
      }
    }

    // Update filter dropdowns with data
    function updateFilters() {
      const countrySelect = document.getElementById('filter-country')
      const browserSelect = document.getElementById('filter-browser')
      if (countrySelect && countries.length > 0) {
        const opts = countries.slice(0, 20).map(c => '<option value="' + (c.country || c.name) + '">' + (c.country || c.name) + '</option>')
        countrySelect.innerHTML = '<option value="">All Countries</option>' + opts.join('')
      }
      if (browserSelect && browsers.length > 0) {
        const opts = browsers.slice(0, 10).map(b => '<option value="' + (b.browser || b.name) + '">' + (b.browser || b.name) + '</option>')
        browserSelect.innerHTML = '<option value="">All Browsers</option>' + opts.join('')
      }
    }

    // Export data
    async function exportData(format) {
      const params = getDateRangeParams(false)
      const type = activeTab === 'sessions' ? 'sessions' : activeTab === 'events' ? 'events' : 'pageviews'
      const url = \`\${API_ENDPOINT}/api/sites/\${siteId}/export\${params}&format=\${format}&type=\${type}\`
      if (format === 'csv') {
        window.open(url, '_blank')
      } else {
        try {
          const res = await fetch(url)
          const data = await res.json()
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = type + '-export.json'
          a.click()
        } catch (e) {
          console.error('Export failed:', e)
        }
      }
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

      // Update filter dropdowns
      updateFilters()

      // Update last updated time
      if (lastUpdated) {
        document.getElementById('last-updated').textContent = 'Updated ' + lastUpdated.toLocaleTimeString()
      }

      // Show setup instructions if no data
      const noDataMsg = document.getElementById('no-data-msg')
      const mainContent = document.getElementById('main-content')

      // Only show setup instructions for truly new sites (no historical data)
      // If site has historical data but current time range is empty, just show empty charts
      if (!hasAnyData() && !siteHasHistoricalData) {
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
      const tooltip = document.getElementById('chartTooltip')

      if (!canvas) return

      // Read CSS variables for theme-aware chart colors
      const styles = getComputedStyle(document.documentElement)
      const colors = {
        border: styles.getPropertyValue('--border').trim() || '#2d3139',
        accent2: styles.getPropertyValue('--accent2').trim() || '#818cf8',
        muted: styles.getPropertyValue('--muted').trim() || '#6b7280',
        text: styles.getPropertyValue('--text').trim() || '#f3f4f6'
      }

      if (!timeSeriesData.length) {
        canvas.style.display = 'none'
        chartEmpty.style.display = 'flex'
        return
      }

      canvas.style.display = 'block'
      chartEmpty.style.display = 'none'

      const ctx = canvas.getContext('2d')
      const rect = canvas.parentElement.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const logicalW = rect.width - 48
      const logicalH = 220
      canvas.width = logicalW * dpr
      canvas.height = logicalH * dpr
      canvas.style.width = logicalW + 'px'
      canvas.style.height = logicalH + 'px'
      ctx.scale(dpr, dpr)
      const pad = { top: 20, right: 20, bottom: 50, left: 50 }
      const w = logicalW - pad.left - pad.right
      const h = logicalH - pad.top - pad.bottom
      const maxV = Math.max(...timeSeriesData.map(d => d.views || d.count || 0), 1)
      const xS = w / (timeSeriesData.length - 1 || 1)
      const yS = h / maxV

      // Store points for hover
      const points = timeSeriesData.map((d, i) => ({
        x: pad.left + i * xS,
        y: pad.top + h - (d.views || d.count || 0) * yS,
        data: d
      }))

      function fmtDate(dateStr) {
        const date = new Date(dateStr)
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        // Show time for hourly ranges, date for daily ranges
        if (dateRange === '1h' || dateRange === '6h' || dateRange === '12h') {
          const h = date.getHours()
          const m = date.getMinutes()
          const ampm = h >= 12 ? 'pm' : 'am'
          const h12 = h % 12 || 12
          return h12 + ':' + (m < 10 ? '0' : '') + m + ampm
        } else if (dateRange === '24h') {
          const h = date.getHours()
          const ampm = h >= 12 ? 'pm' : 'am'
          const h12 = h % 12 || 12
          return h12 + ampm
        }
        return months[date.getMonth()] + ' ' + date.getDate()
      }

      function fmtDateFull(dateStr) {
        const date = new Date(dateStr)
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        const h = date.getHours()
        const m = date.getMinutes()
        const ampm = h >= 12 ? 'pm' : 'am'
        const h12 = h % 12 || 12
        const timeStr = h12 + ':' + (m < 10 ? '0' : '') + m + ampm
        const dateStr2 = months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear()
        if (dateRange === '1h' || dateRange === '6h' || dateRange === '12h' || dateRange === '24h') {
          return dateStr2 + ' at ' + timeStr
        }
        return dateStr2
      }

      function draw(hoverIdx) {
        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, logicalW, logicalH)

        // Grid lines
        ctx.strokeStyle = colors.border
        ctx.lineWidth = 1
        for (let i = 0; i <= 4; i++) {
          const y = pad.top + (h/4)*i
          ctx.beginPath()
          ctx.moveTo(pad.left, y)
          ctx.lineTo(pad.left+w, y)
          ctx.stroke()
        }

        // Fill
        ctx.beginPath()
        ctx.fillStyle = colors.accent2 + '1a' // 0.1 alpha
        points.forEach((p, i) => {
          i===0 ? (ctx.moveTo(p.x,pad.top+h), ctx.lineTo(p.x,p.y)) : ctx.lineTo(p.x,p.y)
        })
        ctx.lineTo(points[points.length-1].x, pad.top+h)
        ctx.closePath()
        ctx.fill()

        // Line
        ctx.beginPath()
        ctx.strokeStyle = colors.accent2
        ctx.lineWidth = 2
        points.forEach((p, i) => { i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y) })
        ctx.stroke()

        // Data points
        points.forEach((p, i) => {
          ctx.beginPath()
          ctx.fillStyle = i === hoverIdx ? colors.text : colors.accent2
          ctx.arc(p.x, p.y, i === hoverIdx ? 6 : 3, 0, Math.PI * 2)
          ctx.fill()
          if (i === hoverIdx) { ctx.strokeStyle = colors.accent2; ctx.lineWidth = 2; ctx.stroke() }
        })

        // Y-axis labels
        ctx.fillStyle = colors.muted
        ctx.font = '11px -apple-system, sans-serif'
        ctx.textAlign = 'right'
        for (let i = 0; i <= 4; i++) {
          ctx.fillText(fmt(Math.round(maxV - (maxV/4)*i)), pad.left-10, pad.top+(h/4)*i+4)
        }

        // X-axis labels - smart distribution based on data length
        ctx.textAlign = 'center'
        const n = timeSeriesData.length
        let maxLabels = 7
        // Adjust label count based on time range
        if (dateRange === '1h') maxLabels = Math.min(n, 7) // 5-min buckets, show ~7 labels
        else if (dateRange === '6h') maxLabels = Math.min(n, 7)
        else if (dateRange === '12h') maxLabels = Math.min(n, 7)
        else if (dateRange === '24h') maxLabels = Math.min(n, 8)

        if (n === 1) {
          // Single data point: show just that label centered
          ctx.fillText(fmtDate(timeSeriesData[0].date), pad.left + w / 2, logicalH - 10)
        } else if (n <= maxLabels) {
          // Few points: show all labels
          timeSeriesData.forEach((d, i) => {
            ctx.fillText(fmtDate(d.date), pad.left + i * xS, logicalH - 10)
          })
        } else {
          // Many points: distribute labels evenly
          const step = (n - 1) / (maxLabels - 1)
          for (let j = 0; j < maxLabels; j++) {
            const i = Math.round(j * step)
            const d = timeSeriesData[i]
            ctx.fillText(fmtDate(d.date), pad.left + i * xS, logicalH - 10)
          }
        }

        // Hover line
        if (hoverIdx >= 0) {
          ctx.beginPath()
          ctx.strokeStyle = colors.accent2 + '80' // 0.5 alpha
          ctx.lineWidth = 1
          ctx.setLineDash([4, 4])
          ctx.moveTo(points[hoverIdx].x, pad.top)
          ctx.lineTo(points[hoverIdx].x, pad.top + h)
          ctx.stroke()
          ctx.setLineDash([])
        }
        ctx.restore()
      }

      draw(-1)

      canvas.onmousemove = function(e) {
        const cr = canvas.getBoundingClientRect()
        const mx = e.clientX - cr.left
        let closest = -1, minDist = 30
        points.forEach((p, i) => { const d = Math.abs(mx - p.x); if (d < minDist) { minDist = d; closest = i } })
        if (closest >= 0) {
          const p = points[closest], d = p.data
          tooltip.innerHTML = '<div style="color:var(--muted);font-size:11px;margin-bottom:6px;font-weight:500">' + fmtDateFull(d.date) + '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:8px;height:8px;background:var(--accent2);border-radius:2px"></span>Views: <strong style="margin-left:auto">' + fmt(d.views || d.count || 0) + '</strong></div>' +
            '<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:8px;height:8px;background:var(--success);border-radius:2px"></span>Visitors: <strong style="margin-left:auto">' + fmt(d.visitors || 0) + '</strong></div>'
          tooltip.style.display = 'block'
          let left = p.x + 10; if (left + 150 > logicalW) left = p.x - 160
          tooltip.style.left = left + 'px'
          tooltip.style.top = (p.y - 20) + 'px'
          draw(closest)
          canvas.style.cursor = 'pointer'
        } else {
          tooltip.style.display = 'none'
          draw(-1)
          canvas.style.cursor = 'default'
        }
      }
      canvas.onmouseleave = function() { tooltip.style.display = 'none'; draw(-1) }
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
    :root { --bg: #0f1117; --bg2: #1a1d27; --bg3: #252836; --text: #f3f4f6; --text2: #9ca3af; --muted: #6b7280; --accent: #6366f1; --accent2: #818cf8; --success: #10b981; --border: #2d3139; --warning: #f59e0b; --error: #ef4444; --overlay: rgba(0,0,0,0.7) }
    [data-theme="light"] { --bg: #f8fafc; --bg2: #ffffff; --bg3: #f1f5f9; --text: #0f172a; --text2: #475569; --muted: #64748b; --accent: #4f46e5; --accent2: #6366f1; --success: #059669; --border: #e2e8f0; --warning: #d97706; --error: #dc2626; --overlay: rgba(0,0,0,0.5) }
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
    .header-left { display: flex; align-items: center; gap: 1rem; flex-shrink: 0 }
    .back-btn { background: none; border: none; color: var(--muted); cursor: pointer; padding: 0.5rem; border-radius: 6px; display: flex; align-items: center; justify-content: center }
    .back-btn:hover { background: var(--bg2); color: var(--text) }
    .site-name-header { font-size: 1.25rem; font-weight: 600 }
    .header-nav { display: flex; align-items: center; gap: 0.25rem }
    .nav-btn { background: none; border: none; color: var(--muted); padding: 0.5rem 0.875rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; transition: all 0.15s; white-space: nowrap }
    .nav-btn:hover { color: var(--text); background: var(--bg2) }
    .nav-btn.active { color: var(--accent); background: var(--bg2) }
    .header-right { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0 }
    .realtime-badge { display: flex; align-items: center; gap: 0.5rem; background: var(--bg2); padding: 0.5rem 1rem; border-radius: 9999px; font-size: 0.875rem }
    .pulse { width: 8px; height: 8px; background: var(--success); border-radius: 50%; animation: pulse 2s infinite }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }

    /* Controls */
    .controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; gap: 1rem; flex-wrap: wrap }
    .controls-right { display: flex; align-items: center; gap: 0.75rem }
    .date-range { display: flex; gap: 0.25rem; background: var(--bg2); padding: 0.25rem; border-radius: 8px }
    .date-btn { background: none; border: none; color: var(--muted); padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; transition: all 0.15s }
    .date-btn:hover { color: var(--text) }
    .date-btn.active { background: var(--accent); color: white }
    .last-updated { font-size: 0.75rem; color: var(--muted) }
    .refresh-btn { background: var(--bg2); border: 1px solid var(--border); color: var(--text2); padding: 0.5rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s }
    .refresh-btn:hover { border-color: var(--accent); color: var(--text) }
    .refresh-btn.spinning svg { animation: spinReverse 1s linear infinite }
    @keyframes spinReverse { to { transform: rotate(-360deg) } }
    .filters-row { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap }

    /* Theme Toggle */
    .theme-toggle { background: var(--bg2); border: 1px solid var(--border); color: var(--text2); padding: 0.5rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s }
    .theme-toggle:hover { border-color: var(--accent); color: var(--text) }

    /* Export Button (icon only in header) */
    .export-btn { display: flex; align-items: center; justify-content: center; background: var(--bg2); border: 1px solid var(--border); color: var(--text2); padding: 0.5rem; border-radius: 6px; cursor: pointer; transition: all 0.15s }
    .export-btn:hover { border-color: var(--accent); color: var(--text) }

    /* Filters */
    .filter-select { background: var(--bg2); border: 1px solid var(--border); color: var(--text); padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.8125rem; cursor: pointer }
    .filter-select:hover { border-color: var(--accent) }

    /* Comparison Stats */
    .stat-change { font-size: 0.6875rem; margin-top: 0.25rem }
    .stat-change.positive { color: var(--success) }
    .stat-change.negative { color: var(--error) }

    /* Tab Content Sections */
    .tab-content { display: none }
    .tab-content.active { display: block }

    /* Sessions List */
    .session-list { display: flex; flex-direction: column; gap: 0.5rem }
    .session-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; cursor: pointer; transition: all 0.15s }
    .session-card:hover { border-color: var(--accent) }
    .session-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem }
    .session-meta { display: flex; gap: 1rem; font-size: 0.75rem; color: var(--muted) }
    .session-pages { font-size: 0.8125rem; color: var(--text2) }

    /* Vitals Cards */
    .vitals-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem }
    .vital-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; text-align: center }
    .vital-name { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; margin-bottom: 0.5rem }
    .vital-value { font-size: 1.5rem; font-weight: 600 }
    .vital-value.good { color: var(--success) }
    .vital-value.needs-improvement { color: var(--warning) }
    .vital-value.poor { color: var(--error) }
    .vital-bar { height: 4px; background: var(--bg3); border-radius: 2px; margin-top: 0.5rem; overflow: hidden; display: flex }
    .vital-bar span { height: 100% }
    .vital-bar .good { background: var(--success) }
    .vital-bar .needs-improvement { background: var(--warning) }
    .vital-bar .poor { background: var(--error) }

    /* Error Cards */
    .error-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 0.5rem }
    .error-message { color: var(--error); font-family: monospace; font-size: 0.8125rem; margin-bottom: 0.5rem; word-break: break-word }
    .error-meta { display: flex; gap: 1rem; font-size: 0.75rem; color: var(--muted) }
    .error-stack { font-family: monospace; font-size: 0.6875rem; color: var(--muted); background: var(--bg); padding: 0.5rem; border-radius: 4px; margin-top: 0.5rem; overflow-x: auto; white-space: pre-wrap; max-height: 100px }

    /* Insights Cards */
    .insight-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; gap: 1rem; align-items: flex-start }
    .insight-icon { width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0 }
    .insight-icon.positive { background: rgba(16,185,129,0.1); color: var(--success) }
    .insight-icon.negative { background: rgba(239,68,68,0.1); color: var(--error) }
    .insight-icon.neutral { background: rgba(99,102,241,0.1); color: var(--accent) }
    .insight-content { flex: 1 }
    .insight-title { font-weight: 500; margin-bottom: 0.25rem }
    .insight-desc { font-size: 0.8125rem; color: var(--muted) }

    /* Session Detail Modal */
    .modal-overlay { position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: center; justify-content: center; z-index: 1000; display: none }
    .modal-overlay.active { display: flex }
    .modal { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; width: 90%; max-width: 800px; max-height: 90vh; overflow: auto }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 1 }
    .modal-header h3 { font-size: 1rem }
    .modal-close { background: none; border: none; color: var(--muted); cursor: pointer; padding: 0.5rem }
    .modal-close:hover { color: var(--text) }
    .modal-body { padding: 1rem }
    .timeline-item { display: flex; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid var(--bg3) }
    .timeline-item:last-child { border-bottom: none }
    .timeline-type { width: 80px; font-size: 0.6875rem; text-transform: uppercase; color: var(--muted) }
    .timeline-content { flex: 1; font-size: 0.8125rem }
    .timeline-time { font-size: 0.6875rem; color: var(--muted) }

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
    .chart-tooltip { display: none; position: absolute; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); pointer-events: none; z-index: 100; min-width: 140px }

    /* Grid & Panels */
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem }
    .panel { background: var(--bg2); border-radius: 8px; padding: 1rem; border: 1px solid var(--border) }
    .panel-title { font-size: 0.875rem; font-weight: 500; margin-bottom: 1rem; color: var(--text2); display: flex; align-items: center; gap: 0.5rem }
    .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem }
    .panel-header .panel-title { margin-bottom: 0 }
    .view-all { font-size: 0.75rem; color: var(--muted); text-decoration: none; opacity: 0.7; transition: all 0.2s }
    .view-all:hover { opacity: 1; color: var(--text2) }

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
    .icon-btn.danger:hover { color: var(--error) }
    .goal-type-badge { font-size: 0.7rem; padding: 0.2rem 0.5rem; border-radius: 4px; text-transform: uppercase; font-weight: 500 }
    .goal-type-badge.pageview { background: rgba(99,102,241,0.2); color: var(--accent) }
    .goal-type-badge.event { background: rgba(16,185,129,0.2); color: var(--success) }
    .goal-type-badge.duration { background: rgba(245,158,11,0.2); color: #f59e0b }

    /* Modal */
    .modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--overlay); display: flex; align-items: center; justify-content: center; z-index: 1000 }
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
    @media (max-width: 1200px) { .header { flex-wrap: wrap } .header-nav { order: 3; width: 100%; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border); overflow-x: auto; -webkit-overflow-scrolling: touch } .header-nav::-webkit-scrollbar { display: none } }
    @media (max-width: 1024px) { .stats { grid-template-columns: repeat(3, 1fr) } .grid { grid-template-columns: 1fr } }
    @media (max-width: 640px) { .stats { grid-template-columns: repeat(2, 1fr) } .controls { flex-direction: column; align-items: stretch } .controls-right { justify-content: space-between } .date-range { justify-content: center } .filters-row { justify-content: center } .nav-btn { padding: 0.5rem 0.625rem; font-size: 0.8125rem } }
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
      <nav class="header-nav">
        <button class="nav-btn active" data-tab="dashboard" onclick="switchTab('dashboard')">Dashboard</button>
        <button class="nav-btn" data-tab="sessions" onclick="switchTab('sessions')">Sessions</button>
        <button class="nav-btn" data-tab="flow" onclick="switchTab('flow')">User Flow</button>
        <button class="nav-btn" data-tab="vitals" onclick="switchTab('vitals')">Web Vitals</button>
        <button class="nav-btn" data-tab="errors" onclick="switchTab('errors')">Errors</button>
        <button class="nav-btn" data-tab="insights" onclick="switchTab('insights')">Insights</button>
      </nav>
      <div class="header-right">
        <button id="theme-toggle" class="theme-toggle" onclick="toggleTheme()" title="Toggle dark/light mode">
          <svg id="theme-icon-dark" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
          <svg id="theme-icon-light" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="display:none"><circle cx="12" cy="12" r="5" stroke-width="2"/><path stroke-linecap="round" stroke-width="2" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        </button>
      </div>
    </header>

    <div class="controls">
      <div class="date-range">
        <button class="date-btn" data-range="1h" onclick="setDateRange('1h')">1h</button>
        <button class="date-btn active" data-range="6h" onclick="setDateRange('6h')">6h</button>
        <button class="date-btn" data-range="12h" onclick="setDateRange('12h')">12h</button>
        <button class="date-btn" data-range="24h" onclick="setDateRange('24h')">24h</button>
        <button class="date-btn" data-range="7d" onclick="setDateRange('7d')">7d</button>
        <button class="date-btn" data-range="30d" onclick="setDateRange('30d')">30d</button>
        <button class="date-btn" data-range="90d" onclick="setDateRange('90d')">90d</button>
      </div>
      <div class="controls-right">
        <div class="realtime-badge"><span class="pulse"></span><span id="realtime-count">0 visitors online</span></div>
        <span id="last-updated" class="last-updated"></span>
        <button id="refresh-btn" class="refresh-btn" onclick="fetchDashboardData()" title="Refresh data">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
        </button>
        <button class="export-btn" onclick="exportData('csv')" title="Export CSV">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        </button>
      </div>
    </div>

    <div class="filters-row">
      <select id="filter-country" class="filter-select" onchange="applyFilter('country', this.value)">
        <option value="">All Countries</option>
      </select>
      <select id="filter-device" class="filter-select" onchange="applyFilter('device', this.value)">
        <option value="">All Devices</option>
        <option value="desktop">Desktop</option>
        <option value="mobile">Mobile</option>
        <option value="tablet">Tablet</option>
      </select>
      <select id="filter-browser" class="filter-select" onchange="applyFilter('browser', this.value)">
        <option value="">All Browsers</option>
      </select>
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
      <div class="chart-box" style="position:relative">
        <div class="chart-title">Pageviews Over Time</div>
        <canvas id="chart"></canvas>
        <div id="chartTooltip" class="chart-tooltip"></div>
        <div id="chart-empty" class="chart-empty">
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="opacity:0.5;margin-bottom:0.5rem"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          <p>No time series data available</p>
        </div>
      </div>

      <div class="grid">
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>Top Pages</div>
            <a href="#" onclick="navigateTo('pages')" class="view-all">View all &rarr;</a>
          </div>
          <table class="data-table">
            <thead><tr><th>Path</th><th style="text-align:right">Entries</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th></tr></thead>
            <tbody id="pages-body"><tr><td colspan="4" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>Top Referrers</div>
            <a href="#" onclick="navigateTo('referrers')" class="view-all">View all &rarr;</a>
          </div>
          <table class="data-table">
            <thead><tr><th>Source</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th></tr></thead>
            <tbody id="referrers-body"><tr><td colspan="3" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="grid">
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>Devices</div>
            <a href="#" onclick="navigateTo('devices')" class="view-all">View all &rarr;</a>
          </div>
          <table class="data-table">
            <thead><tr><th>Type</th><th style="text-align:right">Visitors</th><th style="text-align:right">%</th></tr></thead>
            <tbody id="devices-body"><tr><td colspan="3" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>Browsers</div>
            <a href="#" onclick="navigateTo('browsers')" class="view-all">View all &rarr;</a>
          </div>
          <table class="data-table">
            <thead><tr><th>Browser</th><th style="text-align:right">Visitors</th><th style="text-align:right">%</th></tr></thead>
            <tbody id="browsers-body"><tr><td colspan="3" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="grid">
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Countries</div>
            <a href="#" onclick="navigateTo('countries')" class="view-all">View all &rarr;</a>
          </div>
          <table class="data-table">
            <thead><tr><th>Country</th><th style="text-align:right">Visitors</th></tr></thead>
            <tbody id="countries-body"><tr><td colspan="2" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg>Campaigns</div>
            <a href="#" onclick="navigateTo('campaigns')" class="view-all">View all &rarr;</a>
          </div>
          <table class="data-table">
            <thead><tr><th>Campaign</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th></tr></thead>
            <tbody id="campaigns-body"><tr><td colspan="3" class="empty-cell">Loading...</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="events">
        <div class="panel-header">
          <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>Custom Events</div>
          <a href="#" onclick="navigateTo('events')" class="view-all">View all &rarr;</a>
        </div>
        <div id="events-container"><div class="empty-cell">Loading...</div></div>
      </div>

      <div class="goals-section">
        <div class="panel-header">
          <div class="panel-title"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Goals</div>
          <div style="display:flex;gap:1rem;align-items:center">
            <a href="#" onclick="navigateTo('goals')" class="view-all">View all &rarr;</a>
            <button onclick="showCreateGoalModal()" class="create-goal-btn">+ Add Goal</button>
          </div>
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

    // =========================================================================
    // SQS Fast Path - Queue events for async processing
    // This reduces Lambda execution time and handles traffic spikes better
    // =========================================================================
    if (SQS_ENABLED) {
      try {
        const producer = await getSQSProducer()
        if (producer) {
          const timestamp = new Date()
          const salt = getDailySalt()
          const visitorId = await hashVisitorId(ip, userAgent, payload.s, salt)

          // Parse device info for the event
          const deviceInfo = parseUserAgent(userAgent)
          const referrerSource = parseReferrerSource(payload.r)

          let parsedUrl: URL
          try {
            parsedUrl = new URL(payload.u)
          }
          catch {
            return response({ error: 'Invalid URL' }, 400)
          }

          // Get country from headers
          const country = getCountryFromHeaders(event.headers)

          // Build analytics event for SQS
          const analyticsEvent: AnalyticsEvent = {
            type: payload.e === 'pageview' ? 'pageview' : payload.e === 'event' ? 'event' : 'event',
            siteId: payload.s,
            timestamp: timestamp.toISOString(),
            data: {
              id: generateId(),
              siteId: payload.s,
              visitorId,
              sessionId: payload.sid,
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
              isUnique: true, // Will be determined by consumer
              isBounce: true, // Will be determined by consumer
              timestamp,
              // For custom events
              ...(payload.e === 'event' && payload.p && {
                name: payload.p.name || 'unnamed',
                value: payload.p.value,
                properties: payload.p,
              }),
            },
          }

          await producer.sendEvent(analyticsEvent)
          console.log(`[Collect] Queued ${payload.e} event to SQS for site ${payload.s}`)

          // Return fast - 204 No Content
          return response(null, 204)
        }
      }
      catch (sqsError) {
        // Fall back to direct write if SQS fails
        console.error('[Collect] SQS send failed, falling back to direct write:', sqsError)
      }
    }

    // =========================================================================
    // Direct Write Path - Traditional synchronous DynamoDB writes
    // =========================================================================
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
    else if (payload.e === 'vitals') {
      // Handle Core Web Vitals event (LCP, FID, CLS, TTFB, INP)
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshall({
          pk: `SITE#${payload.s}`,
          sk: `VITAL#${timestamp.toISOString()}#${generateId()}`,
          siteId: payload.s,
          sessionId,
          visitorId,
          path: parsedUrl.pathname,
          metric: props.metric || 'unknown',
          value: props.value || 0,
          rating: props.rating || 'unknown',
          deviceType: deviceInfo.deviceType,
          browser: deviceInfo.browser,
          timestamp: timestamp.toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days TTL
        }),
      })
    }
    else if (payload.e === 'error') {
      // Handle JavaScript error event
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshall({
          pk: `SITE#${payload.s}`,
          sk: `ERROR#${timestamp.toISOString()}#${generateId()}`,
          siteId: payload.s,
          sessionId,
          visitorId,
          path: parsedUrl.pathname,
          message: String(props.message || '').slice(0, 500),
          source: props.source || '',
          line: props.line || 0,
          col: props.col || 0,
          stack: String(props.stack || '').slice(0, 2000),
          deviceType: deviceInfo.deviceType,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          timestamp: timestamp.toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days TTL
        }),
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
  const minimal = event.queryStringParameters?.minimal === 'true'
  const stealth = event.queryStringParameters?.stealth === 'true'

  // Use stealth domain (a.stacksjs.com) if stealth mode is requested
  const defaultEndpoint = `https://${event.requestContext?.domainName}`
  const stealthEndpoint = process.env.STEALTH_DOMAIN ? `https://${process.env.STEALTH_DOMAIN}` : defaultEndpoint
  const apiEndpoint = event.queryStringParameters?.api || (stealth ? stealthEndpoint : defaultEndpoint)

  if (!siteId) {
    return response({ error: 'Missing siteId' }, 400)
  }

  const script = minimal
    ? generateMinimalTrackingScript({ siteId, apiEndpoint, honorDnt: true, stealthMode: stealth })
    : generateTrackingScript({ siteId, apiEndpoint, honorDnt: true, trackOutboundLinks: true, stealthMode: stealth })

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
// Detail Pages
// ============================================================================

async function handleDetailPage(section: string, event: LambdaEvent) {
  const siteId = event.queryStringParameters?.siteId || ''

  const sectionTitles: Record<string, string> = {
    pages: 'All Pages',
    referrers: 'All Referrers',
    devices: 'Devices & OS',
    browsers: 'All Browsers',
    countries: 'All Countries',
    campaigns: 'All Campaigns',
    events: 'All Events',
    goals: 'Goals',
  }

  const sectionIcons: Record<string, string> = {
    pages: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
    referrers: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>',
    devices: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>',
    browsers: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>',
    countries: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    campaigns: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg>',
    events: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>',
    goals: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sectionTitles[section]} - Analytics</title>
  <style>
    :root { --bg: #0f0f0f; --bg2: #1a1a1a; --bg3: #252525; --text: #fff; --text2: #e5e5e5; --muted: #888; --border: #333; --primary: #818cf8 }
    [data-theme="light"] { --bg: #f8fafc; --bg2: #ffffff; --bg3: #f1f5f9; --text: #0f172a; --text2: #475569; --muted: #64748b; --border: #e2e8f0; --primary: #4f46e5 }
    * { margin: 0; padding: 0; box-sizing: border-box }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem }
    .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem }
    .back-btn { display: flex; align-items: center; gap: 0.5rem; color: var(--muted); text-decoration: none; font-size: 0.875rem; padding: 0.5rem 1rem; border-radius: 6px; transition: all 0.2s }
    .back-btn:hover { background: var(--bg2); color: var(--text) }
    .page-title { display: flex; align-items: center; gap: 0.75rem; font-size: 1.5rem; font-weight: 600; color: var(--text) }
    .page-title svg { color: var(--primary) }
    .date-range { display: flex; gap: 0.5rem; margin-bottom: 1.5rem }
    .date-btn { padding: 0.5rem 1rem; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; color: var(--muted); cursor: pointer; font-size: 0.8125rem; transition: all 0.2s }
    .date-btn:hover { color: var(--text); border-color: var(--primary) }
    .date-btn.active { background: var(--primary); color: #fff; border-color: var(--primary) }
    .panel { background: var(--bg2); border-radius: 8px; padding: 1.5rem; border: 1px solid var(--border) }
    .data-table { width: 100%; font-size: 0.875rem; border-collapse: collapse }
    .data-table th { text-align: left; color: var(--muted); font-weight: 500; padding: 0.75rem 0.5rem; border-bottom: 1px solid var(--border); font-size: 0.75rem; text-transform: uppercase }
    .data-table td { padding: 0.75rem 0.5rem; border-bottom: 1px solid var(--bg3) }
    .data-table tr:hover { background: var(--bg3) }
    .name { color: var(--text); display: flex; align-items: center; gap: 0.5rem }
    .value { text-align: right; color: var(--text2) }
    .empty-cell { color: var(--muted); text-align: center; padding: 2rem }
    .loading { text-align: center; padding: 3rem; color: var(--muted) }
    .bar { height: 4px; background: var(--bg3); border-radius: 2px; margin-top: 4px; overflow: hidden }
    .bar-fill { height: 100%; background: var(--primary); border-radius: 2px }
    @media (max-width: 768px) { .container { padding: 1rem } .date-range { flex-wrap: wrap } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <a href="/dashboard?siteId=${encodeURIComponent(siteId)}" class="back-btn">
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
        Back to Dashboard
      </a>
    </div>
    <h1 class="page-title">${sectionIcons[section]}${sectionTitles[section]}</h1>
    <div class="date-range" style="margin-top:1.5rem">
      <button class="date-btn" data-range="1h">1h</button>
      <button class="date-btn active" data-range="6h">6h</button>
      <button class="date-btn" data-range="12h">12h</button>
      <button class="date-btn" data-range="24h">24h</button>
      <button class="date-btn" data-range="7d">7 days</button>
      <button class="date-btn" data-range="30d">30 days</button>
      <button class="date-btn" data-range="90d">90 days</button>
    </div>
    <div class="panel">
      <div id="content" class="loading">Loading...</div>
    </div>
  </div>
  <script>
    // Theme initialization - sync with main dashboard
    function getPreferredTheme() {
      const stored = localStorage.getItem('ts-analytics-theme')
      if (stored) return stored
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
    document.documentElement.setAttribute('data-theme', getPreferredTheme())

    const siteId = '${siteId}'
    const section = '${section}'
    let dateRange = '6h'

    document.querySelectorAll('.date-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        dateRange = btn.dataset.range
        document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        fetchData()
      })
    })

    function getDateRangeParams() {
      const now = new Date()
      const end = now.toISOString()
      let start
      switch(dateRange) {
        case '1h': start = new Date(now - 1*60*60*1000); break
        case '6h': start = new Date(now - 6*60*60*1000); break
        case '12h': start = new Date(now - 12*60*60*1000); break
        case '24h': start = new Date(now - 24*60*60*1000); break
        case '7d': start = new Date(now - 7*24*60*60*1000); break
        case '30d': start = new Date(now - 30*24*60*60*1000); break
        case '90d': start = new Date(now - 90*24*60*60*1000); break
        default: start = new Date(now - 30*24*60*60*1000)
      }
      return '?startDate=' + start.toISOString() + '&endDate=' + end + '&limit=100'
    }

    function fmt(n) { return n >= 1000 ? (n/1000).toFixed(1) + 'k' : n.toString() }

    function getDeviceIcon(type) {
      if (type === 'Desktop') return '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'
      if (type === 'Mobile') return '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>'
      if (type === 'Tablet') return '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>'
      return '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
    }

    function getBrowserIcon(name) {
      const n = name?.toLowerCase() || ''
      if (n.includes('chrome')) return '<svg width="14" height="14" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="10" fill="#4285f4"/><circle cx="12" cy="12" r="4" fill="#fff"/></svg>'
      if (n.includes('firefox')) return '<svg width="14" height="14" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="10" fill="#ff9500"/></svg>'
      if (n.includes('safari')) return '<svg width="14" height="14" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="10" fill="#006cff"/></svg>'
      if (n.includes('edge')) return '<svg width="14" height="14" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="10" fill="#0078d7"/></svg>'
      return '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/></svg>'
    }

    function getCountryFlag(name) {
      const flags = { 'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Germany': '🇩🇪', 'France': '🇫🇷', 'Canada': '🇨🇦', 'Australia': '🇦🇺', 'Japan': '🇯🇵', 'China': '🇨🇳', 'India': '🇮🇳', 'Brazil': '🇧🇷', 'Netherlands': '🇳🇱', 'Spain': '🇪🇸', 'Italy': '🇮🇹', 'Sweden': '🇸🇪', 'Norway': '🇳🇴', 'Denmark': '🇩🇰', 'Finland': '🇫🇮', 'Poland': '🇵🇱', 'Russia': '🇷🇺', 'South Korea': '🇰🇷', 'Mexico': '🇲🇽', 'Argentina': '🇦🇷', 'Singapore': '🇸🇬', 'New Zealand': '🇳🇿', 'Ireland': '🇮🇪', 'Switzerland': '🇨🇭', 'Austria': '🇦🇹', 'Belgium': '🇧🇪', 'Portugal': '🇵🇹', 'Czech Republic': '🇨🇿', 'Unknown': '🌐' }
      return flags[name] || '🌐'
    }

    async function fetchData() {
      const content = document.getElementById('content')
      content.innerHTML = '<div class="loading">Loading...</div>'
      const params = getDateRangeParams()
      try {
        const res = await fetch('/api/sites/' + encodeURIComponent(siteId) + '/' + section + params)
        const data = await res.json()
        renderContent(data)
      } catch (err) {
        content.innerHTML = '<div class="empty-cell">Failed to load data</div>'
      }
    }

    function renderContent(data) {
      const content = document.getElementById('content')
      let html = ''

      if (section === 'pages') {
        const pages = data.pages || []
        if (!pages.length) { content.innerHTML = '<div class="empty-cell">No page data</div>'; return }
        const maxViews = Math.max(...pages.map(p => p.views || 0))
        html = '<table class="data-table"><thead><tr><th>Path</th><th style="text-align:right">Entries</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th><th style="width:100px"></th></tr></thead><tbody>'
        pages.forEach(p => {
          const pct = maxViews > 0 ? ((p.views || 0) / maxViews * 100) : 0
          html += '<tr><td class="name">' + (p.path || p.url || '/') + '</td><td class="value">' + fmt(p.entries || 0) + '</td><td class="value">' + fmt(p.visitors || 0) + '</td><td class="value">' + fmt(p.views || 0) + '</td><td><div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></td></tr>'
        })
        html += '</tbody></table>'
      }
      else if (section === 'referrers') {
        const referrers = data.referrers || []
        if (!referrers.length) { content.innerHTML = '<div class="empty-cell">No referrer data</div>'; return }
        const maxViews = Math.max(...referrers.map(r => r.views || 0))
        html = '<table class="data-table"><thead><tr><th>Source</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th><th style="width:100px"></th></tr></thead><tbody>'
        referrers.forEach(r => {
          const pct = maxViews > 0 ? ((r.views || 0) / maxViews * 100) : 0
          html += '<tr><td class="name">' + (r.source || 'Direct') + '</td><td class="value">' + fmt(r.visitors || 0) + '</td><td class="value">' + fmt(r.views || 0) + '</td><td><div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></td></tr>'
        })
        html += '</tbody></table>'
      }
      else if (section === 'devices') {
        const devices = data.deviceTypes || []
        const os = data.operatingSystems || []
        html = '<h3 style="font-size:1rem;margin-bottom:1rem;color:var(--text2)">Device Types</h3>'
        if (!devices.length) { html += '<div class="empty-cell">No device data</div>' }
        else {
          html += '<table class="data-table"><thead><tr><th>Type</th><th style="text-align:right">Visitors</th><th style="text-align:right">%</th></tr></thead><tbody>'
          devices.forEach(d => { html += '<tr><td class="name">' + getDeviceIcon(d.type) + d.type + '</td><td class="value">' + fmt(d.visitors || 0) + '</td><td class="value">' + (d.percentage || 0) + '%</td></tr>' })
          html += '</tbody></table>'
        }
        if (os.length) {
          html += '<h3 style="font-size:1rem;margin:2rem 0 1rem;color:var(--text2)">Operating Systems</h3>'
          html += '<table class="data-table"><thead><tr><th>OS</th><th style="text-align:right">Visitors</th><th style="text-align:right">%</th></tr></thead><tbody>'
          os.forEach(o => { html += '<tr><td class="name">' + o.name + '</td><td class="value">' + fmt(o.visitors || 0) + '</td><td class="value">' + (o.percentage || 0) + '%</td></tr>' })
          html += '</tbody></table>'
        }
      }
      else if (section === 'browsers') {
        const browsers = data.browsers || []
        if (!browsers.length) { content.innerHTML = '<div class="empty-cell">No browser data</div>'; return }
        html = '<table class="data-table"><thead><tr><th>Browser</th><th style="text-align:right">Visitors</th><th style="text-align:right">%</th></tr></thead><tbody>'
        browsers.forEach(b => { html += '<tr><td class="name">' + getBrowserIcon(b.name) + b.name + '</td><td class="value">' + fmt(b.visitors || 0) + '</td><td class="value">' + (b.percentage || 0) + '%</td></tr>' })
        html += '</tbody></table>'
      }
      else if (section === 'countries') {
        const countries = data.countries || []
        if (!countries.length) { content.innerHTML = '<div class="empty-cell">No country data</div>'; return }
        const maxVisitors = Math.max(...countries.map(c => c.visitors || 0))
        html = '<table class="data-table"><thead><tr><th>Country</th><th style="text-align:right">Visitors</th><th style="width:100px"></th></tr></thead><tbody>'
        countries.forEach(c => {
          const pct = maxVisitors > 0 ? ((c.visitors || 0) / maxVisitors * 100) : 0
          html += '<tr><td class="name"><span style="margin-right:8px">' + getCountryFlag(c.name) + '</span>' + (c.name || 'Unknown') + '</td><td class="value">' + fmt(c.visitors || 0) + '</td><td><div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></td></tr>'
        })
        html += '</tbody></table>'
      }
      else if (section === 'campaigns') {
        const campaigns = data.campaigns || []
        if (!campaigns.length) { content.innerHTML = '<div class="empty-cell">No campaign data</div>'; return }
        const maxViews = Math.max(...campaigns.map(c => c.views || 0))
        html = '<table class="data-table"><thead><tr><th>Campaign</th><th>Source</th><th>Medium</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th><th style="width:100px"></th></tr></thead><tbody>'
        campaigns.forEach(c => {
          const pct = maxViews > 0 ? ((c.views || 0) / maxViews * 100) : 0
          html += '<tr><td class="name">' + (c.name || '-') + '</td><td>' + (c.source || '-') + '</td><td>' + (c.medium || '-') + '</td><td class="value">' + fmt(c.visitors || 0) + '</td><td class="value">' + fmt(c.views || 0) + '</td><td><div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></td></tr>'
        })
        html += '</tbody></table>'
      }
      else if (section === 'events') {
        const events = data.events || []
        if (!events.length) { content.innerHTML = '<div class="empty-cell">No custom events tracked</div>'; return }
        const maxCount = Math.max(...events.map(e => e.count || 0))
        html = '<table class="data-table"><thead><tr><th>Event</th><th style="text-align:right">Count</th><th style="text-align:right">Unique</th><th style="text-align:right">Avg Value</th><th style="width:100px"></th></tr></thead><tbody>'
        events.forEach(e => {
          const pct = maxCount > 0 ? ((e.count || 0) / maxCount * 100) : 0
          html += '<tr><td class="name">' + e.name + '</td><td class="value">' + fmt(e.count || 0) + '</td><td class="value">' + fmt(e.unique || e.visitors || 0) + '</td><td class="value">' + (e.avgValue ? e.avgValue.toFixed(2) : '-') + '</td><td><div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></td></tr>'
        })
        html += '</tbody></table>'
      }
      else if (section === 'goals') {
        const goals = data.goals || []
        if (!goals.length) { content.innerHTML = '<div class="empty-cell">No goals configured</div>'; return }
        html = '<table class="data-table"><thead><tr><th>Goal</th><th>Type</th><th>Pattern</th><th style="text-align:right">Conversions</th><th style="text-align:right">Value</th></tr></thead><tbody>'
        goals.forEach(g => {
          html += '<tr><td class="name">' + g.name + '</td><td>' + g.type + '</td><td>' + (g.pattern || '-') + '</td><td class="value">' + fmt(g.conversions || 0) + '</td><td class="value">' + (g.totalValue ? '$' + g.totalValue.toFixed(2) : '-') + '</td></tr>'
        })
        html += '</tbody></table>'
      }

      content.innerHTML = html
    }

    fetchData()
  </script>
</body>
</html>`

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
    },
    body: html,
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

async function handleGetRegions(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)
    const countryFilter = event.queryStringParameters?.country

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
      if (sessionStart < startDate || sessionStart > endDate) return false
      if (countryFilter && s.country !== countryFilter) return false
      return true
    })

    // Aggregate by region
    const regionStats: Record<string, { visitors: Set<string>, country: string }> = {}
    for (const s of sessions) {
      const region = s.region || 'Unknown'
      const country = s.country || 'Unknown'
      const key = `${country}:${region}`
      if (!regionStats[key]) regionStats[key] = { visitors: new Set(), country }
      regionStats[key].visitors.add(s.visitorId)
    }

    const regions = Object.entries(regionStats)
      .map(([key, data]) => {
        const region = key.split(':')[1]
        return { name: region, country: data.country, visitors: data.visitors.size }
      })
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ regions })
  } catch (error) {
    console.error('Regions error:', error)
    return response({ error: 'Failed to fetch regions' }, 500)
  }
}

async function handleGetCities(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)
    const countryFilter = event.queryStringParameters?.country
    const regionFilter = event.queryStringParameters?.region

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
      if (sessionStart < startDate || sessionStart > endDate) return false
      if (countryFilter && s.country !== countryFilter) return false
      if (regionFilter && s.region !== regionFilter) return false
      return true
    })

    // Aggregate by city
    const cityStats: Record<string, { visitors: Set<string>, country: string, region: string }> = {}
    for (const s of sessions) {
      const city = s.city || 'Unknown'
      const region = s.region || 'Unknown'
      const country = s.country || 'Unknown'
      const key = `${country}:${region}:${city}`
      if (!cityStats[key]) cityStats[key] = { visitors: new Set(), country, region }
      cityStats[key].visitors.add(s.visitorId)
    }

    const cities = Object.entries(cityStats)
      .map(([key, data]) => {
        const city = key.split(':')[2]
        return { name: city, country: data.country, region: data.region, visitors: data.visitors.size }
      })
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ cities })
  } catch (error) {
    console.error('Cities error:', error)
    return response({ error: 'Failed to fetch cities' }, 500)
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

    // Generate all time buckets in the range
    const allBuckets: string[] = []
    const current = new Date(startDate)
    const end = new Date(endDate)

    while (current <= end) {
      let key: string
      if (period === 'minute') {
        // 5-minute buckets for granular view
        const mins = Math.floor(current.getUTCMinutes() / 5) * 5
        key = `${current.toISOString().slice(0, 14)}${mins.toString().padStart(2, '0')}:00.000Z`
        current.setMinutes(current.getMinutes() + 5)
      } else if (period === 'hour') {
        key = `${current.toISOString().slice(0, 13)}:00:00.000Z`
        current.setHours(current.getHours() + 1)
      } else if (period === 'month') {
        key = `${current.toISOString().slice(0, 7)}-01T00:00:00.000Z`
        current.setMonth(current.getMonth() + 1)
      } else {
        key = `${current.toISOString().slice(0, 10)}T00:00:00.000Z`
        current.setDate(current.getDate() + 1)
      }
      if (!allBuckets.includes(key)) allBuckets.push(key)
    }

    // Group pageviews by period
    const buckets: Record<string, { views: number; visitors: Set<string>; sessions: Set<string> }> = {}

    // Initialize all buckets with zeros
    for (const key of allBuckets) {
      buckets[key] = { views: 0, visitors: new Set(), sessions: new Set() }
    }

    for (const pv of pageviews) {
      const date = new Date(pv.timestamp)
      let key: string

      if (period === 'minute') {
        // 5-minute buckets
        const mins = Math.floor(date.getUTCMinutes() / 5) * 5
        key = `${date.toISOString().slice(0, 14)}${mins.toString().padStart(2, '0')}:00.000Z`
      } else if (period === 'hour') {
        key = `${date.toISOString().slice(0, 13)}:00:00.000Z`
      } else if (period === 'month') {
        key = `${date.toISOString().slice(0, 7)}-01T00:00:00.000Z`
      } else {
        key = `${date.toISOString().slice(0, 10)}T00:00:00.000Z`
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

// ============================================================================
// Sessions API - View individual sessions with all data
// ============================================================================

async function handleGetSessions(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 50, 200)
    const filter = event.queryStringParameters?.filter || ''

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `SESSION#` },
        ':end': { S: `SESSION#~` },
      },
      ScanIndexForward: false,
      Limit: limit * 2, // Get extra to filter
    }) as { Items?: any[] }

    let sessions = (result.Items || []).map(unmarshall).filter((s: any) => {
      const sessionTime = new Date(s.startedAt || s.endedAt || s.timestamp)
      return sessionTime >= startDate && sessionTime <= endDate
    })

    // Apply filters
    if (filter) {
      const f = filter.toLowerCase()
      sessions = sessions.filter((s: any) =>
        (s.entryPath || '').toLowerCase().includes(f) ||
        (s.browser || '').toLowerCase().includes(f) ||
        (s.country || '').toLowerCase().includes(f) ||
        (s.referrerSource || '').toLowerCase().includes(f)
      )
    }

    sessions = sessions.slice(0, limit).map((s: any) => ({
      id: s.id,
      visitorId: s.visitorId,
      entryPath: s.entryPath,
      exitPath: s.exitPath,
      pageViewCount: s.pageViewCount || 0,
      eventCount: s.eventCount || 0,
      duration: s.duration || 0,
      isBounce: s.isBounce,
      browser: s.browser,
      os: s.os,
      deviceType: s.deviceType,
      country: s.country,
      referrerSource: s.referrerSource,
      utmSource: s.utmSource,
      utmCampaign: s.utmCampaign,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    }))

    return response({ sessions, total: sessions.length })
  } catch (error) {
    console.error('Sessions error:', error)
    return response({ error: 'Failed to fetch sessions' }, 500)
  }
}

async function handleGetSessionDetail(siteId: string, sessionId: string, event: LambdaEvent) {
  try {
    // Get session
    const sessionResult = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: `SITE#${siteId}` },
        sk: { S: `SESSION#${sessionId}` },
      },
    })

    if (!sessionResult.Item) {
      return response({ error: 'Session not found' }, 404)
    }

    const session = unmarshall(sessionResult.Item)

    // Get all pageviews for this session
    const pageviewsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'PAGEVIEW#' },
        ':sessionId': { S: sessionId },
      },
    }) as { Items?: any[] }

    const pageviews = (pageviewsResult.Items || []).map(unmarshall)
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // Get all events for this session
    const eventsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'EVENT#' },
        ':sessionId': { S: sessionId },
      },
    }) as { Items?: any[] }

    const events = (eventsResult.Items || []).map(unmarshall)
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // Get heatmap clicks for this session
    const clicksResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'HEATMAP_CLICK#' },
        ':sessionId': { S: sessionId },
      },
    }) as { Items?: any[] }

    const clicks = (clicksResult.Items || []).map(unmarshall)

    // Get vitals for this session
    const vitalsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'VITAL#' },
        ':sessionId': { S: sessionId },
      },
    }) as { Items?: any[] }

    const vitals = (vitalsResult.Items || []).map(unmarshall)

    // Get errors for this session
    const errorsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'ERROR#' },
        ':sessionId': { S: sessionId },
      },
    }) as { Items?: any[] }

    const errors = (errorsResult.Items || []).map(unmarshall)

    // Build timeline of all events
    const timeline = [
      ...pageviews.map((p: any) => ({ type: 'pageview', timestamp: p.timestamp, data: p })),
      ...events.map((e: any) => ({ type: 'event', timestamp: e.timestamp, data: e })),
      ...clicks.map((c: any) => ({ type: 'click', timestamp: c.timestamp, data: c })),
      ...vitals.map((v: any) => ({ type: 'vital', timestamp: v.timestamp, data: v })),
      ...errors.map((e: any) => ({ type: 'error', timestamp: e.timestamp, data: e })),
    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return response({
      session,
      pageviews,
      events,
      clicks,
      vitals,
      errors,
      timeline,
    })
  } catch (error) {
    console.error('Session detail error:', error)
    return response({ error: 'Failed to fetch session detail' }, 500)
  }
}

// ============================================================================
// Web Vitals API
// ============================================================================

async function handleGetVitals(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `VITAL#${startDate.toISOString()}` },
        ':end': { S: `VITAL#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const vitals = (result.Items || []).map(unmarshall)

    // Aggregate by metric
    const metrics: Record<string, { values: number[]; ratings: Record<string, number> }> = {
      LCP: { values: [], ratings: { good: 0, 'needs-improvement': 0, poor: 0 } },
      FID: { values: [], ratings: { good: 0, 'needs-improvement': 0, poor: 0 } },
      CLS: { values: [], ratings: { good: 0, 'needs-improvement': 0, poor: 0 } },
      TTFB: { values: [], ratings: { good: 0, 'needs-improvement': 0, poor: 0 } },
      INP: { values: [], ratings: { good: 0, 'needs-improvement': 0, poor: 0 } },
    }

    for (const v of vitals) {
      const metric = v.metric
      if (metrics[metric]) {
        metrics[metric].values.push(v.value)
        metrics[metric].ratings[v.rating] = (metrics[metric].ratings[v.rating] || 0) + 1
      }
    }

    // Calculate p75 and averages
    const summary = Object.entries(metrics).map(([name, data]) => {
      const sorted = [...data.values].sort((a, b) => a - b)
      const p75Index = Math.floor(sorted.length * 0.75)
      const total = data.ratings.good + data.ratings['needs-improvement'] + data.ratings.poor
      return {
        metric: name,
        p75: sorted[p75Index] || 0,
        avg: sorted.length > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
        samples: sorted.length,
        good: total > 0 ? Math.round((data.ratings.good / total) * 100) : 0,
        needsImprovement: total > 0 ? Math.round((data.ratings['needs-improvement'] / total) * 100) : 0,
        poor: total > 0 ? Math.round((data.ratings.poor / total) * 100) : 0,
      }
    })

    return response({ vitals: summary, raw: vitals.slice(0, 100) })
  } catch (error) {
    console.error('Vitals error:', error)
    return response({ error: 'Failed to fetch vitals' }, 500)
  }
}

// ============================================================================
// Errors API
// ============================================================================

async function handleGetErrors(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 50, 200)

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ERROR#${startDate.toISOString()}` },
        ':end': { S: `ERROR#${endDate.toISOString()}` },
      },
      ScanIndexForward: false,
    }) as { Items?: any[] }

    const errors = (result.Items || []).map(unmarshall)

    // Group by message for aggregation
    const grouped: Record<string, { message: string; count: number; lastSeen: string; browsers: Set<string>; paths: Set<string>; sample: any }> = {}
    for (const e of errors) {
      const key = e.message || 'Unknown error'
      if (!grouped[key]) {
        grouped[key] = {
          message: key,
          count: 0,
          lastSeen: e.timestamp,
          browsers: new Set(),
          paths: new Set(),
          sample: e,
        }
      }
      grouped[key].count++
      if (e.timestamp > grouped[key].lastSeen) {
        grouped[key].lastSeen = e.timestamp
        grouped[key].sample = e
      }
      if (e.browser) grouped[key].browsers.add(e.browser)
      if (e.path) grouped[key].paths.add(e.path)
    }

    const errorList = Object.values(grouped)
      .map(g => ({
        message: g.message,
        count: g.count,
        lastSeen: g.lastSeen,
        browsers: Array.from(g.browsers),
        paths: Array.from(g.paths).slice(0, 5),
        source: g.sample.source,
        line: g.sample.line,
        stack: g.sample.stack,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    return response({
      errors: errorList,
      total: errors.length,
      uniqueErrors: Object.keys(grouped).length,
    })
  } catch (error) {
    console.error('Errors error:', error)
    return response({ error: 'Failed to fetch errors' }, 500)
  }
}

// ============================================================================
// Export API - CSV/JSON export
// ============================================================================

async function handleExport(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const format = event.queryStringParameters?.format || 'json'
    const type = event.queryStringParameters?.type || 'pageviews'

    let data: any[] = []
    let headers: string[] = []

    if (type === 'pageviews') {
      const result = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':start': { S: `PAGEVIEW#${startDate.toISOString()}` },
          ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
        },
        Limit: 10000,
      }) as { Items?: any[] }
      data = (result.Items || []).map(unmarshall)
      headers = ['timestamp', 'path', 'title', 'browser', 'os', 'deviceType', 'country', 'referrerSource', 'utmSource', 'utmCampaign']
    } else if (type === 'sessions') {
      const result = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':skPrefix': { S: 'SESSION#' },
        },
        Limit: 10000,
      }) as { Items?: any[] }
      data = (result.Items || []).map(unmarshall).filter((s: any) => {
        const t = new Date(s.startedAt || s.endedAt)
        return t >= startDate && t <= endDate
      })
      headers = ['id', 'startedAt', 'endedAt', 'duration', 'pageViewCount', 'eventCount', 'entryPath', 'exitPath', 'browser', 'os', 'deviceType', 'country', 'isBounce']
    } else if (type === 'events') {
      const result = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':start': { S: `EVENT#${startDate.toISOString()}` },
          ':end': { S: `EVENT#${endDate.toISOString()}` },
        },
        Limit: 10000,
      }) as { Items?: any[] }
      data = (result.Items || []).map(unmarshall)
      headers = ['timestamp', 'name', 'value', 'path']
    }

    if (format === 'csv') {
      const csvRows = [headers.join(',')]
      for (const row of data) {
        csvRows.push(headers.map(h => {
          const val = row[h]
          if (val === undefined || val === null) return ''
          const str = String(val)
          return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str
        }).join(','))
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${type}-${startDate.toISOString().slice(0, 10)}-${endDate.toISOString().slice(0, 10)}.csv"`,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        body: csvRows.join('\n'),
      }
    }

    return response({ data, count: data.length, type, dateRange: { start: startDate.toISOString(), end: endDate.toISOString() } })
  } catch (error) {
    console.error('Export error:', error)
    return response({ error: 'Failed to export data' }, 500)
  }
}

// ============================================================================
// Insights API - Automatic anomaly detection and insights
// ============================================================================

async function handleGetInsights(siteId: string, event: LambdaEvent) {
  try {
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    // Get this week's stats
    const thisWeekResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${weekAgo.toISOString()}` },
        ':end': { S: `PAGEVIEW#${now.toISOString()}` },
      },
    }) as { Items?: any[] }

    // Get last week's stats
    const lastWeekResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${twoWeeksAgo.toISOString()}` },
        ':end': { S: `PAGEVIEW#${weekAgo.toISOString()}` },
      },
    }) as { Items?: any[] }

    const thisWeek = (thisWeekResult.Items || []).map(unmarshall)
    const lastWeek = (lastWeekResult.Items || []).map(unmarshall)

    const insights: { type: string; title: string; description: string; change?: number; severity: 'positive' | 'negative' | 'neutral' }[] = []

    // Traffic change insight
    const thisWeekViews = thisWeek.length
    const lastWeekViews = lastWeek.length
    if (lastWeekViews > 0) {
      const change = Math.round(((thisWeekViews - lastWeekViews) / lastWeekViews) * 100)
      if (Math.abs(change) >= 10) {
        insights.push({
          type: 'traffic',
          title: change > 0 ? 'Traffic is up' : 'Traffic is down',
          description: `Page views ${change > 0 ? 'increased' : 'decreased'} by ${Math.abs(change)}% compared to last week`,
          change,
          severity: change > 0 ? 'positive' : 'negative',
        })
      }
    }

    // Top referrer insight
    const referrerCounts: Record<string, number> = {}
    for (const pv of thisWeek) {
      if (pv.referrerSource && pv.referrerSource !== 'Direct') {
        referrerCounts[pv.referrerSource] = (referrerCounts[pv.referrerSource] || 0) + 1
      }
    }
    const topReferrer = Object.entries(referrerCounts).sort((a, b) => b[1] - a[1])[0]
    if (topReferrer && topReferrer[1] >= 5) {
      insights.push({
        type: 'referrer',
        title: `${topReferrer[0]} driving traffic`,
        description: `${topReferrer[0]} sent ${topReferrer[1]} visitors this week`,
        severity: 'positive',
      })
    }

    // Popular page insight
    const pageCounts: Record<string, number> = {}
    for (const pv of thisWeek) {
      pageCounts[pv.path] = (pageCounts[pv.path] || 0) + 1
    }
    const topPage = Object.entries(pageCounts).sort((a, b) => b[1] - a[1])[0]
    if (topPage && topPage[0] !== '/') {
      insights.push({
        type: 'page',
        title: 'Most popular page',
        description: `${topPage[0]} received ${topPage[1]} views this week`,
        severity: 'neutral',
      })
    }

    // Mobile vs Desktop insight
    const deviceCounts: Record<string, number> = { mobile: 0, desktop: 0, tablet: 0 }
    for (const pv of thisWeek) {
      if (pv.deviceType) deviceCounts[pv.deviceType] = (deviceCounts[pv.deviceType] || 0) + 1
    }
    const mobilePercent = thisWeek.length > 0 ? Math.round((deviceCounts.mobile / thisWeek.length) * 100) : 0
    if (mobilePercent >= 50) {
      insights.push({
        type: 'device',
        title: 'Mobile-first audience',
        description: `${mobilePercent}% of your visitors are on mobile devices`,
        severity: 'neutral',
      })
    }

    // Bounce rate insight
    const sessionsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'SESSION#' },
      },
      Limit: 1000,
    }) as { Items?: any[] }

    const sessions = (sessionsResult.Items || []).map(unmarshall).filter((s: any) => {
      const t = new Date(s.startedAt || s.endedAt)
      return t >= weekAgo && t <= now
    })

    const bounces = sessions.filter((s: any) => s.isBounce).length
    const bounceRate = sessions.length > 0 ? Math.round((bounces / sessions.length) * 100) : 0
    if (bounceRate >= 70) {
      insights.push({
        type: 'engagement',
        title: 'High bounce rate',
        description: `${bounceRate}% of visitors leave after viewing one page`,
        severity: 'negative',
      })
    } else if (bounceRate <= 30) {
      insights.push({
        type: 'engagement',
        title: 'Great engagement',
        description: `Only ${bounceRate}% bounce rate - visitors are exploring your site`,
        severity: 'positive',
      })
    }

    return response({
      insights,
      stats: {
        thisWeekViews,
        lastWeekViews,
        change: lastWeekViews > 0 ? Math.round(((thisWeekViews - lastWeekViews) / lastWeekViews) * 100) : 0,
        bounceRate,
        sessions: sessions.length,
      },
    })
  } catch (error) {
    console.error('Insights error:', error)
    return response({ error: 'Failed to fetch insights' }, 500)
  }
}

// ============================================================================
// Public Dashboard Sharing
// ============================================================================

async function handleCreateShareLink(siteId: string, event: LambdaEvent) {
  try {
    const token = generateId() + generateId() // 24 char token
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: `SITE#${siteId}`,
        sk: `SHARE#${token}`,
        token,
        siteId,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        ttl: Math.floor(expiresAt.getTime() / 1000),
      }),
    })

    return response({
      token,
      url: `https://analytics.stacksjs.com/?share=${token}`,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('Create share link error:', error)
    return response({ error: 'Failed to create share link' }, 500)
  }
}

async function handleGetSharedDashboard(token: string) {
  try {
    // Find the share token
    const result = await dynamodb.scan({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(sk, :sharePrefix) AND #token = :token',
      ExpressionAttributeNames: { '#token': 'token' },
      ExpressionAttributeValues: {
        ':sharePrefix': { S: 'SHARE#' },
        ':token': { S: token },
      },
    }) as { Items?: any[] }

    if (!result.Items || result.Items.length === 0) {
      return response({ error: 'Invalid or expired share link' }, 404)
    }

    const share = unmarshall(result.Items[0])
    if (new Date(share.expiresAt) < new Date()) {
      return response({ error: 'Share link has expired' }, 410)
    }

    return response({ siteId: share.siteId, valid: true })
  } catch (error) {
    console.error('Get shared dashboard error:', error)
    return response({ error: 'Failed to validate share link' }, 500)
  }
}

// ============================================================================
// A/B Testing / Experiments
// ============================================================================

async function handleCreateExperiment(siteId: string, event: LambdaEvent) {
  try {
    const body = JSON.parse(event.body || '{}')
    const { name, variants, targetUrl } = body

    if (!name || !variants || variants.length < 2) {
      return response({ error: 'Name and at least 2 variants required' }, 400)
    }

    const experiment = {
      pk: `SITE#${siteId}`,
      sk: `EXPERIMENT#${generateId()}`,
      id: generateId(),
      siteId,
      name,
      variants: variants.map((v: any, i: number) => ({
        id: generateId(),
        name: v.name || `Variant ${String.fromCharCode(65 + i)}`,
        weight: v.weight || Math.floor(100 / variants.length),
      })),
      targetUrl: targetUrl || '*',
      status: 'active',
      createdAt: new Date().toISOString(),
      conversions: {},
      impressions: {},
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(experiment),
    })

    return response({ experiment }, 201)
  } catch (error) {
    console.error('Create experiment error:', error)
    return response({ error: 'Failed to create experiment' }, 500)
  }
}

async function handleGetExperiments(siteId: string, event: LambdaEvent) {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'EXPERIMENT#' },
      },
    }) as { Items?: any[] }

    const experiments = (result.Items || []).map(unmarshall)
    return response({ experiments })
  } catch (error) {
    console.error('Get experiments error:', error)
    return response({ error: 'Failed to fetch experiments' }, 500)
  }
}

async function handleRecordExperimentEvent(siteId: string, event: LambdaEvent) {
  try {
    const body = JSON.parse(event.body || '{}')
    const { experimentId, variantId, eventType, visitorId } = body

    if (!experimentId || !variantId || !eventType) {
      return response({ error: 'experimentId, variantId, and eventType required' }, 400)
    }

    // Update experiment stats
    const updateExpr = eventType === 'conversion'
      ? 'SET conversions.#vid = if_not_exists(conversions.#vid, :zero) + :one'
      : 'SET impressions.#vid = if_not_exists(impressions.#vid, :zero) + :one'

    await dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: `SITE#${siteId}` },
        sk: { S: `EXPERIMENT#${experimentId}` },
      },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: { '#vid': variantId },
      ExpressionAttributeValues: {
        ':zero': { N: '0' },
        ':one': { N: '1' },
      },
    })

    return response({ success: true })
  } catch (error) {
    console.error('Record experiment event error:', error)
    return response({ error: 'Failed to record experiment event' }, 500)
  }
}

// ============================================================================
// Alerts & Webhooks
// ============================================================================

async function handleCreateAlert(siteId: string, event: LambdaEvent) {
  try {
    const body = JSON.parse(event.body || '{}')
    const { name, type, threshold, webhookUrl, email } = body

    if (!name || !type) {
      return response({ error: 'Name and type required' }, 400)
    }

    const alert = {
      pk: `SITE#${siteId}`,
      sk: `ALERT#${generateId()}`,
      id: generateId(),
      siteId,
      name,
      type, // 'traffic_spike', 'traffic_drop', 'error_rate', 'goal_conversion'
      threshold: threshold || 50, // percentage change
      webhookUrl,
      email,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastTriggered: null,
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(alert),
    })

    return response({ alert }, 201)
  } catch (error) {
    console.error('Create alert error:', error)
    return response({ error: 'Failed to create alert' }, 500)
  }
}

async function handleGetAlerts(siteId: string, event: LambdaEvent) {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'ALERT#' },
      },
    }) as { Items?: any[] }

    const alerts = (result.Items || []).map(unmarshall)
    return response({ alerts })
  } catch (error) {
    console.error('Get alerts error:', error)
    return response({ error: 'Failed to fetch alerts' }, 500)
  }
}

async function handleDeleteAlert(siteId: string, alertId: string) {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: `SITE#${siteId}` },
        sk: { S: `ALERT#${alertId}` },
      },
    })
    return response({ success: true })
  } catch (error) {
    console.error('Delete alert error:', error)
    return response({ error: 'Failed to delete alert' }, 500)
  }
}

// ============================================================================
// API Keys
// ============================================================================

async function handleCreateApiKey(siteId: string, event: LambdaEvent) {
  try {
    const body = JSON.parse(event.body || '{}')
    const { name } = body

    const key = 'tsa_' + generateId() + generateId() // API key format

    const apiKey = {
      pk: `SITE#${siteId}`,
      sk: `APIKEY#${key}`,
      key,
      siteId,
      name: name || 'API Key',
      createdAt: new Date().toISOString(),
      lastUsed: null,
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(apiKey),
    })

    return response({ apiKey: { ...apiKey, key } }, 201) // Only return key once on creation
  } catch (error) {
    console.error('Create API key error:', error)
    return response({ error: 'Failed to create API key' }, 500)
  }
}

async function handleGetApiKeys(siteId: string, event: LambdaEvent) {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'APIKEY#' },
      },
    }) as { Items?: any[] }

    const apiKeys = (result.Items || []).map(item => {
      const key = unmarshall(item)
      return {
        ...key,
        key: key.key.slice(0, 8) + '...' + key.key.slice(-4), // Mask key
      }
    })
    return response({ apiKeys })
  } catch (error) {
    console.error('Get API keys error:', error)
    return response({ error: 'Failed to fetch API keys' }, 500)
  }
}

async function handleDeleteApiKey(siteId: string, keyId: string) {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: `SITE#${siteId}` },
        sk: { S: `APIKEY#${keyId}` },
      },
    })
    return response({ success: true })
  } catch (error) {
    console.error('Delete API key error:', error)
    return response({ error: 'Failed to delete API key' }, 500)
  }
}

// ============================================================================
// User Flow Visualization
// ============================================================================

async function handleGetUserFlow(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const entryPath = event.queryStringParameters?.entry || '/'
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 100, 500)

    // Get sessions with multiple pageviews
    const sessionsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: 'pageViewCount > :one',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':skPrefix': { S: 'SESSION#' },
        ':one': { N: '1' },
      },
      Limit: limit,
    }) as { Items?: any[] }

    const sessions = (sessionsResult.Items || []).map(unmarshall).filter((s: any) => {
      const t = new Date(s.startedAt || s.endedAt)
      return t >= startDate && t <= endDate
    })

    // Get pageviews for these sessions
    const sessionIds = sessions.map((s: any) => s.id).filter(Boolean).slice(0, 50)

    // Build flow data
    const flows: Record<string, Record<string, number>> = {}
    const pathCounts: Record<string, number> = {}

    // Query pageviews for each session (limited batch)
    for (const sid of sessionIds) {
      const pvResult = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        FilterExpression: 'sessionId = :sessionId',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':skPrefix': { S: 'PAGEVIEW#' },
          ':sessionId': { S: sid },
        },
        Limit: 20,
      }) as { Items?: any[] }

      const pvs = (pvResult.Items || []).map(unmarshall)
        .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

      // Build path sequence
      for (let i = 0; i < pvs.length - 1; i++) {
        const from = pvs[i].path || '/'
        const to = pvs[i + 1].path || '/'

        if (!flows[from]) flows[from] = {}
        flows[from][to] = (flows[from][to] || 0) + 1

        pathCounts[from] = (pathCounts[from] || 0) + 1
        pathCounts[to] = (pathCounts[to] || 0) + 1
      }
    }

    // Convert to array format for visualization
    const nodes = Object.keys(pathCounts).map(path => ({
      id: path,
      label: path,
      count: pathCounts[path],
    })).sort((a, b) => b.count - a.count).slice(0, 20)

    const nodeIds = new Set(nodes.map(n => n.id))

    const links: { source: string; target: string; value: number }[] = []
    for (const [from, targets] of Object.entries(flows)) {
      for (const [to, count] of Object.entries(targets)) {
        if (nodeIds.has(from) && nodeIds.has(to)) {
          links.push({ source: from, target: to, value: count })
        }
      }
    }

    // Sort links by value
    links.sort((a, b) => b.value - a.value)

    return response({
      nodes,
      links: links.slice(0, 50),
      totalSessions: sessions.length,
      analyzedSessions: sessionIds.length,
    })
  } catch (error) {
    console.error('User flow error:', error)
    return response({ error: 'Failed to fetch user flow' }, 500)
  }
}

// ============================================================================
// Revenue Attribution
// ============================================================================

async function handleGetRevenue(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)

    // Get conversions with revenue
    const conversionsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `CONVERSION#${startDate.toISOString()}` },
        ':end': { S: `CONVERSION#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const conversions = (conversionsResult.Items || []).map(unmarshall)

    // Get events with value (revenue events)
    const eventsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      FilterExpression: 'attribute_exists(#val)',
      ExpressionAttributeNames: { '#val': 'value' },
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `EVENT#${startDate.toISOString()}` },
        ':end': { S: `EVENT#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const revenueEvents = (eventsResult.Items || []).map(unmarshall)

    // Aggregate by source
    const bySource: Record<string, { revenue: number; conversions: number; events: number }> = {}
    const byUtmSource: Record<string, { revenue: number; conversions: number }> = {}
    const byUtmCampaign: Record<string, { revenue: number; conversions: number }> = {}

    for (const c of conversions) {
      const source = c.referrerSource || 'Direct'
      if (!bySource[source]) bySource[source] = { revenue: 0, conversions: 0, events: 0 }
      bySource[source].conversions++
      bySource[source].revenue += c.revenue || 0

      if (c.utmSource) {
        if (!byUtmSource[c.utmSource]) byUtmSource[c.utmSource] = { revenue: 0, conversions: 0 }
        byUtmSource[c.utmSource].conversions++
        byUtmSource[c.utmSource].revenue += c.revenue || 0
      }

      if (c.utmCampaign) {
        if (!byUtmCampaign[c.utmCampaign]) byUtmCampaign[c.utmCampaign] = { revenue: 0, conversions: 0 }
        byUtmCampaign[c.utmCampaign].conversions++
        byUtmCampaign[c.utmCampaign].revenue += c.revenue || 0
      }
    }

    // Add revenue from events
    for (const e of revenueEvents) {
      const source = 'Events'
      if (!bySource[source]) bySource[source] = { revenue: 0, conversions: 0, events: 0 }
      bySource[source].events++
      bySource[source].revenue += e.value || 0
    }

    const totalRevenue = Object.values(bySource).reduce((sum, s) => sum + s.revenue, 0)
    const totalConversions = conversions.length

    return response({
      totalRevenue,
      totalConversions,
      bySource: Object.entries(bySource)
        .map(([source, stats]) => ({ source, ...stats }))
        .sort((a, b) => b.revenue - a.revenue),
      byUtmSource: Object.entries(byUtmSource)
        .map(([source, stats]) => ({ source, ...stats }))
        .sort((a, b) => b.revenue - a.revenue),
      byUtmCampaign: Object.entries(byUtmCampaign)
        .map(([campaign, stats]) => ({ campaign, ...stats }))
        .sort((a, b) => b.revenue - a.revenue),
    })
  } catch (error) {
    console.error('Revenue error:', error)
    return response({ error: 'Failed to fetch revenue' }, 500)
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

  // Detail page routes
  const detailMatch = path.match(/^\/dashboard\/(pages|referrers|devices|browsers|countries|campaigns|events|goals)$/)
  if (detailMatch && method === 'GET') {
    return handleDetailPage(detailMatch[1], event)
  }

  if ((path === '/collect' || path === '/t') && method === 'POST') {
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
      // /api/sites/{siteId}/regions
      if (path.endsWith('/regions')) {
        return handleGetRegions(siteId, event)
      }
      // /api/sites/{siteId}/cities
      if (path.endsWith('/cities')) {
        return handleGetCities(siteId, event)
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
      // /api/sites/{siteId}/sessions/{sessionId}
      const sessionMatch = path.match(/\/sessions\/([^/]+)$/)
      if (sessionMatch) {
        return handleGetSessionDetail(siteId, sessionMatch[1], event)
      }
      // /api/sites/{siteId}/sessions
      if (path.endsWith('/sessions')) {
        return handleGetSessions(siteId, event)
      }
      // /api/sites/{siteId}/vitals
      if (path.endsWith('/vitals')) {
        return handleGetVitals(siteId, event)
      }
      // /api/sites/{siteId}/errors
      if (path.endsWith('/errors')) {
        return handleGetErrors(siteId, event)
      }
      // /api/sites/{siteId}/export
      if (path.endsWith('/export')) {
        return handleExport(siteId, event)
      }
      // /api/sites/{siteId}/insights
      if (path.endsWith('/insights')) {
        return handleGetInsights(siteId, event)
      }
      // /api/sites/{siteId}/experiments
      if (path.endsWith('/experiments')) {
        return handleGetExperiments(siteId, event)
      }
      // /api/sites/{siteId}/alerts
      if (path.endsWith('/alerts')) {
        return handleGetAlerts(siteId, event)
      }
      // /api/sites/{siteId}/api-keys
      if (path.endsWith('/api-keys')) {
        return handleGetApiKeys(siteId, event)
      }
      // /api/sites/{siteId}/flow
      if (path.endsWith('/flow')) {
        return handleGetUserFlow(siteId, event)
      }
      // /api/sites/{siteId}/revenue
      if (path.endsWith('/revenue')) {
        return handleGetRevenue(siteId, event)
      }
    }
  }

  // Handle share link validation
  if (method === 'GET' && path.startsWith('/api/share/')) {
    const token = path.split('/').pop()
    if (token) return handleGetSharedDashboard(token)
  }

  // POST routes for new features
  const siteIdForPost = extractSiteId(path)
  if (siteIdForPost && method === 'POST') {
    // /api/sites/{siteId}/share
    if (path.endsWith('/share')) {
      return handleCreateShareLink(siteIdForPost, event)
    }
    // /api/sites/{siteId}/experiments
    if (path.endsWith('/experiments')) {
      return handleCreateExperiment(siteIdForPost, event)
    }
    // /api/sites/{siteId}/experiments/event
    if (path.endsWith('/experiments/event')) {
      return handleRecordExperimentEvent(siteIdForPost, event)
    }
    // /api/sites/{siteId}/alerts
    if (path.endsWith('/alerts')) {
      return handleCreateAlert(siteIdForPost, event)
    }
    // /api/sites/{siteId}/api-keys
    if (path.endsWith('/api-keys')) {
      return handleCreateApiKey(siteIdForPost, event)
    }
  }

  // DELETE routes
  if (siteIdForPost && method === 'DELETE') {
    // /api/sites/{siteId}/alerts/{alertId}
    const alertMatch = path.match(/\/alerts\/([^/]+)$/)
    if (alertMatch) {
      return handleDeleteAlert(siteIdForPost, alertMatch[1])
    }
    // /api/sites/{siteId}/api-keys/{keyId}
    const keyMatch = path.match(/\/api-keys\/([^/]+)$/)
    if (keyMatch) {
      return handleDeleteApiKey(siteIdForPost, keyMatch[1])
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
