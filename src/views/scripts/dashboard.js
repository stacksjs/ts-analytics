/**
 * Dashboard Client-Side JavaScript
 *
 * This module contains all the client-side logic for the analytics dashboard.
 * Organized into sections:
 * - Configuration & State
 * - Theme Management
 * - Icons & Formatting
 * - API & Data Fetching
 * - Rendering Functions
 * - Tab Content Renderers
 * - Modal Handlers
 * - Event Handlers
 * - Initialization
 */

// ============================================================================
// Configuration & State
// ============================================================================

const urlParams = new URLSearchParams(window.location.search)
const API_ENDPOINT = window.ANALYTICS_API_ENDPOINT || urlParams.get('api') || window.location.origin
const SITE_ID = urlParams.get('siteId') || window.ANALYTICS_SITE_ID || ''

// Dashboard State
const state = {
  siteName: "Analytics Dashboard",
  siteId: SITE_ID,
  availableSites: [],
  currentSite: null,
  dateRange: '6h',
  isLoading: false,
  lastUpdated: null,
  refreshInterval: null,
  previousStats: null,
  stats: { realtime: 0, sessions: 0, people: 0, views: 0, avgTime: "00:00", bounceRate: 0, events: 0 },
  pages: [],
  referrers: [],
  deviceTypes: [],
  browsers: [],
  countries: [],
  campaigns: [],
  events: [],
  timeSeriesData: [],
  goals: [],
  goalStats: null,
  siteHostname: null,
  showGoalModal: false,
  editingGoal: null,
  siteHasHistoricalData: false,
  sessions: [],
  sessionDetail: null,
  vitals: [],
  errors: [],
  insights: [],
  activeTab: 'dashboard',
  filters: { country: '', device: '', browser: '', referrer: '' },
  comparisonStats: null,
  liveRefreshInterval: null,
  annotations: [],
  showComparison: false,
  comparisonData: null,
  flowData: null,
  revenueData: null,
  perfBudgetViolations: [],
  errorStatuses: {}
}

// Load cached stats
function loadCachedStats() {
  try {
    const cached = localStorage.getItem('ts-analytics-stats-' + state.siteId)
    if (cached) {
      const data = JSON.parse(cached)
      if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        return data.stats
      }
    }
  } catch (e) {}
  return null
}

function saveCachedStats(statsData) {
  try {
    localStorage.setItem('ts-analytics-stats-' + state.siteId, JSON.stringify({
      stats: statsData,
      timestamp: Date.now()
    }))
  } catch (e) {}
}

// Initialize from cache
const cachedStats = loadCachedStats()
if (cachedStats) {
  state.stats = cachedStats
  state.siteHasHistoricalData = true
}

// ============================================================================
// Theme Management
// ============================================================================

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
  if (state.timeSeriesData.length) renderChart()
}

// ============================================================================
// Icons & Formatting
// ============================================================================

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
}

function getCountryFlag(name) {
  return countryFlags[name] || '\u{1F30D}'
}

const deviceIcons = {
  'desktop': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  'mobile': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
  'tablet': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
}

function getDeviceIcon(type) {
  return deviceIcons[type?.toLowerCase()] || deviceIcons['desktop']
}

function fmt(n) {
  if (n === undefined || n === null) return '0'
  return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n)
}

function formatDuration(ms) {
  if (!ms) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  return m + 'm ' + (s % 60) + 's'
}

function animateValue(element, start, end, duration, formatter) {
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
    const easeProgress = 1 - Math.pow(1 - progress, 3)
    const current = Math.round(startNum + (endNum - startNum) * easeProgress)
    element.textContent = formatter ? formatter(current) : current

    if (progress < 1) {
      requestAnimationFrame(update)
    }
  }
  requestAnimationFrame(update)
}

// ============================================================================
// API & Data Fetching
// ============================================================================

function getDateRangeParams(forTimeseries) {
  const now = new Date()
  const end = now.toISOString()
  let start, period = 'day'
  switch(state.dateRange) {
    case '1h': start = new Date(now - 1*60*60*1000); period = 'minute'; break
    case '6h': start = new Date(now - 6*60*60*1000); period = 'hour'; break
    case '12h': start = new Date(now - 12*60*60*1000); period = 'hour'; break
    case '24h': start = new Date(now - 24*60*60*1000); period = 'hour'; break
    case '7d': start = new Date(now - 7*24*60*60*1000); break
    case '30d': start = new Date(now - 30*24*60*60*1000); break
    case '90d': start = new Date(now - 90*24*60*60*1000); break
    default: start = new Date(now - 30*24*60*60*1000)
  }
  let params = `?startDate=${start.toISOString()}&endDate=${end}`
  if (forTimeseries) params += `&period=${period}`
  return params
}

async function fetchSites() {
  const container = document.getElementById('site-list')
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading sites...</p></div>'
  try {
    const res = await fetch(`${API_ENDPOINT}/api/sites`)
    if (!res.ok) throw new Error('Failed to fetch')
    const data = await res.json()
    state.availableSites = data.sites || []
    renderSiteSelector()
  } catch (err) {
    container.innerHTML = '<div class="error"><p>Failed to load sites</p><button onclick="fetchSites()">Retry</button></div>'
  }
}

async function fetchDashboardData() {
  if (state.isLoading) return
  state.isLoading = true
  const spinStartTime = Date.now()
  document.getElementById('refresh-btn')?.classList.add('spinning')

  const baseUrl = `${API_ENDPOINT}/api/sites/${state.siteId}`
  const params = getDateRangeParams(false)
  const tsParams = getDateRangeParams(true)

  try {
    const fetchPromises = [
      fetch(`${baseUrl}/stats${params}`).then(r => r.json()).catch(() => ({})),
      fetch(`${baseUrl}/realtime`).then(r => r.json()).catch(() => ({ currentVisitors: 0 })),
      fetch(`${baseUrl}/pages${params}`).then(r => r.json()).catch(() => ({ pages: [] })),
      fetch(`${baseUrl}/referrers${params}`).then(r => r.json()).catch(() => ({ referrers: [] })),
      fetch(`${baseUrl}/devices${params}`).then(r => r.json()).catch(() => ({ deviceTypes: [] })),
      fetch(`${baseUrl}/browsers${params}`).then(r => r.json()).catch(() => ({ browsers: [] })),
      fetch(`${baseUrl}/countries${params}`).then(r => r.json()).catch(() => ({ countries: [] })),
      fetch(`${baseUrl}/timeseries${tsParams}`).then(r => r.json()).catch(() => ({ timeSeries: [] })),
      fetch(`${baseUrl}/events${params}`).then(r => r.json()).catch(() => ({ events: [] })),
      fetch(`${baseUrl}/campaigns${params}`).then(r => r.json()).catch(() => ({ campaigns: [] })),
      fetch(`${baseUrl}/goals${params}`).then(r => r.json()).catch(() => ({ goals: [] })),
      fetch(`${baseUrl}/vitals${params}`).then(r => r.json()).catch(() => ({ vitals: [] })),
      fetch(`${baseUrl}/errors${params}`).then(r => r.json()).catch(() => ({ errors: [] })),
      fetch(`${baseUrl}/insights`).then(r => r.json()).catch(() => ({ insights: [] })),
      fetch(`${baseUrl}/annotations${params}`).then(r => r.json()).catch(() => ({ annotations: [] })),
    ]

    if (state.showComparison) {
      fetchPromises.push(fetch(`${baseUrl}/comparison${params}`).then(r => r.json()).catch(() => null))
    }

    const results = await Promise.all(fetchPromises)
    const [statsRes, realtimeRes, pagesRes, referrersRes, devicesRes, browsersRes, countriesRes, timeseriesRes, eventsRes, campaignsRes, goalsRes, vitalsRes, errorsRes, insightsRes, annotationsRes] = results

    if (state.showComparison && results[15]) {
      state.comparisonData = results[15]
    }

    state.previousStats = { ...state.stats }
    state.stats = {
      realtime: realtimeRes.currentVisitors || 0,
      sessions: statsRes.sessions || 0,
      people: statsRes.people || 0,
      views: statsRes.views || 0,
      avgTime: statsRes.avgTime || "00:00",
      bounceRate: statsRes.bounceRate || 0,
      events: statsRes.events || 0
    }
    saveCachedStats(state.stats)
    state.pages = pagesRes.pages || []
    state.siteHostname = pagesRes.hostname || null
    state.referrers = referrersRes.referrers || []
    state.deviceTypes = devicesRes.deviceTypes || []
    state.browsers = browsersRes.browsers || []
    state.countries = countriesRes.countries || []
    state.campaigns = campaignsRes.campaigns || []
    state.events = eventsRes.events || []
    state.goals = goalsRes.goals || []
    state.timeSeriesData = timeseriesRes.timeSeries || []
    state.vitals = vitalsRes.vitals || []
    state.errors = errorsRes.errors || []
    state.insights = insightsRes.insights || []
    state.comparisonStats = insightsRes.stats || null
    state.annotations = annotationsRes.annotations || []
    state.lastUpdated = new Date()

    if (state.stats.views > 0 || state.stats.sessions > 0 || state.pages.length > 0 || state.timeSeriesData.some(t => t.views > 0)) {
      state.siteHasHistoricalData = true
    }

    renderDashboard(true)
  } catch (error) {
    console.error('Failed to fetch:', error)
  } finally {
    state.isLoading = false
    const elapsed = Date.now() - spinStartTime
    const remainingTime = Math.max(0, 1000 - elapsed)
    setTimeout(() => {
      document.getElementById('refresh-btn')?.classList.remove('spinning')
    }, remainingTime)
  }
}

// ============================================================================
// Site Management
// ============================================================================

function renderSiteSelector() {
  const container = document.getElementById('site-list')

  const createForm = `<div class="create-site-form" style="margin-bottom:1.5rem;width:100%;max-width:500px">
    <h3 style="font-size:0.875rem;margin-bottom:0.75rem;color:var(--text2)">Create New Site</h3>
    <form onsubmit="createSite(event)" style="display:flex;gap:0.5rem">
      <input type="text" id="new-site-name" placeholder="Site name (e.g. My Website)" required style="flex:1;padding:0.5rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:0.875rem">
      <input type="text" id="new-site-domain" placeholder="Domain (optional)" style="flex:1;padding:0.5rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:0.875rem">
      <button type="submit" style="padding:0.5rem 1rem;border-radius:6px;background:var(--accent);color:white;border:none;cursor:pointer;font-weight:500">Create</button>
    </form>
    <p id="create-site-error" style="color:var(--error);font-size:0.75rem;margin-top:0.5rem;display:none"></p>
  </div>`

  if (state.availableSites.length === 0) {
    container.innerHTML = createForm + `<div class="empty" style="margin-top:1rem">
      <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
      <p>No sites yet</p>
      <p style="font-size:0.75rem;margin-top:0.5rem;color:var(--muted)">Create your first site above to start tracking analytics</p>
    </div>`
    return
  }

  container.innerHTML = createForm + `<h3 style="font-size:0.875rem;margin-bottom:0.75rem;color:var(--text2);width:100%;max-width:500px">Your Sites</h3>` + state.availableSites.map(s =>
    `<button class="site-card" onclick="selectSite('${s.id}', '${(s.name || '').replace(/'/g, "\\'")}')">
      <div class="site-icon"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg></div>
      <div class="site-info"><span class="site-name">${s.name || 'Unnamed'}</span><span class="site-domain">${s.domains?.[0] || s.id}</span></div>
      <svg class="arrow" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
    </button>`
  ).join('')
}

async function createSite(e) {
  e.preventDefault()
  const nameInput = document.getElementById('new-site-name')
  const domainInput = document.getElementById('new-site-domain')
  const errorEl = document.getElementById('create-site-error')

  const name = nameInput.value.trim()
  const domain = domainInput.value.trim()

  if (!name) {
    errorEl.textContent = 'Site name is required'
    errorEl.style.display = 'block'
    return
  }

  try {
    const res = await fetch(`${API_ENDPOINT}/api/sites`, {
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

function selectSite(id, name) {
  state.siteId = id
  state.siteName = name || 'Analytics Dashboard'
  state.currentSite = state.availableSites.find(s => s.id === id)
  document.getElementById('site-selector').style.display = 'none'
  document.getElementById('dashboard').style.display = 'block'
  document.getElementById('current-site-name').textContent = state.siteName
  const url = new URL(window.location.href)
  url.searchParams.set('siteId', id)
  window.history.pushState({}, '', url)

  const cached = loadCachedStats()
  if (cached) {
    state.stats = cached
    state.previousStats = null
    state.siteHasHistoricalData = true
    renderDashboard(false)
  }

  fetchDashboardData()
  if (state.refreshInterval) clearInterval(state.refreshInterval)
  state.refreshInterval = setInterval(fetchDashboardData, 30000)
}

function goBack() {
  if (state.refreshInterval) clearInterval(state.refreshInterval)
  state.siteId = ''
  state.currentSite = null
  document.getElementById('site-selector').style.display = 'flex'
  document.getElementById('dashboard').style.display = 'none'
  const url = new URL(window.location.href)
  url.searchParams.delete('siteId')
  window.history.pushState({}, '', url)
  fetchSites()
}

// ============================================================================
// Export to window for onclick handlers
// ============================================================================

window.fetchSites = fetchSites
window.createSite = createSite
window.selectSite = selectSite
window.goBack = goBack
window.toggleTheme = toggleTheme
window.setDateRange = setDateRange
window.toggleComparison = toggleComparison
window.addAnnotation = addAnnotation
window.fetchDashboardData = fetchDashboardData
window.switchTab = switchTab
window.applyFilter = applyFilter
window.exportData = exportData
window.navigateTo = navigateTo
window.viewSession = viewSession
window.closeModal = closeModal
window.showCreateGoalModal = showCreateGoalModal
window.editGoal = editGoal
window.deleteGoal = deleteGoal
window.saveGoal = saveGoal
window.closeGoalModal = closeGoalModal
window.updateGoalForm = updateGoalForm
window.showPathHeatmap = showPathHeatmap

// Note: The remaining functions (setDateRange, toggleComparison, addAnnotation, switchTab,
// renderDashboard, renderChart, renderGoals, etc.) are defined in the inline script
// to keep this module focused on core functionality and state management
