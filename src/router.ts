/**
 * Router configuration using bun-router
 *
 * This file defines all API routes for the analytics service.
 * Note: bun-router uses {param} syntax for route parameters, not :param
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
export async function createRouter(): Promise<Router> {
  const router = new Router()

  // Health check
  await router.get('/health', misc.handleHealth)

  // Favicon (return empty to prevent 404)
  await router.get('/favicon.ico', () => new Response(null, { status: 204 }))

  // HTML pages
  await router.get('/', views.handleDashboard)
  await router.get('/dashboard', views.handleDashboard)
  await router.get('/test-errors', views.handleTestErrors)
  await router.get('/errors/{errorId}', (req) => {
    const errorId = decodeURIComponent(req.params.errorId)
    return views.handleErrorDetailPage(req, errorId)
  })
  await router.get('/dashboard/{section}', (req) => {
    const section = req.params.section
    return views.handleDetailPage(req, section)
  })

  // Collection endpoints
  await router.post('/collect', collect.handleCollect)
  await router.post('/t', collect.handleCollect)

  // Script serving
  await router.get('/sites/{siteId}/script', (req) => views.handleScript(req, req.params.siteId))

  // Sites list and creation
  await router.get('/api/sites', misc.handleGetSites)
  await router.post('/api/sites', misc.handleCreateSite)

  // Share link validation
  await router.get('/api/share/{token}', (req) => sharing.handleGetSharedDashboard(req, req.params.token))

  // Site-specific API routes
  // Stats & Analytics
  await router.get('/api/sites/{siteId}/stats', (req) => stats.handleGetStats(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/realtime', (req) => stats.handleGetRealtime(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/pages', (req) => stats.handleGetPages(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/referrers', (req) => stats.handleGetReferrers(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/devices', (req) => stats.handleGetDevices(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/browsers', (req) => stats.handleGetBrowsers(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/countries', (req) => stats.handleGetCountries(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/regions', (req) => stats.handleGetRegions(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/cities', (req) => stats.handleGetCities(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/timeseries', (req) => stats.handleGetTimeSeries(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/events', (req) => stats.handleGetEvents(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/campaigns', (req) => stats.handleGetCampaigns(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/comparison', (req) => stats.handleGetComparison(req, req.params.siteId))

  // Goals
  await router.get('/api/sites/{siteId}/goals/stats', (req) => goals.handleGetGoalStats(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/goals', (req) => goals.handleGetGoals(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/goals', (req) => goals.handleCreateGoal(req, req.params.siteId))
  await router.put('/api/sites/{siteId}/goals/{goalId}', (req) => goals.handleUpdateGoal(req, req.params.siteId, req.params.goalId))
  await router.delete('/api/sites/{siteId}/goals/{goalId}', (req) => goals.handleDeleteGoal(req, req.params.siteId, req.params.goalId))

  // Sessions
  await router.get('/api/sites/{siteId}/sessions', (req) => sessions.handleGetSessions(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/sessions/{sessionId}', (req) => sessions.handleGetSessionDetail(req, req.params.siteId, req.params.sessionId))
  await router.get('/api/sites/{siteId}/flow', (req) => sessions.handleGetUserFlow(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/entry-exit', (req) => sessions.handleGetEntryExitPages(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/live', (req) => sessions.handleGetLiveView(req, req.params.siteId))

  // Heatmaps
  await router.get('/api/sites/{siteId}/heatmap/clicks', (req) => heatmaps.handleGetHeatmapClicks(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/heatmap/scroll', (req) => heatmaps.handleGetHeatmapScroll(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/heatmap/pages', (req) => heatmaps.handleGetHeatmapPages(req, req.params.siteId))

  // Errors
  await router.get('/api/sites/{siteId}/errors', (req) => errors.handleGetErrors(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/statuses', (req) => errors.handleGetErrorStatuses(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/errors/status', (req) => errors.handleUpdateErrorStatus(req, req.params.siteId))

  // Performance & Vitals
  await router.get('/api/sites/{siteId}/vitals', (req) => performance.handleGetVitals(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/vitals-trends', (req) => performance.handleGetVitalsTrends(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/performance-budgets', (req) => performance.handleGetPerformanceBudgets(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/performance-budgets/check', (req) => performance.handleCheckPerformanceBudgets(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/performance-budgets', (req) => performance.handleCreatePerformanceBudget(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/performance-budgets/{budgetId}', (req) => performance.handleDeletePerformanceBudget(req, req.params.siteId, req.params.budgetId))

  // Funnels
  await router.get('/api/sites/{siteId}/funnels', (req) => funnels.handleGetFunnels(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/funnels/{funnelId}', (req) => funnels.handleGetFunnelAnalysis(req, req.params.siteId, req.params.funnelId))
  await router.post('/api/sites/{siteId}/funnels', (req) => funnels.handleCreateFunnel(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/funnels/{funnelId}', (req) => funnels.handleDeleteFunnel(req, req.params.siteId, req.params.funnelId))

  // Annotations
  await router.get('/api/sites/{siteId}/annotations', (req) => annotations.handleGetAnnotations(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/annotations', (req) => annotations.handleCreateAnnotation(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/annotations/{annotationId}', (req) => annotations.handleDeleteAnnotation(req, req.params.siteId, req.params.annotationId))

  // Experiments
  await router.get('/api/sites/{siteId}/experiments', (req) => experiments.handleGetExperiments(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/experiments', (req) => experiments.handleCreateExperiment(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/experiments/event', (req) => experiments.handleRecordExperimentEvent(req, req.params.siteId))

  // Alerts
  await router.get('/api/sites/{siteId}/alerts', (req) => alerts.handleGetAlerts(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/alerts', (req) => alerts.handleCreateAlert(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/alerts/{alertId}', (req) => alerts.handleDeleteAlert(req, req.params.siteId, req.params.alertId))

  // Email Reports
  await router.get('/api/sites/{siteId}/email-reports', (req) => alerts.handleGetEmailReports(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/email-reports', (req) => alerts.handleCreateEmailReport(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/email-reports/{reportId}', (req) => alerts.handleDeleteEmailReport(req, req.params.siteId, req.params.reportId))

  // API Keys
  await router.get('/api/sites/{siteId}/api-keys', (req) => apiKeys.handleGetApiKeys(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/api-keys', (req) => apiKeys.handleCreateApiKey(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/api-keys/{keyId}', (req) => apiKeys.handleDeleteApiKey(req, req.params.siteId, req.params.keyId))

  // Uptime Monitoring
  await router.get('/api/sites/{siteId}/uptime', (req) => uptime.handleGetUptimeMonitors(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/uptime/{monitorId}/history', (req) => uptime.handleGetUptimeHistory(req, req.params.siteId, req.params.monitorId))
  await router.post('/api/sites/{siteId}/uptime', (req) => uptime.handleCreateUptimeMonitor(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/uptime/{monitorId}', (req) => uptime.handleDeleteUptimeMonitor(req, req.params.siteId, req.params.monitorId))

  // Webhooks
  await router.get('/api/sites/{siteId}/webhooks', (req) => webhooks.handleGetWebhooks(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/webhooks', (req) => webhooks.handleCreateWebhook(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/webhooks/{webhookId}', (req) => webhooks.handleDeleteWebhook(req, req.params.siteId, req.params.webhookId))

  // Team Management
  await router.get('/api/sites/{siteId}/team', (req) => team.handleGetTeamMembers(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/team', (req) => team.handleInviteTeamMember(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/team/{memberId}', (req) => team.handleRemoveTeamMember(req, req.params.siteId, req.params.memberId))

  // Data Export & Retention
  await router.get('/api/sites/{siteId}/export', (req) => data.handleExport(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/retention', (req) => data.handleGetRetentionSettings(req, req.params.siteId))
  await router.put('/api/sites/{siteId}/retention', (req) => data.handleUpdateRetentionSettings(req, req.params.siteId))

  // GDPR
  await router.get('/api/sites/{siteId}/gdpr/export', (req) => data.handleGdprExport(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/gdpr/delete', (req) => data.handleGdprDelete(req, req.params.siteId))

  // Insights
  await router.get('/api/sites/{siteId}/insights', (req) => data.handleGetInsights(req, req.params.siteId))

  // Revenue
  await router.get('/api/sites/{siteId}/revenue', (req) => misc.handleGetRevenue(req, req.params.siteId))

  // Share Links
  await router.post('/api/sites/{siteId}/share', (req) => sharing.handleCreateShareLink(req, req.params.siteId))

  return router
}

// Export a singleton router instance (using top-level await)
export const router = await createRouter()
