/// <reference path="../../types/window.d.ts" />

const urlParams = new URLSearchParams(window.location.search)
const API_ENDPOINT = window.ANALYTICS_API_ENDPOINT || urlParams.get('api') || window.location.origin
const SITE_ID = urlParams.get('siteId') || window.ANALYTICS_SITE_ID || ''

// Stealth mode: use innocuous API paths to bypass content blockers
// Default to OFF unless explicitly enabled via ?stealth=true or window config
const USE_STEALTH = window.ANALYTICS_STEALTH_MODE ?? (urlParams.get('stealth') === 'true')

/**
 * Stealth API path mapping - maps standard paths to innocuous alternatives
 * that won't be detected by content blockers
 */
const STEALTH_MAP: Record<string, string> = {
  // Base path change: /api/sites/ -> /api/p/
  'sites': 'projects',
  // Stats & Analytics
  'stats': 'summary',
  'realtime': 'pulse',
  'pages': 'content',
  'referrers': 'sources',
  'devices': 'clients',
  'browsers': 'agents',
  'os': 'platform',
  'countries': 'geo',
  'regions': 'area',
  'cities': 'locale',
  'timeseries': 'series',
  'events': 'actions',
  'campaigns': 'promo',
  'comparison': 'diff',
  // User behavior
  'sessions': 'visits',
  'flow': 'journey',
  'entry-exit': 'endpoints',
  'live': 'now',
  // Heatmaps
  'heatmap': 'touch',
  // Errors
  // Performance
  'vitals': 'metrics',
  'vitals-trends': 'metrics-trends',
  'performance-budgets': 'budgets',
  // Goals
  'goals': 'targets',
  'goals/stats': 'targets/data',
  // Funnels
  'funnels': 'pipelines',
  // Other
  'annotations': 'notes',
  'experiments': 'tests',
  'experiments/event': 'tests/record',
  'alerts': 'notifications',
  'email-reports': 'scheduled',
  'api-keys': 'tokens',
  'uptime': 'monitors',
  'webhooks': 'hooks',
  'team': 'members',
  'export': 'download',
  'retention': 'storage',
  'gdpr/export': 'privacy/download',
  'gdpr/delete': 'privacy/remove',
  'insights': 'intel',
  'revenue': 'income',
  'share': 'link',
}

/**
 * Convert a standard API path to stealth path if stealth mode is enabled
 * @example apiPath('/api/sites/123/stats') -> '/api/p/123/summary' (when stealth enabled)
 */
function apiPath(path: string): string {
  if (!USE_STEALTH) return path

  let result = path

  // Replace /api/sites/ with /api/p/
  result = result.replace('/api/sites/', '/api/p/')
  result = result.replace('/api/sites', '/api/projects')

  // Replace known endpoint names (longest first to avoid partial matches)
  const sortedKeys = Object.keys(STEALTH_MAP).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    // Only replace if it's a path segment (bounded by / or end of string)
    const regex = new RegExp(`/${key}(?=/|\\?|$)`, 'g')
    result = result.replace(regex, `/${STEALTH_MAP[key]}`)
  }

  return result
}

// Expose to window for STX components
window.apiPath = apiPath
window.USE_STEALTH = USE_STEALTH

let siteName = 'Analytics Dashboard'
let siteId = SITE_ID
let dateRange = '7d'
let isLoading = false
let refreshInterval: ReturnType<typeof setInterval> | null = null

// Expose globals for STX panel components
window.API_ENDPOINT = API_ENDPOINT
window.siteId = siteId

// Load cached stats from localStorage
function loadCachedStats() {
  try {
    const cached = localStorage.getItem(`ts-analytics-stats-${siteId}`)
    if (cached) {
      const data = JSON.parse(cached)
      if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        return data.stats
      }
    }
  }
catch (e) {}
  return null
}

function saveCachedStats(statsData: any) {
  try {
    localStorage.setItem(`ts-analytics-stats-${siteId}`, JSON.stringify({
      stats: statsData,
      timestamp: Date.now()
    }))
  }
catch (e) {}
}

const cachedStats = loadCachedStats()
let stats = cachedStats || { realtime: 0, sessions: 0, people: 0, views: 0, avgTime: '00:00', bounceRate: 0, events: 0 }

// Valid tab ids (used for URL validation; tab chrome lives in DashboardHeader).
// 'account' is project-independent — listed so getTabFromUrl/switchTab don't
// coerce its URL to /dashboard, but the bootstrap below skips its data fetch.
const validTabs = ['dashboard', 'live', 'sessions', 'funnels', 'flow', 'vitals', 'insights', 'settings', 'account']

// Theme is owned by DashboardHeader (isDark state + data-theme effect + storage).

// Site management — fetchSites/renderSiteSelector/createSite handled by SiteSelector.stx component


function selectSite(id: string, name: string, navigateToDashboard = true) {
  siteId = id
  window.siteId = id
  siteName = name || 'Analytics Dashboard'
  // Shell visibility is reactive (SiteSelector effect on the store siteId, set by
  // pickSite). Update the header name through its reactive setter.
  if (window.headerSetSiteName) window.headerSetSiteName(siteName)

  // The selected site lives in state (window.siteId) + localStorage, not the URL
  // — so the URL stays clean (/dashboard). Only navigate to the dashboard root
  // when the user actively picks a site; a refresh-restore seeds in place so it
  // stays on the current sub-tab.
  if (navigateToDashboard) {
    window.history.pushState({ tab: 'dashboard' }, '', `${window.location.origin}/dashboard`)
  }

  const cached = loadCachedStats()
  if (cached) {
    stats = cached
  }

  fetchDashboardData()
  refreshAllPanels()
  if (refreshInterval) clearInterval(refreshInterval)
  refreshInterval = setInterval(fetchDashboardData, 30000)
}

function goBack() {
  if (refreshInterval) clearInterval(refreshInterval)
  siteId = ''
  window.siteId = ''
  // Shell visibility is reactive (SiteSelector effect on the store siteId).
  const url = new URL(window.location.href)
  url.searchParams.delete('siteId')
  window.history.pushState({}, '', url)
  if (window.fetchSites) window.fetchSites()
}

// Date range handling
function setDateRange(range: string) {
  dateRange = range
  fetchDashboardData()
  refreshAllPanels()
}

function getDateRangeParams(forTimeseries?: boolean) {
  const now = new Date()
  const end = now.toISOString()
  let start: Date, period = 'day'
  switch(dateRange) {
    case '1h': start = new Date(now.getTime() - 1*60*60*1000); period = 'minute'; break
    case '6h': start = new Date(now.getTime() - 6*60*60*1000); period = 'hour'; break
    case '12h': start = new Date(now.getTime() - 12*60*60*1000); period = 'hour'; break
    case '24h': start = new Date(now.getTime() - 24*60*60*1000); period = 'hour'; break
    case '7d': start = new Date(now.getTime() - 7*24*60*60*1000); break
    case '30d': start = new Date(now.getTime() - 30*24*60*60*1000); break
    case '90d': start = new Date(now.getTime() - 90*24*60*60*1000); break
    default: start = new Date(now.getTime() - 30*24*60*60*1000)
  }
  let params = `?startDate=${start.toISOString()}&endDate=${end}`
  if (forTimeseries) params += `&period=${period}`
  return params
}
window.getDateRangeParams = getDateRangeParams

function refreshAllPanels() {
  if (window.refreshPagesPanel) window.refreshPagesPanel()
  if (window.refreshReferrersPanel) window.refreshReferrersPanel()
  if (window.refreshDevicesPanel) window.refreshDevicesPanel()
  if (window.refreshBrowsersPanel) window.refreshBrowsersPanel()
  if (window.refreshOSPanel) window.refreshOSPanel()
  if (window.refreshCountriesPanel) window.refreshCountriesPanel()
  if (window.refreshCampaignsPanel) window.refreshCampaignsPanel()
  if (window.refreshEventsPanel) window.refreshEventsPanel()
  if (window.refreshGoalsPanel) window.refreshGoalsPanel()
}
window.refreshAllPanels = refreshAllPanels

// Data fetching
async function fetchDashboardData() {
  if (isLoading) return
  isLoading = true
  if (window.stxLoading) window.stxLoading.start()
  const refreshBtn = document.getElementById('refresh-btn')
  const spinStartTime = Date.now()
  refreshBtn?.classList.add('spinning')

  const baseUrl = `${API_ENDPOINT}/api/sites/${siteId}`
  const params = getDateRangeParams(false)

  try {
    const results = await Promise.all([
      fetch(apiPath(`${baseUrl}/stats${params}`)).then(r => r.json()).catch(() => ({})),
      fetch(apiPath(`${baseUrl}/realtime`)).then(r => r.json()).catch(() => ({ currentVisitors: 0 })),
    ])
    const [statsRes, realtimeRes] = results

    stats = {
      realtime: realtimeRes.currentVisitors || 0,
      sessions: statsRes.sessions || 0,
      people: statsRes.people || 0,
      views: statsRes.views || 0,
      avgTime: statsRes.avgTime || '00:00',
      bounceRate: statsRes.bounceRate || 0,
      events: statsRes.events || 0
    }
    saveCachedStats(stats)

    // ChartSection owns time-series/annotations data; nudge it to refresh too.
    window.refreshChart?.()
  }
catch (error) {
    console.error('Failed to fetch:', error)
  }
finally {
    isLoading = false
    if (window.stxLoading) window.stxLoading.finish()
    const spinDuration = Date.now() - spinStartTime
    const rotationTime = 500
    const completedRotations = Math.floor(spinDuration / rotationTime)
    const minRotations = Math.max(1, completedRotations + 1)
    const targetTime = minRotations * rotationTime
    const remainingTime = targetTime - spinDuration
    setTimeout(() => {
      refreshBtn?.classList.remove('spinning')
    }, remainingTime)
  }
}

// Tab navigation
function getTabFromUrl() {
  const url = new URL(window.location.href)
  const pathMatch = url.pathname.match(/\/dashboard\/([^/]+)/)
  if (pathMatch && validTabs.includes(pathMatch[1])) {
    return pathMatch[1]
  }
  const tabParam = url.searchParams.get('tab')
  if (tabParam && validTabs.includes(tabParam)) {
    return tabParam
  }
  return 'dashboard'
}

function updateUrlForTab(tab: string, replace = false) {
  const url = new URL(window.location.href)
  const basePath = tab === 'dashboard' ? '/dashboard' : `/dashboard/${tab}`
  url.pathname = basePath
  // Site lives in state/localStorage, not the URL — keep tab URLs clean and
  // strip any stale ?siteId that arrived via a deep-link.
  url.searchParams.delete('siteId')
  url.searchParams.delete('tab')

  if (replace) {
    window.history.replaceState({ tab, siteId }, '', url)
  }
else {
    window.history.pushState({ tab, siteId }, '', url)
  }
}

function switchTab(tab: string, updateHistory = true) {
  if (!validTabs.includes(tab)) tab = 'dashboard'
  // Tab chrome (title, active state) and controls/filters visibility are owned
  // reactively by DashboardHeader + ControlsBar/FiltersBar (dashboard.currentTab).
  // Tab content is swapped by the stx router; this only maintains history/URL.
  if (updateHistory && siteId) {
    updateUrlForTab(tab)
  }
}

// Empty-state onboarding + main-content visibility are owned by NoDataMessage
// (bound to analytics.stats / hasHistoricalData). Tab chrome + controls/filters
// visibility are owned by DashboardHeader + ControlsBar/FiltersBar.

// Event handlers
window.addEventListener('popstate', (event) => {
  if (window.stxRouter) return // STX router handles popstate and dispatches stx:navigate
  if (event.state && event.state.tab) {
    switchTab(event.state.tab, false)
  }
else if (event.state && event.state.siteId) {
    const tab = getTabFromUrl()
    switchTab(tab, false)
  }
else if (!siteId) {
    goBack()
  }
})

document.addEventListener('DOMContentLoaded', async () => {
  // Shell visibility is reactive (SiteSelector effect on the store siteId) and the
  // layout's inline pre-paint sets the initial state. This bootstrap only kicks
  // off the data fetch + refresh loop for a site loaded directly via the URL.
  // The account page is project-independent — skip it so its URL isn't rewritten
  // to /dashboard and no per-site fetch/refresh runs (#3).
  if (siteId && window.location.pathname !== '/dashboard/account') {
    const initialTab = getTabFromUrl()
    switchTab(initialTab, false)

    const cached = loadCachedStats()
    if (cached) {
      stats = cached
    }

    await fetchDashboardData()
    refreshInterval = setInterval(fetchDashboardData, 30000)

    updateUrlForTab(initialTab, true)
  }
  // No-site case: SiteSelector renders the selector and fetches sites via onMount.
})

// Expose functions to global scope
Object.assign(window, {
  selectSite,
  goBack,
  setDateRange,
  switchTab,
  fetchDashboardData,
})
