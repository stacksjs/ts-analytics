<script setup lang="ts">
/**
 * ProgressRing Component
 *
 * Circular progress indicator with optional center content.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  value: number // 0-100
  size?: number
  strokeWidth?: number
  color?: string
  bgColor?: string
  showValue?: boolean
  label?: string
  loading?: boolean
}>(), {
  size: 120,
  strokeWidth: 8,
  color: '#6366f1',
  bgColor: '#e5e7eb',
  showValue: true,
  loading: false,
})

const radius = computed(() => (props.size - props.strokeWidth) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const offset = computed(() => {
  const progress = Math.min(Math.max(props.value, 0), 100)
  return circumference.value - (progress / 100) * circumference.value
})
const center = computed(() => props.size / 2)
</script>

<template>
  <div
    class="progress-ring relative inline-flex items-center justify-center"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <!-- Loading state -->
    <div v-if="loading" class="absolute inset-0 animate-pulse">
      <div class="w-full h-full rounded-full bg-gray-200" />
    </div>

    <!-- SVG Ring -->
    <svg
      v-else
      :width="size"
      :height="size"
      class="transform -rotate-90"
    >
      <!-- Background circle -->
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke="bgColor"
        :stroke-width="strokeWidth"
        fill="none"
      />

      <!-- Progress circle -->
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke="color"
        :stroke-width="strokeWidth"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset"
        stroke-linecap="round"
        fill="none"
        class="transition-all duration-500 ease-out"
      />
    </svg>

    <!-- Center content -->
    <div
      v-if="!loading"
      class="absolute inset-0 flex flex-col items-center justify-center"
    >
      <slot>
        <span v-if="showValue" class="text-2xl font-bold text-gray-900">
          {{ Math.round(value) }}%
        </span>
        <span v-if="label" class="text-xs text-gray-500 mt-0.5">
          {{ label }}
        </span>
      </slot>
    </div>
  </div>
</template>
