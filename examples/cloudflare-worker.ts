/**
 * Cloudflare Workers Example
 *
 * Deploy this to Cloudflare Workers for edge-based analytics collection.
 *
 * Setup:
 * 1. npm create cloudflare@latest -- my-analytics
 * 2. Copy this file to src/index.ts
 * 3. Configure wrangler.toml with KV namespace
 * 4. wrangler deploy
 */

import {
  createAnalyticsHandler,
  type CloudflareEnv,
} from '../src'

// ============================================================================
// Worker Configuration
// ============================================================================

/**
 * Environment bindings expected in wrangler.toml:
 *
 * ```toml
 * name = "analytics-worker"
 * main = "src/index.ts"
 * compatibility_date = "2024-01-01"
 *
 * [[kv_namespaces]]
 * binding = "SESSIONS_KV"
 * id = "your-kv-namespace-id"
 *
 * [vars]
 * TABLE_NAME = "AnalyticsTable"
 * AWS_REGION = "us-east-1"
 * ```
 */

// ============================================================================
// Handler
// ============================================================================

const analyticsHandler = createAnalyticsHandler({
  basePath: '/api/analytics',
  corsOrigins: ['*'], // Configure for production
  sessionTtl: 1800, // 30 minutes
})

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        cf: {
          colo: (request as unknown as { cf?: { colo?: string } }).cf?.colo,
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Handle analytics routes
    if (url.pathname.startsWith('/api/analytics')) {
      return analyticsHandler(request, env, ctx)
    }

    // Serve tracking script
    if (url.pathname === '/tracker.js') {
      return new Response(generateTrackerScript(url.origin), {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // Root - documentation
    if (url.pathname === '/') {
      return new Response(getDocumentation(url.origin), {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    return new Response('Not Found', { status: 404 })
  },
}

// ============================================================================
// Tracker Script
// ============================================================================

function generateTrackerScript(origin: string): string {
  return `(function(w,d){
  var endpoint='${origin}/api/analytics/collect';
  var siteId='default';

  // Generate session ID
  var sid=sessionStorage.getItem('_as')||Math.random().toString(36).slice(2);
  sessionStorage.setItem('_as',sid);

  // Track function
  function track(type,data){
    var payload={s:siteId,sid:sid,e:type,u:location.href,r:d.referrer,t:d.title,sw:screen.width,sh:screen.height};
    if(data)Object.assign(payload,data);
    navigator.sendBeacon?navigator.sendBeacon(endpoint,JSON.stringify(payload)):
    (new Image).src=endpoint+'?d='+encodeURIComponent(JSON.stringify(payload));
  }

  // Public API
  w.sa=function(cmd){
    if(cmd==='init')siteId=arguments[1];
    else if(cmd==='track')track('pageview');
    else if(cmd==='event')track('event',{en:arguments[1],p:arguments[2]});
  };

  // Process queue
  var q=w.sa.q||[];
  w.sa.q=[];
  q.forEach(function(a){w.sa.apply(null,a)});

  // Auto track
  track('pageview');

  // SPA support
  var push=history.pushState;
  history.pushState=function(){push.apply(history,arguments);track('pageview')};
  w.addEventListener('popstate',function(){track('pageview')});
})(window,document);`
}

// ============================================================================
// Documentation
// ============================================================================

function getDocumentation(origin: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Analytics API</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; line-height: 1.6; }
    h1 { color: #1a1a1a; }
    h2 { color: #333; margin-top: 2em; }
    code { background: #f4f4f4; padding: 2px 8px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
    .endpoint { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .method { display: inline-block; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.85em; margin-right: 8px; }
    .get { background: #e7f5e7; color: #1b7d1b; }
    .post { background: #e7e7f5; color: #1b1b7d; }
    .path { font-family: monospace; font-size: 0.95em; }
  </style>
</head>
<body>
  <h1>Privacy-First Analytics API</h1>
  <p>Edge-deployed analytics running on Cloudflare Workers.</p>

  <h2>Quick Start</h2>
  <p>Add this snippet to your website:</p>
  <pre>&lt;script&gt;
(function(w,d,s,a){
  w.sa=w.sa||function(){(w.sa.q=w.sa.q||[]).push(arguments)};
  var f=d.getElementsByTagName(s)[0],j=d.createElement(s);
  j.async=1;j.src='${origin}/tracker.js';
  f.parentNode.insertBefore(j,f);
})(window,document,'script');
sa('init','YOUR_SITE_ID');
&lt;/script&gt;</pre>

  <h2>API Endpoints</h2>

  <div class="endpoint">
    <span class="method post">POST</span>
    <span class="path">/api/analytics/collect</span>
    <p>Collect tracking events</p>
    <pre>{
  "s": "site-id",
  "sid": "session-id",
  "e": "pageview",
  "u": "https://example.com/page"
}</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <span class="path">/api/analytics/sites/:siteId/stats</span>
    <p>Get aggregated statistics</p>
    <p>Query params: <code>start</code>, <code>end</code></p>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <span class="path">/api/analytics/sites/:siteId/realtime</span>
    <p>Get real-time visitor data</p>
    <p>Query params: <code>minutes</code> (default: 5)</p>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <span class="path">/api/analytics/sites</span>
    <p>List all sites</p>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <span class="path">/api/analytics/sites</span>
    <p>Create a new site</p>
    <pre>{
  "name": "My Website",
  "domains": ["example.com"]
}</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <span class="path">/health</span>
    <p>Health check endpoint</p>
  </div>

  <h2>Features</h2>
  <ul>
    <li>Privacy-first: No cookies, respects DNT</li>
    <li>Edge-deployed: Low latency worldwide</li>
    <li>Lightweight: ~1KB tracking script</li>
    <li>SPA support: Automatic route tracking</li>
    <li>Real-time: Live visitor counts</li>
  </ul>

  <h2>Links</h2>
  <ul>
    <li><a href="https://github.com/stacksjs/analytics">GitHub Repository</a></li>
    <li><a href="${origin}/health">Health Check</a></li>
  </ul>
</body>
</html>`
}

// Types
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}
