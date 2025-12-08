<script setup lang="ts">
/**
 * EngagementMetrics Component
 *
 * Displays user engagement metrics with visual indicators.
 */
import { computed } from 'vue'
import { formatCompact, formatDuration, formatPercentage } from '../utils'

export interface EngagementData {
  avgSessionDuration: number // in seconds
  avgPagesPerSession: number
  bounceRate: number // 0-1
  returningVisitorRate: number // 0-1
  avgTimeOnPage: number // in seconds
  exitRate: number // 0-1
}

const props = withDefaults(defineProps<{
  data: EngagementData | null
  loading?: boolean
  title?: string
}>(), {
  loading: false,
  title: 'Engagement',
})

interface MetricConfig {
  label: string
  key: keyof EngagementData
  format: 'duration' | 'number' | 'percentage'
  icon: string
  good: 'high' | 'low' // Is high value good or bad?
  benchmark?: number // Industry benchmark
}

const metrics: MetricConfig[] = [
  {
    label: 'Avg. Session Duration',
    key: 'avgSessionDuration',
    format: 'duration',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    good: 'high',
    benchmark: 180, // 3 minutes
  },
  {
    label: 'Pages / Session',
    key: 'avgPagesPerSession',
    format: 'number',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    good: 'high',
    benchmark: 3,
  },
  {
    label: 'Bounce Rate',
    key: 'bounceRate',
    format: 'percentage',
    icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
    good: 'low',
    benchmark: 0.4, // 40%
  },
  {
    label: 'Returning Visitors',
    key: 'returningVisitorRate',
    format: 'percentage',
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    good: 'high',
    benchmark: 0.3, // 30%
  },
  {
    label: 'Avg. Time on Page',
    key: 'avgTimeOnPage',
    format: 'duration',
    icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    good: 'high',
    benchmark: 60, // 1 minute
  },
  {
    label: 'Exit Rate',
    key: 'exitRate',
    format: 'percentage',
    icon: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
    good: 'low',
    benchmark: 0.5, // 50%
  },
]

function formatValue(value: number, format: string): string {
  switch (format) {
    case 'duration':
      return formatDuration(value)
    case 'percentage':
      return formatPercentage(value)
    default:
      return formatCompact(value)
  }
}

function getPerformanceClass(metric: MetricConfig, value: number): string {
  if (metric.benchmark === undefined)
    return 'text-gray-600'

  const isGood = metric.good === 'high'
    ? value >= metric.benchmark
    : value <= metric.benchmark

  return isGood ? 'text-green-600' : 'text-amber-600'
}

function getBarWidth(metric: MetricConfig, value: number): number {
  if (metric.format === 'percentage') {
    return Math.min(value * 100, 100)
  }

  // For non-percentage values, calculate relative to benchmark * 2
  const max = (metric.benchmark ?? value) * 2
  return Math.min((value / max) * 100, 100)
}
</script>

<template>
  <div class="engagement-metrics">
    <h3 class="text-sm font-medium text-gray-900 mb-4">{{ title }}</h3>

    <!-- Loading state -->
    <div v-if="loading" class="grid grid-cols-2 gap-4">
      <div v-for="i in 6" :key="i" class="animate-pulse">
        <div class="skeleton h-4 w-24 mb-2" />
        <div class="skeleton h-8 w-16 mb-2" />
        <div class="skeleton h-2 w-full" />
      </div>
    </div>

    <!-- No data state -->
    <div v-else-if="!data" class="text-center py-8 text-gray-500">
      No engagement data available
    </div>

    <!-- Metrics grid -->
    <div v-else class="grid grid-cols-2 lg:grid-cols-3 gap-6">
      <div v-for="metric in metrics" :key="metric.key" class="space-y-2">
        <!-- Label with icon -->
        <div class="flex items-center gap-2 text-sm text-gray-500">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="metric.icon" />
          </svg>
          <span>{{ metric.label }}</span>
        </div>

        <!-- Value -->
        <div
          class="text-2xl font-semibold"
          :class="getPerformanceClass(metric, data[metric.key])"
        >
          {{ formatValue(data[metric.key], metric.format) }}
        </div>

        <!-- Progress bar -->
        <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="getPerformanceClass(metric, data[metric.key]).replace('text-', 'bg-')"
            :style="{ width: `${getBarWidth(metric, data[metric.key])}%` }"
          />
        </div>

        <!-- Benchmark comparison -->
        <div v-if="metric.benchmark" class="text-xs text-gray-400">
          Benchmark: {{ formatValue(metric.benchmark, metric.format) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.engagement-metrics {
  @apply card-hover p-6;
}
</style>
