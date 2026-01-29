// Extend Window interface for STX loading indicator
declare global {
  interface Window {
    stxLoading?: {
      start: () => void
      finish: () => void
      set: (value: number) => void
      clear: () => void
    }
    ANALYTICS_API_ENDPOINT?: string
    ANALYTICS_SITE_ID?: string
    ANALYTICS_STEALTH_MODE?: boolean
  }
}

const urlParams = new URLSearchParams(window.location.search)
const API_ENDPOINT = window.ANALYTICS_API_ENDPOINT || urlParams.get('api') || window.location.origin
const SITE_ID = urlParams.get('siteId') || window.ANALYTICS_SITE_ID || ''

// Stealth mode: use innocuous API paths to bypass content blockers
const USE_STEALTH = window.ANALYTICS_STEALTH_MODE ?? urlParams.get('stealth') === 'true' ?? true

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
;(window as any).apiPath = apiPath
;(window as any).USE_STEALTH = USE_STEALTH

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
;(window as any).API_ENDPOINT = API_ENDPOINT
;(window as any).siteId = siteId

// Load cached stats from localStorage
function loadCachedStats() {
  try {
    const cached = localStorage.getItem('ts-analytics-stats-' + siteId)
    if (cached) {
      const data = JSON.parse(cached)
      if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        return data.stats
      }
    }
  } catch (e) {}
  return null
}

function saveCachedStats(statsData: any) {
  try {
    localStorage.setItem('ts-analytics-stats-' + siteId, JSON.stringify({
      stats: statsData,
      timestamp: Date.now()
    }))
  } catch (e) {}
}

// Animate number transitions
function animateValue(element: HTMLElement | null, start: number, end: number, duration: number, formatter?: (n: number) => string) {
  if (!element) return
  const startNum = typeof start === 'number' ? start : (parseFloat(String(start)) || 0)
  const endNum = typeof end === 'number' ? end : (parseFloat(String(end)) || 0)

  if (startNum === endNum) {
    element.textContent = formatter ? formatter(endNum) : String(endNum)
    return
  }

  const startTime = performance.now()

  function update(currentTime: number) {
    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / duration, 1)
    const easeProgress = 1 - Math.pow(1 - progress, 3)
    const current = Math.round(startNum + (endNum - startNum) * easeProgress)
    element!.textContent = formatter ? formatter(current) : String(current)

    if (progress < 1) {
      requestAnimationFrame(update)
    }
  }
  requestAnimationFrame(update)
}

const cachedStats = loadCachedStats()
let stats = cachedStats || { realtime: 0, sessions: 0, people: 0, views: 0, avgTime: '00:00', bounceRate: 0, events: 0 }
let timeSeriesData: any[] = []
let goals: any[] = []
let siteHostname: string | null = null
let showGoalModal = false
let editingGoal: any = null
let siteHasHistoricalData = cachedStats ? true : false

// Annotations and comparison state
let annotations: any[] = []
let showComparison = false
let comparisonData: any = null

// Tab state
let activeTab = 'dashboard'
const validTabs = ['dashboard', 'live', 'sessions', 'funnels', 'flow', 'vitals', 'errors', 'insights', 'settings']

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
  if (timeSeriesData.length) renderChart()
}

applyTheme(getPreferredTheme())

// Site management
async function fetchSites() {
  const container = document.getElementById('site-list')
  if (!container) return
  container.innerHTML = '<div class="loading">Loading sites...</div>'

  try {
    const res = await fetch(apiPath(`${API_ENDPOINT}/api/sites`))
    if (!res.ok) throw new Error('Failed to fetch')
    const data = await res.json()
    availableSites = data.sites || []
    renderSiteSelector()
  } catch (err) {
    container.innerHTML = '<div class="error">Failed to load sites</div>'
  }
}

function renderSiteSelector() {
  const container = document.getElementById('site-list')
  if (!container) return

  const sitesHtml = availableSites.length === 0 ? `
    <div class="empty" style="margin-top:1rem">
      <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
      <p>No sites yet</p>
      <p style="font-size:0.75rem;margin-top:0.5rem;color:var(--muted)">Create your first site above to start tracking analytics</p>
    </div>
  ` : `
    <h3 style="font-size:0.875rem;margin-bottom:0.75rem;color:var(--text2);width:100%;max-width:500px">Your Sites</h3>
    ${availableSites.map(s => `
      <button class="site-card" data-site-id="${s.id}" data-site-name="${s.name || ''}">
        <div class="site-icon">
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
        </div>
        <div class="site-info">
          <span class="site-name">${s.name || 'Unnamed'}</span>
          <span class="site-domain">${s.domains?.[0] || s.id}</span>
        </div>
        <svg class="arrow" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
      </button>
    `).join('')}
  `

  container.innerHTML = `
    <div class="create-site-form" style="margin-bottom:1.5rem;width:100%;max-width:500px">
      <h3 style="font-size:0.875rem;margin-bottom:0.75rem;color:var(--text2)">Create New Site</h3>
      <form id="create-site-form" style="display:flex;gap:0.5rem">
        <input type="text" id="new-site-name" placeholder="Site name (e.g. My Website)" required style="flex:1;padding:0.5rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:0.875rem">
        <input type="text" id="new-site-domain" placeholder="Domain (optional)" style="flex:1;padding:0.5rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:0.875rem">
        <button type="submit" style="padding:0.5rem 1rem;border-radius:6px;background:var(--accent);color:white;border:none;cursor:pointer;font-weight:500">Create</button>
      </form>
      <p id="create-site-error" style="color:var(--error);font-size:0.75rem;margin-top:0.5rem;display:none"></p>
    </div>
    ${sitesHtml}
  `

  document.getElementById('create-site-form')?.addEventListener('submit', createSite)
  container.querySelectorAll('.site-card').forEach(card => {
    card.addEventListener('click', () => {
      selectSite((card as HTMLElement).dataset.siteId!, (card as HTMLElement).dataset.siteName || '')
    })
  })
}

async function createSite(e: Event) {
  e.preventDefault()
  const nameInput = document.getElementById('new-site-name') as HTMLInputElement
  const domainInput = document.getElementById('new-site-domain') as HTMLInputElement
  const errorEl = document.getElementById('create-site-error')!

  const name = nameInput.value.trim()
  const domain = domainInput.value.trim()

  if (!name) {
    errorEl.textContent = 'Site name is required'
    errorEl.style.display = 'block'
    return
  }

  try {
    const res = await fetch(apiPath(`${API_ENDPOINT}/api/sites`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, domain: domain || undefined })
    })
    const data = await res.json()

    if (!res.ok) {
      errorEl.textContent = data.error || 'Failed to create site'
      errorEl.style.display = 'block'
      return
    }

    errorEl.style.display = 'none'
    nameInput.value = ''
    domainInput.value = ''

    await fetchSites()
    if (data.site) {
      selectSite(data.site.id, data.site.name)
    }
  } catch (err) {
    errorEl.textContent = 'Failed to create site'
    errorEl.style.display = 'block'
  }
}

function selectSite(id: string, name: string) {
  siteId = id
  ;(window as any).siteId = id
  siteName = name || 'Analytics Dashboard'
  currentSite = availableSites.find(s => s.id === id)
  document.getElementById('site-selector')!.style.display = 'none'
  document.getElementById('dashboard')!.style.display = 'block'
  document.getElementById('current-site-name')!.textContent = siteName

  const url = new URL(window.location.origin + '/dashboard')
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
  ;(window as any).siteId = ''
  currentSite = null
  document.getElementById('site-selector')!.style.display = 'flex'
  document.getElementById('dashboard')!.style.display = 'none'
  const url = new URL(window.location.href)
  url.searchParams.delete('siteId')
  window.history.pushState({}, '', url)
  fetchSites()
}

function navigateTo(section: string) {
  window.location.href = '/dashboard/' + section + '?siteId=' + encodeURIComponent(siteId)
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
;(window as any).getDateRangeParams = getDateRangeParams

function refreshAllPanels() {
  const w = window as any
  if (w.refreshPagesPanel) w.refreshPagesPanel()
  if (w.refreshReferrersPanel) w.refreshReferrersPanel()
  if (w.refreshDevicesPanel) w.refreshDevicesPanel()
  if (w.refreshBrowsersPanel) w.refreshBrowsersPanel()
  if (w.refreshCountriesPanel) w.refreshCountriesPanel()
  if (w.refreshCampaignsPanel) w.refreshCampaignsPanel()
  if (w.refreshEventsPanel) w.refreshEventsPanel()
  if (w.refreshGoalsPanel) w.refreshGoalsPanel()
}
;(window as any).refreshAllPanels = refreshAllPanels

function toggleComparison() {
  showComparison = !showComparison
  const btn = document.getElementById('compare-btn')
  if (btn) {
    btn.classList.toggle('active', showComparison)
    btn.style.background = showComparison ? 'var(--accent)' : ''
    btn.style.color = showComparison ? 'white' : ''
  }
  fetchDashboardData()
}

async function addAnnotation() {
  const type = prompt('Annotation type (deployment, campaign, incident, general):') || 'general'
  if (!['deployment', 'campaign', 'incident', 'general'].includes(type)) {
    alert('Invalid type. Use: deployment, campaign, incident, or general')
    return
  }
  const title = prompt('Title (e.g., "v2.0 Release"):')
  if (!title) return
  const description = prompt('Description (optional):') || ''
  const dateStr = prompt('Date (YYYY-MM-DD, leave empty for today):')
  const date = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString()

  try {
    await fetch(apiPath(`${API_ENDPOINT}/api/sites/${siteId}/annotations`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, description, date })
    })
    fetchDashboardData()
  } catch (e) {
    console.error('Failed to add annotation:', e)
    alert('Failed to add annotation')
  }
}

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
  const tsParams = getDateRangeParams(true)

  try {
    const fetchPromises: Promise<any>[] = [
      fetch(apiPath(`${baseUrl}/stats${params}`)).then(r => r.json()).catch(() => ({})),
      fetch(apiPath(`${baseUrl}/realtime`)).then(r => r.json()).catch(() => ({ currentVisitors: 0 })),
      fetch(apiPath(`${baseUrl}/timeseries${tsParams}`)).then(r => r.json()).catch(() => ({ timeSeries: [] })),
      fetch(apiPath(`${baseUrl}/goals${params}`)).then(r => r.json()).catch(() => ({ goals: [] })),
      fetch(apiPath(`${baseUrl}/annotations${params}`)).then(r => r.json()).catch(() => ({ annotations: [] })),
    ]

    if (showComparison) {
      fetchPromises.push(fetch(apiPath(`${baseUrl}/comparison${params}`)).then(r => r.json()).catch(() => null))
    }

    const results = await Promise.all(fetchPromises)
    const [statsRes, realtimeRes, timeseriesRes, goalsRes, annotationsRes] = results
    if (showComparison && results[5]) {
      comparisonData = results[5]
    }

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
    goals = goalsRes.goals || []
    timeSeriesData = (timeseriesRes.timeSeries || []).map((t: any) => ({
      date: t.timestamp || t.date,
      views: t.views,
      visitors: t.visitors
    }))
    annotations = annotationsRes.annotations || []
    lastUpdated = new Date()

    if (stats.views > 0 || stats.sessions > 0 || timeSeriesData.some((t: any) => t.views > 0)) {
      siteHasHistoricalData = true
    }

    renderDashboard(true)
  } catch (error) {
    console.error('Failed to fetch:', error)
  } finally {
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
  } else {
    window.history.pushState({ tab, siteId }, '', url)
  }
}

function switchTab(tab: string, updateHistory = true) {
  if (!validTabs.includes(tab)) tab = 'dashboard'
  activeTab = tab

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
  } else {
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

function renderDashboard(animate = false) {
  const duration = 600

  if (animate && previousStats) {
    animateValue(document.getElementById('stat-realtime'), previousStats.realtime, stats.realtime, duration, fmt)
    animateValue(document.getElementById('stat-sessions'), previousStats.sessions, stats.sessions, duration, fmt)
    animateValue(document.getElementById('stat-people'), previousStats.people, stats.people, duration, fmt)
    animateValue(document.getElementById('stat-views'), previousStats.views, stats.views, duration, fmt)
    animateValue(document.getElementById('stat-bounce'), previousStats.bounceRate, stats.bounceRate, duration, v => v + '%')
    const avgTimeEl = document.getElementById('stat-avgtime')
    if (avgTimeEl) avgTimeEl.textContent = stats.avgTime
  } else {
    const realtimeEl = document.getElementById('stat-realtime')
    if (realtimeEl) realtimeEl.textContent = fmt(stats.realtime)
    const sessionsEl = document.getElementById('stat-sessions')
    if (sessionsEl) sessionsEl.textContent = fmt(stats.sessions)
    const peopleEl = document.getElementById('stat-people')
    if (peopleEl) peopleEl.textContent = fmt(stats.people)
    const viewsEl = document.getElementById('stat-views')
    if (viewsEl) viewsEl.textContent = fmt(stats.views)
    const bounceEl = document.getElementById('stat-bounce')
    if (bounceEl) bounceEl.textContent = stats.bounceRate + '%'
    const avgTimeEl = document.getElementById('stat-avgtime')
    if (avgTimeEl) avgTimeEl.textContent = stats.avgTime
  }

  const realtimeCountEl = document.getElementById('realtime-count')
  if (realtimeCountEl) realtimeCountEl.textContent = stats.realtime === 1 ? '1 visitor online' : stats.realtime + ' visitors online'

  if (lastUpdated) {
    const updatedEl = document.getElementById('last-updated')
    if (updatedEl) updatedEl.textContent = 'Updated ' + lastUpdated.toLocaleTimeString()
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

  renderChart()
}

// Goal modal
function showCreateGoalModal() {
  editingGoal = null
  const titleEl = document.getElementById('goal-modal-title')
  if (titleEl) titleEl.textContent = 'Create Goal'
  const form = document.getElementById('goal-form') as HTMLFormElement
  if (form) form.reset()
  const modal = document.getElementById('goal-modal')
  if (modal) modal.style.display = 'flex'
  updateGoalForm()
}

function editGoal(goalId: string) {
  const goal = goals.find(g => g.id === goalId)
  if (!goal) return

  editingGoal = goal
  const titleEl = document.getElementById('goal-modal-title')
  if (titleEl) titleEl.textContent = 'Edit Goal'
  const nameEl = document.getElementById('goal-name') as HTMLInputElement
  if (nameEl) nameEl.value = goal.name || ''
  const typeEl = document.getElementById('goal-type') as HTMLSelectElement
  if (typeEl) typeEl.value = goal.type || 'pageview'
  const patternEl = document.getElementById('goal-pattern') as HTMLInputElement
  if (patternEl) patternEl.value = goal.pattern || ''
  const matchTypeEl = document.getElementById('goal-match-type') as HTMLSelectElement
  if (matchTypeEl) matchTypeEl.value = goal.matchType || 'exact'
  const durationEl = document.getElementById('goal-duration') as HTMLInputElement
  if (durationEl) durationEl.value = goal.durationMinutes || 5
  const valueEl = document.getElementById('goal-value') as HTMLInputElement
  if (valueEl) valueEl.value = goal.value || ''
  const modal = document.getElementById('goal-modal')
  if (modal) modal.style.display = 'flex'
  updateGoalForm()
}

function updateGoalForm() {
  const typeEl = document.getElementById('goal-type') as HTMLSelectElement
  const type = typeEl?.value
  const patternGroup = document.getElementById('goal-pattern-group')
  const durationGroup = document.getElementById('goal-duration-group')
  if (patternGroup) patternGroup.style.display = type !== 'duration' ? 'block' : 'none'
  if (durationGroup) durationGroup.style.display = type === 'duration' ? 'block' : 'none'
}

function closeGoalModal() {
  const modal = document.getElementById('goal-modal')
  if (modal) modal.style.display = 'none'
  editingGoal = null
}

async function saveGoal(e: Event) {
  e.preventDefault()

  const typeEl = document.getElementById('goal-type') as HTMLSelectElement
  const type = typeEl?.value
  const data = {
    name: (document.getElementById('goal-name') as HTMLInputElement)?.value,
    type,
    pattern: type !== 'duration' ? (document.getElementById('goal-pattern') as HTMLInputElement)?.value : '',
    matchType: type !== 'duration' ? (document.getElementById('goal-match-type') as HTMLSelectElement)?.value : 'exact',
    durationMinutes: type === 'duration' ? Number((document.getElementById('goal-duration') as HTMLInputElement)?.value) : undefined,
    value: (document.getElementById('goal-value') as HTMLInputElement)?.value ? Number((document.getElementById('goal-value') as HTMLInputElement)?.value) : undefined,
    isActive: true,
  }

  const url = editingGoal
    ? apiPath(`${API_ENDPOINT}/api/sites/${siteId}/goals/${editingGoal.id}`)
    : apiPath(`${API_ENDPOINT}/api/sites/${siteId}/goals`)
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
      refreshAllPanels()
    } else {
      const err = await res.json()
      alert(err.error || 'Failed to save goal')
    }
  } catch (err) {
    console.error('Save goal error:', err)
    alert('Failed to save goal')
  }
}

async function deleteGoal(goalId: string) {
  if (!confirm('Delete this goal? Conversion data will be preserved.')) return

  try {
    const res = await fetch(apiPath(`${API_ENDPOINT}/api/sites/${siteId}/goals/${goalId}`), { method: 'DELETE' })
    if (res.ok) {
      fetchDashboardData()
      refreshAllPanels()
    }
  } catch (err) {
    console.error('Delete goal error:', err)
  }
}

// Expose goal modal functions for STX GoalsPanel component
;(window as any).showEditGoalModal = editGoal
;(window as any).confirmDeleteGoal = deleteGoal

// Chart rendering
function renderChart() {
  const canvas = document.getElementById('chart') as HTMLCanvasElement
  const chartEmpty = document.getElementById('chart-empty')
  const tooltip = document.getElementById('chartTooltip')

  if (!canvas) return

  const styles = getComputedStyle(document.documentElement)
  const colors = {
    border: styles.getPropertyValue('--border').trim() || '#2d3139',
    accent2: styles.getPropertyValue('--accent2').trim() || '#818cf8',
    muted: styles.getPropertyValue('--muted').trim() || '#6b7280',
    text: styles.getPropertyValue('--text').trim() || '#f3f4f6'
  }

  if (!timeSeriesData.length) {
    canvas.style.display = 'none'
    if (chartEmpty) chartEmpty.style.display = 'flex'
    return
  }

  canvas.style.display = 'block'
  if (chartEmpty) chartEmpty.style.display = 'none'

  const ctx = canvas.getContext('2d')!
  const rect = canvas.parentElement!.getBoundingClientRect()
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

  const points = timeSeriesData.map((d, i) => ({
    x: pad.left + i * xS,
    y: pad.top + h - (d.views || d.count || 0) * yS,
    data: d
  }))

  function fmtDate(dateStr: string) {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return String(dateStr)
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    if (dateRange === '1h' || dateRange === '6h' || dateRange === '12h') {
      const hr = date.getHours()
      const m = date.getMinutes()
      const ampm = hr >= 12 ? 'pm' : 'am'
      const h12 = hr % 12 || 12
      return h12 + ':' + (m < 10 ? '0' : '') + m + ampm
    } else if (dateRange === '24h') {
      const hr = date.getHours()
      const ampm = hr >= 12 ? 'pm' : 'am'
      const h12 = hr % 12 || 12
      return h12 + ampm
    }
    return months[date.getMonth()] + ' ' + date.getDate()
  }

  function fmtDateFull(dateStr: string) {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return String(dateStr)
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const hr = date.getHours()
    const m = date.getMinutes()
    const ampm = hr >= 12 ? 'pm' : 'am'
    const h12 = hr % 12 || 12
    const timeStr = h12 + ':' + (m < 10 ? '0' : '') + m + ampm
    const dateStr2 = months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear()
    if (dateRange === '1h' || dateRange === '6h' || dateRange === '12h' || dateRange === '24h') {
      return dateStr2 + ' at ' + timeStr
    }
    return dateStr2
  }

  function draw(hoverIdx: number) {
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, logicalW, logicalH)

    ctx.strokeStyle = colors.border
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (h/4)*i
      ctx.beginPath()
      ctx.moveTo(pad.left, y)
      ctx.lineTo(pad.left+w, y)
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.fillStyle = colors.accent2 + '1a'
    points.forEach((p, i) => {
      i===0 ? (ctx.moveTo(p.x,pad.top+h), ctx.lineTo(p.x,p.y)) : ctx.lineTo(p.x,p.y)
    })
    ctx.lineTo(points[points.length-1].x, pad.top+h)
    ctx.closePath()
    ctx.fill()

    ctx.beginPath()
    ctx.strokeStyle = colors.accent2
    ctx.lineWidth = 2
    points.forEach((p, i) => { i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y) })
    ctx.stroke()

    points.forEach((p, i) => {
      ctx.beginPath()
      ctx.fillStyle = i === hoverIdx ? colors.text : colors.accent2
      ctx.arc(p.x, p.y, i === hoverIdx ? 6 : 3, 0, Math.PI * 2)
      ctx.fill()
      if (i === hoverIdx) { ctx.strokeStyle = colors.accent2; ctx.lineWidth = 2; ctx.stroke() }
    })

    const annotationColors: Record<string, string> = { deployment: '#22c55e', campaign: '#3b82f6', incident: '#ef4444', general: '#8b5cf6' }
    if (annotations.length > 0) {
      annotations.forEach(ann => {
        const annDate = new Date(ann.date).toISOString().split('T')[0]
        const idx = timeSeriesData.findIndex(d => {
          const tDate = new Date(d.date).toISOString().split('T')[0]
          return tDate === annDate
        })
        if (idx >= 0 && idx < points.length) {
          const px = points[idx].x
          const color = annotationColors[ann.type] || annotationColors.general
          ctx.beginPath()
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.setLineDash([4, 2])
          ctx.moveTo(px, pad.top)
          ctx.lineTo(px, pad.top + h)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.fillStyle = color
          ctx.arc(px, pad.top - 8, 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = 'white'
          ctx.font = '8px sans-serif'
          ctx.textAlign = 'center'
          const icons: Record<string, string> = { deployment: '↑', campaign: '📢', incident: '!', general: '•' }
          ctx.fillText(icons[ann.type] || '•', px, pad.top - 5)
        }
      })
    }

    ctx.fillStyle = colors.muted
    ctx.font = '11px -apple-system, sans-serif'
    ctx.textAlign = 'right'
    for (let i = 0; i <= 4; i++) {
      ctx.fillText(fmt(Math.round(maxV - (maxV/4)*i)), pad.left-10, pad.top+(h/4)*i+4)
    }

    ctx.textAlign = 'center'
    const n = timeSeriesData.length
    let maxLabels = 7
    if (dateRange === '1h') maxLabels = Math.min(n, 7)
    else if (dateRange === '6h') maxLabels = Math.min(n, 7)
    else if (dateRange === '12h') maxLabels = Math.min(n, 7)
    else if (dateRange === '24h') maxLabels = Math.min(n, 8)

    if (n === 1) {
      ctx.fillText(fmtDate(timeSeriesData[0].date), pad.left + w / 2, logicalH - 10)
    } else if (n <= maxLabels) {
      timeSeriesData.forEach((d, i) => {
        ctx.fillText(fmtDate(d.date), pad.left + i * xS, logicalH - 10)
      })
    } else {
      const step = (n - 1) / (maxLabels - 1)
      for (let j = 0; j < maxLabels; j++) {
        const i = Math.round(j * step)
        const d = timeSeriesData[i]
        ctx.fillText(fmtDate(d.date), pad.left + i * xS, logicalH - 10)
      }
    }

    if (hoverIdx >= 0) {
      ctx.beginPath()
      ctx.strokeStyle = colors.accent2 + '80'
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

  if (tooltip) {
    let tooltipDate = tooltip.querySelector('.tooltip-date') as HTMLElement
    if (!tooltipDate) {
      tooltipDate = document.createElement('div')
      tooltipDate.className = 'tooltip-date'
      tooltip.appendChild(tooltipDate)
    }
    let tooltipViews = tooltip.querySelector('.tooltip-views') as HTMLElement
    if (!tooltipViews) {
      const row = document.createElement('div')
      row.className = 'tooltip-row'
      row.innerHTML = '<span class="tooltip-dot views"></span>Views: <strong class="tooltip-views"></strong>'
      tooltip.appendChild(row)
      tooltipViews = row.querySelector('.tooltip-views')!
    }
    let tooltipVisitors = tooltip.querySelector('.tooltip-visitors') as HTMLElement
    if (!tooltipVisitors) {
      const row = document.createElement('div')
      row.className = 'tooltip-row'
      row.innerHTML = '<span class="tooltip-dot visitors"></span>Visitors: <strong class="tooltip-visitors"></strong>'
      tooltip.appendChild(row)
      tooltipVisitors = row.querySelector('.tooltip-visitors')!
    }

    canvas.onmousemove = function(e) {
      const cr = canvas.getBoundingClientRect()
      const mx = e.clientX - cr.left
      let closest = -1, minDist = 30
      points.forEach((p, i) => { const d = Math.abs(mx - p.x); if (d < minDist) { minDist = d; closest = i } })
      if (closest >= 0) {
        const p = points[closest], d = p.data
        tooltipDate.textContent = fmtDateFull(d.date)
        tooltipViews.textContent = fmt(d.views || d.count || 0)
        tooltipVisitors.textContent = fmt(d.visitors || 0)
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
}

// Event handlers
window.addEventListener('popstate', (event) => {
  if (event.state && event.state.tab) {
    switchTab(event.state.tab, false)
  } else if (event.state && event.state.siteId) {
    const tab = getTabFromUrl()
    switchTab(tab, false)
  } else if (!siteId) {
    goBack()
  }
})

document.addEventListener('DOMContentLoaded', async () => {
  if (siteId) {
    currentSite = { id: siteId }
    document.getElementById('site-selector')!.style.display = 'none'
    document.getElementById('dashboard')!.style.display = 'block'

    const cached = loadCachedStats()
    if (cached) {
      stats = cached
      previousStats = null
      renderDashboard(false)
    }

    const initialTab = getTabFromUrl()

    await fetchDashboardData()
    refreshInterval = setInterval(fetchDashboardData, 30000)

    if (initialTab !== 'dashboard') {
      switchTab(initialTab, false)
    }
    updateUrlForTab(initialTab, true)
  } else {
    document.getElementById('site-selector')!.style.display = 'flex'
    document.getElementById('dashboard')!.style.display = 'none'
    fetchSites()
  }
})

window.addEventListener('resize', () => { if (timeSeriesData.length) renderChart() })

// Expose functions to global scope
Object.assign(window, {
  selectSite,
  fetchSites,
  createSite,
  goBack,
  toggleTheme,
  setDateRange,
  switchTab,
  navigateTo,
  showCreateGoalModal,
  closeGoalModal,
  saveGoal,
  updateGoalForm,
  editGoal,
  deleteGoal,
  addAnnotation,
  toggleComparison,
  fetchDashboardData,
})
