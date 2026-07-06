/**
 * Data export, GDPR, and retention handlers
 */

import { querySessionItemsInRange, dynamodb, TABLE_NAME, unmarshall, marshall, queryAllItems } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'
import { getUserPlan, planLimits } from '../lib/plans'

/**
 * GET /api/sites/{siteId}/export
 */
export async function handleExport(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const format = query.format || 'json'
    const dataType = query.type || 'pageviews'

    let items: any[] = []
    let prefix: string

    switch (dataType) {
      case 'sessions':
        prefix = 'SESSION#'
        break
      case 'events':
        prefix = 'EVENT#'
        break
      case 'pageviews':
      default:
        prefix = 'PAGEVIEW#'
    }

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `${prefix}${startDate.toISOString()}` },
        ':end': { S: `${prefix}${endDate.toISOString()}` },
      },
      Limit: 10000,
    }) as { Items?: any[] }

    items = (result.Items || []).map(unmarshall)

    if (format === 'csv') {
      const headers = items.length > 0 ? Object.keys(items[0]).join(',') : ''
      const rows = items.map(item => Object.values(item).map(v => JSON.stringify(v)).join(','))
      const csv = [headers, ...rows].join('\n')

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${siteId}-${dataType}-export.csv"`,
        },
      })
    }

    return jsonResponse({
      data: items,
      count: items.length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  }
catch (error) {
    console.error('Export error:', error)
    return errorResponse('Failed to export data')
  }
}

/**
 * GET /api/sites/{siteId}/retention
 */
export async function handleGetRetentionSettings(_request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':sk': { S: 'RETENTION_SETTINGS' },
      },
    }) as { Items?: any[] }

    const settings = result.Items?.[0] ? unmarshall(result.Items[0]) : {
      retentionDays: 365,
      autoDelete: true,
      anonymizeAfterDays: 90,
    }

    return jsonResponse({ settings })
  }
catch (error) {
    console.error('Get retention settings error:', error)
    return errorResponse('Failed to fetch retention settings')
  }
}

/**
 * PUT /api/sites/{siteId}/retention
 */
export async function handleUpdateRetentionSettings(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    // Plan limit (#62): retention is clamped to the owning account's plan.
    let retentionDays = body.retentionDays || 365
    try {
      const siteRes = await dynamodb.getItem({
        TableName: TABLE_NAME,
        Key: { pk: { S: 'SITES' }, sk: { S: `SITE#${siteId}` } },
      }) as { Item?: Record<string, any> }
      const ownerId = siteRes.Item ? unmarshall(siteRes.Item).ownerId : undefined
      if (ownerId) {
        const limits = planLimits(await getUserPlan(ownerId))
        if (limits.retentionDays > 0 && retentionDays > limits.retentionDays) {
          retentionDays = limits.retentionDays
        }
      }
    }
    catch {
      // clamp is best-effort; the requested value stands if the lookup fails
    }

    const settings = {
      pk: `SITE#${siteId}`,
      sk: 'RETENTION_SETTINGS',
      siteId,
      retentionDays,
      autoDelete: body.autoDelete ?? true,
      anonymizeAfterDays: body.anonymizeAfterDays || 90,
      updatedAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(settings),
    })

    return jsonResponse({ settings })
  }
catch (error) {
    console.error('Update retention settings error:', error)
    return errorResponse('Failed to update retention settings')
  }
}

/**
 * GET /api/sites/{siteId}/gdpr/export
 */
export async function handleGdprExport(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const visitorId = query.visitorId

    if (!visitorId) {
      return jsonResponse({ error: 'Missing required parameter: visitorId' }, 400)
    }

    // Query the visitor's rows from the main table. The old pageviews query hit
    // a visitor-keyed GSI ('gsi1' / VISITOR#) that doesn't exist — the live GSI
    // is keyed SITE#…#DATE#… — so it always returned nothing (#140). Filter the
    // site partition by visitorId instead, paginated so nothing truncates.
    const byPrefix = (prefix: string) => queryAllItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: 'visitorId = :visitorId',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: prefix },
        ':visitorId': { S: visitorId },
      },
    })
    const [pageviews, sessions, events] = await Promise.all([
      byPrefix('PAGEVIEW#'),
      byPrefix('SESSION#'),
      byPrefix('EVENT#'),
    ])

    return jsonResponse({
      visitorId,
      data: {
        pageviews: (pageviews.Items || []).map(unmarshall),
        sessions: (sessions.Items || []).map(unmarshall),
        events: (events.Items || []).map(unmarshall),
      },
      exportedAt: new Date().toISOString(),
    })
  }
catch (error) {
    console.error('GDPR export error:', error)
    return errorResponse('Failed to export GDPR data')
  }
}

/**
 * POST /api/sites/{siteId}/gdpr/delete
 */
export async function handleGdprDelete(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>
    const visitorId = body.visitorId

    if (!visitorId) {
      return jsonResponse({ error: 'Missing required field: visitorId' }, 400)
    }

    // Find every row in this site's partition belonging to the visitor, across
    // ALL record types. The old code queried a visitor-keyed GSI that never
    // existed, so it deleted nothing while reporting success (#140). Cookieless
    // daily-salting means a visitorId maps to roughly one day's worth of data.
    const result = await queryAllItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      FilterExpression: 'visitorId = :visitorId',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':visitorId': { S: visitorId },
      },
    })

    const items = result.Items.map(unmarshall)

    // Delete all items
    let deletedCount = 0
    for (const item of items) {
      try {
        await dynamodb.deleteItem({
          TableName: TABLE_NAME,
          Key: marshall({
            pk: item.pk,
            sk: item.sk,
          }),
        })
        deletedCount++
      }
catch (e) {
        console.error('Failed to delete item:', e)
      }
    }

    return jsonResponse({
      success: true,
      visitorId,
      deletedCount,
      deletedAt: new Date().toISOString(),
    })
  }
catch (error) {
    console.error('GDPR delete error:', error)
    return errorResponse('Failed to delete GDPR data')
  }
}

/**
 * GET /api/sites/{siteId}/insights — auto-detected, plain-language findings:
 * period-over-period traffic movement (with a first-traffic milestone instead
 * of silence for young sites), top mover pages, top referrer share, busiest
 * day, bounce-rate and mobile-share signals. Emits the Insight contract the
 * tab renders: type ∈ {traffic,referrer,page,device,engagement} (icon) and
 * severity ∈ {success,warning,error,info} (color).
 */
export async function handleGetInsights(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    // Current and previous periods of equal length
    const duration = endDate.getTime() - startDate.getTime()
    const previousStartDate = new Date(startDate.getTime() - duration)
    const previousEndDate = new Date(startDate.getTime() - 1)

    // Sessions (paginated — the old raw query silently truncated at ~1MB) and
    // pageviews for both periods in one range query each.
    const [sessionsResult, pageviewsResult] = await Promise.all([
      querySessionItemsInRange(siteId, previousStartDate, endDate) as Promise<{ Items?: any[] }>,
      queryAllItems({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':start': { S: `PAGEVIEW#${previousStartDate.toISOString()}` },
          ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
        },
      }) as Promise<{ Items?: any[] }>,
    ])

    const allSessions = (sessionsResult.Items || []).map(unmarshall)
    const currentSessions = allSessions.filter((s) => {
      const t = new Date(s.startedAt)
      return t >= startDate && t <= endDate
    })
    const previousSessions = allSessions.filter((s) => {
      const t = new Date(s.startedAt)
      return t >= previousStartDate && t <= previousEndDate
    })

    const pageviews = (pageviewsResult.Items || []).map(unmarshall)
    const currentPvs = pageviews.filter(pv => new Date(pv.timestamp) >= startDate)
    const previousPvs = pageviews.filter(pv => new Date(pv.timestamp) < startDate)

    const insights: Array<{ type: string, severity: string, title: string, description: string, metric?: string, change?: number }> = []

    // ── Traffic movement (or a first-traffic milestone for young sites — the
    // old previousTraffic>0 guard made the tab permanently empty for exactly
    // the sites that look at it most)
    const currentTraffic = currentSessions.length
    const previousTraffic = previousSessions.length
    if (previousTraffic > 0) {
      const change = ((currentTraffic - previousTraffic) / previousTraffic) * 100
      if (Math.abs(change) > 10) {
        insights.push({
          type: 'traffic',
          severity: change > 0 ? 'success' : 'warning',
          title: change > 0 ? 'Traffic Increase' : 'Traffic Decrease',
          description: `Sessions ${change > 0 ? 'increased' : 'decreased'} by ${Math.abs(Math.round(change))}% compared to the previous period (${currentTraffic} vs ${previousTraffic}).`,
          metric: 'sessions',
          change: Math.round(change),
        })
      }
    }
    else if (currentTraffic > 0) {
      const visitors = new Set(currentSessions.map(s => s.visitorId)).size
      insights.push({
        type: 'traffic',
        severity: 'success',
        title: 'Your Baseline Starts Now',
        description: `${visitors} visitor${visitors === 1 ? '' : 's'} across ${currentTraffic} session${currentTraffic === 1 ? '' : 's'} this period — with no traffic in the one before, this becomes the baseline future periods compare against.`,
        metric: 'sessions',
      })
    }

    // ── Top mover page (gainer vs previous period; falls back to the top page
    // when there is no previous data)
    const visitorsByPath = (pvs: any[]): Record<string, Set<string>> => {
      const out: Record<string, Set<string>> = {}
      for (const pv of pvs) {
        const path = pv.path || '/'
        if (!out[path]) out[path] = new Set()
        out[path].add(pv.visitorId)
      }
      return out
    }
    const curPaths = visitorsByPath(currentPvs)
    const prevPaths = visitorsByPath(previousPvs)
    if (Object.keys(curPaths).length > 0) {
      if (previousPvs.length > 0) {
        let best: { path: string, delta: number, now: number } | null = null
        for (const [path, set] of Object.entries(curPaths)) {
          const delta = set.size - (prevPaths[path]?.size || 0)
          if (!best || delta > best.delta) best = { path, delta, now: set.size }
        }
        if (best && best.delta >= 2) {
          insights.push({
            type: 'page',
            severity: 'success',
            title: 'Fastest-Growing Page',
            description: `${best.path} gained ${best.delta} visitors vs the previous period (${best.now} this period).`,
            metric: 'pageVisitors',
            change: best.delta,
          })
        }
      }
      else {
        const top = Object.entries(curPaths).sort((a, b) => b[1].size - a[1].size)[0]
        insights.push({
          type: 'page',
          severity: 'info',
          title: 'Top Page',
          description: `${top[0]} is your most-visited page this period with ${top[1].size} visitor${top[1].size === 1 ? '' : 's'}.`,
          metric: 'pageVisitors',
        })
      }
    }

    // ── Dominant referrer source
    if (currentTraffic >= 5) {
      const bySource: Record<string, number> = {}
      for (const s of currentSessions) {
        const src = s.referrerSource || 'Direct'
        bySource[src] = (bySource[src] || 0) + 1
      }
      const top = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0]
      const share = Math.round((top[1] / currentTraffic) * 100)
      if (share >= 50 && top[0] !== 'Direct') {
        insights.push({
          type: 'referrer',
          severity: 'info',
          title: 'Dominant Traffic Source',
          description: `${share}% of your sessions come from ${top[0]} — a single source this concentrated is worth both nurturing and diversifying.`,
          metric: 'referrerShare',
          change: share,
        })
      }
      else if (share >= 80 && top[0] === 'Direct') {
        insights.push({
          type: 'referrer',
          severity: 'info',
          title: 'Mostly Direct Traffic',
          description: `${share}% of sessions arrive direct (no referrer). Campaign links with UTMs would reveal where these visitors actually come from.`,
          metric: 'referrerShare',
          change: share,
        })
      }
    }

    // ── Busiest day this period
    if (currentTraffic >= 5) {
      const byDay: Record<string, number> = {}
      for (const s of currentSessions) {
        const day = new Date(s.startedAt).toISOString().slice(0, 10)
        byDay[day] = (byDay[day] || 0) + 1
      }
      const days = Object.entries(byDay)
      if (days.length > 1) {
        const [bestDay, bestCount] = days.sort((a, b) => b[1] - a[1])[0]
        insights.push({
          type: 'engagement',
          severity: 'info',
          title: 'Busiest Day',
          description: `${new Date(`${bestDay}T00:00:00Z`).toUTCString().slice(0, 11)} was your busiest day this period with ${bestCount} sessions.`,
          metric: 'sessions',
        })
      }
    }

    // ── Bounce rate (both directions)
    const currentBounces = currentSessions.filter(s => s.isBounce).length
    const currentBounceRate = currentTraffic > 0 ? (currentBounces / currentTraffic) * 100 : 0
    if (currentBounceRate > 70 && currentTraffic >= 5) {
      insights.push({
        type: 'engagement',
        severity: 'warning',
        title: 'High Bounce Rate',
        description: `Your bounce rate is ${Math.round(currentBounceRate)}%. Consider improving page load times or content relevance.`,
        metric: 'bounceRate',
        change: Math.round(currentBounceRate),
      })
    }
    else if (currentBounceRate < 30 && currentTraffic >= 10) {
      insights.push({
        type: 'engagement',
        severity: 'success',
        title: 'Visitors Are Sticking Around',
        description: `Only ${Math.round(currentBounceRate)}% of sessions bounce — most visitors view more than one page.`,
        metric: 'bounceRate',
        change: Math.round(currentBounceRate),
      })
    }

    // ── Mobile share
    const mobileSession = currentSessions.filter(s => s.deviceType === 'mobile').length
    const mobilePercent = currentTraffic > 0 ? (mobileSession / currentTraffic) * 100 : 0
    if (mobilePercent > 50) {
      insights.push({
        type: 'device',
        severity: 'info',
        title: 'Mobile-First Traffic',
        description: `${Math.round(mobilePercent)}% of your traffic comes from mobile devices. Ensure your site is mobile-optimized.`,
        metric: 'mobilePercent',
        change: Math.round(mobilePercent),
      })
    }

    return jsonResponse({
      insights,
      summary: {
        currentPeriod: { start: startDate.toISOString(), end: endDate.toISOString(), sessions: currentTraffic },
        previousPeriod: { start: previousStartDate.toISOString(), end: previousEndDate.toISOString(), sessions: previousTraffic },
      },
    })
  }
catch (error) {
    console.error('Get insights error:', error)
    return errorResponse('Failed to fetch insights')
  }
}
