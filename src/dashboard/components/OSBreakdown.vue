<script setup lang="ts">
/**
 * OSBreakdown Component
 *
 * Displays operating system breakdown with icons.
 */
import { computed } from 'vue'
import type { TopItem } from '../types'
import { formatPercentage } from '../utils'

const props = withDefaults(defineProps<{
  systems: TopItem[]
  loading?: boolean
}>(), {
  loading: false,
})

const osIcons: Record<string, string> = {
  windows: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>`,
  macos: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`,
  ios: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`,
  android: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.523 15.341c-.5 0-.91-.41-.91-.91s.41-.91.91-.91.91.41.91.91-.41.91-.91.91m-11.046 0c-.5 0-.91-.41-.91-.91s.41-.91.91-.91.91.41.91.91-.41.91-.91.91m11.4-6.02l1.97-3.41c.11-.19.04-.43-.15-.54-.19-.11-.43-.04-.54.15l-2 3.46C15.53 8.31 13.84 7.91 12 7.91s-3.53.4-5.15 1.07l-2-3.46c-.11-.19-.35-.26-.54-.15-.19.11-.26.35-.15.54l1.97 3.41C3.47 11.07 1.59 14.07 1.5 17.5h21c-.09-3.43-1.97-6.43-4.63-8.18z"/></svg>`,
  linux: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12.504 0c-.155 0-.311.001-.465.003-.653.014-1.302.082-1.933.225-1.308.298-2.482.88-3.46 1.71-.476.4-.903.85-1.273 1.347-.383.515-.706 1.076-.958 1.672-.264.628-.456 1.29-.57 1.97-.118.704-.162 1.425-.132 2.143.032.757.136 1.505.31 2.234.159.662.378 1.304.649 1.92.238.54.522 1.058.846 1.546.261.392.549.764.86 1.114.296.333.615.646.95.938.317.276.65.533.995.77.284.197.578.38.879.548.21.118.426.227.644.33.197.093.398.18.6.262.19.078.384.15.58.217.189.065.38.125.573.18.194.057.39.108.587.155.198.048.398.09.6.127.21.04.422.072.635.1.225.03.452.052.679.068.24.018.481.028.723.028.242 0 .483-.01.723-.028.227-.016.454-.038.679-.068.213-.028.425-.06.635-.1.202-.037.402-.079.6-.127.197-.047.393-.098.587-.155.193-.055.384-.115.573-.18.196-.067.39-.139.58-.217.202-.082.403-.169.6-.262.218-.103.434-.212.644-.33.301-.168.595-.351.879-.548.345-.237.678-.494.995-.77.335-.292.654-.605.95-.938.311-.35.599-.722.86-1.114.324-.488.608-1.006.846-1.546.271-.616.49-1.258.649-1.92.174-.729.278-1.477.31-2.234.03-.718-.014-1.439-.132-2.143-.114-.68-.306-1.342-.57-1.97-.252-.596-.575-1.157-.958-1.672-.37-.497-.797-.947-1.273-1.347-.978-.83-2.152-1.412-3.46-1.71-.631-.143-1.28-.211-1.933-.225C12.815.001 12.659 0 12.504 0z"/></svg>`,
  chromeos: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-3.952 6.848a12.014 12.014 0 0 0 9.229-9.006zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728z"/></svg>`,
  other: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>`,
}

const osColors: Record<string, string> = {
  windows: 'bg-blue-100 text-blue-600',
  macos: 'bg-gray-100 text-gray-700',
  ios: 'bg-gray-100 text-gray-700',
  android: 'bg-green-100 text-green-600',
  linux: 'bg-amber-100 text-amber-600',
  chromeos: 'bg-yellow-100 text-yellow-600',
  other: 'bg-gray-100 text-gray-600',
}

const sortedSystems = computed(() =>
  [...props.systems].sort((a, b) => b.value - a.value),
)

function getOSIcon(name: string): string {
  const key = name.toLowerCase().replace(/\s+/g, '')
  if (key.includes('windows'))
    return osIcons.windows
  if (key.includes('mac') || key.includes('osx'))
    return osIcons.macos
  if (key.includes('ios') || key.includes('iphone') || key.includes('ipad'))
    return osIcons.ios
  if (key.includes('android'))
    return osIcons.android
  if (key.includes('linux') || key.includes('ubuntu') || key.includes('debian'))
    return osIcons.linux
  if (key.includes('chrome'))
    return osIcons.chromeos
  return osIcons.other
}

function getOSColor(name: string): string {
  const key = name.toLowerCase().replace(/\s+/g, '')
  if (key.includes('windows'))
    return osColors.windows
  if (key.includes('mac') || key.includes('osx'))
    return osColors.macos
  if (key.includes('ios') || key.includes('iphone') || key.includes('ipad'))
    return osColors.ios
  if (key.includes('android'))
    return osColors.android
  if (key.includes('linux') || key.includes('ubuntu') || key.includes('debian'))
    return osColors.linux
  if (key.includes('chrome'))
    return osColors.chromeos
  return osColors.other
}
</script>

<template>
  <div class="os-breakdown">
    <h3 class="text-sm font-medium text-gray-900 mb-4">
      Operating Systems
    </h3>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 4" :key="i" class="animate-pulse flex items-center gap-4">
        <div class="skeleton w-10 h-10 rounded-lg" />
        <div class="flex-1">
          <div class="skeleton h-4 w-20 mb-2" />
          <div class="skeleton h-2 w-full" />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!systems.length" class="text-center py-8 text-gray-500">
      No OS data available
    </div>

    <!-- OS list -->
    <div v-else class="space-y-4">
      <div
        v-for="system in sortedSystems"
        :key="system.name"
        class="flex items-center gap-4"
      >
        <div
          class="w-10 h-10 rounded-lg flex items-center justify-center"
          :class="getOSColor(system.name)"
          v-html="getOSIcon(system.name)"
        />
        <div class="flex-1">
          <div class="flex items-center justify-between">
            <span class="font-medium text-gray-900">{{ system.name }}</span>
            <span class="text-sm text-gray-600">{{ formatPercentage(system.percentage) }}</span>
          </div>
          <div class="progress-bar mt-1">
            <div
              class="progress-fill bg-gray-400"
              :style="{ width: `${system.percentage * 100}%` }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.os-breakdown {
  @apply card-hover p-6;
}
</style>
