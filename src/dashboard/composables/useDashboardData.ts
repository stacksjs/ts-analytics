/**
 * Dashboard Data Hook
 *
 * Connects all dashboard components to the analytics API with
 * proper data transformation and reactive state management.
 */

import type {
  AnalyticsApiConfig,
  DashboardSummary,
  GoalConversion,
  RealtimeData,
  TimeSeriesDataPoint,
  TopItem,
} from '../types'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { AnalyticsClient } from './useAnalytics'

export interface DashboardDataOptions extends AnalyticsApiConfig {
  /** Auto-refresh interval in ms (0 to disable) */
  refreshInterval?: number
  /** Realtime polling interval in ms */
  realtimeInterval?: number
  /** Initial date range */
  initialDateRange?: { start: Date, end: Date }
}

export interface DashboardData {
  // Summary stats
  summary: DashboardSummary | null
  // Time series for charts
  timeSeries: TimeSeriesDataPoint[]
  // Realtime data
  realtime: RealtimeData | null
  // Top lists
  topPages: TopItem[]
  topReferrers: TopItem[]
  // Breakdowns
  devices: Array<{ type: string, count: number, percentage: number }>
  browsers: Array<{ name: string, count: number, percentage: number }>
  operatingSystems: Array<{ name: string, count: number, percentage: number }>
  countries: Array<{ name: string, code: string, visitors: number, percentage: number }>
  // Goals
  goals: GoalConversion[]
}

/**
 * Vue 3 composable for dashboard data
 */
export function useDashboardData(options: DashboardDataOptions) {
  const client = new AnalyticsClient(options)

  // Reactive state
  const loading = ref(true)
  const error = ref<Error | null>(null)
  const dateRange = ref(options.initialDateRange || getDefaultDateRange())

  // Data state
  const summary = ref<DashboardSummary | null>(null)
  const timeSeries = ref<TimeSeriesDataPoint[]>([])
  const realtime = ref<RealtimeData | null>(null)
  const topPages = ref<TopItem[]>([])
  const topReferrers = ref<TopItem[]>([])
  const devices = ref<Array<{ type: string, count: number, percentage: number }>>([])
  const browsers = ref<Array<{ name: string, count: number, percentage: number }>>([])
  const operatingSystems = ref<Array<{ name: string, count: number, percentage: number }>>([])
  const countries = ref<Array<{ name: string, code: string, visitors: number, percentage: number }>>([])
  const goals = ref<GoalConversion[]>([])

  // Intervals
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  let realtimeTimer: ReturnType<typeof setInterval> | null = null

  // Computed stats for StatCard components
  const statCards = computed(() => {
    if (!summary.value)
      return []

    const change = summary.value.change

    return [
      {
        label: 'Total Visitors',
        value: formatNumber(summary.value.uniqueVisitors),
        change: change?.uniqueVisitors,
        icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
      },
      {
        label: 'Page Views',
        value: formatNumber(summary.value.pageViews),
        change: change?.pageViews,
        icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
      },
      {
        label: 'Bounce Rate',
        value: `${(summary.value.bounceRate * 100).toFixed(1)}%`,
        change: change?.bounceRate ? -change.bounceRate : undefined, // Inverse (lower is better)
        icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
      },
      {
        label: 'Avg. Duration',
        value: formatDuration(summary.value.avgSessionDuration),
        change: change?.avgSessionDuration,
        icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
      },
    ]
  })

  // Fetch all data
  async function fetchData(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const fetchOptions = {
        startDate: dateRange.value.start,
        endDate: dateRange.value.end,
      }

      const [
        statsResult,
        pagesResult,
        referrersResult,
        devicesResult,
        browsersResult,
        countriesResult,
        timeSeriesResult,
        goalsResult,
      ] = await Promise.all([
        client.getStats(fetchOptions),
        client.getTopPages({ ...fetchOptions, limit: 10 }),
        client.getTopReferrers({ ...fetchOptions, limit: 10 }),
        client.getDevices(fetchOptions),
        client.getBrowsers({ ...fetchOptions, limit: 10 }),
        client.getCountries({ ...fetchOptions, limit: 10 }),
        client.getTimeSeries(fetchOptions),
        client.getGoals(fetchOptions),
      ])

      summary.value = statsResult
      topPages.value = pagesResult
      topReferrers.value = referrersResult
      timeSeries.value = timeSeriesResult
      goals.value = goalsResult

      // Transform device data
      devices.value = transformDeviceData(devicesResult)
      browsers.value = transformBrowserData(browsersResult)
      countries.value = transformCountryData(countriesResult)
    }
    catch (err) {
      error.value = err instanceof Error ? err : new Error('Failed to fetch data')
      console.error('Dashboard data fetch error:', err)
    }
    finally {
      loading.value = false
    }
  }

  // Fetch realtime data
  async function fetchRealtime() {
    try {
      realtime.value = await client.getRealtime()
    }
    catch (err) {
      console.error('Realtime fetch error:', err)
    }
  }

  // Start polling
  function startPolling() {
    if (options.refreshInterval && options.refreshInterval > 0) {
      refreshTimer = setInterval(fetchData, options.refreshInterval)
    }

    if (options.realtimeInterval && options.realtimeInterval > 0) {
      realtimeTimer = setInterval(fetchRealtime, options.realtimeInterval)
    }
  }

  // Stop polling
  function stopPolling() {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
    if (realtimeTimer) {
      clearInterval(realtimeTimer)
      realtimeTimer = null
    }
  }

  // Set date range
  function setDateRange(start: Date, end: Date) {
    dateRange.value = { start, end }
  }

  // Watch date range changes
  watch(dateRange, () => {
    fetchData()
  }, { deep: true })

  // Lifecycle
  onMounted(() => {
    fetchData()
    fetchRealtime()
    startPolling()
  })

  onUnmounted(() => {
    stopPolling()
  })

  return {
    // State
    loading,
    error,
    dateRange,

    // Data
    summary,
    timeSeries,
    realtime,
    topPages,
    topReferrers,
    devices,
    browsers,
    operatingSystems,
    countries,
    goals,

    // Computed
    statCards,

    // Methods
    refresh: fetchData,
    setDateRange,
  }
}

// Helper functions
function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return { start, end }
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`
  }
  return num.toLocaleString()
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function transformDeviceData(data: TopItem[]): Array<{ type: string, count: number, percentage: number }> {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  return data.map(d => ({
    type: d.name.toLowerCase(),
    count: d.value,
    percentage: total > 0 ? d.value / total : 0,
  }))
}

function transformBrowserData(data: TopItem[]): Array<{ name: string, count: number, percentage: number }> {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  return data.map(d => ({
    name: d.name,
    count: d.value,
    percentage: total > 0 ? d.value / total : 0,
  }))
}

function transformCountryData(data: TopItem[]): Array<{ name: string, code: string, visitors: number, percentage: number }> {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  return data.map(d => ({
    name: d.name,
    code: getCountryCode(d.name),
    visitors: d.value,
    percentage: total > 0 ? d.value / total : 0,
  }))
}

function getCountryCode(countryName: string): string {
  const codes: Record<string, string> = {
    'United States': 'US',
    'United Kingdom': 'GB',
    'Germany': 'DE',
    'France': 'FR',
    'Canada': 'CA',
    'Australia': 'AU',
    'Japan': 'JP',
    'Brazil': 'BR',
    'India': 'IN',
    'China': 'CN',
  }
  return codes[countryName] || 'XX'
}

export default useDashboardData
