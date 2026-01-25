/**
 * Analytics Data Composables
 *
 * Vue 3 composables for fetching and managing analytics data.
 * Can also be used as standalone async functions in non-Vue contexts.
 */

import type {
  AnalyticsApiConfig,
  DashboardSummary,
  FetchOptions,
  GoalConversion,
  RealtimeData,
  TimeSeriesDataPoint,
  TopItem,
} from '../types'

// ============================================================================
// API Client
// ============================================================================

export class AnalyticsClient {
  private baseUrl: string
  private siteId: string
  private headers: Record<string, string>

  constructor(config: AnalyticsApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.siteId = config.siteId
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    }
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`Analytics API error: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Get dashboard summary stats
   */
  async getStats(options: FetchOptions = {}): Promise<DashboardSummary> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())
    if (options.period)
      params.set('period', options.period)

    const query = params.toString()
    return this.fetch(`/api/analytics/sites/${this.siteId}/stats${query ? `?${query}` : ''}`)
  }

  /**
   * Get realtime visitor data
   */
  async getRealtime(minutes = 5): Promise<RealtimeData> {
    return this.fetch(`/api/analytics/sites/${this.siteId}/realtime?minutes=${minutes}`)
  }

  /**
   * Get top pages
   */
  async getTopPages(options: FetchOptions = {}): Promise<TopItem[]> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())
    if (options.limit)
      params.set('limit', String(options.limit))

    const query = params.toString()
    const response = await this.fetch<{ pages: TopItem[] }>(
      `/api/analytics/sites/${this.siteId}/pages${query ? `?${query}` : ''}`,
    )
    return response.pages || []
  }

  /**
   * Get top referrers
   */
  async getTopReferrers(options: FetchOptions = {}): Promise<TopItem[]> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())
    if (options.limit)
      params.set('limit', String(options.limit))

    const query = params.toString()
    const response = await this.fetch<{ referrers: TopItem[] }>(
      `/api/analytics/sites/${this.siteId}/referrers${query ? `?${query}` : ''}`,
    )
    return response.referrers || []
  }

  /**
   * Get device breakdown
   */
  async getDevices(options: FetchOptions = {}): Promise<TopItem[]> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())

    const query = params.toString()
    const response = await this.fetch<{ devices: TopItem[] }>(
      `/api/analytics/sites/${this.siteId}/devices${query ? `?${query}` : ''}`,
    )
    return response.devices || []
  }

  /**
   * Get browser stats
   */
  async getBrowsers(options: FetchOptions = {}): Promise<TopItem[]> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())
    if (options.limit)
      params.set('limit', String(options.limit))

    const query = params.toString()
    const response = await this.fetch<{ browsers: TopItem[] }>(
      `/api/analytics/sites/${this.siteId}/browsers${query ? `?${query}` : ''}`,
    )
    return response.browsers || []
  }

  /**
   * Get country stats
   */
  async getCountries(options: FetchOptions = {}): Promise<TopItem[]> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())
    if (options.limit)
      params.set('limit', String(options.limit))

    const query = params.toString()
    const response = await this.fetch<{ countries: TopItem[] }>(
      `/api/analytics/sites/${this.siteId}/countries${query ? `?${query}` : ''}`,
    )
    return response.countries || []
  }

  /**
   * Get region stats
   */
  async getRegions(options: FetchOptions & { country?: string } = {}): Promise<TopItem[]> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())
    if (options.limit)
      params.set('limit', String(options.limit))
    if (options.country)
      params.set('country', options.country)

    const query = params.toString()
    const response = await this.fetch<{ regions: TopItem[] }>(
      `/api/analytics/sites/${this.siteId}/regions${query ? `?${query}` : ''}`,
    )
    return response.regions || []
  }

  /**
   * Get city stats
   */
  async getCities(options: FetchOptions & { country?: string, region?: string } = {}): Promise<TopItem[]> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())
    if (options.limit)
      params.set('limit', String(options.limit))
    if (options.country)
      params.set('country', options.country)
    if (options.region)
      params.set('region', options.region)

    const query = params.toString()
    const response = await this.fetch<{ cities: TopItem[] }>(
      `/api/analytics/sites/${this.siteId}/cities${query ? `?${query}` : ''}`,
    )
    return response.cities || []
  }

  /**
   * Get time series data
   */
  async getTimeSeries(options: FetchOptions = {}): Promise<TimeSeriesDataPoint[]> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())
    if (options.period)
      params.set('period', options.period)

    const query = params.toString()
    const response = await this.fetch<{ timeSeries: TimeSeriesDataPoint[] }>(
      `/api/analytics/sites/${this.siteId}/timeseries${query ? `?${query}` : ''}`,
    )
    return response.timeSeries || []
  }

  /**
   * Get goal conversions
   */
  async getGoals(options: FetchOptions = {}): Promise<GoalConversion[]> {
    const params = new URLSearchParams()
    if (options.startDate)
      params.set('startDate', options.startDate.toISOString())
    if (options.endDate)
      params.set('endDate', options.endDate.toISOString())

    const query = params.toString()
    const response = await this.fetch<{ goals: GoalConversion[] }>(
      `/api/analytics/sites/${this.siteId}/goals/stats${query ? `?${query}` : ''}`,
    )
    return response.goals || []
  }
}

// ============================================================================
// Vue Composable (for Vue 3)
// ============================================================================

/**
 * Create analytics composable for Vue 3
 *
 * @example
 * ```vue
 * <script setup>
 * import { useAnalytics } from 'dynamodb-tooling/analytics/dashboard'
 *
 * const {
 *   stats,
 *   realtime,
 *   topPages,
 *   loading,
 *   error,
 *   refresh,
 *   setDateRange
 * } = useAnalytics({
 *   baseUrl: '/api',
 *   siteId: 'my-site'
 * })
 * </script>
 * ```
 */
export interface UseAnalyticsOptions extends AnalyticsApiConfig {
  /** Auto-refresh interval in ms (0 to disable) */
  refreshInterval?: number
  /** Initial date range preset */
  initialDateRange?: '7d' | '30d' | '90d' | 'today' | 'yesterday'
  /** Fetch realtime data */
  fetchRealtime?: boolean
  /** Realtime refresh interval in ms */
  realtimeInterval?: number
}

export interface UseAnalyticsReturn {
  // Data
  stats: { value: DashboardSummary | null }
  realtime: { value: RealtimeData | null }
  topPages: { value: TopItem[] }
  topReferrers: { value: TopItem[] }
  devices: { value: TopItem[] }
  browsers: { value: TopItem[] }
  countries: { value: TopItem[] }
  timeSeries: { value: TimeSeriesDataPoint[] }
  goals: { value: GoalConversion[] }

  // State
  loading: { value: boolean }
  error: { value: Error | null }
  dateRange: { value: { start: Date, end: Date } }

  // Actions
  refresh: () => Promise<void>
  setDateRange: (start: Date, end: Date) => void
  setDatePreset: (preset: string) => void
}

/**
 * Create analytics composable
 * Note: This returns a factory function that works with Vue's reactivity system
 */
export function createAnalyticsComposable(options: UseAnalyticsOptions): {
  client: AnalyticsClient
  getInitialDateRange: () => { start: Date, end: Date }
  fetchStats: (dateRange: { start: Date, end: Date }) => Promise<DashboardSummary>
  fetchRealtime: () => Promise<RealtimeData>
  fetchTopPages: (dateRange: { start: Date, end: Date }, limit?: number) => Promise<unknown[]>
  fetchTopReferrers: (dateRange: { start: Date, end: Date }, limit?: number) => Promise<unknown[]>
  fetchDevices: (dateRange: { start: Date, end: Date }) => Promise<unknown>
  fetchBrowsers: (dateRange: { start: Date, end: Date }, limit?: number) => Promise<unknown[]>
  fetchCountries: (dateRange: { start: Date, end: Date }, limit?: number) => Promise<unknown[]>
  fetchRegions: (dateRange: { start: Date, end: Date }, country?: string, limit?: number) => Promise<unknown[]>
  fetchCities: (dateRange: { start: Date, end: Date }, country?: string, region?: string, limit?: number) => Promise<unknown[]>
  fetchTimeSeries: (dateRange: { start: Date, end: Date }) => Promise<unknown[]>
  fetchGoals: (dateRange: { start: Date, end: Date }) => Promise<unknown[]>
} {
  const client = new AnalyticsClient(options)

  // Get initial date range
  const getInitialDateRange = () => {
    const end = new Date()
    const start = new Date()
    const preset = options.initialDateRange || '7d'

    switch (preset) {
      case 'today':
        start.setHours(0, 0, 0, 0)
        break
      case 'yesterday':
        start.setDate(start.getDate() - 1)
        start.setHours(0, 0, 0, 0)
        end.setDate(end.getDate() - 1)
        end.setHours(23, 59, 59, 999)
        break
      case '30d':
        start.setDate(start.getDate() - 30)
        break
      case '90d':
        start.setDate(start.getDate() - 90)
        break
      case '7d':
      default:
        start.setDate(start.getDate() - 7)
        break
    }

    return { start, end }
  }

  return {
    client,
    getInitialDateRange,
    fetchStats: (dateRange: { start: Date, end: Date }): Promise<DashboardSummary> =>
      client.getStats({ startDate: dateRange.start, endDate: dateRange.end }),
    fetchRealtime: (): Promise<RealtimeData> => client.getRealtime(),
    fetchTopPages: (dateRange: { start: Date, end: Date }, limit = 10): Promise<unknown[]> =>
      client.getTopPages({ startDate: dateRange.start, endDate: dateRange.end, limit }),
    fetchTopReferrers: (dateRange: { start: Date, end: Date }, limit = 10): Promise<unknown[]> =>
      client.getTopReferrers({ startDate: dateRange.start, endDate: dateRange.end, limit }),
    fetchDevices: (dateRange: { start: Date, end: Date }): Promise<unknown> =>
      client.getDevices({ startDate: dateRange.start, endDate: dateRange.end }),
    fetchBrowsers: (dateRange: { start: Date, end: Date }, limit = 10): Promise<unknown[]> =>
      client.getBrowsers({ startDate: dateRange.start, endDate: dateRange.end, limit }),
    fetchCountries: (dateRange: { start: Date, end: Date }, limit = 10): Promise<unknown[]> =>
      client.getCountries({ startDate: dateRange.start, endDate: dateRange.end, limit }),
    fetchRegions: (dateRange: { start: Date, end: Date }, country?: string, limit = 10): Promise<unknown[]> =>
      client.getRegions({ startDate: dateRange.start, endDate: dateRange.end, country, limit }),
    fetchCities: (dateRange: { start: Date, end: Date }, country?: string, region?: string, limit = 10): Promise<unknown[]> =>
      client.getCities({ startDate: dateRange.start, endDate: dateRange.end, country, region, limit }),
    fetchTimeSeries: (dateRange: { start: Date, end: Date }): Promise<unknown[]> =>
      client.getTimeSeries({ startDate: dateRange.start, endDate: dateRange.end }),
    fetchGoals: (dateRange: { start: Date, end: Date }): Promise<unknown[]> =>
      client.getGoals({ startDate: dateRange.start, endDate: dateRange.end }),
  }
}

// ============================================================================
// Standalone Hooks (Framework-Agnostic)
// ============================================================================

/**
 * Fetch all dashboard data at once
 */
export async function fetchDashboardData(
  config: AnalyticsApiConfig,
  options: FetchOptions = {},
): Promise<{
    stats: DashboardSummary
    realtime: RealtimeData
    topPages: TopItem[]
    topReferrers: TopItem[]
    devices: TopItem[]
    timeSeries: TimeSeriesDataPoint[]
  }> {
  const client = new AnalyticsClient(config)

  const [stats, realtime, topPages, topReferrers, devices, timeSeries] = await Promise.all([
    client.getStats(options),
    client.getRealtime(),
    client.getTopPages({ ...options, limit: 10 }),
    client.getTopReferrers({ ...options, limit: 10 }),
    client.getDevices(options),
    client.getTimeSeries(options),
  ])

  return {
    stats,
    realtime,
    topPages,
    topReferrers,
    devices,
    timeSeries,
  }
}

/**
 * Create a polling function for realtime data
 */
export function createRealtimePoller(
  config: AnalyticsApiConfig,
  callback: (data: RealtimeData) => void,
  interval = 5000,
): { start: () => void, stop: () => void } {
  const client = new AnalyticsClient(config)
  let timerId: ReturnType<typeof setInterval> | null = null

  const poll = async () => {
    try {
      const data = await client.getRealtime()
      callback(data)
    }
    catch (error) {
      console.error('Realtime polling error:', error)
    }
  }

  return {
    start: () => {
      if (timerId)
        return
      poll() // Initial fetch
      timerId = setInterval(poll, interval)
    },
    stop: () => {
      if (timerId) {
        clearInterval(timerId)
        timerId = null
      }
    },
  }
}
