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
  os: 'platform',
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
  vitals: 'metrics',
  'vitals-trends': 'metrics-trends',
  'performance-budgets': 'budgets',
  goals: 'targets',
  'goals/stats': 'targets/data',
  funnels: 'pipelines',
  clicks: 'links',
  engagement: 'dwell',
  'event-properties': 'traits',
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

  // Tabs that show the controls/filters bars (others hide them)
  const TABS_WITH_CONTROLS = ['dashboard', 'sessions', 'flow', 'live', 'funnels']

  function tabFromPath(): string {
    const match = window.location.pathname.match(/\/dashboard\/([^/]+)/)
    return match ? match[1] : 'dashboard'
  }

  // Core state
  const siteId = state(urlParams.get('siteId') || '')
  // Public share mode (#152): set by the /shared/{token} page.
  const shareToken = state<string>('')
  const sharePassword = state<string>('')
  // Compare-with-previous-period overlay (#153), toggled by the ControlsBar.
  const showComparison = state<boolean>(false)
  // Custom calendar range (#139): active when dateRange === 'custom'.
  const customStart = state<string>('')
  const customEnd = state<string>('')
  const useStealth = state(window.ANALYTICS_STEALTH_MODE ?? (urlParams.get('stealth') === 'true'))

  // Resolve the API endpoint LAZILY at call time. The layout's
  // window.ANALYTICS_API_ENDPOINT setter runs AFTER stores/components initialize,
  // so capturing it at store-init would always get the origin fallback and ignore
  // a configured endpoint (the reason a separate API server was unreachable).
  function apiEndpoint(): string {
    return window.ANALYTICS_API_ENDPOINT || window.API_ENDPOINT || window.location.origin
  }
  // Default range: last 7 days (Fathom's default) — enough context to be
  // meaningful on first open, without the cost of a 30d scan.
  const dateRange = state('7d')
  const currentTab = state(tabFromPath())

  // Active dashboard filters (e.g. { country, device, browser }); appended to
  // every store-built API URL so all panels share the same slice.
  const filters = state<Record<string, string>>({})

  // Whether the controls/filters bars should show for the current tab.
  function controlsVisible(): boolean {
    return TABS_WITH_CONTROLS.includes(currentTab())
  }

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

  // Build a full API URL for a site endpoint. On the public shared-dashboard
  // page (#152) every request carries the share token — the server's auth
  // guard accepts it for aggregate reads.
  function apiUrl(path: string): string {
    const base = apiPath(`${apiEndpoint()}/api/sites/${siteId()}${path}`)
    const token = shareToken()
    if (!token) return base
    const sep = base.includes('?') ? '&' : '?'
    const pw = sharePassword()
    return `${base}${sep}share=${encodeURIComponent(token)}${pw ? `&share_pw=${encodeURIComponent(pw)}` : ''}`
  }

  // Date range as query params
  function dateParams(): string {
    if (!dateRange()) return ''
    const bounds = dateBounds()
    return `?startDate=${bounds.start}&endDate=${bounds.end}&period=${timeseriesPeriod()}`
  }

  // Active filters as query params (e.g. &country=US&device=mobile)
  function filterParams(): string {
    const f = filters()
    const parts = Object.keys(f)
      .filter(k => f[k])
      .map(k => `${k}=${encodeURIComponent(f[k])}`)
    return parts.length > 0 ? `&${parts.join('&')}` : ''
  }

  // Set (or clear, when value is falsy) a single filter dimension, triggering a
  // refetch in any panel whose effect reads filters().
  function setFilter(key: string, value: string): void {
    const next = { ...filters() }
    if (value) next[key] = value
    else delete next[key]
    filters.set(next)
  }

  // Refetch the panels that don't reactively watch filters() themselves
  // (Countries/OS/Browsers/Devices/Referrers, via their window.refresh* aliases).
  // Reactive readers (e.g. ChannelsPanel's effect) already refresh off the
  // filters() signal. This is the ONE seam coupling filters to the legacy
  // controller — replace it with per-panel effects once that controller is gone.
  function refreshFilteredPanels(): void {
    if (window.refreshAllPanels) window.refreshAllPanels()
  }

  // Apply (or clear, when value is falsy) a filter AND refresh the non-reactive
  // panels. Single entry point shared by the FiltersBar dropdowns, panel
  // drill-down clicks, and chip removal, so all three apply filters identically.
  function applyFilter(key: string, value: string): void {
    setFilter(key, value)
    refreshFilteredPanels()
  }

  function clearFilters(): void {
    filters.set({})
    refreshFilteredPanels()
  }

  // Build API URL with date + filter params included
  function apiUrlWithDates(path: string): string {
    const dp = dateParams()
    const fp = filterParams()
    const qs = dp ? dp + fp : (fp ? `?${fp.slice(1)}` : '')
    return apiUrl(path + qs)
  }

  // Absolute start/end ISO bounds for the current range. Used by endpoints that
  // read startDate/endDate (e.g. /timeseries, /annotations) rather than start/end.
  /**
   * SINGLE SOURCE OF TRUTH for every date range the dashboard understands.
   * Each preset owns its label (picker rail), chart bucket granularity, and
   * bounds derivation. dateBounds / timeseriesPeriod / dateParams /
   * triggerLabel are all thin lookups into this table — never re-derive
   * range semantics anywhere else.
   */
  interface RangePreset {
    id: string
    label: string
    period: 'minute' | 'hour' | 'day' | 'month'
    /** Hidden from the picker rail (legacy deep-link tokens). */
    legacy?: boolean
    bounds: (now: Date) => { start: Date, end: Date }
  }

  const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const hoursBack = (now: Date, h: number) => ({ start: new Date(now.getTime() - h * 36e5), end: now })
  const daysBack = (now: Date, d: number) => ({ start: new Date(now.getTime() - d * 864e5), end: now })

  const RANGE_PRESETS: RangePreset[] = [
    { id: 'today', label: 'Today', period: 'hour', bounds: now => ({ start: startOfDay(now), end: now }) },
    { id: 'yesterday', label: 'Yesterday', period: 'hour', bounds: (now) => {
      const y = new Date(now.getTime() - 864e5)
      return { start: startOfDay(y), end: new Date(startOfDay(now).getTime() - 1) }
    } },
    { id: '7d', label: 'Last 7 Days', period: 'day', bounds: now => daysBack(now, 7) },
    { id: '30d', label: 'Last 30 Days', period: 'day', bounds: now => daysBack(now, 30) },
    { id: '90d', label: 'Last 90 Days', period: 'day', bounds: now => daysBack(now, 90) },
    { id: '365d', label: 'Last 365 Days', period: 'month', bounds: now => daysBack(now, 365) },
    { id: 'this-month', label: 'This Month', period: 'day', bounds: now => ({ start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }) },
    { id: 'last-month', label: 'Last Month', period: 'day', bounds: now => ({
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1),
    }) },
    { id: 'this-year', label: 'This Year', period: 'month', bounds: now => ({ start: new Date(now.getFullYear(), 0, 1), end: now }) },
    { id: 'last-year', label: 'Last Year', period: 'month', bounds: now => ({
      start: new Date(now.getFullYear() - 1, 0, 1),
      end: new Date(new Date(now.getFullYear(), 0, 1).getTime() - 1),
    }) },
    { id: 'all', label: 'All Time', period: 'month', bounds: now => ({ start: new Date('2015-01-01T00:00:00.000Z'), end: now }) },
    // Legacy deep-link tokens (old preset row / bookmarks) — resolvable, not shown.
    { id: '1h', label: 'Last hour', period: 'minute', legacy: true, bounds: now => hoursBack(now, 1) },
    { id: '6h', label: 'Last 6 hours', period: 'hour', legacy: true, bounds: now => hoursBack(now, 6) },
    { id: '12h', label: 'Last 12 hours', period: 'hour', legacy: true, bounds: now => hoursBack(now, 12) },
    { id: '24h', label: 'Last 24 hours', period: 'hour', legacy: true, bounds: now => hoursBack(now, 24) },
  ]

  function presetFor(id: string): RangePreset | undefined {
    return RANGE_PRESETS.find(preset => preset.id === id)
  }

  /** Presets for the picker rail (legacy tokens excluded). */
  function rangePresets(): Array<{ id: string, label: string }> {
    return RANGE_PRESETS.filter(preset => !preset.legacy).map(preset => ({ id: preset.id, label: preset.label }))
  }

  function dateBounds(): { start: string, end: string } {
    const now = new Date()
    const range = dateRange()
    if (range === 'custom' && customStart()) {
      // Calendar picks are LOCAL days — anchor bounds to local midnights, not
      // UTC (UTC anchoring shifted labels/data by the timezone offset).
      const [sy, sm, sd] = customStart().split('-').map(Number)
      const start = new Date(sy, sm - 1, sd)
      let end = now
      if (customEnd()) {
        const [ey, em, ed] = customEnd().split('-').map(Number)
        end = new Date(ey, em - 1, ed, 23, 59, 59, 999)
      }
      return { start: start.toISOString(), end: end.toISOString() }
    }
    const preset = presetFor(range) ?? presetFor('30d')!
    const bounds = preset.bounds(now)
    return { start: bounds.start.toISOString(), end: bounds.end.toISOString() }
  }

  /** Human label for the current range, Fathom-style ("Last 7 Days: Jun 30 to Jul 7, 2026"). */
  function triggerLabel(): string {
    const range = dateRange()
    if (range === 'all') return 'All Time'
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const bounds = dateBounds()
    const s = new Date(bounds.start)
    const e = new Date(bounds.end)
    const name = range === 'custom' ? 'Custom' : (presetFor(range)?.label ?? range)
    return `${name}: ${MONTHS[s.getMonth()]} ${s.getDate()} to ${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`
  }

  /** Apply a preset from the picker rail. */
  function applyPreset(id: string): void {
    dateRange.set(id)
  }

  /** Apply a custom calendar range (ISO yyyy-mm-dd dates). */
  function applyCustomRange(startIso: string, endIso: string): void {
    customStart.set(startIso)
    customEnd.set(endIso)
    dateRange.set('custom')
  }

  // The window immediately before the current one, same duration (#153).
  function previousDateBounds(): { start: string, end: string } {
    const { start, end } = dateBounds()
    const startMs = new Date(start).getTime()
    const span = new Date(end).getTime() - startMs
    return { start: new Date(startMs - span).toISOString(), end: new Date(startMs - 1).toISOString() }
  }

  // Bucket granularity for the timeseries endpoint, derived from the range.
  function timeseriesPeriod(): string {
    const range = dateRange()
    if (range === 'custom') return 'day'
    return presetFor(range)?.period ?? 'day'
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
    shareToken,
    sharePassword,
    apiEndpoint,
    useStealth,
    dateRange,
    currentTab,
    controlsVisible,
    apiPath,
    apiUrl,
    dateParams,
    apiUrlWithDates,
    filters,
    filterParams,
    setFilter,
    applyFilter,
    clearFilters,
    dateBounds,
    rangePresets,
    triggerLabel,
    applyPreset,
    applyCustomRange,
    previousDateBounds,
    showComparison,
    customStart,
    customEnd,
    timeseriesPeriod,
    navigateTo,
  }
})
