/**
 * Router configuration using bun-router
 *
 * This file defines all API routes for the analytics service.
 */

import { Router } from 'bun-router'

// Import handlers
import * as stats from './handlers/stats'
import * as goals from './handlers/goals'
import * as sessions from './handlers/sessions'
import * as heatmaps from './handlers/heatmaps'
import * as errors from './handlers/errors'
import * as performance from './handlers/performance'
import * as funnels from './handlers/funnels'
import * as annotations from './handlers/annotations'
import * as experiments from './handlers/experiments'
import * as alerts from './handlers/alerts'
import * as apiKeys from './handlers/api-keys'
import * as uptime from './handlers/uptime'
import * as webhooks from './handlers/webhooks'
import * as team from './handlers/team'
import * as data from './handlers/data'
import * as sharing from './handlers/sharing'
import * as collect from './handlers/collect'
import * as misc from './handlers/misc'
import * as views from './handlers/views'

/**
 * Create and configure the router with all routes
 */
export function createRouter(): Router {
  const router = new Router()

  // Health check
  router.get('/health', misc.handleHealth)

  // HTML pages
  router.get('/', views.handleDashboard)
  router.get('/dashboard', views.handleDashboard)
  router.get('/test-errors', views.handleTestErrors)
  router.get('/errors/:errorId', (req) => {
    const errorId = decodeURIComponent(req.params.errorId)
    return views.handleErrorDetailPage(req, errorId)
  })
  router.get('/dashboard/:section', (req) => {
    const section = req.params.section
    return views.handleDetailPage(req, section)
  })

  // Collection endpoints
  router.post('/collect', collect.handleCollect)
  router.post('/t', collect.handleCollect)

  // Script serving
  router.get('/sites/:siteId/script', views.handleScript)

  // Sites list
  router.get('/api/sites', misc.handleGetSites)

  // Share link validation
  router.get('/api/share/:token', (req) => sharing.handleGetSharedDashboard(req, req.params.token))

  // Site-specific API routes
  // Stats & Analytics
  router.get('/api/sites/:siteId/stats', (req) => stats.handleGetStats(req, req.params.siteId))
  router.get('/api/sites/:siteId/realtime', (req) => stats.handleGetRealtime(req, req.params.siteId))
  router.get('/api/sites/:siteId/pages', (req) => stats.handleGetPages(req, req.params.siteId))
  router.get('/api/sites/:siteId/referrers', (req) => stats.handleGetReferrers(req, req.params.siteId))
  router.get('/api/sites/:siteId/devices', (req) => stats.handleGetDevices(req, req.params.siteId))
  router.get('/api/sites/:siteId/browsers', (req) => stats.handleGetBrowsers(req, req.params.siteId))
  router.get('/api/sites/:siteId/countries', (req) => stats.handleGetCountries(req, req.params.siteId))
  router.get('/api/sites/:siteId/regions', (req) => stats.handleGetRegions(req, req.params.siteId))
  router.get('/api/sites/:siteId/cities', (req) => stats.handleGetCities(req, req.params.siteId))
  router.get('/api/sites/:siteId/timeseries', (req) => stats.handleGetTimeSeries(req, req.params.siteId))
  router.get('/api/sites/:siteId/events', (req) => stats.handleGetEvents(req, req.params.siteId))
  router.get('/api/sites/:siteId/campaigns', (req) => stats.handleGetCampaigns(req, req.params.siteId))
  router.get('/api/sites/:siteId/comparison', (req) => stats.handleGetComparison(req, req.params.siteId))

  // Goals
  router.get('/api/sites/:siteId/goals/stats', (req) => goals.handleGetGoalStats(req, req.params.siteId))
  router.get('/api/sites/:siteId/goals', (req) => goals.handleGetGoals(req, req.params.siteId))
  router.post('/api/sites/:siteId/goals', (req) => goals.handleCreateGoal(req, req.params.siteId))
  router.put('/api/sites/:siteId/goals/:goalId', (req) => goals.handleUpdateGoal(req, req.params.siteId, req.params.goalId))
  router.delete('/api/sites/:siteId/goals/:goalId', (req) => goals.handleDeleteGoal(req, req.params.siteId, req.params.goalId))

  // Sessions
  router.get('/api/sites/:siteId/sessions', (req) => sessions.handleGetSessions(req, req.params.siteId))
  router.get('/api/sites/:siteId/sessions/:sessionId', (req) => sessions.handleGetSessionDetail(req, req.params.siteId, req.params.sessionId))
  router.get('/api/sites/:siteId/flow', (req) => sessions.handleGetUserFlow(req, req.params.siteId))
  router.get('/api/sites/:siteId/entry-exit', (req) => sessions.handleGetEntryExitPages(req, req.params.siteId))
  router.get('/api/sites/:siteId/live', (req) => sessions.handleGetLiveView(req, req.params.siteId))

  // Heatmaps
  router.get('/api/sites/:siteId/heatmap/clicks', (req) => heatmaps.handleGetHeatmapClicks(req, req.params.siteId))
  router.get('/api/sites/:siteId/heatmap/scroll', (req) => heatmaps.handleGetHeatmapScroll(req, req.params.siteId))
  router.get('/api/sites/:siteId/heatmap/pages', (req) => heatmaps.handleGetHeatmapPages(req, req.params.siteId))

  // Errors
  router.get('/api/sites/:siteId/errors', (req) => errors.handleGetErrors(req, req.params.siteId))
  router.get('/api/sites/:siteId/errors/statuses', (req) => errors.handleGetErrorStatuses(req, req.params.siteId))
  router.post('/api/sites/:siteId/errors/status', (req) => errors.handleUpdateErrorStatus(req, req.params.siteId))

  // Performance & Vitals
  router.get('/api/sites/:siteId/vitals', (req) => performance.handleGetVitals(req, req.params.siteId))
  router.get('/api/sites/:siteId/vitals-trends', (req) => performance.handleGetVitalsTrends(req, req.params.siteId))
  router.get('/api/sites/:siteId/performance-budgets', (req) => performance.handleGetPerformanceBudgets(req, req.params.siteId))
  router.get('/api/sites/:siteId/performance-budgets/check', (req) => performance.handleCheckPerformanceBudgets(req, req.params.siteId))
  router.post('/api/sites/:siteId/performance-budgets', (req) => performance.handleCreatePerformanceBudget(req, req.params.siteId))
  router.delete('/api/sites/:siteId/performance-budgets/:budgetId', (req) => performance.handleDeletePerformanceBudget(req, req.params.siteId, req.params.budgetId))

  // Funnels
  router.get('/api/sites/:siteId/funnels', (req) => funnels.handleGetFunnels(req, req.params.siteId))
  router.get('/api/sites/:siteId/funnels/:funnelId', (req) => funnels.handleGetFunnelAnalysis(req, req.params.siteId, req.params.funnelId))
  router.post('/api/sites/:siteId/funnels', (req) => funnels.handleCreateFunnel(req, req.params.siteId))
  router.delete('/api/sites/:siteId/funnels/:funnelId', (req) => funnels.handleDeleteFunnel(req, req.params.siteId, req.params.funnelId))

  // Annotations
  router.get('/api/sites/:siteId/annotations', (req) => annotations.handleGetAnnotations(req, req.params.siteId))
  router.post('/api/sites/:siteId/annotations', (req) => annotations.handleCreateAnnotation(req, req.params.siteId))
  router.delete('/api/sites/:siteId/annotations/:annotationId', (req) => annotations.handleDeleteAnnotation(req, req.params.siteId, req.params.annotationId))

  // Experiments
  router.get('/api/sites/:siteId/experiments', (req) => experiments.handleGetExperiments(req, req.params.siteId))
  router.post('/api/sites/:siteId/experiments', (req) => experiments.handleCreateExperiment(req, req.params.siteId))
  router.post('/api/sites/:siteId/experiments/event', (req) => experiments.handleRecordExperimentEvent(req, req.params.siteId))

  // Alerts
  router.get('/api/sites/:siteId/alerts', (req) => alerts.handleGetAlerts(req, req.params.siteId))
  router.post('/api/sites/:siteId/alerts', (req) => alerts.handleCreateAlert(req, req.params.siteId))
  router.delete('/api/sites/:siteId/alerts/:alertId', (req) => alerts.handleDeleteAlert(req, req.params.siteId, req.params.alertId))

  // Email Reports
  router.get('/api/sites/:siteId/email-reports', (req) => alerts.handleGetEmailReports(req, req.params.siteId))
  router.post('/api/sites/:siteId/email-reports', (req) => alerts.handleCreateEmailReport(req, req.params.siteId))
  router.delete('/api/sites/:siteId/email-reports/:reportId', (req) => alerts.handleDeleteEmailReport(req, req.params.siteId, req.params.reportId))

  // API Keys
  router.get('/api/sites/:siteId/api-keys', (req) => apiKeys.handleGetApiKeys(req, req.params.siteId))
  router.post('/api/sites/:siteId/api-keys', (req) => apiKeys.handleCreateApiKey(req, req.params.siteId))
  router.delete('/api/sites/:siteId/api-keys/:keyId', (req) => apiKeys.handleDeleteApiKey(req, req.params.siteId, req.params.keyId))

  // Uptime Monitoring
  router.get('/api/sites/:siteId/uptime', (req) => uptime.handleGetUptimeMonitors(req, req.params.siteId))
  router.get('/api/sites/:siteId/uptime/:monitorId/history', (req) => uptime.handleGetUptimeHistory(req, req.params.siteId, req.params.monitorId))
  router.post('/api/sites/:siteId/uptime', (req) => uptime.handleCreateUptimeMonitor(req, req.params.siteId))
  router.delete('/api/sites/:siteId/uptime/:monitorId', (req) => uptime.handleDeleteUptimeMonitor(req, req.params.siteId, req.params.monitorId))

  // Webhooks
  router.get('/api/sites/:siteId/webhooks', (req) => webhooks.handleGetWebhooks(req, req.params.siteId))
  router.post('/api/sites/:siteId/webhooks', (req) => webhooks.handleCreateWebhook(req, req.params.siteId))
  router.delete('/api/sites/:siteId/webhooks/:webhookId', (req) => webhooks.handleDeleteWebhook(req, req.params.siteId, req.params.webhookId))

  // Team Management
  router.get('/api/sites/:siteId/team', (req) => team.handleGetTeamMembers(req, req.params.siteId))
  router.post('/api/sites/:siteId/team', (req) => team.handleInviteTeamMember(req, req.params.siteId))
  router.delete('/api/sites/:siteId/team/:memberId', (req) => team.handleRemoveTeamMember(req, req.params.siteId, req.params.memberId))

  // Data Export & Retention
  router.get('/api/sites/:siteId/export', (req) => data.handleExport(req, req.params.siteId))
  router.get('/api/sites/:siteId/retention', (req) => data.handleGetRetentionSettings(req, req.params.siteId))
  router.put('/api/sites/:siteId/retention', (req) => data.handleUpdateRetentionSettings(req, req.params.siteId))

  // GDPR
  router.get('/api/sites/:siteId/gdpr/export', (req) => data.handleGdprExport(req, req.params.siteId))
  router.post('/api/sites/:siteId/gdpr/delete', (req) => data.handleGdprDelete(req, req.params.siteId))

  // Insights
  router.get('/api/sites/:siteId/insights', (req) => data.handleGetInsights(req, req.params.siteId))

  // Revenue
  router.get('/api/sites/:siteId/revenue', (req) => misc.handleGetRevenue(req, req.params.siteId))

  // Share Links
  router.post('/api/sites/:siteId/share', (req) => sharing.handleCreateShareLink(req, req.params.siteId))

  return router
}

// Export a singleton router instance
export const router = createRouter()
