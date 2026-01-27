/**
 * Session handlers
 */

import { dynamodb, TABLE_NAME, unmarshall } from '../lib/dynamodb'
import { parseDateRange, formatDuration } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * GET /api/sites/{siteId}/sessions
 */
export async function handleGetSessions(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 50, 200)
    const filter = query.filter || ''

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `SESSION#` },
        ':end': { S: `SESSION#~` },
      },
      ScanIndexForward: false,
      Limit: limit * 2,
    }) as { Items?: any[] }

    let sessions = (result.Items || []).map(unmarshall).filter((s: any) => {
      const sessionTime = new Date(s.startedAt || s.endedAt || s.timestamp)
      return sessionTime >= startDate && sessionTime <= endDate
    })

    if (filter) {
      const f = filter.toLowerCase()
      sessions = sessions.filter((s: any) =>
        (s.country?.toLowerCase().includes(f)) ||
        (s.browser?.toLowerCase().includes(f)) ||
        (s.deviceType?.toLowerCase().includes(f)) ||
        (s.os?.toLowerCase().includes(f)) ||
        (s.referrerSource?.toLowerCase().includes(f))
      )
    }

    sessions = sessions.slice(0, limit)

    const formattedSessions = sessions.map((s: any) => ({
      id: s.id || s.sessionId,
      visitorId: s.visitorId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      duration: s.duration,
      durationFormatted: formatDuration(s.duration || 0),
      pageViewCount: s.pageViewCount || 0,
      eventCount: s.eventCount || 0,
      isBounce: s.isBounce,
      entryPage: s.entryPage,
      exitPage: s.exitPage,
      referrerSource: s.referrerSource || 'direct',
      country: s.country,
      region: s.region,
      city: s.city,
      deviceType: s.deviceType,
      browser: s.browser,
      os: s.os,
      utmSource: s.utmSource,
      utmMedium: s.utmMedium,
      utmCampaign: s.utmCampaign,
    }))

    return jsonResponse({
      sessions: formattedSessions,
      total: formattedSessions.length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Get sessions error:', error)
    return errorResponse('Failed to fetch sessions')
  }
}

/**
 * GET /api/sites/{siteId}/sessions/{sessionId}
 */
export async function handleGetSessionDetail(request: Request, siteId: string, sessionId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const includeEvents = query.includeEvents !== 'false'
    const includePageviews = query.includePageviews !== 'false'

    // Get session
    const sessionResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':sk': { S: `SESSION#${sessionId}` },
      },
    }) as { Items?: any[] }

    if (!sessionResult.Items || sessionResult.Items.length === 0) {
      return jsonResponse({ error: 'Session not found' }, 404)
    }

    const session = unmarshall(sessionResult.Items[0])

    // Get pageviews for this session
    let pageviews: any[] = []
    if (includePageviews) {
      const pvResult = await dynamodb.query({
        TableName: TABLE_NAME,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: `SESSION#${sessionId}` },
        },
      }) as { Items?: any[] }
      pageviews = (pvResult.Items || []).map(unmarshall)
        .filter(item => item.sk?.startsWith('PAGEVIEW#'))
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    }

    // Get events for this session
    let events: any[] = []
    if (includeEvents) {
      const eventResult = await dynamodb.query({
        TableName: TABLE_NAME,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: `SESSION#${sessionId}` },
        },
      }) as { Items?: any[] }
      events = (eventResult.Items || []).map(unmarshall)
        .filter(item => item.sk?.startsWith('EVENT#'))
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    }

    // Build timeline of all activities
    const timeline = [
      ...pageviews.map(pv => ({
        type: 'pageview' as const,
        timestamp: pv.timestamp,
        path: pv.path,
        title: pv.title,
        referrer: pv.referrer,
      })),
      ...events.map(e => ({
        type: 'event' as const,
        timestamp: e.timestamp,
        eventName: e.eventName,
        properties: e.properties,
      })),
    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return jsonResponse({
      session: {
        id: session.id || session.sessionId,
        visitorId: session.visitorId,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        duration: session.duration,
        durationFormatted: formatDuration(session.duration || 0),
        pageViewCount: session.pageViewCount || pageviews.length,
        eventCount: session.eventCount || events.length,
        isBounce: session.isBounce,
        entryPage: session.entryPage,
        exitPage: session.exitPage,
        referrerSource: session.referrerSource || 'direct',
        referrer: session.referrer,
        country: session.country,
        region: session.region,
        city: session.city,
        deviceType: session.deviceType,
        browser: session.browser,
        os: session.os,
        screenSize: session.screenSize,
        language: session.language,
        utmSource: session.utmSource,
        utmMedium: session.utmMedium,
        utmCampaign: session.utmCampaign,
        utmContent: session.utmContent,
        utmTerm: session.utmTerm,
      },
      pageviews,
      events,
      timeline,
    })
  } catch (error) {
    console.error('Get session detail error:', error)
    return errorResponse('Failed to fetch session detail')
  }
}

/**
 * GET /api/sites/{siteId}/flow
 */
export async function handleGetUserFlow(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const depth = Math.min(Number(query.depth) || 5, 10)

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

    // Build flow data from entry/exit pages and page sequences
    const flows: Record<string, { from: string; to: string; count: number }> = {}
    const entryPages: Record<string, number> = {}
    const exitPages: Record<string, number> = {}

    for (const session of sessions) {
      // Track entry pages
      if (session.entryPage) {
        entryPages[session.entryPage] = (entryPages[session.entryPage] || 0) + 1
      }

      // Track exit pages
      if (session.exitPage) {
        exitPages[session.exitPage] = (exitPages[session.exitPage] || 0) + 1
      }

      // Track page flows if we have page sequence
      const pageSequence = session.pageSequence || []
      for (let i = 0; i < Math.min(pageSequence.length - 1, depth); i++) {
        const key = `${pageSequence[i]}|${pageSequence[i + 1]}`
        if (!flows[key]) {
          flows[key] = { from: pageSequence[i], to: pageSequence[i + 1], count: 0 }
        }
        flows[key].count++
      }
    }

    const flowData = Object.values(flows)
      .sort((a, b) => b.count - a.count)
      .slice(0, 100)

    const topEntryPages = Object.entries(entryPages)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const topExitPages = Object.entries(exitPages)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return jsonResponse({
      flows: flowData,
      entryPages: topEntryPages,
      exitPages: topExitPages,
      totalSessions: sessions.length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Get user flow error:', error)
    return errorResponse('Failed to fetch user flow')
  }
}

/**
 * GET /api/sites/{siteId}/entry-exit
 */
export async function handleGetEntryExitPages(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)

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

    const entryStats: Record<string, { sessions: number; bounces: number }> = {}
    const exitStats: Record<string, { sessions: number }> = {}

    for (const session of sessions) {
      if (session.entryPage) {
        if (!entryStats[session.entryPage]) {
          entryStats[session.entryPage] = { sessions: 0, bounces: 0 }
        }
        entryStats[session.entryPage].sessions++
        if (session.isBounce) entryStats[session.entryPage].bounces++
      }

      if (session.exitPage) {
        if (!exitStats[session.exitPage]) {
          exitStats[session.exitPage] = { sessions: 0 }
        }
        exitStats[session.exitPage].sessions++
      }
    }

    const entryPages = Object.entries(entryStats)
      .map(([path, stats]) => ({
        path,
        sessions: stats.sessions,
        bounceRate: stats.sessions > 0 ? Math.round((stats.bounces / stats.sessions) * 100) : 0,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, limit)

    const exitPages = Object.entries(exitStats)
      .map(([path, stats]) => ({
        path,
        sessions: stats.sessions,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, limit)

    return jsonResponse({ entryPages, exitPages })
  } catch (error) {
    console.error('Get entry/exit pages error:', error)
    return errorResponse('Failed to fetch entry/exit pages')
  }
}

/**
 * GET /api/sites/{siteId}/live
 */
export async function handleGetLiveView(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const minutes = Number(query.minutes) || 5
    const cutoff = new Date(Date.now() - minutes * 60 * 1000)

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${cutoff.toISOString()}` },
        ':end': { S: 'PAGEVIEW#Z' },
      },
      ScanIndexForward: false,
      Limit: 100,
    }) as { Items?: any[] }

    const pageviews = (result.Items || []).map(unmarshall)

    const liveVisitors = pageviews.map(pv => ({
      visitorId: pv.visitorId?.substring(0, 8) + '...',
      path: pv.path,
      timestamp: pv.timestamp,
      country: pv.country,
      deviceType: pv.deviceType,
      browser: pv.browser,
    }))

    const uniqueVisitors = new Set(pageviews.map(pv => pv.visitorId)).size

    return jsonResponse({
      visitors: liveVisitors,
      count: uniqueVisitors,
      pageviews: pageviews.length,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Get live view error:', error)
    return errorResponse('Failed to fetch live view')
  }
}
