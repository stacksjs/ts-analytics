// API response types - inferred from dashboard fetch calls

import type { Goal, AnalyticsEvent, Session, ErrorItem, ErrorStatuses, Funnel, Vital, BudgetViolation, FlowData, LiveActivity, Insight, ComparisonStats, Referrer, ApiKey, Alert, EmailReport, UptimeMonitor, TeamMember, Webhook, PerfBudget } from './analytics'

export interface GoalsResponse {
  goals?: Goal[]
}

export interface EventsResponse {
  events?: AnalyticsEvent[]
}

export interface SessionsResponse {
  sessions?: Session[]
}

export interface ErrorsResponse {
  errors?: ErrorItem[]
}

export interface ErrorStatusesResponse {
  statuses?: ErrorStatuses
}

export interface FunnelsResponse {
  funnels?: Funnel[]
}

export interface VitalsResponse {
  vitals?: Vital[]
}

export interface BudgetViolationsResponse {
  violations?: BudgetViolation[]
}

export interface FlowResponse extends FlowData {}

export interface LiveResponse {
  activities?: LiveActivity[]
}

export interface InsightsResponse {
  insights?: Insight[]
}

export interface ComparisonResponse extends ComparisonStats {}

export interface ReferrersResponse {
  referrers?: Referrer[]
}

export interface ApiKeysResponse {
  apiKey?: ApiKey
}

export interface AlertsResponse {
  alerts?: Alert[]
}

export interface EmailReportsResponse {
  reports?: EmailReport[]
}

export interface UptimeResponse {
  monitors?: UptimeMonitor[]
}

export interface TeamResponse {
  members?: TeamMember[]
}

export interface WebhooksResponse {
  webhooks?: Webhook[]
}

export interface PerfBudgetsResponse {
  budgets?: PerfBudget[]
}

export interface RetentionResponse {
  days?: number
}
