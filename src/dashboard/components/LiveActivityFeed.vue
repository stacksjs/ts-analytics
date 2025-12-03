<script setup lang="ts">
/**
 * LiveActivityFeed Component
 *
 * Real-time feed of visitor activity with animations.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

export type ActivityType = 'pageview' | 'event' | 'conversion' | 'session_start' | 'session_end'

export interface Activity {
  id: string
  type: ActivityType
  page?: string
  eventName?: string
  country?: string
  countryCode?: string
  device?: 'desktop' | 'mobile' | 'tablet'
  timestamp: Date
  value?: number
}

const props = withDefaults(defineProps<{
  activities: Activity[]
  maxItems?: number
  autoScroll?: boolean
  showTimestamps?: boolean
  paused?: boolean
}>(), {
  maxItems: 20,
  autoScroll: true,
  showTimestamps: true,
  paused: false,
})

const emit = defineEmits<{
  (e: 'click', activity: Activity): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)

const displayedActivities = computed(() =>
  props.activities.slice(0, props.maxItems),
)

const activityConfig: Record<ActivityType, { icon: string, color: string, label: string }> = {
  pageview: {
    icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    color: 'bg-blue-100 text-blue-600',
    label: 'Page View',
  },
  event: {
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    color: 'bg-purple-100 text-purple-600',
    label: 'Event',
  },
  conversion: {
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    color: 'bg-green-100 text-green-600',
    label: 'Conversion',
  },
  session_start: {
    icon: 'M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1',
    color: 'bg-cyan-100 text-cyan-600',
    label: 'Session Start',
  },
  session_end: {
    icon: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
    color: 'bg-gray-100 text-gray-600',
    label: 'Session End',
  },
}

const deviceIcons: Record<string, string> = {
  desktop: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  mobile: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
  tablet: 'M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z',
}

function getFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2)
    return '🌍'
  const codePoints = countryCode.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0))
  return String.fromCodePoint(...codePoints)
}

function formatTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)

  if (seconds < 5)
    return 'Just now'
  if (seconds < 60)
    return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m ago`
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getActivityText(activity: Activity): string {
  switch (activity.type) {
    case 'pageview':
      return activity.page || 'Unknown page'
    case 'event':
      return activity.eventName || 'Custom event'
    case 'conversion':
      return activity.eventName || 'Goal completed'
    case 'session_start':
      return 'Started browsing'
    case 'session_end':
      return 'Left the site'
    default:
      return 'Activity'
  }
}
</script>

<template>
  <div class="live-activity-feed">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-medium text-gray-900">Live Activity</h3>
        <div v-if="!paused" class="relative">
          <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <div class="absolute inset-0 w-2 h-2 rounded-full bg-green-500 animate-ping" />
        </div>
        <span v-else class="text-xs text-gray-500">(Paused)</span>
      </div>
      <span v-if="activities.length" class="text-xs text-gray-500">
        {{ activities.length }} activities
      </span>
    </div>

    <!-- Empty state -->
    <div v-if="!activities.length" class="text-center py-8 text-gray-500">
      <svg class="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <p>Waiting for activity...</p>
    </div>

    <!-- Activity list -->
    <div
      v-else
      ref="containerRef"
      class="space-y-2 max-h-96 overflow-y-auto"
    >
      <TransitionGroup name="activity">
        <div
          v-for="activity in displayedActivities"
          :key="activity.id"
          class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
          @click="emit('click', activity)"
        >
          <!-- Type icon -->
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            :class="activityConfig[activity.type].color"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="activityConfig[activity.type].icon" />
            </svg>
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-900 truncate">
                {{ getActivityText(activity) }}
              </span>
              <span v-if="activity.value" class="text-xs font-medium text-green-600">
                +${{ activity.value }}
              </span>
            </div>
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <span v-if="activity.countryCode" class="flex items-center gap-1">
                {{ getFlag(activity.countryCode) }}
                {{ activity.country }}
              </span>
              <span v-if="activity.device" class="flex items-center gap-1">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="deviceIcons[activity.device]" />
                </svg>
              </span>
            </div>
          </div>

          <!-- Timestamp -->
          <span v-if="showTimestamps" class="text-xs text-gray-400 flex-shrink-0">
            {{ formatTime(activity.timestamp) }}
          </span>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.live-activity-feed {
  @apply card-hover p-6;
}

.activity-enter-active {
  transition: all 0.3s ease-out;
}

.activity-leave-active {
  transition: all 0.2s ease-in;
}

.activity-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.activity-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.activity-move {
  transition: transform 0.3s ease;
}
</style>
