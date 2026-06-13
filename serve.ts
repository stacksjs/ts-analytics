#!/usr/bin/env bun
/**
 * ts-analytics dev/prod entry.
 *
 * Uses bun-plugin-stx/serve for page rendering, SPA routing, and asset
 * serving. The API server (server/) runs separately; API and auth-form
 * requests are PROXIED to it (#116) so the whole app is same-origin in dev —
 * session cookies flow without any CORS/credentials configuration.
 *
 * Ports (set in .env): DASHBOARD_PORT (this server, default 2026) and PORT (the
 * API server it proxies to, default 2027). ANALYTICS_API_PROXY overrides the
 * upstream URL for split-domain deployments.
 */

import { serve } from 'bun-plugin-stx/serve'

// Dashboard (frontend) port. Precedence: --port flag > DASHBOARD_PORT env >
// default 2026. Set DASHBOARD_PORT in .env to avoid conflicts with other apps.
const args = process.argv.slice(2)
const portIdx = args.indexOf('--port')
const port = portIdx >= 0 && args[portIdx + 1]
  ? Number(args[portIdx + 1])
  : Number(process.env.DASHBOARD_PORT) || 2026

// API upstream the dashboard proxies to. Defaults to the local API server on
// its PORT (default 2027), so changing the backend port here needs no extra
// config. ANALYTICS_API_PROXY overrides it (e.g. a split-domain deployment).
const API_UPSTREAM = process.env.ANALYTICS_API_PROXY
  || process.env.STX_PUBLIC_API_ENDPOINT
  || `http://localhost:${process.env.PORT || '2027'}`

// Paths owned by the API server. The auth pages (/login, /signup, …) render
// as stx views on GET — only their form POSTs proxy through.
const API_PREFIXES = ['/api/', '/errors/collect', '/issues/report']
const API_EXACT = ['/collect', '/t', '/p', '/sdk.js', '/script.js', '/health']
const AUTH_FORM_PATHS = ['/login', '/logout', '/signup', '/forgot', '/reset']

function shouldProxy(method: string, pathname: string): boolean {
  if (API_PREFIXES.some(p => pathname.startsWith(p)) || API_EXACT.includes(pathname))
    return true
  return method !== 'GET' && AUTH_FORM_PATHS.includes(pathname)
}

await serve({
  patterns: ['resources/views/'],
  port,
  layoutsDir: 'resources/layouts',
  partialsDir: 'resources/components',
  onRequest: async (req) => {
    const url = new URL(req.url)
    if (!shouldProxy(req.method, url.pathname))
      return null
    const res = await fetch(API_UPSTREAM + url.pathname + url.search, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      // Redirects (e.g. login → /dashboard) must reach the browser, not be
      // followed here.
      redirect: 'manual',
    })
    return new Response(res.body, { status: res.status, headers: res.headers })
  },
})
