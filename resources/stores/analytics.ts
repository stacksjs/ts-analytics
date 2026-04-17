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
  const dashboard = useStore('dashboard')

  // Shared loading state (replaces per-panel `const loading = state(true)`)
  const loading = state(true)

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
