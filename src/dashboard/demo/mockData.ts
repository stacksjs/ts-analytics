/**
 * Mock Data for Dashboard Demo
 *
 * Realistic sample data for showcasing all dashboard components.
 */

export const mockData = {
  // Stat Cards
  stats: [
    { label: 'Total Visitors', value: 24847, change: 0.12, icon: 'users' },
    { label: 'Page Views', value: 89234, change: 0.08, icon: 'eye' },
    { label: 'Bounce Rate', value: '42.3%', change: -0.05, icon: 'arrow-down' },
    { label: 'Avg. Duration', value: '3m 24s', change: 0.15, icon: 'clock' },
  ],

  // Mini Stats
  miniStats: [
    { label: 'Sessions', value: 12847, change: 0.08 },
    { label: 'Users', value: 8234, change: 0.12 },
    { label: 'New Users', value: 3421, change: 0.24 },
    { label: 'Events', value: 45892, change: -0.03 },
  ],

  // Comparison Metrics
  comparisonMetrics: [
    { label: 'Visitors', current: 24847, previous: 22134, format: 'number' as const },
    { label: 'Bounce Rate', current: 0.423, previous: 0.456, format: 'percentage' as const, inverse: true },
    { label: 'Avg. Duration', current: 204000, previous: 178000, format: 'duration' as const },
    { label: 'Conversions', current: 847, previous: 723, format: 'number' as const },
  ],

  // Time Series
  timeSeries: Array.from({ length: 30 }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - (29 - i))
    return {
      date: date.toISOString().slice(0, 10),
      visitors: Math.floor(Math.random() * 500) + 800,
      pageViews: Math.floor(Math.random() * 1500) + 2000,
    }
  }),

  // Donut Chart
  donutData: [
    { label: 'Direct', value: 4234, color: '#3b82f6' },
    { label: 'Organic Search', value: 3456, color: '#10b981' },
    { label: 'Social', value: 2134, color: '#8b5cf6' },
    { label: 'Referral', value: 1234, color: '#f59e0b' },
    { label: 'Email', value: 567, color: '#ef4444' },
  ],

  // Bar Chart
  barData: [
    { label: '/home', value: 12847 },
    { label: '/products', value: 8923 },
    { label: '/about', value: 5634 },
    { label: '/blog', value: 4521 },
    { label: '/contact', value: 2134 },
  ],

  // Funnel Steps
  funnelSteps: [
    { label: 'Visitors', value: 10000, color: '#3b82f6' },
    { label: 'Product Views', value: 6500, color: '#8b5cf6' },
    { label: 'Add to Cart', value: 3200, color: '#f59e0b' },
    { label: 'Checkout', value: 1800, color: '#10b981' },
    { label: 'Purchase', value: 850, color: '#ef4444' },
  ],

  // Heatmap Data (7 days x 24 hours)
  heatmapData: Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => ({
      day,
      hour,
      value: Math.floor(Math.random() * 100),
    }))).flat(),

  // Sparklines
  sparklines: [
    { label: 'Visitors', data: Array.from({ length: 14 }, () => Math.floor(Math.random() * 100) + 50), color: '#3b82f6' },
    { label: 'Conversions', data: Array.from({ length: 14 }, () => Math.floor(Math.random() * 30) + 10), color: '#10b981' },
    { label: 'Bounce Rate', data: Array.from({ length: 14 }, () => Math.floor(Math.random() * 20) + 30), color: '#ef4444' },
    { label: 'Duration', data: Array.from({ length: 14 }, () => Math.floor(Math.random() * 60) + 120), color: '#8b5cf6' },
  ],

  // Device Breakdown
  devices: [
    { type: 'desktop', count: 12847, percentage: 0.52 },
    { type: 'mobile', count: 9234, percentage: 0.37 },
    { type: 'tablet', count: 2766, percentage: 0.11 },
  ],

  // Browser Breakdown
  browsers: [
    { name: 'Chrome', count: 14523, percentage: 0.58, icon: 'chrome' },
    { name: 'Safari', count: 5234, percentage: 0.21, icon: 'safari' },
    { name: 'Firefox', count: 2847, percentage: 0.11, icon: 'firefox' },
    { name: 'Edge', count: 1823, percentage: 0.07, icon: 'edge' },
    { name: 'Other', count: 420, percentage: 0.03, icon: 'globe' },
  ],

  // OS Breakdown
  operatingSystems: [
    { name: 'Windows', count: 10234, percentage: 0.41 },
    { name: 'macOS', count: 7823, percentage: 0.31 },
    { name: 'iOS', count: 4234, percentage: 0.17 },
    { name: 'Android', count: 2134, percentage: 0.09 },
    { name: 'Linux', count: 422, percentage: 0.02 },
  ],

  // Country List
  countryList: [
    { name: 'United States', code: 'US', visitors: 8234, percentage: 0.33 },
    { name: 'United Kingdom', code: 'GB', visitors: 3456, percentage: 0.14 },
    { name: 'Germany', code: 'DE', visitors: 2847, percentage: 0.11 },
    { name: 'France', code: 'FR', visitors: 2134, percentage: 0.09 },
    { name: 'Canada', code: 'CA', visitors: 1823, percentage: 0.07 },
    { name: 'Australia', code: 'AU', visitors: 1234, percentage: 0.05 },
    { name: 'Japan', code: 'JP', visitors: 987, percentage: 0.04 },
    { name: 'Brazil', code: 'BR', visitors: 756, percentage: 0.03 },
  ],

  // Campaigns
  campaigns: [
    { name: 'Summer Sale', source: 'google', medium: 'cpc', visitors: 3456, conversions: 234, conversionRate: 0.068, revenue: 12340 },
    { name: 'Newsletter', source: 'email', medium: 'email', visitors: 2134, conversions: 187, conversionRate: 0.088, revenue: 8923 },
    { name: 'Social Launch', source: 'facebook', medium: 'social', visitors: 1823, conversions: 98, conversionRate: 0.054, revenue: 4521 },
    { name: 'Retargeting', source: 'google', medium: 'display', visitors: 1234, conversions: 76, conversionRate: 0.062, revenue: 3456 },
  ],

  // Top Pages
  topPages: [
    { name: '/home', value: 12847, change: 0.12 },
    { name: '/products', value: 8923, change: 0.08 },
    { name: '/products/widget', value: 5634, change: 0.24 },
    { name: '/about', value: 4521, change: -0.05 },
    { name: '/blog', value: 3847, change: 0.15 },
    { name: '/contact', value: 2134, change: 0.03 },
    { name: '/pricing', value: 1823, change: 0.18 },
    { name: '/docs', value: 1456, change: 0.09 },
  ],

  // Top Referrers
  topReferrers: [
    { name: 'google.com', value: 8234, change: 0.15 },
    { name: 'twitter.com', value: 3456, change: 0.22 },
    { name: 'facebook.com', value: 2847, change: -0.08 },
    { name: 'linkedin.com', value: 1823, change: 0.12 },
    { name: 'reddit.com', value: 1234, change: 0.45 },
    { name: 'github.com', value: 987, change: 0.08 },
  ],

  // Table Data
  tableColumns: [
    { key: 'page', label: 'Page', sortable: true },
    { key: 'visitors', label: 'Visitors', sortable: true, align: 'right' as const },
    { key: 'pageViews', label: 'Page Views', sortable: true, align: 'right' as const },
    { key: 'bounceRate', label: 'Bounce Rate', sortable: true, align: 'right' as const },
    { key: 'avgDuration', label: 'Avg. Duration', sortable: true, align: 'right' as const },
  ],
  tableRows: [
    { page: '/home', visitors: 12847, pageViews: 24532, bounceRate: '38.2%', avgDuration: '2m 45s' },
    { page: '/products', visitors: 8923, pageViews: 15234, bounceRate: '42.1%', avgDuration: '3m 12s' },
    { page: '/about', visitors: 5634, pageViews: 7823, bounceRate: '52.3%', avgDuration: '1m 34s' },
    { page: '/blog', visitors: 4521, pageViews: 12847, bounceRate: '35.6%', avgDuration: '4m 56s' },
    { page: '/contact', visitors: 2134, pageViews: 3456, bounceRate: '48.7%', avgDuration: '1m 23s' },
  ],

  // Page Detail
  pageDetail: {
    path: '/products/widget-pro',
    title: 'Widget Pro - Premium Analytics Widget',
    pageViews: 12847,
    uniquePageViews: 8923,
    avgTimeOnPage: 234000,
    bounceRate: 0.382,
    exitRate: 0.456,
    entrances: 5634,
    exits: 5823,
    change: 0.15,
  },

  // Goals
  goals: [
    { id: '1', name: 'Sign Up', conversions: 847, conversionRate: 0.034, value: 8470, target: 1000 },
    { id: '2', name: 'Purchase', conversions: 234, conversionRate: 0.0094, value: 23400, target: 300 },
    { id: '3', name: 'Newsletter', conversions: 1234, conversionRate: 0.05, value: 0, target: 1500 },
    { id: '4', name: 'Contact Form', conversions: 456, conversionRate: 0.018, value: 0, target: 500 },
  ],

  // Engagement Metrics
  engagementMetrics: {
    avgSessionDuration: 234000,
    pagesPerSession: 3.4,
    bounceRate: 0.423,
    returningVisitors: 0.34,
    newVisitors: 0.66,
    engagedSessions: 0.72,
  },

  // Live Activity
  activities: [
    { id: '1', type: 'pageview' as const, page: '/products', country: 'United States', countryCode: 'US', device: 'desktop' as const, timestamp: new Date() },
    { id: '2', type: 'conversion' as const, eventName: 'Sign Up', country: 'Germany', countryCode: 'DE', device: 'mobile' as const, timestamp: new Date(Date.now() - 15000), value: 10 },
    { id: '3', type: 'event' as const, eventName: 'Add to Cart', country: 'United Kingdom', countryCode: 'GB', device: 'tablet' as const, timestamp: new Date(Date.now() - 30000) },
    { id: '4', type: 'session_start' as const, country: 'France', countryCode: 'FR', device: 'desktop' as const, timestamp: new Date(Date.now() - 45000) },
    { id: '5', type: 'pageview' as const, page: '/blog/analytics-tips', country: 'Canada', countryCode: 'CA', device: 'mobile' as const, timestamp: new Date(Date.now() - 60000) },
  ],

  // Alerts
  alerts: [
    { id: '1', title: 'Traffic Spike', message: 'Visitor count increased by 150% in the last hour.', type: 'success' as const, timestamp: new Date() },
    { id: '2', title: 'High Bounce Rate', message: '/landing page has 75% bounce rate today.', type: 'warning' as const, timestamp: new Date(Date.now() - 3600000) },
  ],

  // Filters
  filters: [
    { id: 'device', label: 'Device', options: ['All', 'Desktop', 'Mobile', 'Tablet'], value: 'All' },
    { id: 'country', label: 'Country', options: ['All', 'United States', 'United Kingdom', 'Germany'], value: 'All' },
    { id: 'source', label: 'Source', options: ['All', 'Direct', 'Organic', 'Social', 'Referral'], value: 'All' },
  ],

  // Helper arrays
  pages: ['/home', '/products', '/about', '/blog', '/contact', '/pricing', '/docs'],
  countries: [
    { name: 'United States', code: 'US' },
    { name: 'United Kingdom', code: 'GB' },
    { name: 'Germany', code: 'DE' },
    { name: 'France', code: 'FR' },
    { name: 'Canada', code: 'CA' },
  ],
}

export default mockData
