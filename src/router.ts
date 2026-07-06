/**
 * Router configuration using bun-router
 *
 * This file defines all API routes for the analytics service.
 * Note: bun-router uses {param} syntax for route parameters, not :param
 */

import { Router } from '@stacksjs/bun-router'
import { preflightResponse } from './utils/response'

// Import handlers
import * as stats from './handlers/stats'
import * as goals from './handlers/goals'
import * as sessions from './handlers/sessions'
import * as heatmaps from './handlers/heatmaps'
import { withReadCache } from './handlers/lib/read-cache'
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
import * as auth from './handlers/auth'
import * as authz from './handlers/authz'
import * as oauth from './handlers/oauth'

/**
 * Stealth API path mapping
 * These use innocuous names to bypass content blockers
 * /api/p/ = "project" (instead of /api/sites/)
 */
const _STEALTH_PATHS = {
  // Analytics data
  stats: 'summary',
  realtime: 'pulse',
  pages: 'content',
  referrers: 'sources',
  devices: 'clients',
  browsers: 'agents',
  os: 'platform',
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
  // Register background jobs on EVERY entrypoint (#168): the Lambda handler
  // imports the router directly and never ran server/index.ts, so
  // POST /api/jobs/tick iterated an empty jobs array in production — rollups,
  // alerts, digests, and webhooks never ran. bootstrapJobs() is idempotent.
  const { bootstrapJobs } = await import('./jobs')
  bootstrapJobs()

  const router = new Router({
    // Automatically preserve siteId across all dashboard navigation
    queryPreservation: {
      enabled: true,
      preserve: ['siteId'],
      exclude: ['_t', '_cache', 'callback'],
      routes: ['/dashboard', '/dashboard/*'],
    },
  })

  // Disable auto file-based routing (all routes are registered explicitly)
  router._fileRoutesInitialized = true

  // Global authorization: gate every /api/sites/{id}/* + /api/p/{id}/* route on
  // project membership (no-op unless ANALYTICS_REQUIRE_AUTH=true). See handlers/authz.
  await router.use(async (req: any, next: () => Promise<Response>) => {
    const denied = await authz.siteAuthGuard(req)
    return denied || next()
  })

  // Health check
  await router.get('/health', misc.handleHealth)

  // Favicon (return empty to prevent 404)
  await router.get('/favicon.ico', () => new Response(null, { status: 204 }))

  // Auth routes (API only — login page served by stx frontend)
  await router.post('/login', auth.handleLogin)
  await router.post('/logout', auth.handleLogout)
  await router.post('/signup', auth.handleSignupForm)
  await router.post('/forgot', auth.handleForgotForm)
  await router.post('/reset', auth.handleResetForm)
  await router.post('/api/auth/signup', auth.handleSignup)
  await router.post('/api/auth/login', auth.handleAuthLogin)
  await router.get('/api/auth/me', auth.handleMe)
  await router.post('/api/auth/logout', auth.handleApiLogout)
  await router.get('/api/auth/verify', auth.handleVerifyEmail)
  await router.post('/api/auth/verify/resend', auth.handleResendVerification)
  await router.post('/api/auth/forgot', auth.handleForgotPassword)
  await router.post('/api/auth/reset', auth.handleResetPassword)
  await router.post('/api/auth/logout-all', auth.handleLogoutAll)
  await router.put('/api/auth/profile', auth.handleUpdateProfile)
  await router.post('/api/auth/password', auth.handleChangePassword)
  await router.post('/api/auth/email', auth.handleChangeEmail)
  await router.get('/api/auth/oauth/{provider}', (req: any) => oauth.handleOAuthStart(req, req.params.provider))
  await router.get('/api/auth/oauth/{provider}/callback', (req: any) => oauth.handleOAuthCallback(req, req.params.provider))

  // Scheduled-jobs tick — for an external cron (Lambda schedule / EventBridge).
  // Gated by ANALYTICS_JOBS_SECRET; disabled (403) when no secret is set.
  await router.post('/api/jobs/tick', async (req: any) => {
    const secret = process.env.ANALYTICS_JOBS_SECRET
    if (!secret || req.headers.get('x-jobs-secret') !== secret) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }
    const result = await import('./lib/scheduler').then(s => s.runDueJobs())
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })

  // Collection endpoints. Cross-domain installs preflight every beacon (JSON
  // content type; the error SDK also sends X-Analytics-Token), so each public
  // collect endpoint answers OPTIONS (#86).
  await router.post('/collect', collect.handleCollect)
  await router.post('/t', collect.handleCollect)
  for (const path of ['/collect', '/t', '/p']) {
    await router.options(path, (req: any) => preflightResponse(req))
  }

  // Sites list and creation — account-scoped (#114). With enforcement on
  // (the default), no session → 401; the all-sites fallback only survives in
  // explicit ANALYTICS_REQUIRE_AUTH=false installs.
  await router.get('/api/sites', async (req: any) => {
    const session = await auth.getSessionFromRequest(req)
    if (!session && authz.authRequired()) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    return misc.handleGetSites(req, session?.userId)
  })
  await router.post('/api/sites', async (req: any) => {
    const session = await auth.getSessionFromRequest(req)
    if (!session && authz.authRequired()) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    return misc.handleCreateSite(req, session?.userId)
  })
  await router.delete('/api/sites/{siteId}', async (req: any) => {
    const session = await auth.getSessionFromRequest(req)
    return misc.handleDeleteSite(req, req.params.siteId, session?.userId)
  })

  // Share link validation
  await router.get('/api/share/{token}', (req: any) => sharing.handleGetSharedDashboard(req, req.params.token))

  // Site-specific API routes
  // Stats & Analytics
  await router.get('/api/sites/{siteId}/stats', (req: any) => withReadCache(req, 'stats', 30_000, () => stats.handleGetStats(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/realtime', (req: any) => stats.handleGetRealtime(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/ingest-counters', (req: any) => misc.handleGetIngestCounters(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/pages', (req: any) => withReadCache(req, 'pages', 60_000, () => stats.handleGetPages(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/referrers', (req: any) => withReadCache(req, 'referrers', 60_000, () => stats.handleGetReferrers(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/screen-sizes', (req: any) => withReadCache(req, 'screen-sizes', 60_000, () => stats.handleGetScreenSizes(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/devices', (req: any) => withReadCache(req, 'devices', 60_000, () => stats.handleGetDevices(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/browsers', (req: any) => withReadCache(req, 'browsers', 60_000, () => stats.handleGetBrowsers(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/os', (req: any) => withReadCache(req, 'os', 60_000, () => stats.handleGetOS(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/countries', (req: any) => withReadCache(req, 'countries', 60_000, () => stats.handleGetCountries(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/regions', (req: any) => withReadCache(req, 'regions', 60_000, () => stats.handleGetRegions(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/cities', (req: any) => withReadCache(req, 'cities', 60_000, () => stats.handleGetCities(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/timeseries', (req: any) => withReadCache(req, 'timeseries', 60_000, () => stats.handleGetTimeSeries(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/events', (req: any) => withReadCache(req, 'events', 60_000, () => stats.handleGetEvents(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/event-properties', (req: any) => withReadCache(req, 'event-properties', 60_000, () => stats.handleGetEventProperties(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/clicks', (req: any) => withReadCache(req, 'clicks', 60_000, () => stats.handleGetClicks(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/engagement', (req: any) => withReadCache(req, 'engagement', 60_000, () => stats.handleGetEngagement(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/campaigns', (req: any) => withReadCache(req, 'campaigns', 60_000, () => stats.handleGetCampaigns(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/comparison', (req: any) => withReadCache(req, 'comparison', 60_000, () => stats.handleGetComparison(req, req.params.siteId)))

  // Goals
  await router.get('/api/sites/{siteId}/goals/stats', (req: any) => withReadCache(req, 'goals-stats', 60_000, () => goals.handleGetGoalStats(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/goals', (req: any) => goals.handleGetGoals(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/goals', (req: any) => goals.handleCreateGoal(req, req.params.siteId))
  await router.put('/api/sites/{siteId}/goals/{goalId}', (req: any) => goals.handleUpdateGoal(req, req.params.siteId, req.params.goalId))
  await router.delete('/api/sites/{siteId}/goals/{goalId}', (req: any) => goals.handleDeleteGoal(req, req.params.siteId, req.params.goalId))

  // Sessions
  await router.get('/api/sites/{siteId}/sessions', (req: any) => sessions.handleGetSessions(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/sessions/{sessionId}', (req: any) => sessions.handleGetSessionDetail(req, req.params.siteId, req.params.sessionId))
  await router.get('/api/sites/{siteId}/flow', (req: any) => withReadCache(req, 'flow', 60_000, () => sessions.handleGetUserFlow(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/entry-exit', (req: any) => withReadCache(req, 'entry-exit', 60_000, () => sessions.handleGetEntryExitPages(req, req.params.siteId)))
  await router.get('/api/sites/{siteId}/live', (req: any) => sessions.handleGetLiveView(req, req.params.siteId))

  // Heatmaps
  await router.get('/api/sites/{siteId}/heatmap/clicks', (req: any) => heatmaps.handleGetHeatmapClicks(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/heatmap/scroll', (req: any) => heatmaps.handleGetHeatmapScroll(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/heatmap/pages', (req: any) => heatmaps.handleGetHeatmapPages(req, req.params.siteId))

  // Performance & Vitals
  await router.get('/api/sites/{siteId}/vitals', (req: any) => performance.handleGetVitals(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/vitals-trends', (req: any) => performance.handleGetVitalsTrends(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/performance-budgets', (req: any) => performance.handleGetPerformanceBudgets(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/performance-budgets/check', (req: any) => performance.handleCheckPerformanceBudgets(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/performance-budgets', (req: any) => performance.handleCreatePerformanceBudget(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/performance-budgets/{budgetId}', (req: any) => performance.handleDeletePerformanceBudget(req, req.params.siteId, req.params.budgetId))

  // Funnels
  await router.get('/api/sites/{siteId}/funnels', (req: any) => funnels.handleGetFunnels(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/funnels/{funnelId}', (req: any) => funnels.handleGetFunnelAnalysis(req, req.params.siteId, req.params.funnelId))
  await router.post('/api/sites/{siteId}/funnels', (req: any) => funnels.handleCreateFunnel(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/funnels/{funnelId}', (req: any) => funnels.handleDeleteFunnel(req, req.params.siteId, req.params.funnelId))

  // Annotations
  await router.get('/api/sites/{siteId}/annotations', (req: any) => annotations.handleGetAnnotations(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/annotations', (req: any) => annotations.handleCreateAnnotation(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/annotations/{annotationId}', (req: any) => annotations.handleDeleteAnnotation(req, req.params.siteId, req.params.annotationId))

  // Experiments
  await router.get('/api/sites/{siteId}/experiments', (req: any) => experiments.handleGetExperiments(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/experiments', (req: any) => experiments.handleCreateExperiment(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/experiments/event', (req: any) => experiments.handleRecordExperimentEvent(req, req.params.siteId))

  // Alerts
  await router.get('/api/sites/{siteId}/alerts', (req: any) => alerts.handleGetAlerts(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/alerts', (req: any) => alerts.handleCreateAlert(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/alerts/{alertId}', (req: any) => alerts.handleDeleteAlert(req, req.params.siteId, req.params.alertId))

  // Email Reports
  await router.get('/api/sites/{siteId}/email-reports', (req: any) => alerts.handleGetEmailReports(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/email-reports', (req: any) => alerts.handleCreateEmailReport(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/email-reports/{reportId}', (req: any) => alerts.handleDeleteEmailReport(req, req.params.siteId, req.params.reportId))

  // API Keys
  await router.get('/api/sites/{siteId}/api-keys', (req: any) => apiKeys.handleGetApiKey(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/api-keys/regenerate', (req: any) => apiKeys.handleRegenerateApiKey(req, req.params.siteId))

  // Uptime Monitoring
  await router.get('/api/sites/{siteId}/uptime', (req: any) => uptime.handleGetUptimeMonitors(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/uptime/{monitorId}/history', (req: any) => uptime.handleGetUptimeHistory(req, req.params.siteId, req.params.monitorId))
  await router.post('/api/sites/{siteId}/uptime', (req: any) => uptime.handleCreateUptimeMonitor(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/uptime/{monitorId}', (req: any) => uptime.handleDeleteUptimeMonitor(req, req.params.siteId, req.params.monitorId))

  // Webhooks
  await router.get('/api/sites/{siteId}/webhooks', (req: any) => webhooks.handleGetWebhooks(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/webhooks', (req: any) => webhooks.handleCreateWebhook(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/webhooks/{webhookId}', (req: any) => webhooks.handleDeleteWebhook(req, req.params.siteId, req.params.webhookId))

  // Team Management
  await router.get('/api/sites/{siteId}/team', (req: any) => team.handleGetTeamMembers(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/team', (req: any) => team.handleInviteTeamMember(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/team/{memberId}', (req: any) => team.handleRemoveTeamMember(req, req.params.siteId, req.params.memberId))

  // Data Export & Retention
  await router.post('/api/sites/{siteId}/import/ga4-api', (req: any) => data.handleGa4ApiImport(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/import/ga', (req: any) => data.handleGaImport(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/export', (req: any) => data.handleExport(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/retention', (req: any) => data.handleGetRetentionSettings(req, req.params.siteId))
  await router.put('/api/sites/{siteId}/retention', (req: any) => data.handleUpdateRetentionSettings(req, req.params.siteId))

  // GDPR
  await router.get('/api/sites/{siteId}/gdpr/export', (req: any) => data.handleGdprExport(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/gdpr/delete', (req: any) => data.handleGdprDelete(req, req.params.siteId))

  // Insights
  await router.get('/api/sites/{siteId}/insights', (req: any) => withReadCache(req, 'insights', 120_000, () => data.handleGetInsights(req, req.params.siteId)))

  // Revenue
  await router.get('/api/sites/{siteId}/revenue', (req: any) => misc.handleGetRevenue(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/verify-install', (req: any) => misc.handleVerifyInstall(req, req.params.siteId))

  // Share Links
  await router.post('/api/sites/{siteId}/share', (req: any) => sharing.handleCreateShareLink(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/share', (req: any) => sharing.handleListShareLinks(req, req.params.siteId))
  await router.delete('/api/sites/{siteId}/share/{token}', (req: any) => sharing.handleRevokeShareLink(req, req.params.siteId, req.params.token))

  // ============================================
  // STEALTH ROUTES - Bypass content blockers
  // Uses /api/p/ ("project") with innocuous names
  // ============================================

  // Collection endpoints (stealth)
  await router.post('/t', collect.handleCollect) // Already defined above, but /t is short
  await router.post('/p', collect.handleCollect) // Even shorter alias

  // Sites list (stealth) — same account scoping as /api/sites (#114)
  await router.get('/api/projects', async (req: any) => {
    const session = await auth.getSessionFromRequest(req)
    if (!session && authz.authRequired()) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    return misc.handleGetSites(req, session?.userId)
  })
  await router.post('/api/projects', async (req: any) => {
    const session = await auth.getSessionFromRequest(req)
    if (!session && authz.authRequired()) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    return misc.handleCreateSite(req, session?.userId)
  })

  // Share link validation (stealth)
  await router.get('/api/link/{token}', (req: any) => sharing.handleGetSharedDashboard(req, req.params.token))

  // Site-specific stealth routes using /api/p/ prefix
  // Stats & Analytics (stealth)
  await router.get('/api/p/{siteId}/summary', (req: any) => withReadCache(req, 'stats', 30_000, () => stats.handleGetStats(req, req.params.siteId)))
  await router.get('/api/p/{siteId}/pulse', (req: any) => stats.handleGetRealtime(req, req.params.siteId))
  await router.get('/api/p/{siteId}/content', (req: any) => stats.handleGetPages(req, req.params.siteId))
  await router.get('/api/p/{siteId}/sources', (req: any) => stats.handleGetReferrers(req, req.params.siteId))
  await router.get('/api/p/{siteId}/displays', (req: any) => withReadCache(req, 'screen-sizes', 60_000, () => stats.handleGetScreenSizes(req, req.params.siteId)))
  await router.get('/api/p/{siteId}/clients', (req: any) => stats.handleGetDevices(req, req.params.siteId))
  await router.get('/api/p/{siteId}/agents', (req: any) => stats.handleGetBrowsers(req, req.params.siteId))
  await router.get('/api/p/{siteId}/platform', (req: any) => stats.handleGetOS(req, req.params.siteId))
  await router.get('/api/p/{siteId}/geo', (req: any) => stats.handleGetCountries(req, req.params.siteId))
  await router.get('/api/p/{siteId}/area', (req: any) => stats.handleGetRegions(req, req.params.siteId))
  await router.get('/api/p/{siteId}/locale', (req: any) => stats.handleGetCities(req, req.params.siteId))
  await router.get('/api/p/{siteId}/series', (req: any) => withReadCache(req, 'timeseries', 60_000, () => stats.handleGetTimeSeries(req, req.params.siteId)))
  await router.get('/api/p/{siteId}/actions', (req: any) => stats.handleGetEvents(req, req.params.siteId))
  await router.get('/api/p/{siteId}/traits', (req: any) => stats.handleGetEventProperties(req, req.params.siteId))
  await router.get('/api/p/{siteId}/links', (req: any) => stats.handleGetClicks(req, req.params.siteId))
  await router.get('/api/p/{siteId}/dwell', (req: any) => stats.handleGetEngagement(req, req.params.siteId))
  await router.get('/api/p/{siteId}/promo', (req: any) => stats.handleGetCampaigns(req, req.params.siteId))
  await router.get('/api/p/{siteId}/diff', (req: any) => stats.handleGetComparison(req, req.params.siteId))

  // Goals (stealth)
  await router.get('/api/p/{siteId}/targets/data', (req: any) => goals.handleGetGoalStats(req, req.params.siteId))
  await router.get('/api/p/{siteId}/targets', (req: any) => goals.handleGetGoals(req, req.params.siteId))
  await router.post('/api/p/{siteId}/targets', (req: any) => goals.handleCreateGoal(req, req.params.siteId))
  await router.put('/api/p/{siteId}/targets/{goalId}', (req: any) => goals.handleUpdateGoal(req, req.params.siteId, req.params.goalId))
  await router.delete('/api/p/{siteId}/targets/{goalId}', (req: any) => goals.handleDeleteGoal(req, req.params.siteId, req.params.goalId))

  // Sessions (stealth)
  await router.get('/api/p/{siteId}/visits', (req: any) => sessions.handleGetSessions(req, req.params.siteId))
  await router.get('/api/p/{siteId}/visits/{sessionId}', (req: any) => sessions.handleGetSessionDetail(req, req.params.siteId, req.params.sessionId))
  await router.get('/api/p/{siteId}/journey', (req: any) => sessions.handleGetUserFlow(req, req.params.siteId))
  await router.get('/api/p/{siteId}/endpoints', (req: any) => sessions.handleGetEntryExitPages(req, req.params.siteId))
  await router.get('/api/p/{siteId}/now', (req: any) => sessions.handleGetLiveView(req, req.params.siteId))

  // Heatmaps (stealth)
  await router.get('/api/p/{siteId}/touch/clicks', (req: any) => heatmaps.handleGetHeatmapClicks(req, req.params.siteId))
  await router.get('/api/p/{siteId}/touch/scroll', (req: any) => heatmaps.handleGetHeatmapScroll(req, req.params.siteId))
  await router.get('/api/p/{siteId}/touch/list', (req: any) => heatmaps.handleGetHeatmapPages(req, req.params.siteId))

  // Errors (stealth)

  // Performance & Vitals (stealth)
  await router.get('/api/p/{siteId}/metrics', (req: any) => performance.handleGetVitals(req, req.params.siteId))
  await router.get('/api/p/{siteId}/metrics-trends', (req: any) => performance.handleGetVitalsTrends(req, req.params.siteId))
  await router.get('/api/p/{siteId}/budgets', (req: any) => performance.handleGetPerformanceBudgets(req, req.params.siteId))
  await router.get('/api/p/{siteId}/budgets/check', (req: any) => performance.handleCheckPerformanceBudgets(req, req.params.siteId))
  await router.post('/api/p/{siteId}/budgets', (req: any) => performance.handleCreatePerformanceBudget(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/budgets/{budgetId}', (req: any) => performance.handleDeletePerformanceBudget(req, req.params.siteId, req.params.budgetId))

  // Funnels (stealth)
  await router.get('/api/p/{siteId}/pipelines', (req: any) => funnels.handleGetFunnels(req, req.params.siteId))
  await router.get('/api/p/{siteId}/pipelines/{funnelId}', (req: any) => funnels.handleGetFunnelAnalysis(req, req.params.siteId, req.params.funnelId))
  await router.post('/api/p/{siteId}/pipelines', (req: any) => funnels.handleCreateFunnel(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/pipelines/{funnelId}', (req: any) => funnels.handleDeleteFunnel(req, req.params.siteId, req.params.funnelId))

  // Annotations (stealth)
  await router.get('/api/p/{siteId}/notes', (req: any) => annotations.handleGetAnnotations(req, req.params.siteId))
  await router.post('/api/p/{siteId}/notes', (req: any) => annotations.handleCreateAnnotation(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/notes/{annotationId}', (req: any) => annotations.handleDeleteAnnotation(req, req.params.siteId, req.params.annotationId))

  // Experiments (stealth)
  await router.get('/api/p/{siteId}/tests', (req: any) => experiments.handleGetExperiments(req, req.params.siteId))
  await router.post('/api/p/{siteId}/tests', (req: any) => experiments.handleCreateExperiment(req, req.params.siteId))
  await router.post('/api/p/{siteId}/tests/record', (req: any) => experiments.handleRecordExperimentEvent(req, req.params.siteId))

  // Alerts (stealth)
  await router.get('/api/p/{siteId}/notifications', (req: any) => alerts.handleGetAlerts(req, req.params.siteId))
  await router.post('/api/p/{siteId}/notifications', (req: any) => alerts.handleCreateAlert(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/notifications/{alertId}', (req: any) => alerts.handleDeleteAlert(req, req.params.siteId, req.params.alertId))

  // Email Reports (stealth)
  await router.get('/api/p/{siteId}/scheduled', (req: any) => alerts.handleGetEmailReports(req, req.params.siteId))
  await router.post('/api/p/{siteId}/scheduled', (req: any) => alerts.handleCreateEmailReport(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/scheduled/{reportId}', (req: any) => alerts.handleDeleteEmailReport(req, req.params.siteId, req.params.reportId))

  // API Keys (stealth)
  await router.get('/api/p/{siteId}/tokens', (req: any) => apiKeys.handleGetApiKey(req, req.params.siteId))
  await router.post('/api/p/{siteId}/tokens/regenerate', (req: any) => apiKeys.handleRegenerateApiKey(req, req.params.siteId))

  // Uptime Monitoring (stealth)
  await router.get('/api/p/{siteId}/monitors', (req: any) => uptime.handleGetUptimeMonitors(req, req.params.siteId))
  await router.get('/api/p/{siteId}/monitors/{monitorId}/history', (req: any) => uptime.handleGetUptimeHistory(req, req.params.siteId, req.params.monitorId))
  await router.post('/api/p/{siteId}/monitors', (req: any) => uptime.handleCreateUptimeMonitor(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/monitors/{monitorId}', (req: any) => uptime.handleDeleteUptimeMonitor(req, req.params.siteId, req.params.monitorId))

  // Webhooks (stealth)
  await router.get('/api/p/{siteId}/hooks', (req: any) => webhooks.handleGetWebhooks(req, req.params.siteId))
  await router.post('/api/p/{siteId}/hooks', (req: any) => webhooks.handleCreateWebhook(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/hooks/{webhookId}', (req: any) => webhooks.handleDeleteWebhook(req, req.params.siteId, req.params.webhookId))

  // Team Management (stealth)
  await router.get('/api/p/{siteId}/members', (req: any) => team.handleGetTeamMembers(req, req.params.siteId))
  await router.post('/api/p/{siteId}/members', (req: any) => team.handleInviteTeamMember(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/members/{memberId}', (req: any) => team.handleRemoveTeamMember(req, req.params.siteId, req.params.memberId))

  // Data Export & Retention (stealth)
  await router.get('/api/p/{siteId}/download', (req: any) => data.handleExport(req, req.params.siteId))
  await router.get('/api/p/{siteId}/storage', (req: any) => data.handleGetRetentionSettings(req, req.params.siteId))
  await router.put('/api/p/{siteId}/storage', (req: any) => data.handleUpdateRetentionSettings(req, req.params.siteId))

  // GDPR (stealth)
  await router.get('/api/p/{siteId}/privacy/download', (req: any) => data.handleGdprExport(req, req.params.siteId))
  await router.post('/api/p/{siteId}/privacy/remove', (req: any) => data.handleGdprDelete(req, req.params.siteId))

  // Insights (stealth)
  await router.get('/api/p/{siteId}/intel', (req: any) => data.handleGetInsights(req, req.params.siteId))

  // Revenue (stealth)
  await router.get('/api/p/{siteId}/income', (req: any) => misc.handleGetRevenue(req, req.params.siteId))

  // Share Links (stealth)
  await router.post('/api/p/{siteId}/link', (req: any) => sharing.handleCreateShareLink(req, req.params.siteId))
  await router.get('/api/p/{siteId}/link', (req: any) => sharing.handleListShareLinks(req, req.params.siteId))
  await router.delete('/api/p/{siteId}/link/{token}', (req: any) => sharing.handleRevokeShareLink(req, req.params.siteId, req.params.token))

  // Tracking script (generates embeddable JS for site owners)
  await router.get('/api/sites/{siteId}/script', (req: any) => {
    return import('./handlers/views').then(v => v.handleScript(req))
  })
  // Raw-JS variant for the `<script src=".../script.js">` one-liner install.
  await router.get('/api/sites/{siteId}/script.js', (req: any) => {
    return import('./handlers/views').then(v => v.handleScript(req))
  })
  // Shared analytics tracker (Fathom-style): one cacheable file for all sites;
  // the site comes from the tag's data-site attribute, the endpoint from origin.
  await router.get('/script.js', (req: any) => {
    return import('./handlers/views').then(v => v.handleSharedScript(req))
  })

  return router
}

// Export a singleton router instance (using top-level await)
export const router: Router = await createRouter()
