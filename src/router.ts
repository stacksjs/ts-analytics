/**
 * Router configuration using bun-router
 *
 * This file defines all API routes for the analytics service.
 * Note: bun-router uses {param} syntax for route parameters, not :param
 */

import { Router } from '@stacksjs/bun-router'

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
import * as auth from './handlers/auth'

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

  // Health check
  await router.get('/health', misc.handleHealth)

  // Favicon (return empty to prevent 404)
  await router.get('/favicon.ico', () => new Response(null, { status: 204 }))

  // Serve STX SPA router script (cached after first request)
  let routerScriptCache: string | null = null
  await router.get('/stx-router.js', () => {
    if (!routerScriptCache) {
      // Inline the minified STX router IIFE with STX_ROUTER_OPTIONS support
      routerScriptCache = `;(function(){
  'use strict';
  var d={container:'main',linkSelector:'a[href]',loadingClass:'stx-navigating',viewTransitions:!0,cache:!0,scrollToTop:!0,prefetch:!0};
  const o=Object.assign({},d,window.STX_ROUTER_OPTIONS||{});
  const c=new Map(),p=new Set(),n=!1,u=location.href;
  function init(){
    document.addEventListener('click',handleClick,!0);
    window.addEventListener('popstate',function(){navigate(location.href,!1)});
    document.addEventListener('mouseenter',handleHover,!0);
    cacheCurrentPage();
    injectStyles();
  }
  function navigate(url,push){
    if(n)return;
    var t=new URL(url,location.origin);
    if(t.href===u&&!t.hash)return;
    if(t.origin!==location.origin){location.href=url;return}
    if(t.pathname===new URL(u).pathname&&t.hash){
      if(push!==!1)history.pushState({url:t.href},'',t.href);
      var el=document.querySelector(t.hash);if(el)el.scrollIntoView({behavior:'smooth'});return
    }
    n=!0;document.body.classList.add(o.loadingClass);
    fetchPage(t.href).then(function(r){
      if(r){
        swapContent(r);
        if(push!==!1)history.pushState({url:t.href},'',t.href);
        u=t.href;
        if(o.scrollToTop&&!t.hash)window.scrollTo({top:0,behavior:'instant'});
        else if(t.hash){var el=document.querySelector(t.hash);if(el)el.scrollIntoView({behavior:'smooth'})}
      }
    }).catch(function(){location.href=url}).finally(function(){n=!1;document.body.classList.remove(o.loadingClass)});
  }
  function handleClick(e){
    var a=e.target.closest('a[href]');if(!a)return;
    if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;
    if(a.target&&a.target!=='_self')return;if(a.hasAttribute('download'))return;
    var h=a.getAttribute('href');
    if(!h||h.startsWith('mailto:')||h.startsWith('tel:')||h.startsWith('javascript:'))return;
    if(a.hasAttribute('data-stx-no-router'))return;
    const t=new URL(h,location.origin);if(t.origin!==location.origin)return;
    e.preventDefault();e.stopPropagation();navigate(h);
  }
  function handleHover(e){
    const a=e.target.closest('a[data-stx-prefetch]');if(!a)return;
    const h=a.getAttribute('href');if(h&&!c.has(h))fetchPage(new URL(h,location.origin).href).catch(function(){});
  }
  function fetchPage(url){
    if(c.has(url)){var x=c.get(url);if(Date.now()-x.t<3e5)return Promise.resolve({h:x.h,i:x.i})}
    return fetch(url,{headers:{'X-STX-Router':'true'}}).then(function(r){
      if(!r.ok)throw new Error(r.status);return r.text()
    }).then(function(html){
      const d=new DOMParser().parseFromString(html,'text/html'),m=d.querySelector(o.container);
      if(!m)throw new Error('Container not found');
      const r={h:m.innerHTML,i:d.title};c.set(url,{h:r.h,i:r.i,t:Date.now()});return r
    });
  }
  function swapContent(r){
    var m=document.querySelector(o.container);if(!m)return;
    const swap=function(){
      m.innerHTML=r.h;document.title=r.i;
      m.querySelectorAll('script').forEach(function(s){
        const n=document.createElement('script');
        Array.from(s.attributes).forEach(function(a){n.setAttribute(a.name,a.value)});
        n.textContent=s.textContent;s.parentNode.replaceChild(n,s);
      });
      window.dispatchEvent(new CustomEvent('stx:navigate',{detail:{url:u}}));
      window.dispatchEvent(new CustomEvent('stx:load'));
    };
    if(o.viewTransitions&&'startViewTransition'in document)document.startViewTransition(swap);else swap();
  }
  function cacheCurrentPage(){var m=document.querySelector(o.container);if(m)c.set(u,{h:m.innerHTML,i:document.title,t:Date.now()})}
  function injectStyles(){
    if(document.getElementById('stx-r-css'))return;
    const s=document.createElement('style');s.id='stx-r-css';
    s.textContent='.stx-navigating{cursor:wait}.stx-navigating *{pointer-events:none}@keyframes stx-l{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}.stx-navigating::before{content:\\'\\';position:fixed;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#78dce8,transparent);animation:stx-l 1s ease-in-out infinite;z-index:99999}';
    document.head.appendChild(s);
  }
  window.stxRouter={navigate:navigate,clearCache:function(){c.clear()}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();`
    }
    return new Response(routerScriptCache, {
      headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=86400' },
    })
  })

  // Auth routes
  await router.get('/login', auth.handleLoginPage)
  await router.post('/login', auth.handleLogin)
  await router.post('/logout', auth.handleLogout)

  // Serve dashboard script (transpile TS on the fly for dev, serve compiled JS for prod)
  const serveDashboardScript = async () => {
    const locations = [
      './src/views/scripts/dashboard.ts',   // Local dev (source)
      '/var/task/views/scripts/dashboard.js', // Lambda
      './dist/views/scripts/dashboard.js',    // Local dev (compiled)
      './views/scripts/dashboard.js',         // Alternative
    ]

    for (const loc of locations) {
      try {
        const file = Bun.file(loc)
        if (await file.exists()) {
          let content = await file.text()
          // Transpile TypeScript files for the browser
          if (loc.endsWith('.ts')) {
            const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' })
            content = transpiler.transformSync(content)
          }
          return new Response(content, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'public, max-age=3600',
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
  }

  // Serve composables script (same pattern as dashboard script)
  const serveComposablesScript = async () => {
    const locations = [
      './src/views/scripts/composables.ts',     // Local dev (source)
      '/var/task/views/scripts/composables.js',  // Lambda
      './dist/views/scripts/composables.js',     // Local dev (compiled)
      './views/scripts/composables.js',          // Alternative
    ]

    for (const loc of locations) {
      try {
        const file = Bun.file(loc)
        if (await file.exists()) {
          let content = await file.text()
          if (loc.endsWith('.ts')) {
            const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' })
            content = transpiler.transformSync(content)
          }
          return new Response(content, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'public, max-age=3600',
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
  }

  await router.get('/dashboard/scripts/composables.ts', serveComposablesScript)

  // Serve Crosswind CSS
  await router.get('/assets/crosswind.css', async () => {
    const locations = [
      './src/assets/crosswind.css',
      '/var/task/assets/crosswind.css',
      './dist/assets/crosswind.css',
    ]
    for (const loc of locations) {
      try {
        const file = Bun.file(loc)
        if (await file.exists()) {
          return new Response(await file.text(), {
            headers: { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=3600' },
          })
        }
      }
      catch {}
    }
    return new Response('/* crosswind.css not found */', {
      status: 404,
      headers: { 'Content-Type': 'text/css' },
    })
  })

  await router.get('/scripts/dashboard.js', serveDashboardScript)
  await router.get('/dashboard/scripts/dashboard.ts', serveDashboardScript)

  // HTML pages
  await router.get('/', views.handleDashboard)
  await router.get('/dashboard', views.handleDashboard)
  await router.get('/dashboard/{tab}', (req: any) => views.handleDashboardTab(req, req.params.tab))
  await router.get('/test-errors', views.handleTestErrors)
  await router.get('/errors/{errorId}', (req: any) => {
    const errorId = decodeURIComponent(req.params.errorId)
    return views.handleErrorDetailPage(req, errorId)
  })

  // Collection endpoints
  await router.post('/collect', collect.handleCollect)
  await router.post('/t', collect.handleCollect)

  // Error collection (SDK endpoint with token auth)
  await router.post('/errors/collect', async (req: any) => {
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
  await router.get('/sites/{siteId}/script', (req: any) => views.handleScript(req))

  // Sites list and creation (pass ownerId from session if authenticated)
  await router.get('/api/sites', async (req: any) => {
    const session = await auth.getSessionFromRequest(req)
    return misc.handleGetSites(req, session?.userId)
  })
  await router.post('/api/sites', async (req: any) => {
    const session = await auth.getSessionFromRequest(req)
    return misc.handleCreateSite(req, session?.userId)
  })

  // Share link validation
  await router.get('/api/share/{token}', (req: any) => sharing.handleGetSharedDashboard(req, req.params.token))

  // Site-specific API routes
  // Stats & Analytics
  await router.get('/api/sites/{siteId}/stats', (req: any) => stats.handleGetStats(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/realtime', (req: any) => stats.handleGetRealtime(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/pages', (req: any) => stats.handleGetPages(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/referrers', (req: any) => stats.handleGetReferrers(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/devices', (req: any) => stats.handleGetDevices(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/browsers', (req: any) => stats.handleGetBrowsers(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/countries', (req: any) => stats.handleGetCountries(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/regions', (req: any) => stats.handleGetRegions(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/cities', (req: any) => stats.handleGetCities(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/timeseries', (req: any) => stats.handleGetTimeSeries(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/events', (req: any) => stats.handleGetEvents(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/campaigns', (req: any) => stats.handleGetCampaigns(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/comparison', (req: any) => stats.handleGetComparison(req, req.params.siteId))

  // Goals
  await router.get('/api/sites/{siteId}/goals/stats', (req: any) => goals.handleGetGoalStats(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/goals', (req: any) => goals.handleGetGoals(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/goals', (req: any) => goals.handleCreateGoal(req, req.params.siteId))
  await router.put('/api/sites/{siteId}/goals/{goalId}', (req: any) => goals.handleUpdateGoal(req, req.params.siteId, req.params.goalId))
  await router.delete('/api/sites/{siteId}/goals/{goalId}', (req: any) => goals.handleDeleteGoal(req, req.params.siteId, req.params.goalId))

  // Sessions
  await router.get('/api/sites/{siteId}/sessions', (req: any) => sessions.handleGetSessions(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/sessions/{sessionId}', (req: any) => sessions.handleGetSessionDetail(req, req.params.siteId, req.params.sessionId))
  await router.get('/api/sites/{siteId}/flow', (req: any) => sessions.handleGetUserFlow(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/entry-exit', (req: any) => sessions.handleGetEntryExitPages(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/live', (req: any) => sessions.handleGetLiveView(req, req.params.siteId))

  // Heatmaps
  await router.get('/api/sites/{siteId}/heatmap/clicks', (req: any) => heatmaps.handleGetHeatmapClicks(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/heatmap/scroll', (req: any) => heatmaps.handleGetHeatmapScroll(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/heatmap/pages', (req: any) => heatmaps.handleGetHeatmapPages(req, req.params.siteId))

  // Errors
  await router.get('/api/sites/{siteId}/errors', (req: any) => errors.handleGetErrors(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/statuses', (req: any) => errors.handleGetErrorStatuses(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/errors/status', (req: any) => errors.handleUpdateErrorStatus(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/timeseries', (req: any) => errors.handleGetErrorTimeseries(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/comparison', (req: any) => errors.handleGetErrorComparison(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/groups', (req: any) => errors.handleGetErrorGroups(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/alerts', (req: any) => errors.handleGetErrorAlerts(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/errors/alerts', (req: any) => errors.handleCreateErrorAlert(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/errors/alerts/evaluate', (req: any) => errors.handleEvaluateErrorAlerts(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/errors/{errorId}', (req: any) => errors.handleGetErrorDetail(req, req.params.siteId, req.params.errorId))

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
  await router.get('/api/sites/{siteId}/export', (req: any) => data.handleExport(req, req.params.siteId))
  await router.get('/api/sites/{siteId}/retention', (req: any) => data.handleGetRetentionSettings(req, req.params.siteId))
  await router.put('/api/sites/{siteId}/retention', (req: any) => data.handleUpdateRetentionSettings(req, req.params.siteId))

  // GDPR
  await router.get('/api/sites/{siteId}/gdpr/export', (req: any) => data.handleGdprExport(req, req.params.siteId))
  await router.post('/api/sites/{siteId}/gdpr/delete', (req: any) => data.handleGdprDelete(req, req.params.siteId))

  // Insights
  await router.get('/api/sites/{siteId}/insights', (req: any) => data.handleGetInsights(req, req.params.siteId))

  // Revenue
  await router.get('/api/sites/{siteId}/revenue', (req: any) => misc.handleGetRevenue(req, req.params.siteId))

  // Share Links
  await router.post('/api/sites/{siteId}/share', (req: any) => sharing.handleCreateShareLink(req, req.params.siteId))

  // ============================================
  // STEALTH ROUTES - Bypass content blockers
  // Uses /api/p/ ("project") with innocuous names
  // ============================================

  // Collection endpoints (stealth)
  await router.post('/t', collect.handleCollect) // Already defined above, but /t is short
  await router.post('/p', collect.handleCollect) // Even shorter alias

  // Issue collection (stealth for errors/collect)
  await router.post('/issues/report', async (req: any) => {
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
  await router.get('/api/link/{token}', (req: any) => sharing.handleGetSharedDashboard(req, req.params.token))

  // Site-specific stealth routes using /api/p/ prefix
  // Stats & Analytics (stealth)
  await router.get('/api/p/{siteId}/summary', (req: any) => stats.handleGetStats(req, req.params.siteId))
  await router.get('/api/p/{siteId}/pulse', (req: any) => stats.handleGetRealtime(req, req.params.siteId))
  await router.get('/api/p/{siteId}/content', (req: any) => stats.handleGetPages(req, req.params.siteId))
  await router.get('/api/p/{siteId}/sources', (req: any) => stats.handleGetReferrers(req, req.params.siteId))
  await router.get('/api/p/{siteId}/clients', (req: any) => stats.handleGetDevices(req, req.params.siteId))
  await router.get('/api/p/{siteId}/agents', (req: any) => stats.handleGetBrowsers(req, req.params.siteId))
  await router.get('/api/p/{siteId}/geo', (req: any) => stats.handleGetCountries(req, req.params.siteId))
  await router.get('/api/p/{siteId}/area', (req: any) => stats.handleGetRegions(req, req.params.siteId))
  await router.get('/api/p/{siteId}/locale', (req: any) => stats.handleGetCities(req, req.params.siteId))
  await router.get('/api/p/{siteId}/series', (req: any) => stats.handleGetTimeSeries(req, req.params.siteId))
  await router.get('/api/p/{siteId}/actions', (req: any) => stats.handleGetEvents(req, req.params.siteId))
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
  await router.get('/api/p/{siteId}/issues', (req: any) => errors.handleGetErrors(req, req.params.siteId))
  await router.get('/api/p/{siteId}/issues/states', (req: any) => errors.handleGetErrorStatuses(req, req.params.siteId))
  await router.post('/api/p/{siteId}/issues/state', (req: any) => errors.handleUpdateErrorStatus(req, req.params.siteId))
  await router.get('/api/p/{siteId}/issues/{errorId}', (req: any) => errors.handleGetErrorDetail(req, req.params.siteId, req.params.errorId))

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

  return router
}

// Export a singleton router instance (using top-level await)
export const router: Router = await createRouter()
