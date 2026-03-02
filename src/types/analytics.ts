// Core analytics types - extracted from component inline definitions

export interface Goal {
  id: string
  name: string
  type: string
  pattern?: string
  matchType?: string
  durationMinutes?: number
  value?: number
  isActive: boolean
  conversions?: number
  conversionRate?: number
}

export interface GoalFormData {
  name: string
  type: string
  pattern: string
  matchType: string
  durationMinutes?: number
  value?: number
  isActive: boolean
}

export interface AnalyticsEvent {
  name: string
  count?: number
}

export interface Session {
  id: string
  sessionId: string
  entryPage: string
  entryPath: string
  startTime: string
  startedAt: string
  pageViews: number
  pageViewCount: number
  duration: number
  bounced: boolean
  isBounce: boolean
  browser: string
  country: string
}

export interface PageView {
  path: string
}

export interface SessionEvent {
  type: string
  name: string
  path: string
  message: string
  timestamp: string
}

export interface SessionDetail {
  pageViewCount: number
  pageViews: PageView[]
  duration: number
  browser: string
  country: string
  events: SessionEvent[]
}

export interface ErrorItem {
  errorId: string
  fingerprint: string
  message: string
  count: number
  severity: string
  category: string
  source: string
  line: number
  lastSeen: string
  firstSeen: string
  browsers: string[]
}

export interface ErrorStatusEntry {
  status: string
}

export interface ErrorStatuses {
  [fingerprint: string]: ErrorStatusEntry
}

export interface StatusCounts {
  new: number
  resolved: number
  ignored: number
  [key: string]: number
}

export interface SeverityCounts {
  critical: number
  high: number
  medium: number
  low: number
  [key: string]: number
}

export interface Funnel {
  id: string
  name: string
  steps: string[]
}

export interface FunnelAnalysisStep {
  path: string
  visitors: number
  rate: number
  dropoff: number
}

export interface FunnelAnalysis {
  name: string
  totalVisitors: number
  conversionRate: number
  steps: FunnelAnalysisStep[]
}

export interface Vital {
  metric: string
  p75: number
  samples: number
  good: number
  needsImprovement: number
  poor: number
}

export interface BudgetViolation {
  metric: string
  currentValue: number
  threshold: number
  exceededBy: number
}

export interface FlowPage {
  path: string
  count: number
}

export interface FlowLink {
  source: string
  target: string
  count: number
}

export interface FlowData {
  entryPages: FlowPage[]
  flows: FlowLink[]
  mostVisited: FlowPage[]
  totalSessions: number
  uniquePaths: number
}

export interface LiveActivity {
  path: string
  country: string
  device: string
  browser: string
  timestamp: string
}

export interface Insight {
  title: string
  description: string
  type: string
  severity: string
}

export interface ComparisonStats {
  thisWeekViews: number
  lastWeekViews: number
  change: number
  sessions: number
  bounceRate: number
}

export interface Referrer {
  name: string
  source?: string
  visitors: number
  views?: number
  favicon?: string
}

// Settings types
export interface ApiKey {
  name: string
  key: string
}

export interface Alert {
  id: string
  metric: string
  threshold: number
  email: string
}

export interface EmailReport {
  id: string
  email: string
  frequency: string
}

export interface UptimeMonitor {
  id: string
  url: string
  interval: number
  status: string
}

export interface TeamMember {
  id: string
  email: string
  role: string
}

export interface Webhook {
  id: string
  url: string
  events: string[]
}

export interface PerfBudget {
  id: string
  metric: string
  threshold: number
}

export interface SiteSettings {
  apiKey: ApiKey | null
  alerts: Alert[]
  emailReports: EmailReport[]
  uptimeMonitors: UptimeMonitor[]
  teamMembers: TeamMember[]
  webhooks: Webhook[]
  perfBudgets: PerfBudget[]
  retentionDays: number
}
