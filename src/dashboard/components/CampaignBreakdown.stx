<script setup lang="ts">
/**
 * CampaignBreakdown Component
 *
 * Displays UTM campaign data with source, medium, and campaign breakdown.
 */
import { computed, ref } from 'vue'
import { formatCompact, formatPercentage } from '../utils'

export interface CampaignData {
  name: string
  source?: string
  medium?: string
  visitors: number
  conversions: number
  conversionRate: number
  revenue?: number
}

const props = withDefaults(defineProps<{
  campaigns: CampaignData[]
  loading?: boolean
  title?: string
  maxItems?: number
}>(), {
  loading: false,
  title: 'Campaigns',
  maxItems: 10,
})

type SortKey = 'visitors' | 'conversions' | 'conversionRate' | 'revenue'

const sortBy = ref<SortKey>('visitors')
const sortOrder = ref<'asc' | 'desc'>('desc')

const sortedCampaigns = computed(() => {
  return [...props.campaigns]
    .sort((a, b) => {
      const aVal = a[sortBy.value] ?? 0
      const bVal = b[sortBy.value] ?? 0
      return sortOrder.value === 'desc' ? bVal - aVal : aVal - bVal
    })
    .slice(0, props.maxItems)
})

const totals = computed(() => ({
  visitors: props.campaigns.reduce((sum, c) => sum + c.visitors, 0),
  conversions: props.campaigns.reduce((sum, c) => sum + c.conversions, 0),
  revenue: props.campaigns.reduce((sum, c) => sum + (c.revenue ?? 0), 0),
}))

function toggleSort(key: SortKey) {
  if (sortBy.value === key) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  }
  else {
    sortBy.value = key
    sortOrder.value = 'desc'
  }
}

const sourceIcons: Record<string, string> = {
  google: 'M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z',
  facebook: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
  twitter: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  linkedin: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  email: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  direct: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
}

function getSourceIcon(source?: string): string {
  if (!source)
    return sourceIcons.direct
  const key = source.toLowerCase()
  return sourceIcons[key] || sourceIcons.direct
}
</script>

<template>
  <div class="campaign-breakdown">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-medium text-gray-900">{{ title }}</h3>
      <span v-if="!loading && campaigns.length" class="text-xs text-gray-500">
        {{ campaigns.length }} campaigns
      </span>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-3 animate-pulse">
      <div class="skeleton h-10 rounded" />
      <div v-for="i in 5" :key="i" class="skeleton h-14 rounded" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!campaigns.length" class="text-center py-8 text-gray-500">
      <svg class="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
      </svg>
      <p>No campaign data available</p>
    </div>

    <!-- Campaign table -->
    <div v-else class="overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr class="border-b border-gray-200">
            <th class="text-left text-xs font-medium text-gray-500 uppercase py-2">Campaign</th>
            <th
              class="text-right text-xs font-medium text-gray-500 uppercase py-2 cursor-pointer hover:text-gray-700"
              @click="toggleSort('visitors')"
            >
              <span class="inline-flex items-center gap-1">
                Visitors
                <svg v-if="sortBy === 'visitors'" class="w-3 h-3" :class="{ 'rotate-180': sortOrder === 'asc' }" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
              </span>
            </th>
            <th
              class="text-right text-xs font-medium text-gray-500 uppercase py-2 cursor-pointer hover:text-gray-700"
              @click="toggleSort('conversions')"
            >
              Conv.
            </th>
            <th
              class="text-right text-xs font-medium text-gray-500 uppercase py-2 cursor-pointer hover:text-gray-700"
              @click="toggleSort('conversionRate')"
            >
              Rate
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="campaign in sortedCampaigns"
            :key="campaign.name"
            class="border-b border-gray-100 hover:bg-gray-50"
          >
            <td class="py-3">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path :d="getSourceIcon(campaign.source)" />
                  </svg>
                </div>
                <div>
                  <div class="text-sm font-medium text-gray-900 truncate max-w-48">
                    {{ campaign.name }}
                  </div>
                  <div v-if="campaign.source || campaign.medium" class="text-xs text-gray-500">
                    {{ [campaign.source, campaign.medium].filter(Boolean).join(' / ') }}
                  </div>
                </div>
              </div>
            </td>
            <td class="text-right text-sm tabular-nums py-3">
              {{ formatCompact(campaign.visitors) }}
            </td>
            <td class="text-right text-sm tabular-nums py-3">
              {{ formatCompact(campaign.conversions) }}
            </td>
            <td class="text-right text-sm tabular-nums py-3">
              <span :class="campaign.conversionRate >= 0.03 ? 'text-green-600' : 'text-gray-600'">
                {{ formatPercentage(campaign.conversionRate) }}
              </span>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-gray-200 font-medium">
            <td class="py-3 text-sm text-gray-900">Total</td>
            <td class="text-right text-sm tabular-nums py-3">{{ formatCompact(totals.visitors) }}</td>
            <td class="text-right text-sm tabular-nums py-3">{{ formatCompact(totals.conversions) }}</td>
            <td class="text-right text-sm tabular-nums py-3">
              {{ formatPercentage(totals.visitors > 0 ? totals.conversions / totals.visitors : 0) }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.campaign-breakdown {
  @apply card-hover p-6;
}
</style>
