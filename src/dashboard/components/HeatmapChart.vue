<script setup lang="ts">
/**
 * HeatmapChart Component
 *
 * Displays activity data as a heatmap grid (e.g., hours x days).
 */
import { computed } from 'vue'
import { formatCompact } from '../utils'

export interface HeatmapDataPoint {
  x: number // Column index (e.g., hour 0-23)
  y: number // Row index (e.g., day 0-6)
  value: number
}

const props = withDefaults(defineProps<{
  data: HeatmapDataPoint[]
  xLabels?: string[]
  yLabels?: string[]
  title?: string
  colorStart?: string
  colorEnd?: string
  loading?: boolean
}>(), {
  xLabels: () => ['12a', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12p', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
  yLabels: () => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  colorStart: '#e0e7ff',
  colorEnd: '#4f46e5',
  loading: false,
})

const maxValue = computed(() => {
  if (!props.data.length)
    return 1
  return Math.max(...props.data.map(d => d.value), 1)
})

const minValue = computed(() => {
  if (!props.data.length)
    return 0
  return Math.min(...props.data.map(d => d.value))
})

// Create a lookup map for quick access
const dataMap = computed(() => {
  const map = new Map<string, number>()
  for (const point of props.data) {
    map.set(`${point.x}-${point.y}`, point.value)
  }
  return map
})

function getValue(x: number, y: number): number {
  return dataMap.value.get(`${x}-${y}`) ?? 0
}

function getColor(value: number): string {
  if (maxValue.value === minValue.value)
    return props.colorStart

  const ratio = (value - minValue.value) / (maxValue.value - minValue.value)

  // Parse colors
  const startRgb = hexToRgb(props.colorStart)
  const endRgb = hexToRgb(props.colorEnd)

  if (!startRgb || !endRgb)
    return props.colorStart

  // Interpolate
  const r = Math.round(startRgb.r + (endRgb.r - startRgb.r) * ratio)
  const g = Math.round(startRgb.g + (endRgb.g - startRgb.g) * ratio)
  const b = Math.round(startRgb.b + (endRgb.b - startRgb.b) * ratio)

  return `rgb(${r}, ${g}, ${b})`
}

function hexToRgb(hex: string): { r: number, g: number, b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: Number.parseInt(result[1], 16),
        g: Number.parseInt(result[2], 16),
        b: Number.parseInt(result[3], 16),
      }
    : null
}
</script>

<template>
  <div class="heatmap-chart">
    <h3 v-if="title" class="text-sm font-medium text-gray-900 mb-4">
      {{ title }}
    </h3>

    <!-- Loading state -->
    <div v-if="loading" class="animate-pulse">
      <div class="skeleton h-48 w-full" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!data.length" class="text-center py-12 text-gray-500">
      No activity data available
    </div>

    <!-- Heatmap -->
    <div v-else class="overflow-x-auto">
      <div class="min-w-max">
        <!-- X-axis labels -->
        <div class="flex ml-12 mb-1">
          <div
            v-for="(label, index) in xLabels"
            :key="index"
            class="flex-1 text-center text-xs text-gray-500"
            style="min-width: 24px;"
          >
            {{ index % 3 === 0 ? label : '' }}
          </div>
        </div>

        <!-- Grid -->
        <div class="space-y-1">
          <div
            v-for="(yLabel, yIndex) in yLabels"
            :key="yIndex"
            class="flex items-center gap-2"
          >
            <!-- Y-axis label -->
            <div class="w-10 text-xs text-gray-500 text-right">
              {{ yLabel }}
            </div>

            <!-- Cells -->
            <div class="flex-1 flex gap-0.5">
              <div
                v-for="(_, xIndex) in xLabels"
                :key="xIndex"
                class="flex-1 aspect-square rounded-sm cursor-pointer transition-transform hover:scale-110 hover:z-10"
                style="min-width: 20px; min-height: 20px;"
                :style="{ backgroundColor: getColor(getValue(xIndex, yIndex)) }"
                :title="`${yLabel} ${xLabels[xIndex]}: ${formatCompact(getValue(xIndex, yIndex))}`"
              />
            </div>
          </div>
        </div>

        <!-- Legend -->
        <div class="flex items-center justify-end mt-4 gap-2">
          <span class="text-xs text-gray-500">Less</span>
          <div class="flex gap-0.5">
            <div
              v-for="i in 5"
              :key="i"
              class="w-4 h-4 rounded-sm"
              :style="{ backgroundColor: getColor(minValue + ((maxValue - minValue) * (i - 1)) / 4) }"
            />
          </div>
          <span class="text-xs text-gray-500">More</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.heatmap-chart {
  @apply card-hover p-6;
}
</style>
