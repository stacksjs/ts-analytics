---
title: Dashboard API
description: API reference for dashboard components and composables
---

# Dashboard API

Vue 3 components and composables for building analytics dashboards.

## Components

### AnalyticsDashboard

Main dashboard component.

```vue
<AnalyticsDashboard
  :config="{ baseUrl: '/api/analytics', siteId: 'my-site' }"
  :date-range="{ start: new Date('2024-01-01'), end: new Date() }"
/>
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `config` | AnalyticsApiConfig | API configuration |
| `dateRange` | DateRange | Date range to display |

### StatCard

Display a single metric.

```vue
<StatCard
  title="Page Views"
  :value="12500"
  :change="0.15"
  format="number"
  icon="chart-bar"
/>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | string | required | Metric name |
| `value` | number | required | Metric value |
| `change` | number | - | Percentage change |
| `format` | string | `'number'` | `'number'`, `'percentage'`, `'duration'` |
| `inverse` | boolean | `false` | Invert change color |
| `icon` | string | - | Icon name |

### RealtimeCounter

Live visitor counter.

```vue
<RealtimeCounter
  :config="config"
  :poll-interval="5000"
/>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `config` | AnalyticsApiConfig | required | API configuration |
| `pollInterval` | number | `5000` | Poll interval (ms) |

### TimeSeriesChart

Line/area chart for time-based data.

```vue
<TimeSeriesChart
  :data="timeSeries"
  :metrics="['pageViews', 'uniqueVisitors']"
  :height="300"
/>
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `data` | TimeSeriesDataPoint[] | Time series data |
| `metrics` | string[] | Metrics to display |
| `height` | number | Chart height |

### DonutChart

Circular breakdown chart.

```vue
<DonutChart
  :data="deviceData"
  label-key="device"
  value-key="sessions"
/>
```

### BarChart

Horizontal or vertical bar chart.

```vue
<BarChart
  :data="topPages"
  label-key="path"
  value-key="pageViews"
  :horizontal="true"
  :limit="10"
/>
```

### FunnelChart

Conversion funnel visualization.

```vue
<FunnelChart
  :steps="funnelSteps"
  :show-percentages="true"
/>
```

### TopList

Ranked list of items.

```vue
<TopList
  title="Top Pages"
  :items="topPages"
  label-key="path"
  value-key="pageViews"
  :limit="10"
/>
```

### DataTable

Sortable data table.

```vue
<DataTable
  :columns="columns"
  :data="pageStats"
  :sortable="true"
/>
```

### DateRangePicker

Date range selection.

```vue
<DateRangePicker
  v-model="dateRange"
  :presets="['today', '7d', '30d', '90d', 'year']"
/>
```

### LiveActivityFeed

Real-time event stream.

```vue
<LiveActivityFeed
  :config="config"
  :max-items="20"
/>
```

## Composables

### useAnalytics

Main analytics composable.

```typescript
import { useAnalytics } from '@stacksjs/ts-analytics'

const {
  summary,        // Ref<DashboardSummary>
  timeSeries,     // Ref<TimeSeriesPoint[]>
  topPages,       // Ref<TopItem[]>
  realtime,       // Ref<RealtimeData>
  isLoading,      // Ref<boolean>
  error,          // Ref<Error | null>
  refresh,        // () => Promise<void>
} = useAnalytics({
  baseUrl: '/api/analytics',
  siteId: 'my-site',
  dateRange: {
    start: new Date('2024-01-01'),
    end: new Date(),
  },
})
```

### createAnalyticsComposable

Create a custom composable.

```typescript
import { createAnalyticsComposable } from '@stacksjs/ts-analytics'

const useMyAnalytics = createAnalyticsComposable({
  baseUrl: '/api/analytics',
  siteId: 'my-site',
  pollInterval: 30000,
})

// In component
const { summary, topPages } = useMyAnalytics()
```

### createRealtimePoller

Poll for real-time data.

```typescript
import { createRealtimePoller } from '@stacksjs/ts-analytics'

const { data, isLoading, start, stop } = createRealtimePoller({
  baseUrl: '/api/analytics',
  siteId: 'my-site',
  interval: 5000,
})

onMounted(() => start())
onUnmounted(() => stop())
```

### fetchDashboardData

Fetch data directly.

```typescript
import { fetchDashboardData } from '@stacksjs/ts-analytics'

const data = await fetchDashboardData(
  { baseUrl: '/api/analytics', siteId: 'my-site' },
  { startDate: new Date('2024-01-01'), endDate: new Date() }
)
```

## Utilities

### Formatting

```typescript
import {
  formatNumber,
  formatPercentage,
  formatDuration,
  formatCompact,
  formatDate,
  formatDateRange,
} from '@stacksjs/ts-analytics'

formatNumber(12500)        // "12,500"
formatPercentage(0.42)     // "42%"
formatDuration(185)        // "3m 5s"
formatCompact(1500000)     // "1.5M"
formatDate(new Date())     // "Jan 15, 2024"
```

### Date Ranges

```typescript
import {
  getDateRangePreset,
  getDateRangeFromPreset,
  dateRangePresets,
} from '@stacksjs/ts-analytics'

const range = getDateRangeFromPreset('30d')
// { start: Date, end: Date }

const preset = getDateRangePreset(range)
// '30d'
```

### Calculations

```typescript
import {
  calculateChange,
  calculatePercentageChange,
  calculateAxisTicks,
} from '@stacksjs/ts-analytics'

calculateChange(100, 80)           // 0.25 (25% increase)
calculatePercentageChange(0.5, 0.4) // 0.25 (25% increase)
```

## Types

### AnalyticsApiConfig

```typescript
interface AnalyticsApiConfig {
  baseUrl: string
  siteId: string
  headers?: Record<string, string>
}
```

### DashboardSummary

```typescript
interface DashboardSummary {
  pageViews: number
  uniqueVisitors: number
  sessions: number
  bounceRate: number
  avgSessionDuration: number
  pagesPerSession: number
  changes?: {
    pageViews: number
    uniqueVisitors: number
    sessions: number
  }
}
```

### TimeSeriesDataPoint

```typescript
interface TimeSeriesDataPoint {
  timestamp: string
  pageViews: number
  uniqueVisitors: number
  sessions?: number
}
```

### TopItem

```typescript
interface TopItem {
  label: string
  value: number
  change?: number
}
```

### DateRange

```typescript
interface DateRange {
  start: Date
  end: Date
}
```

## Themes

### Default Theme

```typescript
import { defaultTheme } from '@stacksjs/ts-analytics'
```

### Dark Theme

```typescript
import { darkTheme } from '@stacksjs/ts-analytics'
```

### Custom Theme

```typescript
const customTheme: DashboardTheme = {
  colors: {
    primary: '#10b981',
    secondary: '#6366f1',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#1e293b',
    textMuted: '#64748b',
  },
  fonts: {
    sans: 'Inter, sans-serif',
    mono: 'JetBrains Mono, monospace',
  },
  borderRadius: '0.5rem',
}
```

## See Also

- [Dashboard Guide](/guide/dashboard) - Usage guide
- [Real-time Analytics](/features/realtime) - Live tracking
- [Goal Tracking](/features/goals) - Conversion goals
