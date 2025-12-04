/**
 * Analytics Dashboard Module
 *
 * Vue 3 dashboard components and utilities for displaying
 * privacy-focused analytics data.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { AnalyticsDashboard } from '@stacksjs/dynamodb-tooling/analytics/dashboard'
 *
 * const config = {
 *   baseUrl: '/api/analytics',
 *   siteId: 'my-site',
 * }
 * </script>
 *
 * <template>
 *   <AnalyticsDashboard :config="config" />
 * </template>
 * ```
 */

// Components - All 31 dashboard components
export {
  // Alert & activity
  AlertCard,
  // Main dashboards
  AnalyticsDashboard,
  AnimatedNumber,
  BarChart,
  BrowserBreakdown,
  CampaignBreakdown,
  CountryList,
  DataTable,
  DateRangePicker,
  // Breakdown components
  DeviceBreakdown,
  DonutChart,
  EmptyState,
  EngagementMetrics,
  FilterBar,
  FullAnalyticsDashboard,
  FunnelChart,
  // Conversion & engagement
  GoalsPanel,
  HeatmapChart,
  LiveActivityFeed,
  MetricComparison,
  MiniStats,
  OSBreakdown,
  PageDetailCard,
  ProgressRing,
  RealtimeCounter,
  SparklineChart,
  // Core components
  StatCard,
  ThemeSwitcher,
  // Chart components
  TimeSeriesChart,
  // List & table components
  TopList,
  TrendIndicator,
} from './components'

// Composables
export {
  AnalyticsClient,
  createAnalyticsComposable,
  createRealtimePoller,
  fetchDashboardData,
} from './composables/useAnalytics'

// Re-export as useAnalytics alias for convenience
export { createAnalyticsComposable as useAnalytics } from './composables/useAnalytics'

// Types
export type {
  AnalyticsApiConfig,
  ChartProps,
  DashboardSummary,
  DashboardTheme,
  DateRange,
  RealtimeCounterProps,
  RealtimeData,
  StatCardProps,
  TimeSeriesDataPoint,
  TopItem,
  TopListProps,
} from './types'

// Theme
export { darkTheme, defaultTheme } from './types'

// Utilities
export {
  calculateAxisTicks,
  calculateChange,
  type DateRangePreset,
  dateRangePresets,
  formatCompact,
  formatDate,
  formatDateRange,
  formatDuration,
  formatNumber,
  formatPercentage,
  getDateRangeFromPreset,
} from './utils'

// Re-export with common alias names
export { calculateChange as calculatePercentageChange } from './utils'
export { getDateRangeFromPreset as getDateRangePreset } from './utils'
