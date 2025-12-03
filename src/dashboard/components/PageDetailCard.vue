<script setup lang="ts">
/**
 * PageDetailCard Component
 *
 * Displays detailed metrics for a specific page.
 */
import { computed } from 'vue'
import { formatCompact, formatDuration, formatPercentage } from '../utils'

export interface PageDetail {
  path: string
  title?: string
  pageViews: number
  uniquePageViews: number
  avgTimeOnPage: number
  bounceRate: number
  exitRate: number
  entrances: number
  exits: number
  change?: number
}

const props = withDefaults(defineProps<{
  page: PageDetail | null
  loading?: boolean
  showSparkline?: boolean
}>(), {
  loading: false,
  showSparkline: false,
})

const metrics = computed(() => {
  if (!props.page)
    return []

  return [
    { label: 'Page Views', value: formatCompact(props.page.pageViews), icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' },
    { label: 'Unique Views', value: formatCompact(props.page.uniquePageViews), icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
    { label: 'Avg. Time', value: formatDuration(props.page.avgTimeOnPage), icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { label: 'Bounce Rate', value: formatPercentage(props.page.bounceRate), icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6', isNegative: props.page.bounceRate > 0.5 },
    { label: 'Exit Rate', value: formatPercentage(props.page.exitRate), icon: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1' },
    { label: 'Entrances', value: formatCompact(props.page.entrances), icon: 'M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1' },
  ]
})
</script>

<template>
  <div class="page-detail-card">
    <!-- Loading state -->
    <div v-if="loading" class="animate-pulse">
      <div class="skeleton h-6 w-3/4 mb-2" />
      <div class="skeleton h-4 w-1/2 mb-6" />
      <div class="grid grid-cols-3 gap-4">
        <div v-for="i in 6" :key="i">
          <div class="skeleton h-4 w-16 mb-2" />
          <div class="skeleton h-6 w-12" />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!page" class="text-center py-8 text-gray-500">
      Select a page to view details
    </div>

    <!-- Page details -->
    <div v-else>
      <!-- Header -->
      <div class="mb-6">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="text-lg font-semibold text-gray-900 truncate" :title="page.path">
              {{ page.title || page.path }}
            </h3>
            <p class="text-sm text-gray-500 truncate mt-0.5" :title="page.path">
              {{ page.path }}
            </p>
          </div>
          <span
            v-if="page.change !== undefined"
            class="flex-shrink-0 px-2 py-1 text-xs font-medium rounded-full"
            :class="page.change >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'"
          >
            {{ page.change >= 0 ? '+' : '' }}{{ page.change.toFixed(1) }}%
          </span>
        </div>
      </div>

      <!-- Metrics grid -->
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div
          v-for="metric in metrics"
          :key="metric.label"
          class="p-3 bg-gray-50 rounded-lg"
        >
          <div class="flex items-center gap-2 text-xs text-gray-500 mb-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="metric.icon" />
            </svg>
            {{ metric.label }}
          </div>
          <div
            class="text-lg font-semibold"
            :class="metric.isNegative ? 'text-red-600' : 'text-gray-900'"
          >
            {{ metric.value }}
          </div>
        </div>
      </div>

      <!-- Actions slot -->
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-detail-card {
  @apply card-hover p-6;
}
</style>
