/**
 * Analytics Dashboard Components
 *
 * stx components for displaying analytics data.
 * These are .stx files that need to be processed by the stx framework.
 * Total: 31 components
 *
 * Components are exported as string identifiers pointing to the component files.
 * The stx framework uses these to resolve and render the components at runtime.
 */

// Component name constants - use these when referencing components in stx templates
export const AlertCard = 'AlertCard'
export const AnalyticsDashboard = 'AnalyticsDashboard'
export const AnimatedNumber = 'AnimatedNumber'
export const BarChart = 'BarChart'
export const BrowserBreakdown = 'BrowserBreakdown'
export const CampaignBreakdown = 'CampaignBreakdown'
export const CountryList = 'CountryList'
export const DataTable = 'DataTable'
export const DateRangePicker = 'DateRangePicker'
export const DeviceBreakdown = 'DeviceBreakdown'
export const DonutChart = 'DonutChart'
export const EmptyState = 'EmptyState'
export const EngagementMetrics = 'EngagementMetrics'
export const FilterBar = 'FilterBar'
export const FullAnalyticsDashboard = 'FullAnalyticsDashboard'
export const FunnelChart = 'FunnelChart'
export const GoalsPanel = 'GoalsPanel'
export const HeatmapChart = 'HeatmapChart'
export const LiveActivityFeed = 'LiveActivityFeed'
export const MetricComparison = 'MetricComparison'
export const MiniStats = 'MiniStats'
export const OSBreakdown = 'OSBreakdown'
export const PageDetailCard = 'PageDetailCard'
export const ProgressRing = 'ProgressRing'
export const RealtimeCounter = 'RealtimeCounter'
export const SparklineChart = 'SparklineChart'
export const StatCard = 'StatCard'
export const ThemeSwitcher = 'ThemeSwitcher'
export const TimeSeriesChart = 'TimeSeriesChart'
export const TopList = 'TopList'
export const TrendIndicator = 'TrendIndicator'

// Component registry for dynamic component resolution
export const componentRegistry: Record<string, string> = {
  AlertCard: './AlertCard.stx',
  AnalyticsDashboard: './AnalyticsDashboard.stx',
  AnimatedNumber: './AnimatedNumber.stx',
  BarChart: './BarChart.stx',
  BrowserBreakdown: './BrowserBreakdown.stx',
  CampaignBreakdown: './CampaignBreakdown.stx',
  CountryList: './CountryList.stx',
  DataTable: './DataTable.stx',
  DateRangePicker: './DateRangePicker.stx',
  DeviceBreakdown: './DeviceBreakdown.stx',
  DonutChart: './DonutChart.stx',
  EmptyState: './EmptyState.stx',
  EngagementMetrics: './EngagementMetrics.stx',
  FilterBar: './FilterBar.stx',
  FullAnalyticsDashboard: './FullAnalyticsDashboard.stx',
  FunnelChart: './FunnelChart.stx',
  GoalsPanel: './GoalsPanel.stx',
  HeatmapChart: './HeatmapChart.stx',
  LiveActivityFeed: './LiveActivityFeed.stx',
  MetricComparison: './MetricComparison.stx',
  MiniStats: './MiniStats.stx',
  OSBreakdown: './OSBreakdown.stx',
  PageDetailCard: './PageDetailCard.stx',
  ProgressRing: './ProgressRing.stx',
  RealtimeCounter: './RealtimeCounter.stx',
  SparklineChart: './SparklineChart.stx',
  StatCard: './StatCard.stx',
  ThemeSwitcher: './ThemeSwitcher.stx',
  TimeSeriesChart: './TimeSeriesChart.stx',
  TopList: './TopList.stx',
  TrendIndicator: './TrendIndicator.stx',
}

// List of all component names
export const allComponents = Object.keys(componentRegistry)

// Function to get component file path
export function getComponentPath(name: string): string | undefined {
  return componentRegistry[name]
}
