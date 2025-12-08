<script setup lang="ts">
/**
 * Analytics Dashboard Demo App
 *
 * Showcases all 31 dashboard components with mock data.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  AlertCard,
  AnimatedNumber,
  AnalyticsDashboard,
  BarChart,
  BrowserBreakdown,
  CampaignBreakdown,
  CountryList,
  DataTable,
  DateRangePicker,
  DeviceBreakdown,
  DonutChart,
  EmptyState,
  EngagementMetrics,
  FilterBar,
  FunnelChart,
  GoalsPanel,
  HeatmapChart,
  LiveActivityFeed,
  MetricComparison,
  MiniStats,
  OSBreakdown,
  PageDetailCard,
  ProgressRing,
  RealtimeCounter,
  SparklineChart,
  StatCard,
  ThemeSwitcher,
  TimeSeriesChart,
  TopList,
  TrendIndicator,
} from '../components'
import { mockData } from './mockData'

// Theme state
const isDark = ref(false)

// Date range state
const dateRange = ref({
  start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  end: new Date(),
})

// Active section for navigation
const activeSection = ref('overview')

// Realtime simulation
const realtimeCount = ref(42)
const activities = ref(mockData.activities)

let realtimeInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // Simulate realtime updates
  realtimeInterval = setInterval(() => {
    realtimeCount.value = Math.floor(Math.random() * 50) + 20

    // Add random activity
    if (Math.random() > 0.5) {
      const types = ['pageview', 'event', 'conversion', 'session_start'] as const
      const newActivity = {
        id: `act-${Date.now()}`,
        type: types[Math.floor(Math.random() * types.length)],
        page: mockData.pages[Math.floor(Math.random() * mockData.pages.length)],
        country: mockData.countries[Math.floor(Math.random() * mockData.countries.length)].name,
        countryCode: mockData.countries[Math.floor(Math.random() * mockData.countries.length)].code,
        device: (['desktop', 'mobile', 'tablet'] as const)[Math.floor(Math.random() * 3)],
        timestamp: new Date(),
      }
      activities.value = [newActivity, ...activities.value.slice(0, 19)]
    }
  }, 3000)
})

onUnmounted(() => {
  if (realtimeInterval) clearInterval(realtimeInterval)
})

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts', label: 'Charts' },
  { id: 'breakdowns', label: 'Breakdowns' },
  { id: 'tables', label: 'Tables & Lists' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'utilities', label: 'Utilities' },
]

function handleDateChange(range: { start: Date, end: Date }) {
  dateRange.value = range
}
</script>

<template>
  <div class="min-h-screen" :class="isDark ? 'dark bg-gray-900' : 'bg-gray-50'">
    <!-- Header -->
    <header class="sticky top-0 z-50 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center gap-4">
            <h1 class="text-xl font-bold text-gray-900 dark:text-white">
              Analytics Dashboard Demo
            </h1>
            <span class="px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full">
              31 Components
            </span>
          </div>
          <div class="flex items-center gap-4">
            <DateRangePicker
              :start="dateRange.start"
              :end="dateRange.end"
              @change="handleDateChange"
            />
            <ThemeSwitcher v-model="isDark" />
          </div>
        </div>
      </div>
    </header>

    <!-- Navigation -->
    <nav class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex gap-4 overflow-x-auto py-3">
          <button
            v-for="section in sections"
            :key="section.id"
            class="px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
            :class="activeSection === section.id
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'"
            @click="activeSection = section.id"
          >
            {{ section.label }}
          </button>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Overview Section -->
      <section v-show="activeSection === 'overview'" class="space-y-8">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Overview Components</h2>

        <!-- Realtime Counter -->
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <RealtimeCounter :count="realtimeCount" label="Active Visitors" />
        </div>

        <!-- Stat Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            v-for="stat in mockData.stats"
            :key="stat.label"
            :label="stat.label"
            :value="stat.value"
            :change="stat.change"
            :icon="stat.icon"
          />
        </div>

        <!-- Mini Stats -->
        <MiniStats :stats="mockData.miniStats" />

        <!-- Animated Numbers -->
        <div class="card p-6">
          <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-4">Animated Numbers</h3>
          <div class="flex gap-8">
            <div>
              <div class="text-3xl font-bold text-gray-900 dark:text-white">
                <AnimatedNumber :value="12847" format="compact" />
              </div>
              <div class="text-sm text-gray-500">Total Users</div>
            </div>
            <div>
              <div class="text-3xl font-bold text-green-600">
                <AnimatedNumber :value="0.0847" format="percentage" />
              </div>
              <div class="text-sm text-gray-500">Conversion Rate</div>
            </div>
            <div>
              <div class="text-3xl font-bold text-primary-600">
                <AnimatedNumber :value="48293" format="currency" />
              </div>
              <div class="text-sm text-gray-500">Revenue</div>
            </div>
          </div>
        </div>

        <!-- Metric Comparison -->
        <MetricComparison
          :metrics="mockData.comparisonMetrics"
          title="Period Comparison"
        />
      </section>

      <!-- Charts Section -->
      <section v-show="activeSection === 'charts'" class="space-y-8">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Chart Components</h2>

        <!-- Time Series -->
        <TimeSeriesChart
          :data="mockData.timeSeries"
          title="Visitors Over Time"
          :height="300"
        />

        <!-- Chart Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DonutChart
            :data="mockData.donutData"
            title="Traffic Sources"
          />
          <BarChart
            :data="mockData.barData"
            title="Top Pages"
          />
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FunnelChart
            :steps="mockData.funnelSteps"
            title="Conversion Funnel"
          />
          <HeatmapChart
            :data="mockData.heatmapData"
            title="Activity by Hour"
          />
        </div>

        <!-- Sparklines -->
        <div class="card p-6">
          <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-4">Sparkline Charts</h3>
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div v-for="spark in mockData.sparklines" :key="spark.label">
              <div class="text-sm text-gray-500 mb-1">{{ spark.label }}</div>
              <SparklineChart :data="spark.data" :color="spark.color" :height="40" />
            </div>
          </div>
        </div>

        <!-- Progress Rings -->
        <div class="card p-6">
          <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-4">Progress Rings</h3>
          <div class="flex gap-8">
            <ProgressRing :value="0.75" label="Goal Progress" :size="100" />
            <ProgressRing :value="0.42" label="Bounce Rate" color="#ef4444" :size="100" />
            <ProgressRing :value="0.91" label="Uptime" color="#10b981" :size="100" />
          </div>
        </div>
      </section>

      <!-- Breakdowns Section -->
      <section v-show="activeSection === 'breakdowns'" class="space-y-8">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Breakdown Components</h2>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <DeviceBreakdown :data="mockData.devices" />
          <BrowserBreakdown :browsers="mockData.browsers" />
          <OSBreakdown :data="mockData.operatingSystems" />
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CountryList :countries="mockData.countryList" />
          <CampaignBreakdown :campaigns="mockData.campaigns" />
        </div>
      </section>

      <!-- Tables Section -->
      <section v-show="activeSection === 'tables'" class="space-y-8">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Table & List Components</h2>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TopList
            :items="mockData.topPages"
            title="Top Pages"
            value-label="Views"
          />
          <TopList
            :items="mockData.topReferrers"
            title="Top Referrers"
            value-label="Visitors"
          />
        </div>

        <DataTable
          :columns="mockData.tableColumns"
          :rows="mockData.tableRows"
          title="Detailed Analytics"
        />

        <PageDetailCard :page="mockData.pageDetail" />
      </section>

      <!-- Engagement Section -->
      <section v-show="activeSection === 'engagement'" class="space-y-8">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Engagement Components</h2>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <GoalsPanel :goals="mockData.goals" />
          <EngagementMetrics :metrics="mockData.engagementMetrics" />
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LiveActivityFeed :activities="activities" />
          <AlertCard
            v-for="alert in mockData.alerts"
            :key="alert.id"
            :title="alert.title"
            :message="alert.message"
            :type="alert.type"
            :timestamp="alert.timestamp"
          />
        </div>
      </section>

      <!-- Utilities Section -->
      <section v-show="activeSection === 'utilities'" class="space-y-8">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Utility Components</h2>

        <!-- Filter Bar -->
        <FilterBar
          :filters="mockData.filters"
          @change="(f) => console.log('Filters changed:', f)"
        />

        <!-- Trend Indicators -->
        <div class="card p-6">
          <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-4">Trend Indicators</h3>
          <div class="flex gap-8">
            <TrendIndicator :value="0.15" label="vs last week" />
            <TrendIndicator :value="-0.08" label="vs last month" />
            <TrendIndicator :value="0" label="vs yesterday" />
          </div>
        </div>

        <!-- Empty States -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <EmptyState
            title="No data available"
            message="Start tracking to see your analytics data here."
            icon="chart"
          />
          <EmptyState
            title="No visitors yet"
            message="Share your site to start getting visitors."
            icon="users"
          />
          <EmptyState
            title="No goals configured"
            message="Set up conversion goals to track success."
            icon="target"
            action-label="Create Goal"
            @action="() => console.log('Create goal clicked')"
          />
        </div>
      </section>
    </main>
  </div>
</template>

<style>
@import 'uno.css';
</style>
