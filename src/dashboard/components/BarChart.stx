<script setup lang="ts">
/**
 * BarChart Component
 *
 * Horizontal or vertical bar chart for comparing values.
 * Uses Canvas for rendering.
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { DashboardTheme } from '../types'
import { defaultTheme } from '../types'
import { formatCompact } from '../utils'

export interface BarChartItem {
  label: string
  value: number
  color?: string
  previousValue?: number
}

const props = withDefaults(defineProps<{
  data: BarChartItem[]
  title?: string
  height?: number
  orientation?: 'horizontal' | 'vertical'
  showValues?: boolean
  showComparison?: boolean
  loading?: boolean
  theme?: DashboardTheme
}>(), {
  height: 300,
  orientation: 'horizontal',
  showValues: true,
  showComparison: false,
  loading: false,
  theme: () => defaultTheme,
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

const defaultColors = [
  '#6366f1',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
]

const maxValue = computed(() => {
  const values = props.data.flatMap(d => [d.value, d.previousValue ?? 0])
  return Math.max(...values, 1)
})

function drawChart() {
  const canvas = canvasRef.value
  if (!canvas || !props.data.length)
    return

  const ctx = canvas.getContext('2d')
  if (!ctx)
    return

  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()

  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const width = rect.width
  const height = rect.height

  ctx.clearRect(0, 0, width, height)

  if (props.orientation === 'horizontal') {
    drawHorizontalBars(ctx, width, height)
  }
  else {
    drawVerticalBars(ctx, width, height)
  }
}

function drawHorizontalBars(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const padding = { left: 100, right: 60, top: 20, bottom: 20 }
  const chartWidth = width - padding.left - padding.right
  const barHeight = props.showComparison ? 16 : 24
  const barGap = props.showComparison ? 4 : 0
  const groupHeight = barHeight * (props.showComparison ? 2 : 1) + barGap
  const groupGap = 16

  props.data.forEach((item, index) => {
    const y = padding.top + index * (groupHeight + groupGap)
    const barWidth = (item.value / maxValue.value) * chartWidth
    const color = item.color || defaultColors[index % defaultColors.length]

    // Label
    ctx.fillStyle = props.theme.text
    ctx.font = '13px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(item.label, padding.left - 12, y + groupHeight / 2)

    // Current bar
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(padding.left, y, barWidth, barHeight, 4)
    ctx.fill()

    // Previous bar (comparison)
    if (props.showComparison && item.previousValue !== undefined) {
      const prevBarWidth = (item.previousValue / maxValue.value) * chartWidth
      ctx.fillStyle = `${color}60`
      ctx.beginPath()
      ctx.roundRect(padding.left, y + barHeight + barGap, prevBarWidth, barHeight, 4)
      ctx.fill()
    }

    // Value label
    if (props.showValues) {
      ctx.fillStyle = props.theme.textSecondary
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(formatCompact(item.value), padding.left + barWidth + 8, y + barHeight / 2)

      if (props.showComparison && item.previousValue !== undefined) {
        const prevBarWidth = (item.previousValue / maxValue.value) * chartWidth
        ctx.fillText(formatCompact(item.previousValue), padding.left + prevBarWidth + 8, y + barHeight + barGap + barHeight / 2)
      }
    }
  })
}

function drawVerticalBars(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const padding = { left: 50, right: 20, top: 20, bottom: 60 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const barWidth = props.showComparison ? 20 : 32
  const barGap = props.showComparison ? 4 : 0
  const groupWidth = barWidth * (props.showComparison ? 2 : 1) + barGap
  const groupGap = (chartWidth - groupWidth * props.data.length) / (props.data.length + 1)

  // Y-axis
  ctx.strokeStyle = props.theme.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padding.left, padding.top)
  ctx.lineTo(padding.left, height - padding.bottom)
  ctx.stroke()

  props.data.forEach((item, index) => {
    const x = padding.left + groupGap + index * (groupWidth + groupGap)
    const barHeight = (item.value / maxValue.value) * chartHeight
    const color = item.color || defaultColors[index % defaultColors.length]

    // Current bar
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(x, height - padding.bottom - barHeight, barWidth, barHeight, [4, 4, 0, 0])
    ctx.fill()

    // Previous bar
    if (props.showComparison && item.previousValue !== undefined) {
      const prevBarHeight = (item.previousValue / maxValue.value) * chartHeight
      ctx.fillStyle = `${color}60`
      ctx.beginPath()
      ctx.roundRect(x + barWidth + barGap, height - padding.bottom - prevBarHeight, barWidth, prevBarHeight, [4, 4, 0, 0])
      ctx.fill()
    }

    // Label
    ctx.fillStyle = props.theme.textSecondary
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(item.label, x + groupWidth / 2, height - padding.bottom + 16)

    // Value on top
    if (props.showValues) {
      ctx.fillStyle = props.theme.text
      ctx.fillText(formatCompact(item.value), x + barWidth / 2, height - padding.bottom - barHeight - 8)
    }
  })
}

onMounted(() => {
  drawChart()
  if (containerRef.value) {
    const observer = new ResizeObserver(drawChart)
    observer.observe(containerRef.value)
  }
})

watch(() => props.data, drawChart, { deep: true })
</script>

<template>
  <div ref="containerRef" class="bar-chart">
    <h3 v-if="title" class="text-sm font-medium text-gray-900 mb-4">
      {{ title }}
    </h3>

    <!-- Loading state -->
    <div v-if="loading" class="animate-pulse" :style="{ height: `${height}px` }">
      <div class="skeleton h-full" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!data.length"
      class="flex items-center justify-center text-gray-500"
      :style="{ height: `${height}px` }"
    >
      No data available
    </div>

    <!-- Chart -->
    <canvas
      v-else
      ref="canvasRef"
      :style="{ width: '100%', height: `${height}px` }"
    />

    <!-- Legend for comparison -->
    <div v-if="showComparison && !loading && data.length" class="flex items-center justify-end gap-4 mt-4 text-sm">
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded bg-primary-500" />
        <span class="text-gray-600">Current period</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded bg-primary-500/40" />
        <span class="text-gray-600">Previous period</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bar-chart {
  @apply card-hover p-6;
}
canvas {
  display: block;
}
</style>
