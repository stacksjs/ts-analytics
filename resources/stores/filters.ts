/**
 * Filters Store — shared filter/search/sort state for table views.
 *
 * Centralizes searchQuery and sort state that was previously duplicated
 * across DetailView and other table components.
 *
 * Usage in any <script client> block:
 *   const filters = useStore('filters')
 *   filters.searchQuery()       // read current search
 *   filters.toggleSort('name')  // toggle sort on a column
 *   filters.reset()             // clear all filters
 */

defineStore('filters', () => {
  const searchQuery = state('')
  const sortKey = state(null)
  const sortOrder = state('desc')
  const currentPage = state(1)

  /**
   * Toggle sort on a column key.
   * If already sorting by this key, flip the order.
   * Otherwise, set the key and default to descending.
   */
  function toggleSort(key) {
    if (sortKey() === key) {
      sortOrder.set(sortOrder() === 'asc' ? 'desc' : 'asc')
    } else {
      sortKey.set(key)
      sortOrder.set('desc')
    }
    currentPage.set(1)
  }

  /**
   * Reset all filter/sort state to defaults.
   */
  function reset() {
    searchQuery.set('')
    sortKey.set(null)
    sortOrder.set('desc')
    currentPage.set(1)
  }

  /**
   * Set search query and reset to page 1.
   */
  function setSearch(query) {
    searchQuery.set(query)
    currentPage.set(1)
  }

  return {
    searchQuery,
    sortKey,
    sortOrder,
    currentPage,
    toggleSort,
    reset,
    setSearch,
  }
})
