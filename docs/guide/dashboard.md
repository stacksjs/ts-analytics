---
title: Dashboard Components
description: Build analytics dashboards with Vue components
---

# Dashboard Components

ts-analytics includes a comprehensive set of Vue 3 components for building analytics dashboards.

## Quick Start

```vue
<script setup>
import { AnalyticsDashboard } from '@stacksjs/ts-analytics'
</script>

<template>
  <AnalyticsDashboard
    :config="{
      baseUrl: '/api/analytics',
      siteId: 'my-site'
    }"
  />
</template>
```

## Available Components

### Main Dashboards

#### AnalyticsDashboard

A complete analytics dashboard in one component:

```vue
<AnalyticsDashboard
  :config="{
    baseUrl: '/api/analytics',
    siteId: 'my-site',
  }"
  :date-range="{
    start: new Date('2024-01-01'),
    end: new Date(),
  }"
/>
```

#### FullAnalyticsDashboard

Extended dashboard with all features:

```vue
<FullAnalyticsDashboard
  :config="config"
  :show-realtime="true"
  :show-goals="true"
  :show-funnels="true"
/>
```

### Stat Cards

#### StatCard

Display a single metric:

```vue
<StatCard
  title="Page Views"
  :value="12500"
  :change="0.15"
  icon="chart-bar"
/>

<StatCard
  title="Bounce Rate"
  :value="0.42"
  format="percentage"
  :change="-0.05"
  :inverse="true"
/>
```

Props:

| Prop | Type | Description |
|------|------|-------------|
| `title` | string | Metric name |
| `value` | number | Metric value |
| `change` | number | Percentage change |
| `format` | string | `number`, `percentage`, `duration` |
| `inverse` | boolean | Inverse change color (lower is better) |
| `icon` | string | Icon name |

#### RealtimeCounter

Live visitor counter:

```vue
<RealtimeCounter
  :config="config"
  :poll-interval="5000"
/>
```

### Charts

#### TimeSeriesChart

Line/area chart for time-based data:

```vue
<TimeSeriesChart
  :data="timeSeries"
  :metrics="['pageViews', 'uniqueVisitors']"
  :height="300"
/>
```

#### DonutChart

Circular breakdown chart:

```vue
<DonutChart
  :data="deviceData"
  label-key="device"
  value-key="sessions"
/>
```

#### BarChart

Horizontal or vertical bar chart:

```vue
<BarChart
  :data="topPages"
  label-key="path"
  value-key="pageViews"
  :horizontal="true"
  :limit="10"
/>
```

#### FunnelChart

Conversion funnel visualization:

```vue
<FunnelChart
  :steps="[
    { name: 'Visit', count: 10000 },
    { name: 'Sign Up', count: 3000 },
    { name: 'Activate', count: 1500 },
    { name: 'Subscribe', count: 500 },
  ]"
/>
```

#### SparklineChart

Mini inline chart:

```vue
<SparklineChart
  :data="last7Days"
  :height="40"
  :width="120"
/>
```

#### HeatmapChart

Activity heatmap:

```vue
<HeatmapChart
  :data="hourlyData"
  x-key="hour"
  y-key="day"
  value-key="pageViews"
/>
```

### Breakdown Components

#### DeviceBreakdown

Device type distribution:

```vue
<DeviceBreakdown :data="deviceStats" />
```

#### BrowserBreakdown

Browser distribution:

```vue
<BrowserBreakdown :data="browserStats" />
```

#### OSBreakdown

Operating system distribution:

```vue
<OSBreakdown :data="osStats" />
```

#### CampaignBreakdown

UTM campaign performance:

```vue
<CampaignBreakdown :data="campaignStats" />
```

#### CountryList

Geographic distribution:

```vue
<CountryList
  :data="geoStats"
  :show-flags="true"
  :limit="10"
/>
```

### Data Display

#### TopList

Ranked list of items:

```vue
<TopList
  title="Top Pages"
  :items="topPages"
  label-key="path"
  value-key="pageViews"
  :limit="10"
/>
```

#### DataTable

Sortable data table:

```vue
<DataTable
  :columns="[
    { key: 'path', label: 'Page' },
    { key: 'pageViews', label: 'Views', sortable: true },
    { key: 'bounceRate', label: 'Bounce', format: 'percentage' },
  ]"
  :data="pageStats"
/>
```

### Interactive Components

#### DateRangePicker

Date range selection:

```vue
<DateRangePicker
  v-model="dateRange"
  :presets="['today', '7d', '30d', '90d', 'year']"
/>
```

#### FilterBar

Filter controls:

```vue
<FilterBar
  v-model:device="deviceFilter"
  v-model:browser="browserFilter"
  v-model:country="countryFilter"
/>
```

### Real-time Components

#### LiveActivityFeed

Live event stream:

```vue
<LiveActivityFeed
  :config="config"
  :max-items="20"
/>
```

#### TrendIndicator

Trend arrow with percentage:

```vue
<TrendIndicator :change="0.15" />
<TrendIndicator :change="-0.08" :inverse="true" />
```

#### AnimatedNumber

Animated number transitions:

```vue
<AnimatedNumber :value="pageViews" :duration="500" />
```

## Composables

### useAnalytics

Main analytics composable:

```typescript
import { useAnalytics } from '@stacksjs/ts-analytics'

const {
  summary,
  timeSeries,
  topPages,
  realtime,
  isLoading,
  error,
  refresh,
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

Create a custom composable:

```typescript
import { createAnalyticsComposable } from '@stacksjs/ts-analytics'

const useMyAnalytics = createAnalyticsComposable({
  baseUrl: '/api/analytics',
  siteId: 'my-site',
  pollInterval: 30000, // Real-time polling
})

// In component
const { summary, topPages, refresh } = useMyAnalytics()
```

### createRealtimePoller

Poll for real-time data:

```typescript
import { createRealtimePoller } from '@stacksjs/ts-analytics'

const { data, start, stop } = createRealtimePoller({
  baseUrl: '/api/analytics',
  siteId: 'my-site',
  interval: 5000,
})

onMounted(() => start())
onUnmounted(() => stop())
```

### fetchDashboardData

Fetch data directly:

```typescript
import { fetchDashboardData } from '@stacksjs/ts-analytics'

const data = await fetchDashboardData(
  { baseUrl: '/api/analytics', siteId: 'my-site' },
  { startDate: new Date('2024-01-01'), endDate: new Date() }
)
```

## Theming

### Built-in Themes

```typescript
import { defaultTheme, darkTheme } from '@stacksjs/ts-analytics'

// Use in components
<AnalyticsDashboard :theme="darkTheme" />
```

### Custom Theme

```typescript
const customTheme = {
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

### Theme Switcher

```vue
<ThemeSwitcher v-model="theme" />
```

## Utility Functions

### Formatting

```typescript
import {
  formatNumber,
  formatPercentage,
  formatDuration,
  formatCompact,
  formatDate,
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
```

## Next Steps

- [Real-time Analytics](/features/realtime) - Live visitor tracking
- [Goal Tracking](/features/goals) - Conversion goals
- [API Reference](/api/dashboard) - Full component API
