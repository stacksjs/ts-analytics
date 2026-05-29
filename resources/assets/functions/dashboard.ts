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
  'errors': 'issues',
  'errors/statuses': 'issues/states',
  'errors/status': 'issues/state',
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
let availableSites: any[] = []
let currentSite: any = null
let dateRange = '6h'
let isLoading = false
let lastUpdated: Date | null = null
let refreshInterval: ReturnType<typeof setInterval> | null = null
let previousStats: any = null

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
const _siteHostname: string | null = null
let siteHasHistoricalData = cachedStats ? true : false

// Tab state
let activeTab = 'dashboard'
const validTabs = ['dashboard', 'live', 'sessions', 'funnels', 'flow', 'vitals', 'errors', 'insights', 'settings']
const tabTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  live: 'Live View',
  sessions: 'Sessions',
  funnels: 'Funnels',
  flow: 'User Flow',
  vitals: 'Web Vitals',
  errors: 'Errors',
  insights: 'Insights',
  settings: 'Settings'
}

// Theme management
function getPreferredTheme() {
  const stored = localStorage.getItem('ts-analytics-theme')
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme: string) {
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
  // ChartSection redraws itself on theme change (observes <html data-theme>).
}

applyTheme(getPreferredTheme())

// Site management — fetchSites/renderSiteSelector/createSite handled by SiteSelector.stx component


function selectSite(id: string, name: string) {
  siteId = id
  window.siteId = id
  siteName = name || 'Analytics Dashboard'
  availableSites = window._availableSites || availableSites
  currentSite = availableSites.find(s => s.id === id)
  const sel = document.getElementById('site-selector')
  const dash = document.getElementById('dashboard')
  const nameEl = document.getElementById('current-site-name')
  if (sel) sel.style.display = 'none'
  if (dash) dash.style.display = 'block'
  if (nameEl) nameEl.textContent = siteName

  const url = new URL(`${window.location.origin}/dashboard`)
  url.searchParams.set('siteId', id)
  window.history.pushState({ tab: 'dashboard', siteId: id }, '', url)

  const cached = loadCachedStats()
  if (cached) {
    stats = cached
    previousStats = null
    siteHasHistoricalData = true
    renderDashboard(false)
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
  currentSite = null
  const sel = document.getElementById('site-selector')
  const dash = document.getElementById('dashboard')
  if (sel) sel.style.display = 'flex'
  if (dash) dash.style.display = 'none'
  const url = new URL(window.location.href)
  url.searchParams.delete('siteId')
  window.history.pushState({}, '', url)
  if (window.fetchSites) window.fetchSites()
}

function navigateTo(section: string) {
  const url = `/dashboard/${section}?siteId=${encodeURIComponent(siteId)}`
  if (window.stxRouter?.navigate) {
    window.stxRouter.navigate(url)
  }
else {
    navigate(url, true)
  }
}

// Date range handling
function setDateRange(range: string) {
  dateRange = range
  document.querySelectorAll('.date-btn').forEach(btn => btn.classList.remove('active'))
  document.querySelector(`[data-range="${range}"]`)?.classList.add('active')
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

    previousStats = { ...stats }
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
    lastUpdated = new Date()

    if (stats.views > 0 || stats.sessions > 0) {
      siteHasHistoricalData = true
    }

    renderDashboard(true)
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

function fmt(n: number | undefined | null) {
  if (n === undefined || n === null) return '0'
  return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n)
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
  if (siteId) url.searchParams.set('siteId', siteId)
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
  activeTab = tab

  // Update document title based on current tab
  document.title = `${tabTitles[tab] || 'Dashboard'} - Analytics`

  if (updateHistory && siteId) {
    updateUrlForTab(tab)
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab)
  })

  const statsSection = document.querySelector('.stats')
  const chartBox = document.querySelector('.chart-box')
  const dashboardPanels = document.getElementById('dashboard-panels')
  const controlsBar = document.getElementById('controls-bar')
  const filtersBar = document.getElementById('filters-bar')

  const tabsWithControls = ['dashboard', 'sessions', 'flow', 'live', 'funnels']
  const showControls = tabsWithControls.includes(tab)

  if (controlsBar) (controlsBar as HTMLElement).style.display = showControls ? 'flex' : 'none'
  if (filtersBar) (filtersBar as HTMLElement).style.display = showControls ? 'flex' : 'none'

  document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'))

  if (tab === 'dashboard') {
    if (statsSection) (statsSection as HTMLElement).style.display = 'grid'
    if (chartBox) (chartBox as HTMLElement).style.display = 'block'
    if (dashboardPanels) dashboardPanels.style.display = 'block'
    renderDashboard()
  }
else {
    if (statsSection) (statsSection as HTMLElement).style.display = 'none'
    if (chartBox) (chartBox as HTMLElement).style.display = 'none'
    if (dashboardPanels) dashboardPanels.style.display = 'none'

    const tabView = document.getElementById(`tab-${tab}`)
    if (tabView) tabView.classList.remove('hidden')
  }
}

function hasAnyData() {
  return stats.views > 0 || stats.sessions > 0 || stats.people > 0
}

function renderDashboard(_animate = false) {
  // Stat cards are rendered reactively by the StatsRow component (bound to the
  // analytics store). This controller only maintains the realtime-count
  // indicator, last-updated label, and empty-state handling below.
  const realtimeCountEl = document.getElementById('realtime-count')
  if (realtimeCountEl) realtimeCountEl.textContent = stats.realtime === 1 ? '1 visitor online' : `${stats.realtime} visitors online`

  if (lastUpdated) {
    const updatedEl = document.getElementById('last-updated')
    if (updatedEl) updatedEl.textContent = `Updated ${lastUpdated.toLocaleTimeString()}`
  }

  const noDataMsg = document.getElementById('no-data-msg')
  const mainContent = document.getElementById('main-content')

  if (!hasAnyData() && !siteHasHistoricalData) {
    if (noDataMsg) noDataMsg.style.display = 'block'
    if (mainContent) mainContent.style.display = 'none'
    const trackingScriptEl = document.getElementById('tracking-script')
    if (trackingScriptEl) trackingScriptEl.textContent = '<script src="' + API_ENDPOINT + '/sites/' + siteId + '/script" defer></' + 'script>'
    return
  }

  if (noDataMsg) noDataMsg.style.display = 'none'
  if (mainContent) mainContent.style.display = 'block'
}

// SPA navigation handler — update UI after STX router swaps content
window.addEventListener('stx:navigate', () => {
  const tab = getTabFromUrl()
  activeTab = tab
  document.title = `${tabTitles[tab] || 'Dashboard'} - Analytics`

  // Update active nav state
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab)
  })

  // Toggle controls visibility (controls are outside #main-content, persist across swaps)
  const controlsBar = document.getElementById('controls-bar')
  const filtersBar = document.getElementById('filters-bar')
  const statsSection = document.querySelector('.stats') as HTMLElement | null
  const chartBox = document.querySelector('.chart-box') as HTMLElement | null
  const tabsWithControls = ['dashboard', 'sessions', 'flow', 'live', 'funnels']
  const showControls = tabsWithControls.includes(tab)

  if (controlsBar) (controlsBar as HTMLElement).style.display = showControls ? 'flex' : 'none'
  if (filtersBar) (filtersBar as HTMLElement).style.display = showControls ? 'flex' : 'none'
  if (statsSection) statsSection.style.display = tab === 'dashboard' ? 'grid' : 'none'
  if (chartBox) chartBox.style.display = tab === 'dashboard' ? 'block' : 'none'
})

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
  const selectorEl = document.getElementById('site-selector')
  const dashboardEl = document.getElementById('dashboard')

  if (siteId) {
    currentSite = { id: siteId }
    if (selectorEl) selectorEl.style.display = 'none'

    const initialTab = getTabFromUrl()

    // Switch to the correct tab BEFORE showing the dashboard to avoid flash
    switchTab(initialTab, false)

    if (dashboardEl) dashboardEl.style.display = 'block'

    const cached = loadCachedStats()
    if (cached) {
      stats = cached
      previousStats = null
      if (initialTab === 'dashboard') {
        renderDashboard(false)
      }
    }

    await fetchDashboardData()
    refreshInterval = setInterval(fetchDashboardData, 30000)

    updateUrlForTab(initialTab, true)
  }
else {
    if (selectorEl) selectorEl.style.display = 'flex'
    if (dashboardEl) dashboardEl.style.display = 'none'
    // SiteSelector component handles fetchSites via onMount
  }
})

// Expose functions to global scope
Object.assign(window, {
  selectSite,
  goBack,
  toggleTheme,
  setDateRange,
  switchTab,
  navigateTo,
  fetchDashboardData,
})
