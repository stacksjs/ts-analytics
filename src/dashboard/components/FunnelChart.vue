<script setup lang="ts">
/**
 * FunnelChart Component
 *
 * Displays conversion funnel stages with drop-off visualization.
 */
import { computed } from 'vue'
import { formatCompact, formatPercentage } from '../utils'

export interface FunnelStage {
  name: string
  value: number
  color?: string
}

const props = withDefaults(defineProps<{
  stages: FunnelStage[]
  title?: string
  loading?: boolean
  showDropoff?: boolean
}>(), {
  loading: false,
  showDropoff: true,
})

const defaultColors = [
  '#6366f1', // indigo
  '#8b5cf6', // purple
  '#a855f7', // violet
  '#d946ef', // fuchsia
  '#ec4899', // pink
]

const stagesWithData = computed(() => {
  const firstValue = props.stages[0]?.value ?? 1

  return props.stages.map((stage, index) => {
    const prevValue = index > 0 ? props.stages[index - 1].value : stage.value
    const dropoff = prevValue > 0 ? ((prevValue - stage.value) / prevValue) * 100 : 0
    const conversionFromStart = firstValue > 0 ? (stage.value / firstValue) * 100 : 0
    const widthPercent = firstValue > 0 ? (stage.value / firstValue) * 100 : 0

    return {
      ...stage,
      color: stage.color || defaultColors[index % defaultColors.length],
      dropoff,
      conversionFromStart,
      widthPercent: Math.max(widthPercent, 20), // Minimum width for visibility
      actualWidthPercent: widthPercent,
    }
  })
})

const overallConversion = computed(() => {
  if (!props.stages.length)
    return 0
  const first = props.stages[0].value
  const last = props.stages[props.stages.length - 1].value
  return first > 0 ? (last / first) * 100 : 0
})
</script>

<template>
  <div class="funnel-chart">
    <div v-if="title" class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-medium text-gray-900">{{ title }}</h3>
      <span v-if="!loading && stages.length" class="text-sm text-gray-500">
        {{ formatPercentage(overallConversion / 100) }} overall conversion
      </span>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-4 animate-pulse">
      <div v-for="i in 4" :key="i" class="flex items-center gap-4">
        <div class="skeleton h-12 flex-1" :style="{ maxWidth: `${100 - i * 15}%` }" />
        <div class="skeleton h-4 w-20" />
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!stages.length" class="text-center py-12 text-gray-500">
      No funnel data available
    </div>

    <!-- Funnel -->
    <div v-else class="space-y-2">
      <div
        v-for="(stage, index) in stagesWithData"
        :key="stage.name"
        class="relative"
      >
        <!-- Stage bar -->
        <div class="flex items-center gap-4">
          <div
            class="h-12 rounded-lg flex items-center justify-center transition-all duration-500"
            :style="{
              width: `${stage.widthPercent}%`,
              backgroundColor: stage.color,
              minWidth: '120px',
            }"
          >
            <span class="text-white font-medium text-sm px-3 truncate">
              {{ stage.name }}
            </span>
          </div>

          <div class="flex items-center gap-3 text-sm">
            <span class="font-semibold text-gray-900">
              {{ formatCompact(stage.value) }}
            </span>
            <span class="text-gray-500">
              ({{ formatPercentage(stage.conversionFromStart / 100) }})
            </span>
          </div>
        </div>

        <!-- Drop-off indicator -->
        <div
          v-if="showDropoff && index > 0 && stage.dropoff > 0"
          class="absolute -top-1 left-0 flex items-center gap-1 text-xs text-red-500"
          :style="{ left: `${stagesWithData[index - 1].widthPercent}%`, transform: 'translateX(-100%)' }"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          <span>-{{ stage.dropoff.toFixed(1) }}%</span>
        </div>
      </div>
    </div>

    <!-- Summary -->
    <div v-if="!loading && stages.length > 1" class="mt-6 pt-4 border-t border-gray-200">
      <div class="grid grid-cols-3 gap-4 text-center">
        <div>
          <p class="text-2xl font-bold text-gray-900">{{ formatCompact(stages[0].value) }}</p>
          <p class="text-xs text-gray-500">Started</p>
        </div>
        <div>
          <p class="text-2xl font-bold text-gray-900">{{ formatCompact(stages[stages.length - 1].value) }}</p>
          <p class="text-xs text-gray-500">Completed</p>
        </div>
        <div>
          <p class="text-2xl font-bold" :class="overallConversion >= 10 ? 'text-green-600' : 'text-amber-600'">
            {{ formatPercentage(overallConversion / 100) }}
          </p>
          <p class="text-xs text-gray-500">Conversion</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.funnel-chart {
  @apply card-hover p-6;
}
</style>
