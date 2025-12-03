<script setup lang="ts">
/**
 * TrendIndicator Component
 *
 * Compact trend indicator showing direction and percentage change.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  value: number // Percentage change (-100 to +100+)
  size?: 'sm' | 'md' | 'lg'
  showValue?: boolean
  invertColors?: boolean // For metrics where decrease is good
  neutral?: number // Threshold for neutral (default 0)
}>(), {
  size: 'md',
  showValue: true,
  invertColors: false,
  neutral: 0,
})

const isPositive = computed(() => props.value > props.neutral)
const isNegative = computed(() => props.value < props.neutral)
const isNeutral = computed(() => props.value === props.neutral)

const colorClass = computed(() => {
  if (isNeutral.value)
    return 'text-gray-500 bg-gray-100'

  const positive = isPositive.value
  const goodTrend = props.invertColors ? !positive : positive

  return goodTrend
    ? 'text-green-600 bg-green-100'
    : 'text-red-600 bg-red-100'
})

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return { wrapper: 'text-xs px-1.5 py-0.5 gap-0.5', icon: 'w-3 h-3' }
    case 'lg':
      return { wrapper: 'text-base px-3 py-1.5 gap-1.5', icon: 'w-5 h-5' }
    default:
      return { wrapper: 'text-sm px-2 py-1 gap-1', icon: 'w-4 h-4' }
  }
})

const formattedValue = computed(() => {
  const abs = Math.abs(props.value)
  if (abs >= 1000)
    return `${(abs / 1000).toFixed(1)}k`
  if (abs >= 100)
    return abs.toFixed(0)
  if (abs >= 10)
    return abs.toFixed(1)
  return abs.toFixed(2)
})
</script>

<template>
  <span
    class="inline-flex items-center rounded-full font-medium"
    :class="[colorClass, sizeClasses.wrapper]"
  >
    <!-- Up arrow -->
    <svg
      v-if="isPositive"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
    </svg>

    <!-- Down arrow -->
    <svg
      v-else-if="isNegative"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
    </svg>

    <!-- Neutral -->
    <svg
      v-else
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14" />
    </svg>

    <span v-if="showValue">
      {{ isPositive ? '+' : '' }}{{ formattedValue }}%
    </span>
  </span>
</template>
