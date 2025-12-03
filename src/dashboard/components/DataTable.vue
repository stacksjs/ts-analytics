<script setup lang="ts">
/**
 * DataTable Component
 *
 * A flexible table component for displaying analytics data.
 */
import { computed, ref } from 'vue'

export interface TableColumn {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
  format?: 'number' | 'percentage' | 'currency' | 'duration' | 'date'
  sortable?: boolean
  width?: string
}

export interface TableRow {
  [key: string]: string | number | boolean | null | undefined
}

const props = withDefaults(defineProps<{
  columns: TableColumn[]
  rows: TableRow[]
  loading?: boolean
  title?: string
  emptyMessage?: string
  sortable?: boolean
  pageSize?: number
}>(), {
  loading: false,
  emptyMessage: 'No data available',
  sortable: true,
  pageSize: 10,
})

const sortKey = ref<string | null>(null)
const sortOrder = ref<'asc' | 'desc'>('desc')
const currentPage = ref(1)

const sortedRows = computed(() => {
  if (!sortKey.value)
    return props.rows

  return [...props.rows].sort((a, b) => {
    const aVal = a[sortKey.value!]
    const bVal = b[sortKey.value!]

    if (aVal === bVal)
      return 0
    if (aVal === null || aVal === undefined)
      return 1
    if (bVal === null || bVal === undefined)
      return -1

    const comparison = aVal < bVal ? -1 : 1
    return sortOrder.value === 'asc' ? comparison : -comparison
  })
})

const totalPages = computed(() =>
  Math.ceil(sortedRows.value.length / props.pageSize),
)

const paginatedRows = computed(() => {
  const start = (currentPage.value - 1) * props.pageSize
  return sortedRows.value.slice(start, start + props.pageSize)
})

function toggleSort(column: TableColumn) {
  if (!column.sortable && !props.sortable)
    return

  if (sortKey.value === column.key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  }
  else {
    sortKey.value = column.key
    sortOrder.value = 'desc'
  }
}

function formatValue(value: unknown, format?: string): string {
  if (value === null || value === undefined)
    return '-'

  switch (format) {
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value)
    case 'percentage':
      return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : String(value)
    case 'currency':
      return typeof value === 'number' ? `$${value.toLocaleString()}` : String(value)
    case 'duration': {
      if (typeof value !== 'number')
        return String(value)
      const mins = Math.floor(value / 60)
      const secs = Math.floor(value % 60)
      return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
    }
    case 'date':
      return value instanceof Date ? value.toLocaleDateString() : String(value)
    default:
      return String(value)
  }
}
</script>

<template>
  <div class="data-table">
    <div v-if="title" class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-medium text-gray-900">{{ title }}</h3>
      <span v-if="rows.length" class="text-sm text-gray-500">
        {{ rows.length }} {{ rows.length === 1 ? 'row' : 'rows' }}
      </span>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="animate-pulse">
      <div class="skeleton h-10 mb-2" />
      <div v-for="i in 5" :key="i" class="skeleton h-12 mb-1" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!rows.length" class="text-center py-12 text-gray-500">
      {{ emptyMessage }}
    </div>

    <!-- Table -->
    <div v-else class="overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr class="border-b border-gray-200">
            <th
              v-for="column in columns"
              :key="column.key"
              class="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider"
              :class="[
                column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                (column.sortable !== false && sortable) ? 'cursor-pointer hover:text-gray-700' : '',
              ]"
              :style="column.width ? { width: column.width } : {}"
              @click="toggleSort(column)"
            >
              <div class="flex items-center gap-1" :class="column.align === 'right' ? 'justify-end' : ''">
                <span>{{ column.label }}</span>
                <svg
                  v-if="sortKey === column.key"
                  class="w-4 h-4"
                  :class="{ 'rotate-180': sortOrder === 'asc' }"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in paginatedRows"
            :key="index"
            class="border-b border-gray-100 hover:bg-gray-50"
          >
            <td
              v-for="column in columns"
              :key="column.key"
              class="px-4 py-3 text-sm"
              :class="[
                column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                column.format === 'number' || column.format === 'currency' ? 'tabular-nums' : '',
              ]"
            >
              {{ formatValue(row[column.key], column.format) }}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
        <div class="text-sm text-gray-500">
          Showing {{ (currentPage - 1) * pageSize + 1 }} to {{ Math.min(currentPage * pageSize, rows.length) }} of {{ rows.length }}
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn-icon"
            :disabled="currentPage === 1"
            @click="currentPage--"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span class="text-sm text-gray-600">
            Page {{ currentPage }} of {{ totalPages }}
          </span>
          <button
            type="button"
            class="btn-icon"
            :disabled="currentPage === totalPages"
            @click="currentPage++"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.data-table {
  @apply card-hover p-6;
}
</style>
