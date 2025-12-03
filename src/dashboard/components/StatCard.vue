<script setup lang="ts">
/**
 * StatCard Component
 *
 * Displays a single stat with optional change indicator.
 */
import { computed } from 'vue'
import type { StatCardProps } from '../types'
import {
  formatChange,
  formatCompact,
  formatCurrency,
  formatDuration,
  formatPercentage,
} from '../utils'

const props = withDefaults(defineProps<StatCardProps>(), {
  format: 'number',
  loading: false,
})

const formattedValue = computed(() => {
  if (typeof props.value === 'string')
    return props.value

  switch (props.format) {
    case 'percentage':
      return formatPercentage(props.value)
    case 'duration':
      return formatDuration(props.value)
    case 'currency':
      return formatCurrency(props.value)
    case 'number':
    default:
      return formatCompact(props.value)
  }
})

const changeClass = computed(() => {
  if (props.change === undefined)
    return ''
  // For bounce rate, negative is good
  const isPositiveGood = props.title.toLowerCase() !== 'bounce rate'
  const isGood = isPositiveGood ? props.change >= 0 : props.change <= 0
  return isGood ? 'text-green-600' : 'text-red-600'
})

const formattedChange = computed(() => {
  if (props.change === undefined)
    return ''
  return formatChange(props.change)
})
</script>

<template>
  <div class="stat-card">
    <div class="flex items-center justify-between">
      <h3 class="stat-title">
        {{ title }}
      </h3>
      <span v-if="icon" class="text-gray-400">
        <slot name="icon">
          {{ icon }}
        </slot>
      </span>
    </div>

    <div class="mt-2">
      <template v-if="loading">
        <div class="animate-pulse">
          <div class="skeleton h-8 w-24" />
          <div class="skeleton h-4 w-16 mt-2" />
        </div>
      </template>
      <template v-else>
        <p class="stat-value">
          {{ formattedValue }}
        </p>
        <p v-if="change !== undefined" class="mt-1 text-sm" :class="changeClass">
          <span>{{ formattedChange }}</span>
          <span v-if="changeLabel" class="text-gray-500 ml-1">{{ changeLabel }}</span>
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  @apply card-hover p-6;
}
</style>
