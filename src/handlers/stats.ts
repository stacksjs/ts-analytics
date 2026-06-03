/**
 * Statistics handlers
 */

import { dynamodb, TABLE_NAME, unmarshall } from '../lib/dynamodb'
import { parseDateRange, formatDuration } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getReferrerSourceChannel } from '../utils/geolocation'
import { parseFilters, matchesFilters } from '../utils/filters'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * GET /api/sites/{siteId}/stats
 */
export async function handleGetStats(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
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

    // Query realtime visitors (last 2 minutes)
    const realtimeCutoff = new Date(Date.now() - 2 * 60 * 1000)
    const realtimeResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${realtimeCutoff.toISOString()}` },
        ':end': { S: 'PAGEVIEW#Z' },
      },
    }) as { Items?: any[] }
    const realtimePageviews = (realtimeResult.Items || []).map(unmarshall)
    const realtimeVisitors = new Set(realtimePageviews.map(pv => pv.visitorId)).size

    const filters = parseFilters(query)
    const pageviews = (pageviewsResult.Items || []).map(unmarshall).filter((pv: any) => matchesFilters(pv, filters))
    const sessions = (sessionsResult.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && matchesFilters(s, filters)
    })

    // Calculate stats
    const uniqueVisitors = new Set(pageviews.map((pv: any) => pv.visitorId)).size
    const totalViews = pageviews.length
    const totalSessions = sessions.length
    const bounces = sessions.filter(s => s.isBounce).length
    const bounceRate = totalSessions > 0 ? Math.round((bounces / totalSessions) * 100) : 0
    const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0)
    const avgDuration = totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0
    const totalEvents = sessions.reduce((sum, s) => sum + (s.eventCount || 0), 0)

    return jsonResponse({
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
  }
catch (error) {
    console.error('Stats error:', error)
    return errorResponse('Failed to fetch stats')
  }
}

/**
 * GET /api/sites/{siteId}/realtime
 */
export async function handleGetRealtime(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const minutes = Number(query.minutes) || 2
    const cutoff = new Date(Date.now() - minutes * 60 * 1000)

    // Query recent pageviews
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `PAGEVIEW#${cutoff.toISOString()}` },
        ':end': { S: 'PAGEVIEW#Z' },
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

    return jsonResponse({
      currentVisitors: uniqueVisitors,
      pageViewsLastHour: pageviews.length,
      topActivePages,
    })
  }
catch (error) {
    console.error('Realtime error:', error)
    return errorResponse('Failed to fetch realtime data')
  }
}

/**
 * GET /api/sites/{siteId}/pages
 */
export async function handleGetPages(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)

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

    // Get the hostname from the first pageview
    const siteHostname = pageviews.length > 0 ? pageviews[0].hostname : null

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

    return jsonResponse({ pages, hostname: siteHostname })
  }
catch (error) {
    console.error('Pages error:', error)
    return errorResponse('Failed to fetch pages')
  }
}

/**
 * GET /api/sites/{siteId}/referrers
 */
export async function handleGetReferrers(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const filters = parseFilters(query)
    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && matchesFilters(s, filters)
    })

    // Aggregate by referrer source, plus a higher-level channel rollup
    const referrerStats: Record<string, { visitors: Set<string>; views: number }> = {}
    const channelStats: Record<string, { visitors: Set<string>; views: number }> = {}
    for (const s of sessions) {
      const source = s.referrerSource || 'Direct'
      if (!referrerStats[source]) {
        referrerStats[source] = { visitors: new Set(), views: 0 }
      }
      referrerStats[source].visitors.add(s.visitorId)
      referrerStats[source].views += s.pageViewCount || 1

      const channel = getReferrerSourceChannel(source)
      if (!channelStats[channel]) {
        channelStats[channel] = { visitors: new Set(), views: 0 }
      }
      channelStats[channel].visitors.add(s.visitorId)
      channelStats[channel].views += s.pageViewCount || 1
    }

    const referrers = Object.entries(referrerStats)
      .map(([source, stats]) => ({
        source,
        channel: getReferrerSourceChannel(source),
        visitors: stats.visitors.size,
        views: stats.views,
      }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    const byChannel = Object.entries(channelStats)
      .map(([channel, stats]) => ({
        channel,
        visitors: stats.visitors.size,
        views: stats.views,
      }))
      .sort((a, b) => b.visitors - a.visitors)

    return jsonResponse({ referrers, byChannel })
  }
catch (error) {
    console.error('Referrers error:', error)
    return errorResponse('Failed to fetch referrers')
  }
}

/**
 * GET /api/sites/{siteId}/devices
 */
export async function handleGetDevices(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const filters = parseFilters(query)
    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && matchesFilters(s, filters)
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

    const totalVisitors = sessions.length > 0 ? new Set(sessions.map(s => s.visitorId)).size : 0

    const deviceTypes = Object.entries(deviceStats)
      .map(([type, visitors]) => ({
        type: type.charAt(0).toUpperCase() + type.slice(1),
        visitors: visitors.size,
        percentage: totalVisitors > 0 ? Math.round((visitors.size / totalVisitors) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors)

    const operatingSystems = Object.entries(osStats)
      .map(([name, visitors]) => ({
        name,
        visitors: visitors.size,
        percentage: totalVisitors > 0 ? Math.round((visitors.size / totalVisitors) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors)

    return jsonResponse({ deviceTypes, operatingSystems })
  }
catch (error) {
    console.error('Devices error:', error)
    return errorResponse('Failed to fetch devices')
  }
}

/**
 * GET /api/sites/{siteId}/browsers
 */
export async function handleGetBrowsers(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const filters = parseFilters(query)
    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && matchesFilters(s, filters)
    })

    // Aggregate by browser
    const browserStats: Record<string, Set<string>> = {}
    for (const s of sessions) {
      const browser = s.browser || 'Unknown'
      if (!browserStats[browser]) browserStats[browser] = new Set()
      browserStats[browser].add(s.visitorId)
    }

    const totalVisitors = sessions.length > 0 ? new Set(sessions.map(s => s.visitorId)).size : 0

    const browsers = Object.entries(browserStats)
      .map(([name, visitors]) => ({
        name,
        visitors: visitors.size,
        percentage: totalVisitors > 0 ? Math.round((visitors.size / totalVisitors) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return jsonResponse({ browsers })
  }
catch (error) {
    console.error('Browsers error:', error)
    return errorResponse('Failed to fetch browsers')
  }
}

/**
 * GET /api/sites/{siteId}/countries
 */
export async function handleGetCountries(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)

    // Query sessions
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const filters = parseFilters(query)
    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && matchesFilters(s, filters)
    })

    // Aggregate by country
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

    return jsonResponse({ countries })
  }
catch (error) {
    console.error('Countries error:', error)
    return errorResponse('Failed to fetch countries')
  }
}

/**
 * GET /api/sites/{siteId}/regions
 */
export async function handleGetRegions(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)
    const filters = parseFilters(query)

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
      if (sessionStart < startDate || sessionStart > endDate) return false
      return matchesFilters(s, filters)
    })

    // Aggregate by region
    const regionStats: Record<string, { visitors: Set<string>, country: string }> = {}
    for (const s of sessions) {
      const region = s.region || 'Unknown'
      const country = s.country || 'Unknown'
      const key = `${country}:${region}`
      if (!regionStats[key]) regionStats[key] = { visitors: new Set(), country }
      regionStats[key].visitors.add(s.visitorId)
    }

    const regions = Object.entries(regionStats)
      .map(([key, data]) => {
        const region = key.split(':')[1]
        return { name: region, country: data.country, visitors: data.visitors.size }
      })
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return jsonResponse({ regions })
  }
catch (error) {
    console.error('Regions error:', error)
    return errorResponse('Failed to fetch regions')
  }
}

/**
 * GET /api/sites/{siteId}/cities
 */
export async function handleGetCities(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)
    const filters = parseFilters(query)

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
      if (sessionStart < startDate || sessionStart > endDate) return false
      return matchesFilters(s, filters)
    })

    // Aggregate by city
    const cityStats: Record<string, { visitors: Set<string>, country: string, region: string }> = {}
    for (const s of sessions) {
      const city = s.city || 'Unknown'
      const region = s.region || 'Unknown'
      const country = s.country || 'Unknown'
      const key = `${country}:${region}:${city}`
      if (!cityStats[key]) cityStats[key] = { visitors: new Set(), country, region }
      cityStats[key].visitors.add(s.visitorId)
    }

    const cities = Object.entries(cityStats)
      .map(([key, data]) => {
        const city = key.split(':')[2]
        return { name: city, country: data.country, region: data.region, visitors: data.visitors.size }
      })
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return jsonResponse({ cities })
  }
catch (error) {
    console.error('Cities error:', error)
    return errorResponse('Failed to fetch cities')
  }
}

/**
 * GET /api/sites/{siteId}/timeseries
 */
export async function handleGetTimeSeries(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const period = query.period || 'day'

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

    // Generate all time buckets in the range
    const allBuckets: string[] = []
    const current = new Date(startDate)
    const end = new Date(endDate)

    while (current <= end) {
      let key: string
      if (period === 'minute') {
        const mins = Math.floor(current.getUTCMinutes() / 5) * 5
        key = `${current.toISOString().slice(0, 14)}${mins.toString().padStart(2, '0')}:00.000Z`
        current.setMinutes(current.getMinutes() + 5)
      }
else if (period === 'hour') {
        key = `${current.toISOString().slice(0, 13)}:00:00.000Z`
        current.setHours(current.getHours() + 1)
      }
else if (period === 'month') {
        key = `${current.toISOString().slice(0, 7)}-01T00:00:00.000Z`
        current.setMonth(current.getMonth() + 1)
      }
else {
        key = `${current.toISOString().slice(0, 10)}T00:00:00.000Z`
        current.setDate(current.getDate() + 1)
      }
      if (!allBuckets.includes(key)) allBuckets.push(key)
    }

    // Group pageviews by time bucket
    const bucketMap: Record<string, { views: number; visitors: Set<string> }> = {}
    for (const bucket of allBuckets) {
      bucketMap[bucket] = { views: 0, visitors: new Set() }
    }

    for (const pv of pageviews) {
      const timestamp = new Date(pv.timestamp)
      let key: string
      if (period === 'minute') {
        const mins = Math.floor(timestamp.getUTCMinutes() / 5) * 5
        key = `${timestamp.toISOString().slice(0, 14)}${mins.toString().padStart(2, '0')}:00.000Z`
      }
else if (period === 'hour') {
        key = `${timestamp.toISOString().slice(0, 13)}:00:00.000Z`
      }
else if (period === 'month') {
        key = `${timestamp.toISOString().slice(0, 7)}-01T00:00:00.000Z`
      }
else {
        key = `${timestamp.toISOString().slice(0, 10)}T00:00:00.000Z`
      }
      if (bucketMap[key]) {
        bucketMap[key].views++
        bucketMap[key].visitors.add(pv.visitorId)
      }
    }

    const timeSeries = allBuckets.map(bucket => ({
      timestamp: bucket,
      views: bucketMap[bucket]?.views || 0,
      visitors: bucketMap[bucket]?.visitors.size || 0,
    }))

    return jsonResponse({ timeSeries })
  }
catch (error) {
    console.error('TimeSeries error:', error)
    return errorResponse('Failed to fetch time series')
  }
}

/**
 * GET /api/sites/{siteId}/events
 */
export async function handleGetEvents(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)

    // Query custom events
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
    const eventStats: Record<string, { count: number; visitors: Set<string> }> = {}
    for (const e of events) {
      const name = e.name || 'unknown'
      if (!eventStats[name]) {
        eventStats[name] = { count: 0, visitors: new Set() }
      }
      eventStats[name].count++
      eventStats[name].visitors.add(e.visitorId)
    }

    const eventsList = Object.entries(eventStats)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        visitors: stats.visitors.size,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    return jsonResponse({ events: eventsList })
  }
catch (error) {
    console.error('Events error:', error)
    return errorResponse('Failed to fetch events')
  }
}

/**
 * GET /api/sites/{siteId}/clicks
 * Aggregated link-click report (outbound, internal, download, mailto, tel).
 */
export async function handleGetClicks(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 20, 100)
    const kindFilter = query.kind

    // Query link clicks
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `CLICK#${startDate.toISOString()}` },
        ':end': { S: `CLICK#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const clicks = (result.Items || [])
      .map(unmarshall)
      .filter(c => !kindFilter || c.kind === kindFilter)

    // Aggregate by destination URL, plus a per-kind summary
    const urlStats: Record<string, { kind: string; text: string; count: number; visitors: Set<string> }> = {}
    const byKind: Record<string, number> = { outbound: 0, internal: 0, download: 0, mailto: 0, tel: 0 }
    for (const c of clicks) {
      const url = c.url || 'unknown'
      if (!urlStats[url]) {
        urlStats[url] = { kind: c.kind || 'outbound', text: c.text || '', count: 0, visitors: new Set() }
      }
      urlStats[url].count++
      urlStats[url].visitors.add(c.visitorId)
      if (byKind[c.kind] !== undefined) byKind[c.kind]++
    }

    const clicksList = Object.entries(urlStats)
      .map(([url, s]) => ({
        url,
        kind: s.kind,
        text: s.text,
        count: s.count,
        visitors: s.visitors.size,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    return jsonResponse({ clicks: clicksList, byKind, total: clicks.length })
  }
catch (error) {
    console.error('Clicks error:', error)
    return errorResponse('Failed to fetch clicks')
  }
}

/**
 * GET /api/sites/{siteId}/engagement
 * Per-page engagement: average scroll depth (%) and active time-on-page (s).
 */
export async function handleGetEngagement(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 20, 100)

    // Query engagement samples
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ENGAGEMENT#${startDate.toISOString()}` },
        ':end': { S: `ENGAGEMENT#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const samples = (result.Items || []).map(unmarshall)

    // Aggregate by page path
    const pageStats: Record<string, { count: number; sumScroll: number; sumTime: number; visitors: Set<string> }> = {}
    let totalScroll = 0
    let totalTime = 0
    for (const s of samples) {
      const path = s.path || '/'
      if (!pageStats[path]) {
        pageStats[path] = { count: 0, sumScroll: 0, sumTime: 0, visitors: new Set() }
      }
      const stat = pageStats[path]
      stat.count++
      stat.sumScroll += s.scrollDepth || 0
      stat.sumTime += s.timeOnPage || 0
      stat.visitors.add(s.visitorId)
      totalScroll += s.scrollDepth || 0
      totalTime += s.timeOnPage || 0
    }

    const pages = Object.entries(pageStats)
      .map(([path, stat]) => ({
        path,
        samples: stat.count,
        visitors: stat.visitors.size,
        avgScrollDepth: Math.round(stat.sumScroll / stat.count),
        avgSeconds: Math.round(stat.sumTime / stat.count),
      }))
      .sort((a, b) => b.samples - a.samples)
      .slice(0, limit)

    const n = samples.length
    return jsonResponse({
      engagement: pages,
      avgScrollDepth: n > 0 ? Math.round(totalScroll / n) : 0,
      avgSeconds: n > 0 ? Math.round(totalTime / n) : 0,
      samples: n,
    })
  }
catch (error) {
    console.error('Engagement error:', error)
    return errorResponse('Failed to fetch engagement')
  }
}

/**
 * GET /api/sites/{siteId}/campaigns
 */
export async function handleGetCampaigns(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)

    // Query sessions with UTM data
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

    // Aggregate by campaign
    const campaignStats: Record<string, { visitors: Set<string>; sessions: number; source: string; medium: string }> = {}
    for (const s of sessions) {
      const campaign = s.utmCampaign || 'unknown'
      if (!campaignStats[campaign]) {
        campaignStats[campaign] = { visitors: new Set(), sessions: 0, source: s.utmSource || '', medium: s.utmMedium || '' }
      }
      campaignStats[campaign].visitors.add(s.visitorId)
      campaignStats[campaign].sessions++
    }

    const campaigns = Object.entries(campaignStats)
      .map(([name, stats]) => ({
        name,
        visitors: stats.visitors.size,
        sessions: stats.sessions,
        source: stats.source,
        medium: stats.medium,
      }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return jsonResponse({ campaigns })
  }
catch (error) {
    console.error('Campaigns error:', error)
    return errorResponse('Failed to fetch campaigns')
  }
}

/**
 * GET /api/sites/{siteId}/comparison
 */
export async function handleGetComparison(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    // Calculate the comparison period (same duration, immediately before)
    const duration = endDate.getTime() - startDate.getTime()
    const comparisonEndDate = new Date(startDate.getTime() - 1)
    const comparisonStartDate = new Date(comparisonEndDate.getTime() - duration)

    // Helper to get stats for a period
    async function getStatsForPeriod(start: Date, end: Date) {
      const pageviewsResult = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':start': { S: `PAGEVIEW#${start.toISOString()}` },
          ':end': { S: `PAGEVIEW#${end.toISOString()}` },
        },
      }) as { Items?: any[] }

      const sessionsResult = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':prefix': { S: 'SESSION#' },
        },
      }) as { Items?: any[] }

      const filters = parseFilters(query)
      const pageviews = (pageviewsResult.Items || []).map(unmarshall).filter((pv: any) => matchesFilters(pv, filters))
      const sessions = (sessionsResult.Items || []).map(unmarshall).filter(s => {
        const sessionStart = new Date(s.startedAt)
        return sessionStart >= start && sessionStart <= end && matchesFilters(s, filters)
      })

      const uniqueVisitors = new Set(pageviews.map((pv: any) => pv.visitorId)).size
      const totalViews = pageviews.length
      const totalSessions = sessions.length
      const bounces = sessions.filter(s => s.isBounce).length
      const bounceRate = totalSessions > 0 ? Math.round((bounces / totalSessions) * 100) : 0
      const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0)
      const avgDuration = totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0

      return {
        visitors: uniqueVisitors,
        views: totalViews,
        sessions: totalSessions,
        bounceRate,
        avgDuration,
      }
    }

    const [currentStats, previousStats] = await Promise.all([
      getStatsForPeriod(startDate, endDate),
      getStatsForPeriod(comparisonStartDate, comparisonEndDate),
    ])

    // Calculate percentage changes
    const calcChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0
      return Math.round(((current - previous) / previous) * 100)
    }

    return jsonResponse({
      current: currentStats,
      previous: previousStats,
      changes: {
        visitors: calcChange(currentStats.visitors, previousStats.visitors),
        views: calcChange(currentStats.views, previousStats.views),
        sessions: calcChange(currentStats.sessions, previousStats.sessions),
        bounceRate: calcChange(currentStats.bounceRate, previousStats.bounceRate),
        avgDuration: calcChange(currentStats.avgDuration, previousStats.avgDuration),
      },
      periods: {
        current: { start: startDate.toISOString(), end: endDate.toISOString() },
        previous: { start: comparisonStartDate.toISOString(), end: comparisonEndDate.toISOString() },
      },
    })
  }
catch (error) {
    console.error('Comparison error:', error)
    return errorResponse('Failed to fetch comparison data')
  }
}
