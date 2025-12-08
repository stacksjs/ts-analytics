<script setup lang="ts">
/**
 * FilterBar Component
 *
 * Search and filter bar for analytics data.
 */
import { computed, ref } from 'vue'

export interface FilterOption {
  id: string
  label: string
  options: { value: string, label: string }[]
}

const props = withDefaults(defineProps<{
  placeholder?: string
  filters?: FilterOption[]
  showExport?: boolean
}>(), {
  placeholder: 'Search...',
  filters: () => [],
  showExport: false,
})

const emit = defineEmits<{
  (e: 'search', value: string): void
  (e: 'filter', filters: Record<string, string>): void
  (e: 'export', format: 'csv' | 'json'): void
}>()

const searchQuery = ref('')
const activeFilters = ref<Record<string, string>>({})
const showExportMenu = ref(false)

const hasActiveFilters = computed(() =>
  Object.values(activeFilters.value).some(v => v !== ''),
)

function handleSearch() {
  emit('search', searchQuery.value)
}

function handleFilterChange(filterId: string, value: string) {
  activeFilters.value[filterId] = value
  emit('filter', activeFilters.value)
}

function clearFilters() {
  searchQuery.value = ''
  activeFilters.value = {}
  emit('search', '')
  emit('filter', {})
}

function handleExport(format: 'csv' | 'json') {
  emit('export', format)
  showExportMenu.value = false
}
</script>

<template>
  <div class="filter-bar flex flex-wrap items-center gap-3">
    <!-- Search input -->
    <div class="relative flex-1 min-w-48">
      <svg
        class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        :placeholder="placeholder"
        class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        @input="handleSearch"
        @keyup.enter="handleSearch"
      >
    </div>

    <!-- Filter dropdowns -->
    <div v-for="filter in filters" :key="filter.id" class="relative">
      <select
        :value="activeFilters[filter.id] || ''"
        class="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent cursor-pointer"
        @change="handleFilterChange(filter.id, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ filter.label }}</option>
        <option v-for="option in filter.options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <svg
        class="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>

    <!-- Clear filters -->
    <button
      v-if="hasActiveFilters || searchQuery"
      type="button"
      class="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
      @click="clearFilters"
    >
      Clear
    </button>

    <!-- Export button -->
    <div v-if="showExport" class="relative">
      <button
        type="button"
        class="btn-secondary flex items-center gap-2"
        @click="showExportMenu = !showExportMenu"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Export
      </button>

      <Transition
        enter-active-class="transition ease-out duration-100"
        enter-from-class="transform opacity-0 scale-95"
        enter-to-class="transform opacity-100 scale-100"
        leave-active-class="transition ease-in duration-75"
        leave-from-class="transform opacity-100 scale-100"
        leave-to-class="transform opacity-0 scale-95"
      >
        <div v-if="showExportMenu" class="dropdown w-32">
          <button
            type="button"
            class="dropdown-item"
            @click="handleExport('csv')"
          >
            Export CSV
          </button>
          <button
            type="button"
            class="dropdown-item"
            @click="handleExport('json')"
          >
            Export JSON
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  @apply p-4 bg-white rounded-lg border border-gray-200;
}
</style>
