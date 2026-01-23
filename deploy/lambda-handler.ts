/**
 * AWS Lambda Handler for ts-analytics API
 *
 * This handler wraps the analytics API for deployment to AWS Lambda.
 * It uses API Gateway for HTTP routing and Eloquent-like models for data access.
 */

import {
  generateTrackingScript,
  generateMinimalTrackingScript,
  generateId,
  hashVisitorId,
  getDailySalt,
} from '../src/index'
import type { Session as SessionType } from '../src/types'
import {
  PageView as PageViewModel,
  Session as SessionModel,
  CustomEvent as CustomEventModel,
  HeatmapClick,
  HeatmapMovement,
  HeatmapScroll,
  configureAnalytics,
  createClient,
  marshall,
  unmarshall,
} from '../src/models/orm'

// Configuration
const TABLE_NAME = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'
const REGION = process.env.AWS_REGION || 'us-east-1'

// Configure analytics models
configureAnalytics({
  tableName: TABLE_NAME,
  region: REGION,
})

// Create native DynamoDB client for direct queries (used in dashboard handlers)
const dynamodb = createClient({ region: REGION })

// In-memory session cache (resets on cold start)
const sessionCache = new Map<string, { session: SessionType; expires: number }>()

// Helper functions
function getSession(key: string): SessionType | null {
  const cached = sessionCache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.session
  }
  sessionCache.delete(key)
  return null
}

function setSession(key: string, session: SessionType, ttlSeconds = 1800): void {
  sessionCache.set(key, {
    session,
    expires: Date.now() + ttlSeconds * 1000,
  })
}

function parseUserAgent(ua: string) {
  const deviceType = /mobile/i.test(ua) ? 'mobile' : /tablet/i.test(ua) ? 'tablet' : 'desktop'
  let browser = 'Unknown'
  if (ua.includes('Chrome') && !ua.includes('Edge')) browser = 'Chrome'
  else if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari'
  else if (ua.includes('Edge')) browser = 'Edge'

  let os = 'Unknown'
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac')) os = 'macOS'
  else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'

  return { deviceType, browser, os }
}

function parseReferrerSource(referrer?: string): string {
  if (!referrer) return 'direct'
  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()
    if (host.includes('google')) return 'google'
    if (host.includes('bing')) return 'bing'
    if (host.includes('twitter') || host.includes('x.com')) return 'twitter'
    if (host.includes('facebook')) return 'facebook'
    if (host.includes('linkedin')) return 'linkedin'
    if (host.includes('github')) return 'github'
    return host
  }
  catch {
    return 'unknown'
  }
}

// Note: marshalPageView, marshalSession, marshalCustomEvent functions removed
// Now using Eloquent models from ../src/models/eloquent

// Response helper
function response(body: unknown, statusCode = 200, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }
}

// Helper to parse date range from query params
function parseDateRange(query: Record<string, string> | undefined): { startDate: Date; endDate: Date } {
  const now = new Date()
  const endDate = query?.endDate ? new Date(query.endDate) : now
  let startDate: Date

  if (query?.startDate) {
    startDate = new Date(query.startDate)
  } else {
    // Default to last 30 days
    startDate = new Date(now)
    startDate.setDate(startDate.getDate() - 30)
  }

  return { startDate, endDate }
}

// Helper to format duration in mm:ss
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

// Note: unmarshall function removed - now using imported unmarshall from models/eloquent

// Dashboard HTML (embedded for single-file deployment)
function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analytics Dashboard</title>
  <script>
    const urlParams = new URLSearchParams(window.location.search)
    const API_ENDPOINT = window.ANALYTICS_API_ENDPOINT || urlParams.get('api') || window.location.origin
    const SITE_ID = urlParams.get('siteId') || window.ANALYTICS_SITE_ID || ''

    let siteName = "Analytics Dashboard"
    let siteId = SITE_ID
    let stats = { realtime: 0, people: 0, views: 0, avgTime: "00:00", bounceRate: 0, events: 0 }
    let pages = [], referrers = [], deviceTypes = [], browsers = [], countries = [], campaigns = [], events = [], timeSeriesData = []

    async function fetchDashboardData() {
      if (!siteId) {
        document.getElementById('no-site-warning').style.display = 'block'
        return
      }
      document.getElementById('no-site-warning').style.display = 'none'

      const baseUrl = \`\${API_ENDPOINT}/api/sites/\${siteId}\`
      const now = new Date()
      const thirtyDaysAgo = new Date(now)
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const params = \`?startDate=\${thirtyDaysAgo.toISOString()}&endDate=\${now.toISOString()}\`

      try {
        const [statsRes, realtimeRes, pagesRes, referrersRes, devicesRes, browsersRes, countriesRes, timeseriesRes, eventsRes, campaignsRes] = await Promise.all([
          fetch(\`\${baseUrl}/stats\${params}\`).then(r => r.json()).catch(() => ({})),
          fetch(\`\${baseUrl}/realtime\`).then(r => r.json()).catch(() => ({ currentVisitors: 0 })),
          fetch(\`\${baseUrl}/pages\${params}\`).then(r => r.json()).catch(() => ({ pages: [] })),
          fetch(\`\${baseUrl}/referrers\${params}\`).then(r => r.json()).catch(() => ({ referrers: [] })),
          fetch(\`\${baseUrl}/devices\${params}\`).then(r => r.json()).catch(() => ({ deviceTypes: [] })),
          fetch(\`\${baseUrl}/browsers\${params}\`).then(r => r.json()).catch(() => ({ browsers: [] })),
          fetch(\`\${baseUrl}/countries\${params}\`).then(r => r.json()).catch(() => ({ countries: [] })),
          fetch(\`\${baseUrl}/timeseries\${params}\`).then(r => r.json()).catch(() => ({ timeSeries: [] })),
          fetch(\`\${baseUrl}/events\${params}\`).then(r => r.json()).catch(() => ({ events: [] })),
          fetch(\`\${baseUrl}/campaigns\${params}\`).then(r => r.json()).catch(() => ({ campaigns: [] })),
        ])

        stats = { realtime: realtimeRes.currentVisitors || 0, people: statsRes.people || 0, views: statsRes.views || 0, avgTime: statsRes.avgTime || "00:00", bounceRate: statsRes.bounceRate || 0, events: statsRes.events || 0 }
        pages = pagesRes.pages || []
        referrers = referrersRes.referrers || []
        deviceTypes = devicesRes.deviceTypes || []
        browsers = browsersRes.browsers || []
        countries = countriesRes.countries || []
        campaigns = campaignsRes.campaigns || []
        events = eventsRes.events || []
        timeSeriesData = timeseriesRes.timeSeries || []
        renderDashboard()
      } catch (error) { console.error('Failed to fetch:', error) }
    }

    function fmt(n) { return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n) }

    function renderDashboard() {
      document.getElementById('stat-realtime').textContent = fmt(stats.realtime)
      document.getElementById('stat-people').textContent = fmt(stats.people)
      document.getElementById('stat-views').textContent = fmt(stats.views)
      document.getElementById('stat-avgtime').textContent = stats.avgTime
      document.getElementById('stat-bounce').textContent = stats.bounceRate + '%'
      document.getElementById('stat-events').textContent = fmt(stats.events)
      document.getElementById('realtime-count').textContent = stats.realtime + ' current visitors'
      document.getElementById('pages-body').innerHTML = pages.length ? pages.map(p => \`<tr><td class="name" title="\${p.path}">\${p.path}</td><td class="value">\${fmt(p.entries||0)}</td><td class="value">\${fmt(p.visitors||0)}</td><td class="value">\${fmt(p.views||0)}</td></tr>\`).join('') : '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:1rem">No data</td></tr>'
      document.getElementById('referrers-body').innerHTML = referrers.length ? referrers.map(r => \`<tr><td class="name">\${r.source}</td><td class="value">\${fmt(r.visitors||0)}</td><td class="value">\${fmt(r.views||0)}</td></tr>\`).join('') : '<tr><td colspan="3" style="text-align:center;color:#6b7280;padding:1rem">No data</td></tr>'
      document.getElementById('devices-body').innerHTML = deviceTypes.length ? deviceTypes.map(d => \`<tr><td class="name">\${d.type}</td><td class="value">\${fmt(d.visitors||0)}</td></tr>\`).join('') : '<tr><td colspan="2" style="text-align:center;color:#6b7280;padding:1rem">No data</td></tr>'
      document.getElementById('browsers-body').innerHTML = browsers.length ? browsers.map(b => \`<tr><td class="name">\${b.name}</td><td class="value">\${fmt(b.visitors||0)}</td></tr>\`).join('') : '<tr><td colspan="2" style="text-align:center;color:#6b7280;padding:1rem">No data</td></tr>'
      document.getElementById('countries-body').innerHTML = countries.length ? countries.map(c => \`<tr><td class="name">\${c.name}</td><td class="value">\${fmt(c.visitors||0)}</td></tr>\`).join('') : '<tr><td colspan="2" style="text-align:center;color:#6b7280;padding:1rem">No data</td></tr>'
      document.getElementById('campaigns-body').innerHTML = campaigns.length ? campaigns.map(c => \`<tr><td class="name">\${c.name}</td><td class="value">\${fmt(c.visitors||0)}</td><td class="value">\${fmt(c.views||0)}</td></tr>\`).join('') : '<tr><td colspan="3" style="text-align:center;color:#6b7280;padding:1rem">No data</td></tr>'
      document.getElementById('events-container').innerHTML = events.length ? \`<table class="data-table"><thead><tr><th>Event</th><th style="text-align:right">Count</th><th style="text-align:right">Unique</th></tr></thead><tbody>\${events.map(e => \`<tr><td class="name">\${e.name}</td><td class="value">\${fmt(e.count||0)}</td><td class="value">\${fmt(e.unique||0)}</td></tr>\`).join('')}</tbody></table>\` : '<div class="empty-state"><p>No events tracked yet.</p></div>'
      renderChart()
    }

    function renderChart() {
      const canvas = document.getElementById('chart')
      if (!canvas || !timeSeriesData.length) return
      const ctx = canvas.getContext('2d')
      const rect = canvas.parentElement.getBoundingClientRect()
      canvas.width = rect.width - 48
      canvas.height = 200
      const pad = { top: 20, right: 20, bottom: 30, left: 50 }
      const w = canvas.width - pad.left - pad.right
      const h = canvas.height - pad.top - pad.bottom
      const maxV = Math.max(...timeSeriesData.map(d => d.views), 1)
      const xS = w / (timeSeriesData.length - 1 || 1)
      const yS = h / maxV
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = '#374151'; ctx.lineWidth = 1
      for (let i = 0; i <= 4; i++) { const y = pad.top + (h/4)*i; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left+w, y); ctx.stroke() }
      ctx.beginPath(); ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 2
      timeSeriesData.forEach((d, i) => { const x = pad.left + i*xS, y = pad.top + h - d.views*yS; i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y) })
      ctx.stroke()
      ctx.beginPath(); ctx.fillStyle = 'rgba(129,140,248,0.1)'
      timeSeriesData.forEach((d, i) => { const x = pad.left + i*xS, y = pad.top + h - d.views*yS; i===0 ? (ctx.moveTo(x,pad.top+h), ctx.lineTo(x,y)) : ctx.lineTo(x,y) })
      ctx.lineTo(pad.left + (timeSeriesData.length-1)*xS, pad.top+h); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'
      for (let i = 0; i <= 4; i++) { ctx.fillText(fmt(Math.round(maxV - (maxV/4)*i)), pad.left-10, pad.top+(h/4)*i+3) }
    }

    document.addEventListener('DOMContentLoaded', () => { fetchDashboardData(); setInterval(fetchDashboardData, 30000) })
    window.addEventListener('resize', () => { if (timeSeriesData.length) renderChart() })
  </script>
  <style>
    :root { --bg: #1a1f2e; --bg2: #242938; --bg3: #2d3344; --text: #fff; --text2: #9ca3af; --muted: #6b7280; --accent: #818cf8; --success: #10b981; --border: #374151 }
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; min-height: 100vh }
    .dash { max-width: 1400px; margin: 0 auto; padding: 1rem }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; border-bottom: 1px solid var(--border); margin-bottom: 1rem }
    .site-name { font-size: 1.25rem; font-weight: 600 }
    .realtime-badge { display: flex; align-items: center; gap: 0.5rem; background: var(--bg2); padding: 0.5rem 1rem; border-radius: 9999px; font-size: 0.875rem }
    .pulse { width: 8px; height: 8px; background: var(--success); border-radius: 50%; animation: pulse 2s infinite }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.5 } }
    .warning { background: #7c2d12; color: #fed7aa; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; display: none }
    .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1rem; margin-bottom: 1.5rem }
    .stat { background: var(--bg2); padding: 1.25rem; border-radius: 8px; text-align: center }
    .stat-val { font-size: 1.75rem; font-weight: 600 }
    .stat-lbl { font-size: 0.75rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em }
    .chart-box { background: var(--bg2); border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; min-height: 250px }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem }
    .panel { background: var(--bg2); border-radius: 8px; padding: 1rem }
    .panel-title { font-size: 0.875rem; font-weight: 500; margin-bottom: 1rem }
    .data-table { width: 100%; font-size: 0.8125rem }
    .data-table th { text-align: left; color: var(--muted); font-weight: 500; padding: 0.5rem 0; border-bottom: 1px solid var(--border); font-size: 0.6875rem; text-transform: uppercase }
    .data-table td { padding: 0.625rem 0; border-bottom: 1px solid var(--bg3) }
    .data-table tr:last-child td { border-bottom: none }
    .data-table .name { color: var(--text); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
    .data-table .value { color: var(--text2); text-align: right }
    .events { background: var(--bg2); border-radius: 8px; padding: 1.5rem }
    .empty-state { text-align: center; padding: 2rem; color: var(--muted) }
    @media (max-width: 1024px) { .stats { grid-template-columns: repeat(3, 1fr) } .grid { grid-template-columns: 1fr } }
    @media (max-width: 640px) { .stats { grid-template-columns: repeat(2, 1fr) } .header { flex-direction: column; gap: 1rem } }
  </style>
</head>
<body>
  <div class="dash">
    <header class="header">
      <span class="site-name">Analytics Dashboard</span>
      <div class="realtime-badge"><span class="pulse"></span><span id="realtime-count">0 current visitors</span></div>
    </header>
    <div id="no-site-warning" class="warning">No siteId specified. Add <code>?siteId=YOUR_SITE_ID</code> to the URL.</div>
    <div class="stats">
      <div class="stat"><div class="stat-val" id="stat-realtime">0</div><div class="stat-lbl">Realtime</div></div>
      <div class="stat"><div class="stat-val" id="stat-people">0</div><div class="stat-lbl">People</div></div>
      <div class="stat"><div class="stat-val" id="stat-views">0</div><div class="stat-lbl">Views</div></div>
      <div class="stat"><div class="stat-val" id="stat-avgtime">00:00</div><div class="stat-lbl">Avg time</div></div>
      <div class="stat"><div class="stat-val" id="stat-bounce">0%</div><div class="stat-lbl">Bounce</div></div>
      <div class="stat"><div class="stat-val" id="stat-events">0</div><div class="stat-lbl">Events</div></div>
    </div>
    <div class="chart-box"><canvas id="chart"></canvas></div>
    <div class="grid">
      <div class="panel"><div class="panel-title">Pages</div><table class="data-table"><thead><tr><th>Path</th><th style="text-align:right">Entries</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th></tr></thead><tbody id="pages-body"><tr><td colspan="4" style="text-align:center;color:#6b7280;padding:1rem">Loading...</td></tr></tbody></table></div>
      <div class="panel"><div class="panel-title">Referrers</div><table class="data-table"><thead><tr><th>Source</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th></tr></thead><tbody id="referrers-body"><tr><td colspan="3" style="text-align:center;color:#6b7280;padding:1rem">Loading...</td></tr></tbody></table></div>
    </div>
    <div class="grid">
      <div class="panel"><div class="panel-title">Devices</div><table class="data-table"><thead><tr><th>Type</th><th style="text-align:right">Visitors</th></tr></thead><tbody id="devices-body"><tr><td colspan="2" style="text-align:center;color:#6b7280;padding:1rem">Loading...</td></tr></tbody></table></div>
      <div class="panel"><div class="panel-title">Browsers</div><table class="data-table"><thead><tr><th>Browser</th><th style="text-align:right">Visitors</th></tr></thead><tbody id="browsers-body"><tr><td colspan="2" style="text-align:center;color:#6b7280;padding:1rem">Loading...</td></tr></tbody></table></div>
    </div>
    <div class="grid">
      <div class="panel"><div class="panel-title">Countries</div><table class="data-table"><thead><tr><th>Country</th><th style="text-align:right">Visitors</th></tr></thead><tbody id="countries-body"><tr><td colspan="2" style="text-align:center;color:#6b7280;padding:1rem">Loading...</td></tr></tbody></table></div>
      <div class="panel"><div class="panel-title">Campaigns</div><table class="data-table"><thead><tr><th>Campaign</th><th style="text-align:right">Visitors</th><th style="text-align:right">Views</th></tr></thead><tbody id="campaigns-body"><tr><td colspan="3" style="text-align:center;color:#6b7280;padding:1rem">Loading...</td></tr></tbody></table></div>
    </div>
    <div class="events"><div class="panel-title">Events</div><div id="events-container"><div class="empty-state"><p>Loading...</p></div></div></div>
  </div>
</body>
</html>`
}

// Route handlers
async function handleCollect(event: LambdaEvent) {
  try {
    const payload = JSON.parse(event.body || '{}')

    if (!payload?.s || !payload?.e || !payload?.u) {
      return response({ error: 'Missing required fields: s, e, u' }, 400)
    }

    // Support both v1 and v2 formats for source IP
    const ip = event.requestContext?.http?.sourceIp || event.headers?.['x-forwarded-for']?.split(',')[0] || 'unknown'
    const userAgent = event.requestContext?.http?.userAgent || event.headers?.['user-agent'] || 'unknown'
    const salt = getDailySalt()
    const visitorId = await hashVisitorId(ip, userAgent, payload.s, salt)

    let parsedUrl: URL
    try {
      parsedUrl = new URL(payload.u)
    }
    catch {
      return response({ error: 'Invalid URL' }, 400)
    }

    const timestamp = new Date()
    const sessionId = payload.sid

    const sessionKey = `${payload.s}:${sessionId}`
    let session = getSession(sessionKey)
    const isNewSession = !session

    if (payload.e === 'pageview') {
      const deviceInfo = parseUserAgent(userAgent)
      const referrerSource = parseReferrerSource(payload.r)

      // Record page view using Eloquent model
      await PageViewModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        path: parsedUrl.pathname,
        hostname: parsedUrl.hostname,
        title: payload.t,
        referrer: payload.r,
        referrerSource,
        utmSource: parsedUrl.searchParams.get('utm_source') || undefined,
        utmMedium: parsedUrl.searchParams.get('utm_medium') || undefined,
        utmCampaign: parsedUrl.searchParams.get('utm_campaign') || undefined,
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        screenWidth: payload.sw,
        screenHeight: payload.sh,
        isUnique: isNewSession,
        isBounce: isNewSession,
        timestamp,
      })

      if (session) {
        session.pageViewCount += 1
        session.exitPath = parsedUrl.pathname
        session.endedAt = timestamp
        session.isBounce = false
        session.duration = timestamp.getTime() - session.startedAt.getTime()
      }
      else {
        session = {
          id: sessionId,
          siteId: payload.s,
          visitorId,
          entryPath: parsedUrl.pathname,
          exitPath: parsedUrl.pathname,
          referrer: payload.r,
          referrerSource,
          utmSource: parsedUrl.searchParams.get('utm_source') || undefined,
          utmMedium: parsedUrl.searchParams.get('utm_medium') || undefined,
          utmCampaign: parsedUrl.searchParams.get('utm_campaign') || undefined,
          deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          pageViewCount: 1,
          eventCount: 0,
          isBounce: true,
          duration: 0,
          startedAt: timestamp,
          endedAt: timestamp,
        }
      }

      // Upsert session using Eloquent model
      await SessionModel.upsert(session)
      setSession(sessionKey, session)
    }
    else if (payload.e === 'event') {
      // Handle custom events (e.g., button clicks, form submissions)
      const props = payload.p || {}
      const eventName = props.name || 'unnamed'
      const eventValue = typeof props.value === 'number' ? props.value : undefined

      // Record custom event using Eloquent model
      await CustomEventModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        name: eventName,
        value: eventValue,
        path: parsedUrl.pathname,
        timestamp,
      })

      // Update session event count
      if (session) {
        session.eventCount += 1
        session.endedAt = timestamp
        session.duration = timestamp.getTime() - session.startedAt.getTime()

        await SessionModel.upsert(session)
        setSession(sessionKey, session)
      }
    }
    else if (payload.e === 'outbound') {
      // Handle outbound link clicks
      const props = payload.p || {}

      // Record outbound event using Eloquent model
      await CustomEventModel.record({
        id: generateId(),
        siteId: payload.s,
        visitorId,
        sessionId,
        name: 'outbound',
        properties: { url: props.url || '' },
        path: parsedUrl.pathname,
        timestamp,
      })

      // Update session event count
      if (session) {
        session.eventCount += 1
        session.endedAt = timestamp
        session.duration = timestamp.getTime() - session.startedAt.getTime()

        await SessionModel.upsert(session)
        setSession(sessionKey, session)
      }
    }
    else if (payload.e === 'hm_click') {
      // Handle heatmap click event
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      await HeatmapClick.record({
        id: generateId(),
        siteId: payload.s,
        sessionId,
        visitorId,
        path: payload.u,
        viewportX: props.vx || 0,
        viewportY: props.vy || 0,
        documentX: props.dx || 0,
        documentY: props.dy || 0,
        viewportWidth: props.vw || 0,
        viewportHeight: props.vh || 0,
        selector: props.selector || '',
        elementTag: props.tag || '',
        elementText: props.text,
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        timestamp,
      })
    }
    else if (payload.e === 'hm_move') {
      // Handle heatmap movement batch event
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      if (props.points && Array.isArray(props.points) && props.points.length > 0) {
        await HeatmapMovement.record({
          id: generateId(),
          siteId: payload.s,
          sessionId,
          visitorId,
          path: payload.u,
          points: props.points,
          viewportWidth: props.vw || 0,
          viewportHeight: props.vh || 0,
          deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
          timestamp,
        })
      }
    }
    else if (payload.e === 'hm_scroll') {
      // Handle heatmap scroll data event
      const props = payload.p || {}
      const deviceInfo = parseUserAgent(userAgent)

      await HeatmapScroll.upsert({
        id: `${sessionId}-${encodeURIComponent(payload.u)}`,
        siteId: payload.s,
        sessionId,
        visitorId,
        path: payload.u,
        maxScrollDepth: props.maxDepth || 0,
        scrollDepths: props.depths || {},
        documentHeight: props.docHeight || 0,
        viewportHeight: props.vh || 0,
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet' | 'unknown',
        timestamp,
      })
    }

    return response(null, 204)
  }
  catch (error) {
    console.error('Collect error:', error)
    return response({ error: 'Internal server error' }, 500)
  }
}

async function handleHealth() {
  return response({ status: 'ok', timestamp: new Date().toISOString() })
}

async function handleDashboard() {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
    body: getDashboardHtml(),
  }
}

async function handleScript(event: LambdaEvent) {
  // Extract siteId from path (v2 format: /sites/{siteId}/script)
  const path = event.rawPath || event.path || ''
  const pathMatch = path.match(/\/sites\/([^/]+)\/script/)
  const siteId = event.pathParameters?.siteId || (pathMatch ? pathMatch[1] : null)
  const apiEndpoint = event.queryStringParameters?.api || `https://${event.requestContext?.domainName}`
  const minimal = event.queryStringParameters?.minimal === 'true'

  if (!siteId) {
    return response({ error: 'Missing siteId' }, 400)
  }

  const script = minimal
    ? generateMinimalTrackingScript({ siteId, apiEndpoint, honorDnt: true })
    : generateTrackingScript({ siteId, apiEndpoint, honorDnt: true, trackOutboundLinks: true })

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
    body: script,
  }
}

// ============================================================================
// Dashboard Query Handlers
// ============================================================================

async function handleGetStats(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const startDateStr = startDate.toISOString().slice(0, 10)
    const endDateStr = endDate.toISOString().slice(0, 10)

    // Query pageviews for the date range
    const pageviewsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${startDate.toISOString()}` },
        ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
      },
    }) as { Items?: any[]; Count?: number }

    // Query sessions for the date range
    const sessionsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[]; Count?: number }

    // Query realtime visitors (last 5 minutes)
    const realtimeCutoff = new Date(Date.now() - 5 * 60 * 1000)
    const realtimeResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk >= :start',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${realtimeCutoff.toISOString()}` },
      },
    }) as { Items?: any[] }
    const realtimePageviews = (realtimeResult.Items || []).map(unmarshall)
    const realtimeVisitors = new Set(realtimePageviews.map(pv => pv.visitorId)).size

    const pageviews = pageviewsResult.Items || []
    const sessions = (sessionsResult.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Calculate stats
    const uniqueVisitors = new Set(pageviews.map((pv: any) => pv.visitorId?.S)).size
    const totalViews = pageviews.length
    const totalSessions = sessions.length
    const bounces = sessions.filter(s => s.isBounce).length
    const bounceRate = totalSessions > 0 ? Math.round((bounces / totalSessions) * 100) : 0
    const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0)
    const avgDuration = totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0
    const totalEvents = sessions.reduce((sum, s) => sum + (s.eventCount || 0), 0)

    return response({
      realtime: realtimeVisitors,
      people: uniqueVisitors,
      views: totalViews,
      avgTime: formatDuration(avgDuration),
      avgTimeMs: avgDuration,
      bounceRate,
      events: totalEvents,
      sessions: totalSessions,
      dateRange: { start: startDateStr, end: endDateStr },
    })
  } catch (error) {
    console.error('Stats error:', error)
    return response({ error: 'Failed to fetch stats' }, 500)
  }
}

async function handleGetRealtime(siteId: string, event: LambdaEvent) {
  try {
    const minutes = Number(event.queryStringParameters?.minutes) || 5
    const cutoff = new Date(Date.now() - minutes * 60 * 1000)

    // Query recent pageviews
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk >= :start',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${cutoff.toISOString()}` },
      },
    }) as { Items?: any[] }

    const pageviews = (result.Items || []).map(unmarshall)
    const uniqueVisitors = new Set(pageviews.map(pv => pv.visitorId)).size

    // Get active pages
    const pageCounts: Record<string, number> = {}
    for (const pv of pageviews) {
      pageCounts[pv.path] = (pageCounts[pv.path] || 0) + 1
    }

    const topActivePages = Object.entries(pageCounts)
      .map(([path, count]) => ({ name: path, value: count, percentage: 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)

    const total = topActivePages.reduce((sum, p) => sum + p.value, 0)
    topActivePages.forEach(p => {
      p.percentage = total > 0 ? Math.round((p.value / total) * 100) : 0
    })

    return response({
      currentVisitors: uniqueVisitors,
      pageViewsLastHour: pageviews.length,
      topActivePages,
    })
  } catch (error) {
    console.error('Realtime error:', error)
    return response({ error: 'Failed to fetch realtime data' }, 500)
  }
}

async function handleGetPages(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query pageviews
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${startDate.toISOString()}` },
        ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const pageviews = (result.Items || []).map(unmarshall)

    // Aggregate by path
    const pageStats: Record<string, { views: number; visitors: Set<string>; entries: number }> = {}
    for (const pv of pageviews) {
      if (!pageStats[pv.path]) {
        pageStats[pv.path] = { views: 0, visitors: new Set(), entries: 0 }
      }
      pageStats[pv.path].views++
      pageStats[pv.path].visitors.add(pv.visitorId)
      if (pv.isUnique) pageStats[pv.path].entries++
    }

    const pages = Object.entries(pageStats)
      .map(([path, stats]) => ({
        path,
        views: stats.views,
        visitors: stats.visitors.size,
        entries: stats.entries,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, limit)

    return response({ pages })
  } catch (error) {
    console.error('Pages error:', error)
    return response({ error: 'Failed to fetch pages' }, 500)
  }
}

async function handleGetReferrers(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Aggregate by referrer source
    const referrerStats: Record<string, { visitors: Set<string>; views: number }> = {}
    for (const s of sessions) {
      const source = s.referrerSource || 'direct'
      if (!referrerStats[source]) {
        referrerStats[source] = { visitors: new Set(), views: 0 }
      }
      referrerStats[source].visitors.add(s.visitorId)
      referrerStats[source].views += s.pageViewCount || 1
    }

    const referrers = Object.entries(referrerStats)
      .map(([source, stats]) => ({
        source,
        visitors: stats.visitors.size,
        views: stats.views,
      }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ referrers })
  } catch (error) {
    console.error('Referrers error:', error)
    return response({ error: 'Failed to fetch referrers' }, 500)
  }
}

async function handleGetDevices(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Aggregate by device type
    const deviceStats: Record<string, Set<string>> = {}
    const osStats: Record<string, Set<string>> = {}

    for (const s of sessions) {
      const device = s.deviceType || 'unknown'
      const os = s.os || 'Unknown'

      if (!deviceStats[device]) deviceStats[device] = new Set()
      deviceStats[device].add(s.visitorId)

      if (!osStats[os]) osStats[os] = new Set()
      osStats[os].add(s.visitorId)
    }

    const deviceTypes = Object.entries(deviceStats)
      .map(([type, visitors]) => ({ type, visitors: visitors.size }))
      .sort((a, b) => b.visitors - a.visitors)

    const operatingSystems = Object.entries(osStats)
      .map(([name, visitors]) => ({ name, visitors: visitors.size }))
      .sort((a, b) => b.visitors - a.visitors)

    return response({ deviceTypes, operatingSystems })
  } catch (error) {
    console.error('Devices error:', error)
    return response({ error: 'Failed to fetch devices' }, 500)
  }
}

async function handleGetBrowsers(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Aggregate by browser
    const browserStats: Record<string, Set<string>> = {}
    for (const s of sessions) {
      const browser = s.browser || 'Unknown'
      if (!browserStats[browser]) browserStats[browser] = new Set()
      browserStats[browser].add(s.visitorId)
    }

    const browsers = Object.entries(browserStats)
      .map(([name, visitors]) => ({ name, visitors: visitors.size }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ browsers })
  } catch (error) {
    console.error('Browsers error:', error)
    return response({ error: 'Failed to fetch browsers' }, 500)
  }
}

async function handleGetCountries(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Aggregate by country (note: country tracking requires geolocation which may not be enabled)
    const countryStats: Record<string, Set<string>> = {}
    for (const s of sessions) {
      const country = s.country || 'Unknown'
      if (!countryStats[country]) countryStats[country] = new Set()
      countryStats[country].add(s.visitorId)
    }

    const countries = Object.entries(countryStats)
      .map(([name, visitors]) => ({ name, code: '', flag: '', visitors: visitors.size }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ countries })
  } catch (error) {
    console.error('Countries error:', error)
    return response({ error: 'Failed to fetch countries' }, 500)
  }
}

async function handleGetTimeSeries(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const period = event.queryStringParameters?.period || 'day'

    // Query pageviews
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${startDate.toISOString()}` },
        ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const pageviews = (result.Items || []).map(unmarshall)

    // Group by period
    const buckets: Record<string, { views: number; visitors: Set<string>; sessions: Set<string> }> = {}

    for (const pv of pageviews) {
      const date = new Date(pv.timestamp)
      let key: string

      if (period === 'hour') {
        key = `${date.toISOString().slice(0, 13)}:00:00`
      } else if (period === 'month') {
        key = date.toISOString().slice(0, 7)
      } else {
        key = date.toISOString().slice(0, 10)
      }

      if (!buckets[key]) {
        buckets[key] = { views: 0, visitors: new Set(), sessions: new Set() }
      }
      buckets[key].views++
      buckets[key].visitors.add(pv.visitorId)
      buckets[key].sessions.add(pv.sessionId)
    }

    const timeSeries = Object.entries(buckets)
      .map(([date, stats]) => ({
        date,
        views: stats.views,
        visitors: stats.visitors.size,
        sessions: stats.sessions.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return response({ timeSeries })
  } catch (error) {
    console.error('TimeSeries error:', error)
    return response({ error: 'Failed to fetch time series' }, 500)
  }
}

async function handleGetEvents(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query events
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `EVENT#${startDate.toISOString()}` },
        ':end': { S: `EVENT#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const events = (result.Items || []).map(unmarshall)

    // Aggregate by event name
    const eventStats: Record<string, { count: number; visitors: Set<string>; totalValue: number }> = {}
    for (const e of events) {
      const name = e.name || 'unnamed'
      if (!eventStats[name]) {
        eventStats[name] = { count: 0, visitors: new Set(), totalValue: 0 }
      }
      eventStats[name].count++
      eventStats[name].visitors.add(e.visitorId)
      if (e.value) eventStats[name].totalValue += e.value
    }

    const eventList = Object.entries(eventStats)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        unique: stats.visitors.size,
        totalValue: stats.totalValue,
        avgValue: stats.count > 0 ? stats.totalValue / stats.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    return response({ events: eventList })
  } catch (error) {
    console.error('Events error:', error)
    return response({ error: 'Failed to fetch events' }, 500)
  }
}

async function handleGetCampaigns(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && s.utmCampaign
    })

    // Aggregate by UTM campaign
    const campaignStats: Record<string, { visitors: Set<string>; views: number }> = {}
    const sourceStats: Record<string, { visitors: Set<string>; views: number }> = {}
    const mediumStats: Record<string, { visitors: Set<string>; views: number }> = {}

    for (const s of sessions) {
      if (s.utmCampaign) {
        if (!campaignStats[s.utmCampaign]) campaignStats[s.utmCampaign] = { visitors: new Set(), views: 0 }
        campaignStats[s.utmCampaign].visitors.add(s.visitorId)
        campaignStats[s.utmCampaign].views += s.pageViewCount || 1
      }
      if (s.utmSource) {
        if (!sourceStats[s.utmSource]) sourceStats[s.utmSource] = { visitors: new Set(), views: 0 }
        sourceStats[s.utmSource].visitors.add(s.visitorId)
        sourceStats[s.utmSource].views += s.pageViewCount || 1
      }
      if (s.utmMedium) {
        if (!mediumStats[s.utmMedium]) mediumStats[s.utmMedium] = { visitors: new Set(), views: 0 }
        mediumStats[s.utmMedium].visitors.add(s.visitorId)
        mediumStats[s.utmMedium].views += s.pageViewCount || 1
      }
    }

    const campaigns = Object.entries(campaignStats)
      .map(([name, stats]) => ({ name, visitors: stats.visitors.size, views: stats.views }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    const sources = Object.entries(sourceStats)
      .map(([name, stats]) => ({ name, visitors: stats.visitors.size, views: stats.views }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    const mediums = Object.entries(mediumStats)
      .map(([name, stats]) => ({ name, visitors: stats.visitors.size, views: stats.views }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return response({ campaigns, sources, mediums })
  } catch (error) {
    console.error('Campaigns error:', error)
    return response({ error: 'Failed to fetch campaigns' }, 500)
  }
}

// ============================================================================
// Heatmap Query Handlers
// ============================================================================

async function handleGetHeatmapClicks(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const path = event.queryStringParameters?.path
    const device = event.queryStringParameters?.device // 'desktop' | 'mobile' | 'tablet' | 'all'
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 1000, 10000)

    // Query heatmap clicks
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `HMCLICK#${startDate.toISOString()}` },
        ':end': { S: `HMCLICK#${endDate.toISOString()}` },
      },
      Limit: limit,
    }) as { Items?: any[] }

    let clicks = (result.Items || []).map(unmarshall)

    // Filter by path if specified
    if (path) {
      clicks = clicks.filter(c => c.path === path || c.path === decodeURIComponent(path))
    }

    // Filter by device type if specified
    if (device && device !== 'all') {
      clicks = clicks.filter(c => c.deviceType === device)
    }

    // Aggregate clicks by position for heatmap visualization
    // Group clicks into grid cells for density calculation
    const gridSize = Number(event.queryStringParameters?.gridSize) || 20 // pixels
    const clickGrid: Record<string, { count: number; elements: Record<string, number> }> = {}

    for (const click of clicks) {
      // Use document coordinates for consistent positioning
      const gridX = Math.floor(click.documentX / gridSize) * gridSize
      const gridY = Math.floor(click.documentY / gridSize) * gridSize
      const key = `${gridX},${gridY}`

      if (!clickGrid[key]) {
        clickGrid[key] = { count: 0, elements: {} }
      }
      clickGrid[key].count++

      // Track clicked elements
      if (click.selector) {
        clickGrid[key].elements[click.selector] = (clickGrid[key].elements[click.selector] || 0) + 1
      }
    }

    // Convert grid to array format for visualization
    const heatmapData = Object.entries(clickGrid).map(([key, data]) => {
      const [x, y] = key.split(',').map(Number)
      const topElement = Object.entries(data.elements)
        .sort((a, b) => b[1] - a[1])[0]

      return {
        x,
        y,
        count: data.count,
        topElement: topElement ? { selector: topElement[0], count: topElement[1] } : null,
      }
    })

    // Also return top clicked elements
    const elementStats: Record<string, { count: number; tag: string; text?: string }> = {}
    for (const click of clicks) {
      if (click.selector) {
        if (!elementStats[click.selector]) {
          elementStats[click.selector] = { count: 0, tag: click.elementTag || '', text: click.elementText }
        }
        elementStats[click.selector].count++
      }
    }

    const topElements = Object.entries(elementStats)
      .map(([selector, stats]) => ({
        selector,
        tag: stats.tag,
        text: stats.text,
        count: stats.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    return response({
      clicks: heatmapData,
      topElements,
      totalClicks: clicks.length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Heatmap clicks error:', error)
    return response({ error: 'Failed to fetch heatmap clicks' }, 500)
  }
}

async function handleGetHeatmapScroll(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const path = event.queryStringParameters?.path
    const device = event.queryStringParameters?.device

    // Query heatmap scroll data
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'HMSCROLL#' },
      },
    }) as { Items?: any[] }

    let scrollData = (result.Items || []).map(unmarshall).filter(s => {
      const timestamp = new Date(s.timestamp)
      return timestamp >= startDate && timestamp <= endDate
    })

    // Filter by path if specified
    if (path) {
      scrollData = scrollData.filter(s => s.path === path || s.path === decodeURIComponent(path))
    }

    // Filter by device type if specified
    if (device && device !== 'all') {
      scrollData = scrollData.filter(s => s.deviceType === device)
    }

    // Aggregate scroll depth data
    const depthBuckets: Record<number, { sessions: number; totalTime: number }> = {}
    let totalSessions = 0
    let totalMaxDepth = 0

    for (const scroll of scrollData) {
      totalSessions++
      totalMaxDepth += scroll.maxScrollDepth || 0

      // Aggregate time spent at each depth bucket
      const depths = scroll.scrollDepths || {}
      for (const [depth, time] of Object.entries(depths)) {
        const depthNum = Number(depth)
        if (!depthBuckets[depthNum]) {
          depthBuckets[depthNum] = { sessions: 0, totalTime: 0 }
        }
        depthBuckets[depthNum].sessions++
        depthBuckets[depthNum].totalTime += time as number
      }
    }

    // Calculate reach percentage for each depth (what % of sessions reached this depth)
    const scrollDepths = Object.entries(depthBuckets)
      .map(([depth, data]) => ({
        depth: Number(depth),
        reachPercentage: totalSessions > 0 ? Math.round((data.sessions / totalSessions) * 100) : 0,
        avgTimeMs: data.sessions > 0 ? Math.round(data.totalTime / data.sessions) : 0,
        sessions: data.sessions,
      }))
      .sort((a, b) => a.depth - b.depth)

    // Calculate average max scroll depth
    const avgMaxDepth = totalSessions > 0 ? Math.round(totalMaxDepth / totalSessions) : 0

    return response({
      scrollDepths,
      avgMaxDepth,
      totalSessions,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Heatmap scroll error:', error)
    return response({ error: 'Failed to fetch heatmap scroll data' }, 500)
  }
}

async function handleGetHeatmapPages(siteId: string, event: LambdaEvent) {
  try {
    const { startDate, endDate } = parseDateRange(event.queryStringParameters)
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 20, 100)

    // Query heatmap clicks to find pages with data
    const clicksResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `HMCLICK#${startDate.toISOString()}` },
        ':end': { S: `HMCLICK#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    // Query heatmap scroll data
    const scrollResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'HMSCROLL#' },
      },
    }) as { Items?: any[] }

    const clicks = (clicksResult.Items || []).map(unmarshall)
    const scrolls = (scrollResult.Items || []).map(unmarshall).filter(s => {
      const timestamp = new Date(s.timestamp)
      return timestamp >= startDate && timestamp <= endDate
    })

    // Aggregate by page path
    const pageStats: Record<string, {
      clicks: number
      scrollSessions: number
      avgScrollDepth: number
      totalScrollDepth: number
    }> = {}

    for (const click of clicks) {
      const path = click.path
      if (!pageStats[path]) {
        pageStats[path] = { clicks: 0, scrollSessions: 0, avgScrollDepth: 0, totalScrollDepth: 0 }
      }
      pageStats[path].clicks++
    }

    for (const scroll of scrolls) {
      const path = scroll.path
      if (!pageStats[path]) {
        pageStats[path] = { clicks: 0, scrollSessions: 0, avgScrollDepth: 0, totalScrollDepth: 0 }
      }
      pageStats[path].scrollSessions++
      pageStats[path].totalScrollDepth += scroll.maxScrollDepth || 0
    }

    // Calculate averages and format response
    const pages = Object.entries(pageStats)
      .map(([path, stats]) => ({
        path,
        clicks: stats.clicks,
        scrollSessions: stats.scrollSessions,
        avgScrollDepth: stats.scrollSessions > 0
          ? Math.round(stats.totalScrollDepth / stats.scrollSessions)
          : 0,
        hasClickData: stats.clicks > 0,
        hasScrollData: stats.scrollSessions > 0,
      }))
      .sort((a, b) => (b.clicks + b.scrollSessions) - (a.clicks + a.scrollSessions))
      .slice(0, limit)

    return response({
      pages,
      totalPages: Object.keys(pageStats).length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Heatmap pages error:', error)
    return response({ error: 'Failed to fetch heatmap pages' }, 500)
  }
}

// Types for API Gateway HTTP API (v2) format
interface LambdaEvent {
  version?: string
  routeKey?: string
  rawPath?: string
  rawQueryString?: string
  headers?: Record<string, string>
  queryStringParameters?: Record<string, string>
  pathParameters?: Record<string, string>
  body?: string
  isBase64Encoded?: boolean
  requestContext?: {
    accountId?: string
    apiId?: string
    domainName?: string
    domainPrefix?: string
    http?: {
      method: string
      path: string
      protocol: string
      sourceIp: string
      userAgent: string
    }
    requestId?: string
    routeKey?: string
    stage?: string
    time?: string
    timeEpoch?: number
  }
  // Legacy v1 format support
  httpMethod?: string
  path?: string
  resource?: string
}

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

// Extract siteId from API path
function extractSiteId(path: string): string | null {
  const match = path.match(/\/api\/sites\/([^/]+)/)
  return match ? match[1] : null
}

// Main Lambda handler - supports both API Gateway v1 and v2 formats
export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  console.log('Event:', JSON.stringify(event))

  // Determine method and path (v2 vs v1 format)
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET'
  const path = event.rawPath || event.path || event.resource || '/'

  // Handle OPTIONS (CORS preflight)
  if (method === 'OPTIONS') {
    return response(null, 204)
  }

  // Route handling
  if (path === '/health' && method === 'GET') {
    return handleHealth()
  }

  if ((path === '/dashboard' || path === '/') && method === 'GET') {
    return handleDashboard()
  }

  if (path === '/collect' && method === 'POST') {
    return handleCollect(event)
  }

  if (path.match(/\/sites\/[^/]+\/script/) && method === 'GET') {
    return handleScript(event)
  }

  // Dashboard API routes
  if (method === 'GET') {
    const siteId = extractSiteId(path)

    if (siteId) {
      // /api/sites/{siteId}/stats
      if (path.endsWith('/stats')) {
        return handleGetStats(siteId, event)
      }
      // /api/sites/{siteId}/realtime
      if (path.endsWith('/realtime')) {
        return handleGetRealtime(siteId, event)
      }
      // /api/sites/{siteId}/pages
      if (path.endsWith('/pages')) {
        return handleGetPages(siteId, event)
      }
      // /api/sites/{siteId}/referrers
      if (path.endsWith('/referrers')) {
        return handleGetReferrers(siteId, event)
      }
      // /api/sites/{siteId}/devices
      if (path.endsWith('/devices')) {
        return handleGetDevices(siteId, event)
      }
      // /api/sites/{siteId}/browsers
      if (path.endsWith('/browsers')) {
        return handleGetBrowsers(siteId, event)
      }
      // /api/sites/{siteId}/countries
      if (path.endsWith('/countries')) {
        return handleGetCountries(siteId, event)
      }
      // /api/sites/{siteId}/timeseries
      if (path.endsWith('/timeseries')) {
        return handleGetTimeSeries(siteId, event)
      }
      // /api/sites/{siteId}/events
      if (path.endsWith('/events')) {
        return handleGetEvents(siteId, event)
      }
      // /api/sites/{siteId}/campaigns
      if (path.endsWith('/campaigns')) {
        return handleGetCampaigns(siteId, event)
      }
      // /api/sites/{siteId}/heatmap/clicks
      if (path.includes('/heatmap/clicks')) {
        return handleGetHeatmapClicks(siteId, event)
      }
      // /api/sites/{siteId}/heatmap/scroll
      if (path.includes('/heatmap/scroll')) {
        return handleGetHeatmapScroll(siteId, event)
      }
      // /api/sites/{siteId}/heatmap/pages
      if (path.includes('/heatmap/pages')) {
        return handleGetHeatmapPages(siteId, event)
      }
    }
  }

  return response({ error: 'Not found' }, 404)
}
