<script setup lang="ts">
/**
 * CountryList Component
 *
 * Displays country breakdown with flags using emoji flags.
 */
import { computed } from 'vue'
import type { TopItem } from '../types'
import { formatCompact, formatPercentage } from '../utils'

export interface CountryItem extends TopItem {
  countryCode?: string
}

const props = withDefaults(defineProps<{
  countries: CountryItem[]
  loading?: boolean
  maxItems?: number
  title?: string
}>(), {
  loading: false,
  maxItems: 10,
  title: 'Top Countries',
})

const sortedCountries = computed(() =>
  [...props.countries]
    .sort((a, b) => b.value - a.value)
    .slice(0, props.maxItems),
)

const maxValue = computed(() =>
  Math.max(...props.countries.map(c => c.value), 1),
)

// Convert country code to flag emoji
function getFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2)
    return '🌍'

  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0))

  return String.fromCodePoint(...codePoints)
}
</script>

<template>
  <div class="country-list">
    <h3 class="text-sm font-medium text-gray-900 mb-4">
      {{ title }}
    </h3>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 5" :key="i" class="animate-pulse">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <div class="skeleton w-6 h-6 rounded" />
            <div class="skeleton h-4 w-24" />
          </div>
          <div class="skeleton h-4 w-16" />
        </div>
        <div class="skeleton h-2" />
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!countries.length" class="text-center py-8 text-gray-500">
      No geographic data available
    </div>

    <!-- Country list -->
    <div v-else class="space-y-3">
      <div
        v-for="country in sortedCountries"
        :key="country.name"
        class="group"
      >
        <div class="list-item mb-1">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-lg flex-shrink-0">{{ getFlag(country.countryCode) }}</span>
            <span class="list-label" :title="country.name">
              {{ country.name }}
            </span>
          </div>
          <span class="list-value">
            {{ formatCompact(country.value) }}
            <span class="text-gray-400 ml-1">({{ formatPercentage(country.percentage) }})</span>
          </span>
        </div>

        <!-- Progress bar -->
        <div class="progress-bar">
          <div
            class="progress-fill bg-primary-500"
            :style="{ width: `${(country.value / maxValue) * 100}%` }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.country-list {
  @apply card-hover p-6;
}
</style>
