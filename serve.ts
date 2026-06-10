#!/usr/bin/env bun
/**
 * ts-analytics dev/prod entry.
 *
 * Uses bun-plugin-stx/serve for page rendering, SPA routing, and asset
 * serving. The API server (server/) runs separately; API and auth-form
 * requests are PROXIED to it (#116) so the whole app is same-origin in dev —
 * session cookies flow without any CORS/credentials configuration. Set
 * ANALYTICS_API_PROXY to override the upstream (default localhost:3001).
 */

import { serve } from 'bun-plugin-stx/serve'

const args = process.argv.slice(2)
const portIdx = args.indexOf('--port')
const port = portIdx >= 0 && args[portIdx + 1] ? Number(args[portIdx + 1]) : 3000

const API_UPSTREAM = process.env.ANALYTICS_API_PROXY
  || process.env.STX_PUBLIC_API_ENDPOINT
  || 'http://localhost:3001'

// Paths owned by the API server. The auth pages (/login, /signup, …) render
// as stx views on GET — only their form POSTs proxy through.
const API_PREFIXES = ['/api/', '/errors/collect', '/issues/report']
const API_EXACT = ['/collect', '/t', '/p', '/sdk.js', '/health']
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
