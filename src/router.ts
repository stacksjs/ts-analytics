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
 * Stealth API path mapping
 * These use innocuous names to bypass content blockers
 * /api/p/ = "project" (instead of /api/sites/)
 */
const STEALTH_PATHS = {
  // Analytics data
  stats: 'summary',
  realtime: 'pulse',
  pages: 'content',
  referrers: 'sources',
  devices: 'clients',
  browsers: 'agents',
  countries: 'geo',
  regions: 'area',
  cities: 'locale',
  timeseries: 'series',
  events: 'actions',
  campaigns: 'promo',
  comparison: 'diff',
  // User behavior
  sessions: 'visits',
  flow: 'journey',
  'entry-exit': 'endpoints',
  live: 'now',
  // Heatmaps
  heatmap: 'touch',
  // Errors
  errors: 'issues',
  // Performance
  vitals: 'metrics',
  'vitals-trends': 'metrics-trends',
  'performance-budgets': 'budgets',
  // Goals
  goals: 'targets',
  // Funnels
  funnels: 'pipelines',
  // Other
  annotations: 'notes',
  experiments: 'tests',
  alerts: 'notifications',
  'email-reports': 'scheduled',
  'api-keys': 'tokens',
  uptime: 'monitors',
  webhooks: 'hooks',
  team: 'members',
  export: 'download',
  retention: 'storage',
  gdpr: 'privacy',
  insights: 'intel',
  revenue: 'income',
  share: 'link',
}

/**
 * Create and configure the router with all routes
 */
export async function createRouter(): Promise<Router> {
  const router = new Router()

  // Health check
  await router.get('/health', misc.handleHealth)

  // Favicon (return empty to prevent 404)
  await router.get('/favicon.ico', () => new Response(null, { status: 204 }))

  // Serve compiled dashboard script
  await router.get('/scripts/dashboard.js', async () => {
    // Try multiple locations for the compiled script
    const locations = [
      '/var/task/views/scripts/dashboard.js', // Lambda
      './dist/views/scripts/dashboard.js',    // Local dev
      './views/scripts/dashboard.js',         // Alternative
    ]

    for (const loc of locations) {
      try {
        const file = Bun.file(loc)
        if (await file.exists()) {
          return new Response(await file.text(), {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'public, max-age=31536000',
            },
          })
        }
      } catch {
        // Try next location
      }
    }

    return new Response('// Script not found', {
      status: 404,
      headers: { 'Content-Type': 'application/javascript' },
    })
  })

  // HTML pages
  await router.get('/', views.handleDashboard)
  await router.get('/dashboard', views.handleDashboard)
  await router.get('/dashboard/{tab}', (req) => views.handleDashboardTab(req, req.params.tab))
  await router.get('/test-errors', views.handleTestErrors)
  await router.get('/errors/{errorId}', (req) => {
    const errorId = decodeURIComponent(req.params.errorId)
    return views.handleErrorDetailPage(req, errorId)
  })

  // Collection endpoints
  await router.post('/collect', collect.handleCollect)
  await router.post('/t', collect.handleCollect)

  // Error collection (SDK endpoint with token auth)
  await router.post('/errors/collect', async (req) => {
    const auth = await apiKeys.handleValidateApiKey(req, 'error-tracking')
    if (!auth.valid || !auth.siteId || !auth.keyId) {
      return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return errors.handleCollectError(req, auth.siteId, auth.keyId)
  })

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
  await router.get('/api/sites/{siteId}/errors/timeseries', (req) => errors.handleGetErrorTimeseries(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/comparison', (req) => errors.handleGetErrorComparison(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/groups', (req) => errors.handleGetErrorGroups(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/alerts', (req) => errors.handleGetErrorAlerts(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/errors/alerts', (req) => errors.handleCreateErrorAlert(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/errors/alerts/evaluate', (req) => errors.handleEvaluateErrorAlerts(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/{errorId}', (req) => errors.handleGetErrorDetail(req, req.params.siteId, req.params.errorId))

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

  // ============================================
  // STEALTH ROUTES - Bypass content blockers
  // Uses /api/p/ ("project") with innocuous names
  // ============================================

  // Collection endpoints (stealth)
  await router.post('/t', collect.handleCollect) // Already defined above, but /t is short
  await router.post('/p', collect.handleCollect) // Even shorter alias

  // Issue collection (stealth for errors/collect)
  await router.post('/issues/report', async (req) => {
    const auth = await apiKeys.handleValidateApiKey(req, 'error-tracking')
    if (!auth.valid || !auth.siteId || !auth.keyId) {
      return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return errors.handleCollectError(req, auth.siteId, auth.keyId)
  })

  // Sites list (stealth)
  await router.get('/api/projects', misc.handleGetSites)
  await router.post('/api/projects', misc.handleCreateSite)

  // Share link validation (stealth)
  await router.get('/api/link/{token}', (req) => sharing.handleGetSharedDashboard(req, req.params.token))

  // Site-specific stealth routes using /api/p/ prefix
  // Stats & Analytics (stealth)
  await router.get('/api/p/{siteId}/summary', (req) => stats.handleGetStats(req, req.params.siteId))
  await router.get('/api/p/{siteId}/pulse', (req) => stats.handleGetRealtime(req, req.params.siteId))
  await router.get('/api/p/{siteId}/content', (req) => stats.handleGetPages(req, req.params.siteId))
  await router.get('/api/p/{siteId}/sources', (req) => stats.handleGetReferrers(req, req.params.siteId))
  await router.get('/api/p/{siteId}/clients', (req) => stats.handleGetDevices(req, req.params.siteId))
  await router.get('/api/p/{siteId}/agents', (req) => stats.handleGetBrowsers(req, req.params.siteId))
  await router.get('/api/p/{siteId}/geo', (req) => stats.handleGetCountries(req, req.params.siteId))
  await router.get('/api/p/{siteId}/area', (req) => stats.handleGetRegions(req, req.params.siteId))
  await router.get('/api/p/{siteId}/locale', (req) => stats.handleGetCities(req, req.params.siteId))
  await router.get('/api/p/{siteId}/series', (req) => stats.handleGetTimeSeries(req, req.params.siteId))
  await router.get('/api/p/{siteId}/actions', (req) => stats.handleGetEvents(req, req.params.siteId))
  await router.get('/api/p/{siteId}/promo', (req) => stats.handleGetCampaigns(req, req.params.siteId))
  await router.get('/api/p/{siteId}/diff', (req) => stats.handleGetComparison(req, req.params.siteId))

  // Goals (stealth)
  await router.get('/api/p/{siteId}/targets/data', (req) => goals.handleGetGoalStats(req, req.params.siteId))
  await router.get('/api/p/{siteId}/targets', (req) => goals.handleGetGoals(req, req.params.siteId))
  await router.post('/api/p/{siteId}/targets', (req) => goals.handleCreateGoal(req, req.params.siteId))
  await router.put('/api/p/{siteId}/targets/{goalId}', (req) => goals.handleUpdateGoal(req, req.params.siteId, req.params.goalId))
  await router.delete('/api/p/{siteId}/targets/{goalId}', (req) => goals.handleDeleteGoal(req, req.params.siteId, req.params.goalId))

  // Sessions (stealth)
  await router.get('/api/p/{siteId}/visits', (req) => sessions.handleGetSessions(req, req.params.siteId))
  await router.get('/api/p/{siteId}/visits/{sessionId}', (req) => sessions.handleGetSessionDetail(req, req.params.siteId, req.params.sessionId))
  await router.get('/api/p/{siteId}/journey', (req) => sessions.handleGetUserFlow(req, req.params.siteId))
  await router.get('/api/p/{siteId}/endpoints', (req) => sessions.handleGetEntryExitPages(req, req.params.siteId))
  await router.get('/api/p/{siteId}/now', (req) => sessions.handleGetLiveView(req, req.params.siteId))

  // Heatmaps (stealth)
  await router.get('/api/p/{siteId}/touch/clicks', (req) => heatmaps.handleGetHeatmapClicks(req, req.params.siteId))
  await router.get('/api/p/{siteId}/touch/scroll', (req) => heatmaps.handleGetHeatmapScroll(req, req.params.siteId))
  await router.get('/api/p/{siteId}/touch/list', (req) => heatmaps.handleGetHeatmapPages(req, req.params.siteId))

  // Errors (stealth)
  await router.get('/api/p/{siteId}/issues', (req) => errors.handleGetErrors(req, req.params.siteId))
  await router.get('/api/p/{siteId}/issues/states', (req) => errors.handleGetErrorStatuses(req, req.params.siteId))
  await router.post('/api/p/{siteId}/issues/state', (req) => errors.handleUpdateErrorStatus(req, req.params.siteId))
  await router.get('/api/p/{siteId}/issues/{errorId}', (req) => errors.handleGetErrorDetail(req, req.params.siteId, req.params.errorId))

  // Performance & Vitals (stealth)
  await router.get('/api/p/{siteId}/metrics', (req) => performance.handleGetVitals(req, req.params.siteId))
  await router.get('/api/p/{siteId}/metrics-trends', (req) => performance.handleGetVitalsTrends(req, req.params.siteId))
  await router.get('/api/p/{siteId}/budgets', (req) => performance.handleGetPerformanceBudgets(req, req.params.siteId))
  await router.get('/api/p/{siteId}/budgets/check', (req) => performance.handleCheckPerformanceBudgets(req, req.params.siteId))
  await router.post('/api/p/{siteId}/budgets', (req) => performance.handleCreatePerformanceBudget(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/budgets/{budgetId}', (req) => performance.handleDeletePerformanceBudget(req, req.params.siteId, req.params.budgetId))

  // Funnels (stealth)
  await router.get('/api/p/{siteId}/pipelines', (req) => funnels.handleGetFunnels(req, req.params.siteId))
  await router.get('/api/p/{siteId}/pipelines/{funnelId}', (req) => funnels.handleGetFunnelAnalysis(req, req.params.siteId, req.params.funnelId))
  await router.post('/api/p/{siteId}/pipelines', (req) => funnels.handleCreateFunnel(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/pipelines/{funnelId}', (req) => funnels.handleDeleteFunnel(req, req.params.siteId, req.params.funnelId))

  // Annotations (stealth)
  await router.get('/api/p/{siteId}/notes', (req) => annotations.handleGetAnnotations(req, req.params.siteId))
  await router.post('/api/p/{siteId}/notes', (req) => annotations.handleCreateAnnotation(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/notes/{annotationId}', (req) => annotations.handleDeleteAnnotation(req, req.params.siteId, req.params.annotationId))

  // Experiments (stealth)
  await router.get('/api/p/{siteId}/tests', (req) => experiments.handleGetExperiments(req, req.params.siteId))
  await router.post('/api/p/{siteId}/tests', (req) => experiments.handleCreateExperiment(req, req.params.siteId))
  await router.post('/api/p/{siteId}/tests/record', (req) => experiments.handleRecordExperimentEvent(req, req.params.siteId))

  // Alerts (stealth)
  await router.get('/api/p/{siteId}/notifications', (req) => alerts.handleGetAlerts(req, req.params.siteId))
  await router.post('/api/p/{siteId}/notifications', (req) => alerts.handleCreateAlert(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/notifications/{alertId}', (req) => alerts.handleDeleteAlert(req, req.params.siteId, req.params.alertId))

  // Email Reports (stealth)
  await router.get('/api/p/{siteId}/scheduled', (req) => alerts.handleGetEmailReports(req, req.params.siteId))
  await router.post('/api/p/{siteId}/scheduled', (req) => alerts.handleCreateEmailReport(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/scheduled/{reportId}', (req) => alerts.handleDeleteEmailReport(req, req.params.siteId, req.params.reportId))

  // API Keys (stealth)
  await router.get('/api/p/{siteId}/tokens', (req) => apiKeys.handleGetApiKeys(req, req.params.siteId))
  await router.post('/api/p/{siteId}/tokens', (req) => apiKeys.handleCreateApiKey(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/tokens/{keyId}', (req) => apiKeys.handleDeleteApiKey(req, req.params.siteId, req.params.keyId))

  // Uptime Monitoring (stealth)
  await router.get('/api/p/{siteId}/monitors', (req) => uptime.handleGetUptimeMonitors(req, req.params.siteId))
  await router.get('/api/p/{siteId}/monitors/{monitorId}/history', (req) => uptime.handleGetUptimeHistory(req, req.params.siteId, req.params.monitorId))
  await router.post('/api/p/{siteId}/monitors', (req) => uptime.handleCreateUptimeMonitor(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/monitors/{monitorId}', (req) => uptime.handleDeleteUptimeMonitor(req, req.params.siteId, req.params.monitorId))

  // Webhooks (stealth)
  await router.get('/api/p/{siteId}/hooks', (req) => webhooks.handleGetWebhooks(req, req.params.siteId))
  await router.post('/api/p/{siteId}/hooks', (req) => webhooks.handleCreateWebhook(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/hooks/{webhookId}', (req) => webhooks.handleDeleteWebhook(req, req.params.siteId, req.params.webhookId))

  // Team Management (stealth)
  await router.get('/api/p/{siteId}/members', (req) => team.handleGetTeamMembers(req, req.params.siteId))
  await router.post('/api/p/{siteId}/members', (req) => team.handleInviteTeamMember(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/members/{memberId}', (req) => team.handleRemoveTeamMember(req, req.params.siteId, req.params.memberId))

  // Data Export & Retention (stealth)
  await router.get('/api/p/{siteId}/download', (req) => data.handleExport(req, req.params.siteId))
  await router.get('/api/p/{siteId}/storage', (req) => data.handleGetRetentionSettings(req, req.params.siteId))
  await router.put('/api/p/{siteId}/storage', (req) => data.handleUpdateRetentionSettings(req, req.params.siteId))

  // GDPR (stealth)
  await router.get('/api/p/{siteId}/privacy/download', (req) => data.handleGdprExport(req, req.params.siteId))
  await router.post('/api/p/{siteId}/privacy/remove', (req) => data.handleGdprDelete(req, req.params.siteId))

  // Insights (stealth)
  await router.get('/api/p/{siteId}/intel', (req) => data.handleGetInsights(req, req.params.siteId))

  // Revenue (stealth)
  await router.get('/api/p/{siteId}/income', (req) => misc.handleGetRevenue(req, req.params.siteId))

  // Share Links (stealth)
  await router.post('/api/p/{siteId}/link', (req) => sharing.handleCreateShareLink(req, req.params.siteId))

  return router
}

// Export a singleton router instance (using top-level await)
export const router = await createRouter()
