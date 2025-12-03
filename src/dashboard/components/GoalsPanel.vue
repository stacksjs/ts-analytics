<script setup lang="ts">
/**
 * GoalsPanel Component
 *
 * Displays conversion goals with progress and revenue.
 */
import { computed } from 'vue'
import type { GoalConversion } from '../types'
import { formatCompact, formatCurrency, formatPercentage } from '../utils'

const props = withDefaults(defineProps<{
  goals: GoalConversion[]
  loading?: boolean
  title?: string
}>(), {
  loading: false,
  title: 'Conversion Goals',
})

const sortedGoals = computed(() =>
  [...props.goals].sort((a, b) => b.conversions - a.conversions),
)

const totalConversions = computed(() =>
  props.goals.reduce((sum, g) => sum + g.conversions, 0),
)

const totalRevenue = computed(() =>
  props.goals.reduce((sum, g) => sum + g.revenue, 0),
)
</script>

<template>
  <div class="goals-panel">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-medium text-gray-900">
        {{ title }}
      </h3>
      <div v-if="!loading && goals.length" class="text-sm text-gray-500">
        {{ formatCompact(totalConversions) }} total
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 3" :key="i" class="animate-pulse">
        <div class="flex items-center justify-between mb-2">
          <div class="skeleton h-5 w-32" />
          <div class="skeleton h-5 w-20" />
        </div>
        <div class="skeleton h-2" />
        <div class="flex items-center justify-between mt-2">
          <div class="skeleton h-4 w-24" />
          <div class="skeleton h-4 w-16" />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!goals.length" class="text-center py-8 text-gray-500">
      <svg class="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
      <p>No goals configured</p>
      <p class="text-sm text-gray-400 mt-1">Set up conversion goals to track performance</p>
    </div>

    <!-- Goals list -->
    <div v-else class="space-y-4">
      <div
        v-for="goal in sortedGoals"
        :key="goal.goalId"
        class="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
      >
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-gray-900">{{ goal.goalName }}</span>
          <span class="text-lg font-semibold text-gray-900">
            {{ formatCompact(goal.conversions) }}
          </span>
        </div>

        <!-- Conversion rate bar -->
        <div class="progress-bar mb-2">
          <div
            class="progress-fill bg-green-500"
            :style="{ width: `${Math.min(goal.conversionRate * 100, 100)}%` }"
          />
        </div>

        <div class="flex items-center justify-between text-sm">
          <span class="text-gray-500">
            {{ formatPercentage(goal.conversionRate) }} conversion rate
          </span>
          <span v-if="goal.revenue > 0" class="text-green-600 font-medium">
            {{ formatCurrency(goal.revenue) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Summary -->
    <div v-if="!loading && goals.length && totalRevenue > 0" class="mt-4 pt-4 border-t border-gray-200">
      <div class="flex items-center justify-between">
        <span class="text-sm text-gray-500">Total Revenue</span>
        <span class="text-lg font-semibold text-green-600">
          {{ formatCurrency(totalRevenue) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.goals-panel {
  @apply card-hover p-6;
}
</style>
