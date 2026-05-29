import { defineStore, useStore, state } from '@stacksjs/stx'

/**
 * Dashboard Store — shared reactive state for all dashboard components.
 * Replaces the window.* globals from dashboard.ts.
 *
 * Usage in any <script client> block:
 *   const dashboard = useStore('dashboard')
 *   dashboard.siteId()         // read
 *   dashboard.apiUrl('/stats') // build API URL with date params
 */

const STEALTH_MAP: Record<string, string> = {
  sites: 'projects',
  stats: 'summary',
  realtime: 'pulse',
  pages: 'content',
  referrers: 'sources',
  devices: 'clients',
  browsers: 'agents',
  countries: 'geo',
  regions: 'area',
  cities: 'locale',
  timeseries: 'series',
  events: 'actions',
  campaigns: 'promo',
  comparison: 'diff',
  sessions: 'visits',
  flow: 'journey',
  'entry-exit': 'endpoints',
  live: 'now',
  heatmap: 'touch',
  errors: 'issues',
  'errors/statuses': 'issues/states',
  'errors/status': 'issues/state',
  vitals: 'metrics',
  'vitals-trends': 'metrics-trends',
  'performance-budgets': 'budgets',
  goals: 'targets',
  'goals/stats': 'targets/data',
  funnels: 'pipelines',
  annotations: 'notes',
  experiments: 'tests',
  alerts: 'notifications',
  'email-reports': 'scheduled',
  'api-keys': 'tokens',
  uptime: 'monitors',
  webhooks: 'hooks',
  team: 'members',
  export: 'download',
  retention: 'storage',
  'gdpr/export': 'privacy/download',
  'gdpr/delete': 'privacy/remove',
  insights: 'intel',
  revenue: 'income',
  share: 'link',
}

defineStore('dashboard', () => {
  const urlParams = new URLSearchParams(window.location.search)

  // Core state
  const siteId = state(urlParams.get('siteId') || '')
  const apiEndpoint = state(window.ANALYTICS_API_ENDPOINT || window.API_ENDPOINT || window.location.origin)
  const useStealth = state(window.ANALYTICS_STEALTH_MODE ?? (urlParams.get('stealth') === 'true'))
  const dateRange = state('6h')

  // Stealth path mapper
  function apiPath(path: string): string {
    if (!useStealth()) return path
    let result = path
    const sortedKeys = Object.keys(STEALTH_MAP).sort((a, b) => b.length - a.length)
    for (const key of sortedKeys) {
      const regex = new RegExp(`/${key}(?=/|$|\\?)`)
      result = result.replace(regex, `/${STEALTH_MAP[key]}`)
    }
    return result.replace('/api/sites/', '/api/p/')
  }

  // Build a full API URL for a site endpoint
  function apiUrl(path: string): string {
    return apiPath(`${apiEndpoint()}/api/sites/${siteId()}${path}`)
  }

  // Date range as query params
  function dateParams(): string {
    const range = dateRange()
    if (!range) return ''
    const now = new Date()
    let start: Date

    if (range.endsWith('h')) {
      start = new Date(now.getTime() - parseInt(range) * 60 * 60 * 1000)
    } else if (range.endsWith('d')) {
      start = new Date(now.getTime() - parseInt(range) * 24 * 60 * 60 * 1000)
    } else {
      return ''
    }

    return `?start=${start.toISOString()}&end=${now.toISOString()}&period=${range}`
  }

  // Build API URL with date params included
  function apiUrlWithDates(path: string): string {
    return apiUrl(path + dateParams())
  }

  // Absolute start/end ISO bounds for the current range. Used by endpoints that
  // read startDate/endDate (e.g. /timeseries, /annotations) rather than start/end.
  function dateBounds(): { start: string, end: string } {
    const now = new Date()
    const spans: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
    }
    const span = spans[dateRange()] ?? spans['30d']
    return { start: new Date(now.getTime() - span).toISOString(), end: now.toISOString() }
  }

  // Bucket granularity for the timeseries endpoint, derived from the range.
  function timeseriesPeriod(): string {
    const range = dateRange()
    if (range === '1h') return 'minute'
    if (range === '6h' || range === '12h' || range === '24h') return 'hour'
    return 'day'
  }

  // SPA navigation
  function navigateTo(section: string): void {
    const url = `/dashboard/${section}?siteId=${encodeURIComponent(siteId())}`
    if (window.stxRouter?.navigate) {
      window.stxRouter.navigate(url)
    } else {
      navigate(url, true)
    }
  }

  return {
    siteId,
    apiEndpoint,
    useStealth,
    dateRange,
    apiPath,
    apiUrl,
    dateParams,
    apiUrlWithDates,
    dateBounds,
    timeseriesPeriod,
    navigateTo,
  }
})
