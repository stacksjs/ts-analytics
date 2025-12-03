<script setup lang="ts">
/**
 * ThemeSwitcher Component
 *
 * Toggle between light, dark, and system theme modes.
 */
import { computed, onMounted, ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const props = withDefaults(defineProps<{
  modelValue?: ThemeMode
  showLabels?: boolean
  persist?: boolean
  storageKey?: string
}>(), {
  modelValue: 'system',
  showLabels: false,
  persist: true,
  storageKey: 'analytics-theme',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: ThemeMode): void
  (e: 'change', value: ThemeMode, isDark: boolean): void
}>()

const internalMode = ref<ThemeMode>(props.modelValue)

const isDark = computed(() => {
  if (internalMode.value === 'system') {
    return typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  }
  return internalMode.value === 'dark'
})

function setMode(mode: ThemeMode) {
  internalMode.value = mode
  emit('update:modelValue', mode)
  emit('change', mode, isDark.value)

  if (props.persist && typeof localStorage !== 'undefined') {
    localStorage.setItem(props.storageKey, mode)
  }

  updateDocumentClass()
}

function updateDocumentClass() {
  if (typeof document === 'undefined')
    return

  if (isDark.value) {
    document.documentElement.classList.add('dark')
  }
  else {
    document.documentElement.classList.remove('dark')
  }
}

function cycleMode() {
  const modes: ThemeMode[] = ['light', 'dark', 'system']
  const currentIndex = modes.indexOf(internalMode.value)
  const nextIndex = (currentIndex + 1) % modes.length
  setMode(modes[nextIndex])
}

onMounted(() => {
  // Load from storage
  if (props.persist && typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(props.storageKey) as ThemeMode | null
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      internalMode.value = stored
    }
  }

  updateDocumentClass()

  // Listen for system theme changes
  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (internalMode.value === 'system') {
        updateDocumentClass()
        emit('change', 'system', isDark.value)
      }
    })
  }
})

watch(() => props.modelValue, (newVal) => {
  if (newVal !== internalMode.value) {
    internalMode.value = newVal
    updateDocumentClass()
  }
})
</script>

<template>
  <div class="theme-switcher">
    <!-- Simple toggle button -->
    <button
      v-if="!showLabels"
      type="button"
      class="btn-icon relative"
      :title="`Theme: ${internalMode}`"
      @click="cycleMode"
    >
      <!-- Sun (light mode) -->
      <svg
        v-if="internalMode === 'light'"
        class="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>

      <!-- Moon (dark mode) -->
      <svg
        v-else-if="internalMode === 'dark'"
        class="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>

      <!-- Computer (system mode) -->
      <svg
        v-else
        class="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    </button>

    <!-- Button group with labels -->
    <div v-else class="inline-flex rounded-lg border border-gray-200 p-1 bg-white">
      <button
        type="button"
        class="px-3 py-1.5 text-sm rounded-md transition-colors"
        :class="internalMode === 'light' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'"
        @click="setMode('light')"
      >
        <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        Light
      </button>

      <button
        type="button"
        class="px-3 py-1.5 text-sm rounded-md transition-colors"
        :class="internalMode === 'dark' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'"
        @click="setMode('dark')"
      >
        <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
        Dark
      </button>

      <button
        type="button"
        class="px-3 py-1.5 text-sm rounded-md transition-colors"
        :class="internalMode === 'system' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'"
        @click="setMode('system')"
      >
        <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        System
      </button>
    </div>
  </div>
</template>
