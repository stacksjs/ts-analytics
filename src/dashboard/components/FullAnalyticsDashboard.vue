<script setup lang="ts">
/**
 * FullAnalyticsDashboard Component
 *
 * A comprehensive analytics dashboard with tabbed navigation
 * for Overview, Audience, Behavior, and Conversions views.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  AnalyticsApiConfig,
  DashboardSummary,
  DateRange,
  GoalConversion,
  RealtimeData,
  TimeSeriesDataPoint,
  TopItem,
} from '../types'
import { createAnalyticsComposable, createRealtimePoller } from '../composables/useAnalytics'
import BrowserBreakdown from './BrowserBreakdown.vue'
import CountryList from './CountryList.vue'
import DateRangePicker from './DateRangePicker.vue'
import DeviceBreakdown from './DeviceBreakdown.vue'
import DonutChart from './DonutChart.vue'
import GoalsPanel from './GoalsPanel.vue'
import RealtimeCounter from './RealtimeCounter.vue'
import StatCard from './StatCard.vue'
import TimeSeriesChart from './TimeSeriesChart.vue'
import TopList from './TopList.vue'

type TabId = 'overview' | 'audience' | 'behavior' | 'conversions'

interface Tab {
  id: TabId
  label: string
  icon: string
}

const props = withDefaults(defineProps<{
  config: AnalyticsApiConfig
  refreshInterval?: number
  realtimeInterval?: number
  defaultTab?: TabId
}>(), {
  refreshInterval: 60000,
  realtimeInterval: 5000,
  defaultTab: 'overview',
})

const tabs: Tab[] = [
  { id: 'overview', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'audience', label: 'Audience', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z' },
  { id: 'behavior', label: 'Behavior', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'conversions', label: 'Conversions', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
]

const activeTab = ref<TabId>(props.defaultTab)
const loading = ref(true)
const error = ref<Error | null>(null)

// Data state
const stats = ref<DashboardSummary | null>(null)
const realtime = ref<RealtimeData | null>(null)
const timeSeries = ref<TimeSeriesDataPoint[]>([])
const topPages = ref<TopItem[]>([])
const topReferrers = ref<TopItem[]>([])
const devices = ref<TopItem[]>([])
const browsers = ref<TopItem[]>([])
const countries = ref<TopItem[]>([])
const goals = ref<GoalConversion[]>([])
const dateRange = ref<DateRange>({
  start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  end: new Date(),
  preset: '7d',
})

const analytics = createAnalyticsComposable({
  ...props.config,
  initialDateRange: '7d',
})

let realtimePoller: ReturnType<typeof createRealtimePoller> | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null

async function fetchData() {
  loading.value = true
  error.value = null

  try {
    const [
      statsData,
      timeSeriesData,
      pagesData,
      referrersData,
      devicesData,
      browsersData,
      countriesData,
      goalsData,
    ] = await Promise.all([
      analytics.fetchStats(dateRange.value),
      analytics.fetchTimeSeries(dateRange.value),
      analytics.fetchTopPages(dateRange.value, 10),
      analytics.fetchTopReferrers(dateRange.value, 10),
      analytics.fetchDevices(dateRange.value),
      analytics.fetchBrowsers(dateRange.value, 10),
      analytics.fetchCountries(dateRange.value, 10),
      analytics.fetchGoals(dateRange.value),
    ])

    stats.value = statsData
    timeSeries.value = timeSeriesData as TimeSeriesDataPoint[]
    topPages.value = pagesData as TopItem[]
    topReferrers.value = referrersData as TopItem[]
    devices.value = devicesData as TopItem[]
    browsers.value = browsersData as TopItem[]
    countries.value = countriesData as TopItem[]
    goals.value = goalsData as GoalConversion[]
  }
  catch (err) {
    error.value = err instanceof Error ? err : new Error(String(err))
  }
  finally {
    loading.value = false
  }
}

function handleRealtimeUpdate(data: RealtimeData) {
  realtime.value = data
}

// Computed for donut chart data
const deviceDonutData = computed(() =>
  devices.value.map(d => ({ name: d.name, value: d.value })),
)

const browserDonutData = computed(() =>
  browsers.value.slice(0, 5).map(b => ({ name: b.name, value: b.value })),
)

onMounted(async () => {
  await fetchData()

  realtimePoller = createRealtimePoller(props.config, handleRealtimeUpdate, props.realtimeInterval)
  realtimePoller.start()

  if (props.refreshInterval > 0) {
    refreshTimer = setInterval(fetchData, props.refreshInterval)
  }
})

onUnmounted(() => {
  realtimePoller?.stop()
  if (refreshTimer)
    clearInterval(refreshTimer)
})

watch(dateRange, fetchData)
</script>

<template>
  <div class="full-analytics-dashboard min-h-screen bg-gray-50">
    <!-- Header -->
    <header class="bg-white border-b border-gray-200 sticky top-0 z-20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div>
            <h1 class="text-xl font-semibold text-gray-900">Analytics</h1>
          </div>

          <div class="flex items-center gap-4">
            <!-- Realtime badge -->
            <div v-if="realtime" class="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-full">
              <div class="relative">
                <div class="pulse-dot bg-green-500 animate-pulse" />
                <div class="pulse-ring bg-green-500" />
              </div>
              <span class="text-sm font-medium text-green-700">
                {{ realtime.currentVisitors }} online
              </span>
            </div>

            <DateRangePicker v-model="dateRange" />

            <button
              type="button"
              class="btn-icon"
              title="Refresh"
              :disabled="loading"
              @click="fetchData"
            >
              <svg
                class="w-5 h-5"
                :class="{ 'animate-spin': loading }"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Tabs -->
        <nav class="flex gap-6 -mb-px">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="flex items-center gap-2 px-1 py-4 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === tab.id
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'"
            @click="activeTab = tab.id"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="tab.icon" />
            </svg>
            {{ tab.label }}
          </button>
        </nav>
      </div>
    </header>

    <!-- Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Error state -->
      <div v-if="error" class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        <p class="font-medium">Error loading analytics</p>
        <p class="text-sm mt-1">{{ error.message }}</p>
        <button type="button" class="mt-2 text-sm text-red-600 hover:text-red-800 underline" @click="fetchData">
          Try again
        </button>
      </div>

      <!-- Overview Tab -->
      <div v-show="activeTab === 'overview'" class="space-y-6">
        <!-- Stats cards -->
        <section class="dashboard-grid">
          <StatCard title="Page Views" :value="stats?.pageViews ?? 0" :change="stats?.change?.pageViews" change-label="vs previous period" :loading="loading" />
          <StatCard title="Unique Visitors" :value="stats?.uniqueVisitors ?? 0" :change="stats?.change?.uniqueVisitors" change-label="vs previous period" :loading="loading" />
          <StatCard title="Bounce Rate" :value="stats?.bounceRate ?? 0" :change="stats?.change?.bounceRate" change-label="vs previous period" format="percentage" :loading="loading" />
          <StatCard title="Avg. Session Duration" :value="stats?.avgSessionDuration ?? 0" :change="stats?.change?.avgSessionDuration" change-label="vs previous period" format="duration" :loading="loading" />
        </section>

        <!-- Chart -->
        <section>
          <TimeSeriesChart :data="timeSeries" :loading="loading" :height="350" :metrics="['pageViews', 'uniqueVisitors']" />
        </section>

        <!-- Bottom grid -->
        <section class="dashboard-grid-3">
          <TopList title="Top Pages" :items="topPages" :loading="loading" empty-message="No page views yet" />
          <TopList title="Top Referrers" :items="topReferrers" :loading="loading" empty-message="No referrer data" />
          <DeviceBreakdown :devices="devices" :loading="loading" />
        </section>
      </div>

      <!-- Audience Tab -->
      <div v-show="activeTab === 'audience'" class="space-y-6">
        <!-- Realtime -->
        <section>
          <RealtimeCounter :count="realtime?.currentVisitors ?? 0" :loading="!realtime">
            <template #details>
              <p v-if="realtime" class="mt-2 text-sm text-gray-500">
                {{ realtime.pageViewsLastHour }} page views in the last hour
              </p>
            </template>
          </RealtimeCounter>
        </section>

        <!-- Geographic & Demographics -->
        <section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CountryList :countries="countries" :loading="loading" />
          <div class="space-y-6">
            <DonutChart title="Traffic by Device" :items="deviceDonutData" :loading="loading" total-label="Visitors" />
          </div>
        </section>

        <!-- Browsers -->
        <section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BrowserBreakdown :browsers="browsers" :loading="loading" />
          <DonutChart title="Browser Share" :items="browserDonutData" :loading="loading" total-label="Visitors" />
        </section>
      </div>

      <!-- Behavior Tab -->
      <div v-show="activeTab === 'behavior'" class="space-y-6">
        <!-- Page performance -->
        <section class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard title="Pages / Session" :value="stats?.avgPagesPerSession ?? 0" :loading="loading" />
          <StatCard title="Avg. Session Duration" :value="stats?.avgSessionDuration ?? 0" format="duration" :loading="loading" />
          <StatCard title="Bounce Rate" :value="stats?.bounceRate ?? 0" format="percentage" :loading="loading" />
        </section>

        <!-- Top content -->
        <section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TopList title="Most Viewed Pages" :items="topPages" :loading="loading" :max-items="15" empty-message="No page views yet" />
          <TopList title="Top Entry Pages" :items="topPages.slice(0, 10)" :loading="loading" empty-message="No entry data" />
        </section>

        <!-- Referrers -->
        <section>
          <TopList title="Traffic Sources" :items="topReferrers" :loading="loading" :max-items="15" empty-message="No referrer data" />
        </section>
      </div>

      <!-- Conversions Tab -->
      <div v-show="activeTab === 'conversions'" class="space-y-6">
        <!-- Goals summary -->
        <section class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="Total Conversions"
            :value="goals.reduce((sum, g) => sum + g.conversions, 0)"
            :loading="loading"
          />
          <StatCard
            title="Conversion Rate"
            :value="goals.length ? goals.reduce((sum, g) => sum + g.conversionRate, 0) / goals.length : 0"
            format="percentage"
            :loading="loading"
          />
          <StatCard
            title="Total Revenue"
            :value="goals.reduce((sum, g) => sum + g.revenue, 0)"
            format="currency"
            :loading="loading"
          />
        </section>

        <!-- Goals panel -->
        <section>
          <GoalsPanel :goals="goals" :loading="loading" />
        </section>
      </div>
    </main>

    <!-- Footer slot -->
    <slot name="footer" />
  </div>
</template>

<style scoped>
.full-analytics-dashboard {
  min-height: 100vh;
}
</style>
