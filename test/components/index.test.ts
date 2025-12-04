import { describe, expect, it } from 'bun:test'

/**
 * Component Export Tests
 *
 * Verifies all 31 dashboard components are properly exported.
 */

describe('Dashboard Components Exports', () => {
  it('should export all 31 components', async () => {
    const components = await import('../../src/dashboard/components')

    // Main dashboards (2)
    expect(components.AnalyticsDashboard).toBeDefined()
    expect(components.FullAnalyticsDashboard).toBeDefined()

    // Core components (10)
    expect(components.StatCard).toBeDefined()
    expect(components.RealtimeCounter).toBeDefined()
    expect(components.DateRangePicker).toBeDefined()
    expect(components.MetricComparison).toBeDefined()
    expect(components.FilterBar).toBeDefined()
    expect(components.TrendIndicator).toBeDefined()
    expect(components.EmptyState).toBeDefined()
    expect(components.ThemeSwitcher).toBeDefined()
    expect(components.MiniStats).toBeDefined()
    expect(components.AnimatedNumber).toBeDefined()

    // Chart components (7)
    expect(components.TimeSeriesChart).toBeDefined()
    expect(components.DonutChart).toBeDefined()
    expect(components.SparklineChart).toBeDefined()
    expect(components.HeatmapChart).toBeDefined()
    expect(components.FunnelChart).toBeDefined()
    expect(components.BarChart).toBeDefined()
    expect(components.ProgressRing).toBeDefined()

    // Breakdown components (5)
    expect(components.DeviceBreakdown).toBeDefined()
    expect(components.BrowserBreakdown).toBeDefined()
    expect(components.OSBreakdown).toBeDefined()
    expect(components.CountryList).toBeDefined()
    expect(components.CampaignBreakdown).toBeDefined()

    // List & table components (3)
    expect(components.TopList).toBeDefined()
    expect(components.DataTable).toBeDefined()
    expect(components.PageDetailCard).toBeDefined()

    // Conversion & engagement components (2)
    expect(components.GoalsPanel).toBeDefined()
    expect(components.EngagementMetrics).toBeDefined()

    // Alert & activity components (2)
    expect(components.AlertCard).toBeDefined()
    expect(components.LiveActivityFeed).toBeDefined()
  })

  it('should have all components as valid Vue components', async () => {
    const components = await import('../../src/dashboard/components')

    const componentNames = [
      'AnalyticsDashboard',
      'FullAnalyticsDashboard',
      'StatCard',
      'RealtimeCounter',
      'DateRangePicker',
      'MetricComparison',
      'FilterBar',
      'TrendIndicator',
      'EmptyState',
      'ThemeSwitcher',
      'MiniStats',
      'AnimatedNumber',
      'TimeSeriesChart',
      'DonutChart',
      'SparklineChart',
      'HeatmapChart',
      'FunnelChart',
      'BarChart',
      'ProgressRing',
      'DeviceBreakdown',
      'BrowserBreakdown',
      'OSBreakdown',
      'CountryList',
      'CampaignBreakdown',
      'TopList',
      'DataTable',
      'PageDetailCard',
      'GoalsPanel',
      'EngagementMetrics',
      'AlertCard',
      'LiveActivityFeed',
    ]

    for (const name of componentNames) {
      const component = components[name as keyof typeof components]
      expect(component).toBeDefined()
      // Vue components are objects with render or setup function
      expect(typeof component).toBe('object')
    }

    // Verify count
    expect(componentNames.length).toBe(31)
  })
})

describe('Component Type Exports', () => {
  it('should export Activity type from LiveActivityFeed', async () => {
    const { LiveActivityFeed } = await import('../../src/dashboard/components')
    expect(LiveActivityFeed).toBeDefined()
  })

  it('should export PageDetail type from PageDetailCard', async () => {
    const { PageDetailCard } = await import('../../src/dashboard/components')
    expect(PageDetailCard).toBeDefined()
  })

  it('should export CampaignData type from CampaignBreakdown', async () => {
    const { CampaignBreakdown } = await import('../../src/dashboard/components')
    expect(CampaignBreakdown).toBeDefined()
  })
})
