<script setup lang="ts">
/**
 * DonutChart Component
 *
 * Displays data as a donut/pie chart with legend.
 * Uses Canvas for rendering - fast and lightweight.
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { DashboardTheme } from '../types'
import { defaultTheme } from '../types'
import { formatCompact, formatPercentage } from '../utils'

export interface DonutChartItem {
  name: string
  value: number
  color?: string
}

const props = withDefaults(defineProps<{
  items: DonutChartItem[]
  title?: string
  size?: number
  thickness?: number
  loading?: boolean
  showLegend?: boolean
  showTotal?: boolean
  totalLabel?: string
  theme?: DashboardTheme
}>(), {
  size: 180,
  thickness: 24,
  loading: false,
  showLegend: true,
  showTotal: true,
  totalLabel: 'Total',
  theme: () => defaultTheme,
})

const canvasRef = ref<HTMLCanvasElement | null>(null)

const defaultColors = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#14b8a6', // teal
]

const total = computed(() => props.items.reduce((sum, item) => sum + item.value, 0))

const itemsWithColors = computed(() =>
  props.items.map((item, index) => ({
    ...item,
    color: item.color || defaultColors[index % defaultColors.length],
    percentage: total.value > 0 ? item.value / total.value : 0,
  })),
)

function drawChart() {
  const canvas = canvasRef.value
  if (!canvas || !props.items.length)
    return

  const ctx = canvas.getContext('2d')
  if (!ctx)
    return

  const dpr = window.devicePixelRatio || 1
  const size = props.size

  canvas.width = size * dpr
  canvas.height = size * dpr
  ctx.scale(dpr, dpr)

  ctx.clearRect(0, 0, size, size)

  const centerX = size / 2
  const centerY = size / 2
  const radius = (size - props.thickness) / 2
  const innerRadius = radius - props.thickness

  let startAngle = -Math.PI / 2 // Start from top

  for (const item of itemsWithColors.value) {
    const sliceAngle = item.percentage * 2 * Math.PI

    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle)
    ctx.arc(centerX, centerY, innerRadius, startAngle + sliceAngle, startAngle, true)
    ctx.closePath()

    ctx.fillStyle = item.color
    ctx.fill()

    startAngle += sliceAngle
  }
}

onMounted(() => {
  drawChart()
})

watch(() => props.items, drawChart, { deep: true })
</script>

<template>
  <div class="donut-chart">
    <h3 v-if="title" class="text-sm font-medium text-gray-900 mb-4">
      {{ title }}
    </h3>

    <!-- Loading state -->
    <div v-if="loading" class="animate-pulse flex items-center gap-6">
      <div class="skeleton rounded-full" :style="{ width: `${size}px`, height: `${size}px` }" />
      <div class="flex-1 space-y-2">
        <div v-for="i in 4" :key="i" class="skeleton h-4 w-24" />
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!items.length" class="text-center py-8 text-gray-500">
      No data available
    </div>

    <!-- Chart -->
    <div v-else class="flex items-center gap-6">
      <div class="relative" :style="{ width: `${size}px`, height: `${size}px` }">
        <canvas ref="canvasRef" :style="{ width: `${size}px`, height: `${size}px` }" />
        <!-- Center total -->
        <div
          v-if="showTotal"
          class="absolute inset-0 flex flex-col items-center justify-center"
        >
          <span class="text-2xl font-bold text-gray-900">{{ formatCompact(total) }}</span>
          <span class="text-xs text-gray-500">{{ totalLabel }}</span>
        </div>
      </div>

      <!-- Legend -->
      <div v-if="showLegend" class="flex-1 space-y-2">
        <div
          v-for="item in itemsWithColors"
          :key="item.name"
          class="flex items-center justify-between text-sm"
        >
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full" :style="{ backgroundColor: item.color }" />
            <span class="text-gray-700">{{ item.name }}</span>
          </div>
          <div class="text-gray-500 tabular-nums">
            {{ formatCompact(item.value) }}
            <span class="text-gray-400 ml-1">({{ formatPercentage(item.percentage) }})</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.donut-chart {
  @apply card-hover p-6;
}
</style>
