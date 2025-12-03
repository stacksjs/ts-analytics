<script setup lang="ts">
/**
 * AlertCard Component
 *
 * Displays alerts for threshold breaches or important notifications.
 */
import { computed } from 'vue'
import { formatCompact } from '../utils'

export type AlertSeverity = 'info' | 'success' | 'warning' | 'danger'

export interface Alert {
  id: string
  title: string
  message: string
  severity: AlertSeverity
  metric?: string
  value?: number
  threshold?: number
  timestamp?: Date
}

const props = withDefaults(defineProps<{
  alerts: Alert[]
  title?: string
  loading?: boolean
  maxAlerts?: number
  dismissible?: boolean
}>(), {
  title: 'Alerts',
  loading: false,
  maxAlerts: 5,
  dismissible: true,
})

const emit = defineEmits<{
  (e: 'dismiss', alertId: string): void
  (e: 'click', alert: Alert): void
}>()

const displayedAlerts = computed(() =>
  props.alerts.slice(0, props.maxAlerts),
)

const severityConfig: Record<AlertSeverity, { bg: string, border: string, icon: string, text: string }> = {
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: 'text-blue-500',
    text: 'text-blue-800',
  },
  success: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    icon: 'text-green-500',
    text: 'text-green-800',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: 'text-amber-500',
    text: 'text-amber-800',
  },
  danger: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: 'text-red-500',
    text: 'text-red-800',
  },
}

const severityIcons: Record<AlertSeverity, string> = {
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  danger: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
}

function formatTimestamp(date?: Date): string {
  if (!date)
    return ''
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1)
    return 'Just now'
  if (minutes < 60)
    return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
</script>

<template>
  <div class="alert-card">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-medium text-gray-900">{{ title }}</h3>
      <span v-if="alerts.length > maxAlerts" class="text-xs text-gray-500">
        +{{ alerts.length - maxAlerts }} more
      </span>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-3 animate-pulse">
      <div v-for="i in 3" :key="i" class="skeleton h-16 rounded-lg" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!alerts.length" class="text-center py-8">
      <svg class="w-12 h-12 mx-auto text-green-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-gray-500">All systems normal</p>
      <p class="text-sm text-gray-400 mt-1">No alerts at this time</p>
    </div>

    <!-- Alerts list -->
    <div v-else class="space-y-3">
      <div
        v-for="alert in displayedAlerts"
        :key="alert.id"
        class="p-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm"
        :class="[severityConfig[alert.severity].bg, severityConfig[alert.severity].border]"
        @click="emit('click', alert)"
      >
        <div class="flex items-start gap-3">
          <!-- Icon -->
          <svg
            class="w-5 h-5 flex-shrink-0 mt-0.5"
            :class="severityConfig[alert.severity].icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="severityIcons[alert.severity]" />
          </svg>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <h4 class="text-sm font-medium" :class="severityConfig[alert.severity].text">
                {{ alert.title }}
              </h4>
              <button
                v-if="dismissible"
                type="button"
                class="flex-shrink-0 p-1 rounded hover:bg-black/5 transition-colors"
                :class="severityConfig[alert.severity].text"
                @click.stop="emit('dismiss', alert.id)"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p class="text-sm mt-0.5" :class="severityConfig[alert.severity].text" style="opacity: 0.8">
              {{ alert.message }}
            </p>

            <!-- Metric info -->
            <div v-if="alert.value !== undefined" class="flex items-center gap-4 mt-2 text-xs" :class="severityConfig[alert.severity].text" style="opacity: 0.7">
              <span v-if="alert.metric">{{ alert.metric }}: {{ formatCompact(alert.value) }}</span>
              <span v-if="alert.threshold">Threshold: {{ formatCompact(alert.threshold) }}</span>
              <span v-if="alert.timestamp">{{ formatTimestamp(alert.timestamp) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.alert-card {
  @apply card-hover p-6;
}
</style>
