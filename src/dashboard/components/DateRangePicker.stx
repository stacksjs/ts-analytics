<script setup lang="ts">
/**
 * DateRangePicker Component
 *
 * Dropdown for selecting date range presets.
 */
import { ref } from 'vue'
import type { DateRange } from '../types'
import { dateRangePresets, formatDateRange } from '../utils'

const props = defineProps<{
  modelValue: DateRange
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: DateRange): void
}>()

const isOpen = ref(false)

function selectPreset(preset: typeof dateRangePresets[0]) {
  const range = preset.getRange()
  emit('update:modelValue', {
    start: range.start,
    end: range.end,
    preset: preset.value,
  })
  isOpen.value = false
}

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.date-range-picker')) {
    isOpen.value = false
  }
}

// Close on click outside
if (typeof window !== 'undefined') {
  window.addEventListener('click', handleClickOutside)
}
</script>

<template>
  <div class="date-range-picker relative">
    <button
      type="button"
      class="btn-secondary flex items-center gap-2 focus:ring-2 focus:ring-primary-500"
      @click.stop="toggleDropdown"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span>{{ formatDateRange(modelValue.start, modelValue.end) }}</span>
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div v-if="isOpen" class="dropdown w-48">
        <button
          v-for="preset in dateRangePresets"
          :key="preset.value"
          type="button"
          :class="modelValue.preset === preset.value ? 'dropdown-item-active' : 'dropdown-item'"
          @click="selectPreset(preset)"
        >
          {{ preset.label }}
        </button>
      </div>
    </Transition>
  </div>
</template>
