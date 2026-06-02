import { defineStore, useStore, state } from '@stacksjs/stx'

/**
 * Analytics Store — shared reactive data state for all dashboard panels.
 *
 * Centralizes loading, data arrays, and fetch logic that was previously
 * duplicated across 7+ panel components. Each panel's data lives here
 * so it survives SPA navigation and can be refreshed from anywhere.
 *
 * Usage in any <script client> block:
 *   const analytics = useStore('analytics')
 *   analytics.pages()          // read pages data
 *   analytics.loading()        // check loading state
 *   analytics.fetchSection('pages')  // refresh a section
 */

defineStore('analytics', () => {
  // Resolve the dashboard store LAZILY. Store factories run eagerly at
  // defineStore() time in whatever order they're bundled, and this one can run
  // before 'dashboard' is registered — an eager useStore('dashboard') would throw
  // and abort the whole store-registration script (leaving stores unregistered →
  // "Store not found"). The proxy defers the lookup to first property access, by
  // which point every store is registered.
  const dashboard: any = new Proxy({}, {
    get: (_target, key) => (useStore('dashboard') as any)[key],
  })

  // Shared loading state (replaces per-panel `const loading = state(true)`)
  const loading = state(true)

  // Summary stats (realtime/sessions/visitors/views/avg-time/bounce-rate)
  const stats = state(null)

  // True once this site has ever shown data (cache hit or a fetch with data).
  // Gates the onboarding empty-state so it doesn't flash on a zero-data range.
  const hasHistoricalData = state(false)

  // Chart data: pageviews-over-time series + annotation markers
  const timeSeries = state([])
  const annotations = state([])

  // Section data arrays (replaces scattered `const pages = state([])`, etc.)
  const pages = state([])
  const referrers = state([])
  const browsers = state([])
  const devices = state([])
  const countries = state([])
  const campaigns = state([])
  const events = state([])
  const goals = state([])

  // Sites list (from SiteSelector)
  const sites = state([])
  const sitesLoading = state(true)
  const sitesError = state(null)

  // Map of section name to its state setter and response key
  const sectionMap = {
    pages: { data: pages, key: 'pages', slice: 10 },
    referrers: { data: referrers, key: 'referrers', slice: 10 },
    browsers: { data: browsers, key: 'browsers', slice: 0 },
    devices: { data: devices, key: 'devices', slice: 0 },
    countries: { data: countries, key: 'countries', slice: 10 },
    campaigns: { data: campaigns, key: 'campaigns', slice: 10 },
    events: { data: events, key: 'events', slice: 10 },
    goals: { data: goals, key: 'goals', slice: 0 },
  }

  /**
   * Fetch a single section's data from the API.
   * Returns the fetched items array.
   */
  async function fetchSection(section) {
    const config = sectionMap[section]
    if (!config) return []
    if (!dashboard.siteId()) {
      loading.set(false)
      return []
    }

    loading.set(true)
    try {
      const res = await fetch(dashboard.apiUrlWithDates('/' + section))
      const data = await res.json()
      const items = data[config.key] || []
      const sliced = config.slice > 0 ? items.slice(0, config.slice) : items
      config.data.set(sliced)
      return sliced
    } catch (e) {
      console.error(`Failed to fetch ${section}:`, e)
      return []
    } finally {
      loading.set(false)
    }
  }

  /**
   * Fetch all dashboard panel sections in parallel.
   */
  async function fetchAll() {
    if (!dashboard.siteId()) {
      loading.set(false)
      return
    }
    loading.set(true)
    try {
      await Promise.all(
        Object.keys(sectionMap).map(section => fetchSection(section))
      )
    } finally {
      loading.set(false)
    }
  }

  /**
   * Seed stats synchronously from the localStorage cache (instant paint on
   * load/SPA-nav, before the network fetch resolves). Mirrors the cache the
   * legacy inline script used.
   */
  function hydrateStatsFromCache() {
    try {
      const cached = localStorage.getItem(`ts-analytics-stats-${dashboard.siteId()}`)
      if (!cached) return
      const data = JSON.parse(cached)
      if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        stats.set(data.stats)
        hasHistoricalData.set(true)
      }
    } catch (e) {
      // ignore malformed cache
    }
  }

  /**
   * Fetch the summary stats. Realtime visitor count comes from /realtime,
   * the rest from /stats; merged into one object and written back to cache.
   */
  async function fetchStats() {
    if (!dashboard.siteId()) return null
    try {
      const [statsRes, realtimeRes] = await Promise.all([
        fetch(dashboard.apiUrlWithDates('/stats')).then(r => r.json()).catch(() => ({})),
        fetch(dashboard.apiUrl('/realtime')).then(r => r.json()).catch(() => ({ currentVisitors: 0 })),
      ])
      const summary = {
        realtime: realtimeRes.currentVisitors || 0,
        sessions: statsRes.sessions || 0,
        people: statsRes.people || 0,
        views: statsRes.views || 0,
        avgTime: statsRes.avgTime || '00:00',
        bounceRate: statsRes.bounceRate || 0,
        events: statsRes.events || 0,
      }
      stats.set(summary)
      if (summary.views > 0 || summary.sessions > 0 || summary.people > 0) {
        hasHistoricalData.set(true)
      }
      try {
        localStorage.setItem(`ts-analytics-stats-${dashboard.siteId()}`, JSON.stringify({ stats: summary, timestamp: Date.now() }))
      } catch (e) {
        // ignore quota/serialization errors
      }
      return summary
    } catch (e) {
      console.error('Failed to fetch stats:', e)
      return null
    }
  }

  /**
   * Fetch the pageviews-over-time series and annotation markers for the chart.
   * The /timeseries endpoint reads startDate/endDate plus a granularity period,
   * so this builds those explicitly rather than using apiUrlWithDates.
   */
  async function fetchTimeSeries() {
    if (!dashboard.siteId()) return
    const { start, end } = dashboard.dateBounds()
    const period = dashboard.timeseriesPeriod()
    try {
      const [tsRes, annRes] = await Promise.all([
        fetch(dashboard.apiUrl(`/timeseries?startDate=${start}&endDate=${end}&period=${period}`)).then(r => r.json()).catch(() => ({ timeSeries: [] })),
        fetch(dashboard.apiUrl(`/annotations?startDate=${start}&endDate=${end}`)).then(r => r.json()).catch(() => ({ annotations: [] })),
      ])
      timeSeries.set((tsRes.timeSeries || []).map(t => ({
        date: t.timestamp || t.date,
        views: t.views,
        visitors: t.visitors,
      })))
      annotations.set(annRes.annotations || [])
    } catch (e) {
      console.error('Failed to fetch timeseries:', e)
    }
  }

  /**
   * Fetch available sites list.
   */
  async function fetchSites() {
    sitesLoading.set(true)
    sitesError.set(null)
    try {
      const res = await fetch(dashboard.apiUrl('').replace(`/sites/${dashboard.siteId()}`, '/sites'))
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      sites.set(data.sites || [])
      window._availableSites = data.sites || []
    } catch (e) {
      sitesError.set(e.message)
    } finally {
      sitesLoading.set(false)
    }
  }

  return {
    loading,
    stats,
    hasHistoricalData,
    timeSeries,
    annotations,
    hydrateStatsFromCache,
    fetchStats,
    fetchTimeSeries,
    pages,
    referrers,
    browsers,
    devices,
    countries,
    campaigns,
    events,
    goals,
    sites,
    sitesLoading,
    sitesError,
    fetchSection,
    fetchAll,
    fetchSites,
  }
})
