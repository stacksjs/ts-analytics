<script setup lang="ts">
/**
 * SparklineChart Component
 *
 * A minimal inline sparkline chart for showing trends.
 * Uses SVG for crisp rendering at any size.
 */
import { computed, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  data: number[]
  width?: number
  height?: number
  color?: string
  fillColor?: string
  showArea?: boolean
  strokeWidth?: number
  loading?: boolean
}>(), {
  width: 100,
  height: 32,
  color: '#6366f1',
  fillColor: '#6366f120',
  showArea: true,
  strokeWidth: 2,
  loading: false,
})

const svgRef = ref<SVGSVGElement | null>(null)

const pathData = computed(() => {
  if (!props.data.length)
    return ''

  const data = props.data
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const padding = props.strokeWidth
  const chartWidth = props.width - padding * 2
  const chartHeight = props.height - padding * 2

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * chartWidth
    const y = padding + chartHeight - ((value - min) / range) * chartHeight
    return `${x},${y}`
  })

  return `M${points.join(' L')}`
})

const areaPath = computed(() => {
  if (!props.data.length || !props.showArea)
    return ''

  const data = props.data
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const padding = props.strokeWidth
  const chartWidth = props.width - padding * 2
  const chartHeight = props.height - padding * 2

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * chartWidth
    const y = padding + chartHeight - ((value - min) / range) * chartHeight
    return `${x},${y}`
  })

  const firstX = padding
  const lastX = padding + chartWidth
  const bottomY = padding + chartHeight

  return `M${firstX},${bottomY} L${points.join(' L')} L${lastX},${bottomY} Z`
})

const trend = computed(() => {
  if (props.data.length < 2)
    return 0

  const first = props.data[0]
  const last = props.data[props.data.length - 1]

  if (first === 0)
    return last > 0 ? 100 : 0

  return ((last - first) / first) * 100
})

const trendColor = computed(() => {
  if (trend.value > 0)
    return '#22c55e'
  if (trend.value < 0)
    return '#ef4444'
  return '#6b7280'
})
</script>

<template>
  <div class="sparkline-chart inline-flex items-center gap-2">
    <!-- Loading state -->
    <div v-if="loading" class="animate-pulse">
      <div class="skeleton" :style="{ width: `${width}px`, height: `${height}px` }" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!data.length"
      class="flex items-center justify-center text-gray-300"
      :style="{ width: `${width}px`, height: `${height}px` }"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    </div>

    <!-- Chart -->
    <svg
      v-else
      ref="svgRef"
      :width="width"
      :height="height"
      class="overflow-visible"
    >
      <!-- Area fill -->
      <path
        v-if="showArea && areaPath"
        :d="areaPath"
        :fill="fillColor"
      />

      <!-- Line -->
      <path
        :d="pathData"
        :stroke="color"
        :stroke-width="strokeWidth"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- End dot -->
      <circle
        v-if="data.length"
        :cx="width - strokeWidth"
        :cy="height / 2"
        :r="strokeWidth"
        :fill="color"
      />
    </svg>

    <!-- Trend indicator -->
    <slot name="trend">
      <span
        v-if="data.length >= 2"
        class="text-xs font-medium"
        :style="{ color: trendColor }"
      >
        {{ trend >= 0 ? '+' : '' }}{{ trend.toFixed(1) }}%
      </span>
    </slot>
  </div>
</template>
