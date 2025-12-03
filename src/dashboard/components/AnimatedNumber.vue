<script setup lang="ts">
/**
 * AnimatedNumber Component
 *
 * Animated counting number with formatting options.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { formatCompact, formatCurrency, formatPercentage } from '../utils'

const props = withDefaults(defineProps<{
  value: number
  format?: 'number' | 'compact' | 'percentage' | 'currency'
  duration?: number // Animation duration in ms
  decimals?: number
  prefix?: string
  suffix?: string
  animate?: boolean
}>(), {
  format: 'compact',
  duration: 1000,
  decimals: 0,
  prefix: '',
  suffix: '',
  animate: true,
})

const displayValue = ref(0)
const isAnimating = ref(false)

function formatNumber(num: number): string {
  switch (props.format) {
    case 'percentage':
      return formatPercentage(num)
    case 'currency':
      return formatCurrency(num)
    case 'compact':
      return formatCompact(num)
    default:
      return num.toLocaleString(undefined, {
        minimumFractionDigits: props.decimals,
        maximumFractionDigits: props.decimals,
      })
  }
}

function animateValue(start: number, end: number) {
  if (!props.animate) {
    displayValue.value = end
    return
  }

  isAnimating.value = true
  const startTime = performance.now()
  const diff = end - start

  function step(currentTime: number) {
    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / props.duration, 1)

    // Easing function (ease-out cubic)
    const eased = 1 - (1 - progress) ** 3

    displayValue.value = start + diff * eased

    if (progress < 1) {
      requestAnimationFrame(step)
    }
    else {
      displayValue.value = end
      isAnimating.value = false
    }
  }

  requestAnimationFrame(step)
}

const formattedValue = computed(() => {
  return `${props.prefix}${formatNumber(displayValue.value)}${props.suffix}`
})

onMounted(() => {
  animateValue(0, props.value)
})

watch(() => props.value, (newVal, oldVal) => {
  animateValue(oldVal ?? 0, newVal)
})
</script>

<template>
  <span class="animated-number tabular-nums" :class="{ 'opacity-80': isAnimating }">
    {{ formattedValue }}
  </span>
</template>

<style scoped>
.animated-number {
  transition: opacity 0.15s ease;
}
</style>
