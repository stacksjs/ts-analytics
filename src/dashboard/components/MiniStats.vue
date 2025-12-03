<script setup lang="ts">
/**
 * MiniStats Component
 *
 * Compact horizontal row of mini stats, perfect for headers or summaries.
 */
import { formatCompact, formatCurrency, formatDuration, formatPercentage } from '../utils'

export interface MiniStat {
  label: string
  value: number | string
  format?: 'number' | 'percentage' | 'duration' | 'currency'
  change?: number
  icon?: string
}

const props = withDefaults(defineProps<{
  stats: MiniStat[]
  loading?: boolean
  dividers?: boolean
}>(), {
  loading: false,
  dividers: true,
})

function formatValue(stat: MiniStat): string {
  if (typeof stat.value === 'string')
    return stat.value

  switch (stat.format) {
    case 'percentage':
      return formatPercentage(stat.value)
    case 'duration':
      return formatDuration(stat.value)
    case 'currency':
      return formatCurrency(stat.value)
    default:
      return formatCompact(stat.value)
  }
}
</script>

<template>
  <div class="mini-stats flex items-center flex-wrap gap-y-2">
    <template v-if="loading">
      <div v-for="i in 4" :key="i" class="flex items-center gap-6 animate-pulse">
        <div class="flex items-center gap-2">
          <div class="skeleton h-4 w-16" />
          <div class="skeleton h-5 w-12" />
        </div>
        <div v-if="dividers && i < 4" class="h-4 w-px bg-gray-200" />
      </div>
    </template>

    <template v-else>
      <div
        v-for="(stat, index) in stats"
        :key="stat.label"
        class="flex items-center"
      >
        <div class="flex items-center gap-2 px-3 first:pl-0 last:pr-0">
          <!-- Icon -->
          <svg
            v-if="stat.icon"
            class="w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="stat.icon" />
          </svg>

          <!-- Label -->
          <span class="text-sm text-gray-500">{{ stat.label }}</span>

          <!-- Value -->
          <span class="text-sm font-semibold text-gray-900">
            {{ formatValue(stat) }}
          </span>

          <!-- Change indicator -->
          <span
            v-if="stat.change !== undefined"
            class="text-xs font-medium"
            :class="stat.change >= 0 ? 'text-green-600' : 'text-red-600'"
          >
            {{ stat.change >= 0 ? '+' : '' }}{{ stat.change.toFixed(1) }}%
          </span>
        </div>

        <!-- Divider -->
        <div
          v-if="dividers && index < stats.length - 1"
          class="h-4 w-px bg-gray-200"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.mini-stats {
  @apply py-2;
}
</style>
