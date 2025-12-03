<script setup lang="ts">
/**
 * MetricComparison Component
 *
 * Displays a metric with visual comparison between current and previous periods.
 */
import { computed } from 'vue'
import { formatChange, formatCompact, formatCurrency, formatDuration, formatPercentage } from '../utils'

const props = withDefaults(defineProps<{
  title: string
  current: number
  previous: number
  format?: 'number' | 'percentage' | 'duration' | 'currency'
  loading?: boolean
  invertColors?: boolean // For metrics where decrease is good (bounce rate)
}>(), {
  format: 'number',
  loading: false,
  invertColors: false,
})

const change = computed(() => {
  if (props.previous === 0)
    return props.current > 0 ? 100 : 0
  return ((props.current - props.previous) / props.previous) * 100
})

const formattedCurrent = computed(() => {
  switch (props.format) {
    case 'percentage':
      return formatPercentage(props.current)
    case 'duration':
      return formatDuration(props.current)
    case 'currency':
      return formatCurrency(props.current)
    default:
      return formatCompact(props.current)
  }
})

const formattedPrevious = computed(() => {
  switch (props.format) {
    case 'percentage':
      return formatPercentage(props.previous)
    case 'duration':
      return formatDuration(props.previous)
    case 'currency':
      return formatCurrency(props.previous)
    default:
      return formatCompact(props.previous)
  }
})

const isPositive = computed(() => {
  const positive = change.value >= 0
  return props.invertColors ? !positive : positive
})

const barWidthCurrent = computed(() => {
  const max = Math.max(props.current, props.previous)
  return max > 0 ? (props.current / max) * 100 : 0
})

const barWidthPrevious = computed(() => {
  const max = Math.max(props.current, props.previous)
  return max > 0 ? (props.previous / max) * 100 : 0
})
</script>

<template>
  <div class="metric-comparison">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-medium text-gray-900">{{ title }}</h3>
      <span
        v-if="!loading"
        class="text-sm font-medium"
        :class="isPositive ? 'text-green-600' : 'text-red-600'"
      >
        {{ formatChange(change / 100) }}
      </span>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-4 animate-pulse">
      <div>
        <div class="skeleton h-4 w-20 mb-2" />
        <div class="skeleton h-3 w-full" />
      </div>
      <div>
        <div class="skeleton h-4 w-20 mb-2" />
        <div class="skeleton h-3 w-3/4" />
      </div>
    </div>

    <div v-else class="space-y-4">
      <!-- Current period -->
      <div>
        <div class="flex items-center justify-between text-sm mb-1">
          <span class="text-gray-600">Current period</span>
          <span class="font-semibold text-gray-900">{{ formattedCurrent }}</span>
        </div>
        <div class="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="isPositive ? 'bg-green-500' : 'bg-red-500'"
            :style="{ width: `${barWidthCurrent}%` }"
          />
        </div>
      </div>

      <!-- Previous period -->
      <div>
        <div class="flex items-center justify-between text-sm mb-1">
          <span class="text-gray-600">Previous period</span>
          <span class="font-medium text-gray-500">{{ formattedPrevious }}</span>
        </div>
        <div class="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            class="h-full bg-gray-400 rounded-full transition-all duration-500"
            :style="{ width: `${barWidthPrevious}%` }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.metric-comparison {
  @apply card-hover p-6;
}
</style>
