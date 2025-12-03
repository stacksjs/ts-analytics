<script setup lang="ts">
/**
 * TopList Component
 *
 * Displays a list of top items (pages, referrers, etc.) with bars.
 */
import { computed } from 'vue'
import type { TopListProps } from '../types'
import { formatCompact, formatPercentage } from '../utils'

const props = withDefaults(defineProps<TopListProps>(), {
  showPercentage: true,
  maxItems: 10,
  emptyMessage: 'No data available',
  loading: false,
})

const displayItems = computed(() =>
  props.items.slice(0, props.maxItems),
)

const maxValue = computed(() =>
  Math.max(...props.items.map(item => item.value), 1),
)
</script>

<template>
  <div class="top-list">
    <h3 class="text-sm font-medium text-gray-900 mb-4">
      {{ title }}
    </h3>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 5" :key="i" class="animate-pulse">
        <div class="flex justify-between mb-1">
          <div class="skeleton h-4 w-32" />
          <div class="skeleton h-4 w-12" />
        </div>
        <div class="skeleton h-2" />
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="items.length === 0" class="text-center py-8 text-gray-500">
      {{ emptyMessage }}
    </div>

    <!-- Items list -->
    <div v-else class="space-y-3">
      <div v-for="(item, index) in displayItems" :key="index" class="group">
        <div class="list-item mb-1">
          <span class="list-label" :title="item.name">
            {{ item.name }}
          </span>
          <span class="list-value">
            {{ formatCompact(item.value) }}
            <span v-if="showPercentage" class="text-gray-400 ml-1">
              ({{ formatPercentage(item.percentage) }})
            </span>
          </span>
        </div>

        <!-- Progress bar -->
        <div class="progress-bar">
          <div
            class="progress-fill bg-indigo-500"
            :style="{ width: `${(item.value / maxValue) * 100}%` }"
          />
        </div>
      </div>
    </div>

    <!-- View more slot -->
    <slot name="footer" />
  </div>
</template>

<style scoped>
.top-list {
  @apply card-hover p-6;
}
</style>
