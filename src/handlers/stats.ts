/**
 * Statistics handlers
 */

import { dynamodb, querySessionItemsInRange, queryAllItems, TABLE_NAME, unmarshall } from '../lib/dynamodb'
import { parseDateRange, formatDuration } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { countryCodeOf, countryFlagEmoji, getReferrerSourceChannel } from '../utils/geolocation'
import { parseFilters, matchesFilters, hasFilters } from '../utils/filters'
import { getQueryParams } from '../../deploy/lambda-adapter'
import { readDimRollupPrefix, type DayDimRollup, readDayRollups, fullyCoveredDays, isSettledDay } from '../lib/rollups'

/**
 * GET /api/sites/{siteId}/stats
 */
export async function handleGetStats(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const startDateStr = startDate.toISOString().slice(0, 10)
    const endDateStr = endDate.toISOString().slice(0, 10)
    const filters = parseFilters(query)

    // Pre-aggregation (#94): without filters, complete past days are served
    // from ROLLUP#DAY# items and raw events are touched only for the live
    // remainder (today / un-rolled days). Filters can't be answered from
    // rollups, so a filtered request takes the raw path.
    const rolled: { day: string, views: number, visitors: number, sessions: number, bounces: number, totalDuration: number, events: number }[] = []
    let rawWindowStart = startDate
    if (!hasFilters(filters)) {
      // Serve only SETTLED days from rollups; the most-recent complete day stays
      // on the raw path so late-arriving events aren't dropped (#162).
      const eligible = fullyCoveredDays(startDate, endDate).filter(d => isSettledDay(d))
      if (eligible.length > 0) {
        const rollups = await readDayRollups(siteId, eligible[0], eligible[eligible.length - 1])
        // Use the contiguous covered prefix so one raw range query handles the
        // rest; a mid-range gap simply ends the prefix and stays raw.
        for (const day of eligible) {
          const r = rollups.get(day)
          if (!r)
            break
          rolled.push(r)
        }
        if (rolled.length > 0) {
          const next = new Date(`${rolled[rolled.length - 1].day}T00:00:00.000Z`)
          next.setUTCDate(next.getUTCDate() + 1)
          rawWindowStart = next
        }
      }
    }

    // Query pageviews for the (remaining) raw window
    const pageviewsResult = rawWindowStart <= endDate
      ? await queryAllItems({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
          ExpressionAttributeValues: {
            ':pk': { S: `SITE#${siteId}` },
            ':start': { S: `PAGEVIEW#${rawWindowStart.toISOString()}` },
            ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
          },
        }) as { Items?: any[], Count?: number }
      : { Items: [] }

    // Query sessions for the raw window via the time-keyed GSI entry (#171).
    const sessionsResult = rawWindowStart <= endDate
      ? await querySessionItemsInRange(siteId, rawWindowStart, endDate) as { Items?: any[], Count?: number }
      : { Items: [] }

    // Query realtime visitors (last 2 minutes)
    const realtimeCutoff = new Date(Date.now() - 2 * 60 * 1000)
    const realtimeResult = await queryAllItems({
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

    const pageviews = (pageviewsResult.Items || []).map(unmarshall).filter((pv: any) => matchesFilters(pv, filters))
    const sessions = (sessionsResult.Items || []).map(unmarshall).filter((s) => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= rawWindowStart && sessionStart <= endDate && matchesFilters(s, filters)
    })

    // Raw-window stats. Uniques are counted PER UTC DAY to match the rolled
    // days' semantics (#146): the raw window used to dedupe across its whole
    // span, so a visitor spanning two raw days counted once there but twice
    // after those days rolled up — the same historical query changed answers
    // day to day. Per-day bucketing makes raw + rolled consistent (Fathom's
    // "people = sum of daily uniques" semantics).
    const rawDailyVisitors = new Map<string, Set<string>>()
    for (const pv of pageviews) {
      const day = String(pv.timestamp).slice(0, 10)
      let set = rawDailyVisitors.get(day)
      if (!set) { set = new Set(); rawDailyVisitors.set(day, set) }
      set.add(pv.visitorId)
    }
    const rawVisitors = [...rawDailyVisitors.values()].reduce((sum, set) => sum + set.size, 0)
    const rawViews = pageviews.length
    const rawSessions = sessions.length
    const rawBounces = sessions.filter(s => s.isBounce).length
    // Prefer real engaged time from departure pings (#167); fall back to the
    // last-hit-minus-first-hit duration for sessions without pings.
    const rawDuration = sessions.reduce((sum, s) => sum + (s.activeTime > 0 ? s.activeTime : (s.duration || 0)), 0)
    const rawEvents = sessions.reduce((sum, s) => sum + (s.eventCount || 0), 0)

    // Combine with rollup days. Note: `people` across rolled days sums daily
    // uniques (a returning visitor counts once per day) — Fathom semantics.
    const totalViews = rawViews + rolled.reduce((sum, r) => sum + r.views, 0)
    const uniqueVisitors = rawVisitors + rolled.reduce((sum, r) => sum + r.visitors, 0)
    const totalSessions = rawSessions + rolled.reduce((sum, r) => sum + r.sessions, 0)
    const bounces = rawBounces + rolled.reduce((sum, r) => sum + r.bounces, 0)
    const totalDuration = rawDuration + rolled.reduce((sum, r) => sum + r.totalDuration, 0)
    const totalEvents = rawEvents + rolled.reduce((sum, r) => sum + r.events, 0)
    const bounceRate = totalSessions > 0 ? Math.round((bounces / totalSessions) * 100) : 0
    const avgDuration = totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0

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
    const result = await queryAllItems({
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

    // Rolled prefix (#172): settled days come from ROLLUP#DIMS items — they
    // survive the raw TTL, so this report works beyond 30 days ("All Time").
    const { days: rolled, rawWindowStart } = await readDimRollupPrefix(siteId, startDate, endDate)

    // Query raw pageviews only for the live tail
    const result = rawWindowStart <= endDate
      ? await queryAllItems({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
          ExpressionAttributeValues: {
            ':pk': { S: `SITE#${siteId}` },
            ':start': { S: `PAGEVIEW#${rawWindowStart.toISOString()}` },
            ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
          },
        }) as { Items?: any[] }
      : { Items: [] }

    const pageviews = (result.Items || []).map(unmarshall)

    // Hostname for building page links: first raw pageview, else the site's
    // configured domain (a fully rolled-up range has no raw rows to read).
    let siteHostname = pageviews.length > 0 ? pageviews[0].hostname : null
    if (!siteHostname) {
      const siteRes = await dynamodb.getItem({
        TableName: TABLE_NAME,
        Key: { pk: { S: 'SITES' }, sk: { S: `SITE#${siteId}` } },
      }).catch(() => null)
      const site = siteRes?.Item ? unmarshall(siteRes.Item) : null
      siteHostname = Array.isArray(site?.domains) && site.domains.length > 0 ? site.domains[0] : null
    }

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

    // Merge the rolled prefix. Visitors sum daily uniques (Fathom semantics,
    // consistent with the scalar rollups, #146).
    const merged: Record<string, { views: number, visitors: number, entries: number }> = {}
    for (const [path, stats] of Object.entries(pageStats))
      merged[path] = { views: stats.views, visitors: stats.visitors.size, entries: stats.entries }
    for (const dayR of rolled) {
      for (const [path, cell] of Object.entries(dayR.pages || {})) {
        const m = (merged[path] ||= { views: 0, visitors: 0, entries: 0 })
        m.views += cell.w
        m.visitors += cell.v
        m.entries += cell.e
      }
    }

    const pages = Object.entries(merged)
      .map(([path, stats]) => ({
        path,
        views: stats.views,
        visitors: stats.visitors,
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

    const filters = parseFilters(query)
    // Rolled prefix (#172): settled days come from ROLLUP#DIMS items — they
    // survive the raw TTL, so this report works beyond 30 days ("All Time").
    // Filtered queries can't be answered from aggregates and stay raw-only.
    const { days: rolled, rawWindowStart } = hasFilters(filters)
      ? { days: [] as DayDimRollup[], rawWindowStart: startDate }
      : await readDimRollupPrefix(siteId, startDate, endDate)

    // Query sessions for the live tail
    const result = rawWindowStart <= endDate
      ? await querySessionItemsInRange(siteId, rawWindowStart, endDate) as { Items?: any[] }
      : { Items: [] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && matchesFilters(s, filters)
    })

    // Aggregate by referrer source (channels derive from the merged sources).
    const referrerStats: Record<string, { visitors: Set<string>; views: number }> = {}
    for (const s of sessions) {
      const source = s.referrerSource || 'Direct'
      if (!referrerStats[source]) {
        referrerStats[source] = { visitors: new Set(), views: 0 }
      }
      referrerStats[source].visitors.add(s.visitorId)
      referrerStats[source].views += s.pageViewCount || 1
    }

    // Merge the rolled prefix (daily-unique sums, #146 semantics).
    const merged: Record<string, { visitors: number, views: number }> = {}
    for (const [source, stats] of Object.entries(referrerStats))
      merged[source] = { visitors: stats.visitors.size, views: stats.views }
    for (const dayR of rolled) {
      for (const [source, cell] of Object.entries(dayR.sources || {})) {
        const m = (merged[source] ||= { visitors: 0, views: 0 })
        m.visitors += cell.v
        m.views += cell.w
      }
    }
    const mergedChannels: Record<string, { visitors: number, views: number }> = {}
    for (const [source, stats] of Object.entries(merged)) {
      const channel = getReferrerSourceChannel(source)
      const m = (mergedChannels[channel] ||= { visitors: 0, views: 0 })
      m.visitors += stats.visitors
      m.views += stats.views
    }

    const referrers = Object.entries(merged)
      .map(([source, stats]) => ({
        source,
        channel: getReferrerSourceChannel(source),
        visitors: stats.visitors,
        views: stats.views,
      }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    const byChannel = Object.entries(mergedChannels)
      .map(([channel, stats]) => ({
        channel,
        visitors: stats.visitors,
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

    const filters = parseFilters(query)
    // Rolled prefix (#172): settled days from ROLLUP#DIMS survive the raw TTL.
    // Filtered queries stay raw-only.
    const { days: rolled, rawWindowStart } = hasFilters(filters)
      ? { days: [] as DayDimRollup[], rawWindowStart: startDate }
      : await readDimRollupPrefix(siteId, startDate, endDate)

    const result = rawWindowStart <= endDate
      ? await querySessionItemsInRange(siteId, rawWindowStart, endDate) as { Items?: any[] }
      : { Items: [] }

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

    // Merge the rolled prefix (daily-unique sums); percentages come from the
    // merged dimension totals.
    const mergedDevices: Record<string, number> = {}
    for (const [type, visitors] of Object.entries(deviceStats)) mergedDevices[type] = visitors.size
    const mergedOs: Record<string, number> = {}
    for (const [name, visitors] of Object.entries(osStats)) mergedOs[name] = visitors.size
    for (const dayR of rolled) {
      for (const [type, cell] of Object.entries(dayR.devices || {}))
        mergedDevices[type] = (mergedDevices[type] || 0) + cell.v
      for (const [name, cell] of Object.entries(dayR.os || {}))
        mergedOs[name] = (mergedOs[name] || 0) + cell.v
    }
    const totalVisitors = Object.values(mergedDevices).reduce((a, b) => a + b, 0)

    const deviceTypes = Object.entries(mergedDevices)
      .map(([type, visitors]) => ({
        type: type.charAt(0).toUpperCase() + type.slice(1),
        visitors,
        percentage: totalVisitors > 0 ? Math.round((visitors / totalVisitors) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors)

    const osTotal = Object.values(mergedOs).reduce((a, b) => a + b, 0)
    const operatingSystems = Object.entries(mergedOs)
      .map(([name, visitors]) => ({
        name,
        visitors,
        percentage: osTotal > 0 ? Math.round((visitors / osTotal) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors)

    // `devices` is the canonical key (the analytics store's sectionMap and the
    // detail page read data.devices — with only deviceTypes/operatingSystems the
    // panel always showed "No device data"). Legacy keys kept for back-compat.
    return jsonResponse({ devices: deviceTypes, deviceTypes, operatingSystems })
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

    const filters = parseFilters(query)
    // Rolled prefix (#172): settled days from ROLLUP#DIMS survive the raw TTL.
    // Filtered queries stay raw-only.
    const { days: rolled, rawWindowStart } = hasFilters(filters)
      ? { days: [] as DayDimRollup[], rawWindowStart: startDate }
      : await readDimRollupPrefix(siteId, startDate, endDate)

    const result = rawWindowStart <= endDate
      ? await querySessionItemsInRange(siteId, rawWindowStart, endDate) as { Items?: any[] }
      : { Items: [] }

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

    // Merge the rolled prefix (daily-unique sums).
    const merged: Record<string, number> = {}
    for (const [name, visitors] of Object.entries(browserStats)) merged[name] = visitors.size
    for (const dayR of rolled) {
      for (const [name, cell] of Object.entries(dayR.browsers || {}))
        merged[name] = (merged[name] || 0) + cell.v
    }
    const totalVisitors = Object.values(merged).reduce((a, b) => a + b, 0)

    const browsers = Object.entries(merged)
      .map(([name, visitors]) => ({
        name,
        visitors,
        percentage: totalVisitors > 0 ? Math.round((visitors / totalVisitors) * 100) : 0,
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
 * GET /api/sites/{siteId}/os — operating-system breakdown. Parsed server-side
 * from the User-Agent at collect time (only the coarse OS name is stored).
 */
export async function handleGetOS(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 10, 100)

    const filters = parseFilters(query)
    // Rolled prefix (#172): settled days from ROLLUP#DIMS survive the raw TTL.
    // Filtered queries stay raw-only.
    const { days: rolled, rawWindowStart } = hasFilters(filters)
      ? { days: [] as DayDimRollup[], rawWindowStart: startDate }
      : await readDimRollupPrefix(siteId, startDate, endDate)

    const result = rawWindowStart <= endDate
      ? await querySessionItemsInRange(siteId, rawWindowStart, endDate) as { Items?: any[] }
      : { Items: [] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && matchesFilters(s, filters)
    })

    const osStats: Record<string, Set<string>> = {}
    for (const s of sessions) {
      const os = s.os || 'Unknown'
      if (!osStats[os]) osStats[os] = new Set()
      osStats[os].add(s.visitorId)
    }

    // Merge the rolled prefix (daily-unique sums).
    const merged: Record<string, number> = {}
    for (const [name, visitors] of Object.entries(osStats)) merged[name] = visitors.size
    for (const dayR of rolled) {
      for (const [name, cell] of Object.entries(dayR.os || {}))
        merged[name] = (merged[name] || 0) + cell.v
    }
    const totalVisitors = Object.values(merged).reduce((a, b) => a + b, 0)

    const os = Object.entries(merged)
      .map(([name, visitors]) => ({
        name,
        visitors,
        percentage: totalVisitors > 0 ? Math.round((visitors / totalVisitors) * 100) : 0,
      }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, limit)

    return jsonResponse({ os })
  }
catch (error) {
    console.error('OS error:', error)
    return errorResponse('Failed to fetch operating systems')
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

    const filters = parseFilters(query)
    // Rolled prefix (#172): settled days from ROLLUP#DIMS survive the raw TTL.
    // Filtered queries stay raw-only.
    const { days: rolled, rawWindowStart } = hasFilters(filters)
      ? { days: [] as DayDimRollup[], rawWindowStart: startDate }
      : await readDimRollupPrefix(siteId, startDate, endDate)

    const result = rawWindowStart <= endDate
      ? await querySessionItemsInRange(siteId, rawWindowStart, endDate) as { Items?: any[] }
      : { Items: [] }

    const sessions = (result.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate && matchesFilters(s, filters)
    })

    // Aggregate by country. Sessions without a resolved country (pre-geo data,
    // clients with no timezone/headers) are omitted rather than reported as an
    // "Unknown" bucket.
    const countryStats: Record<string, Set<string>> = {}
    for (const s of sessions) {
      if (!s.country) continue
      if (!countryStats[s.country]) countryStats[s.country] = new Set()
      countryStats[s.country].add(s.visitorId)
    }

    // Merge the rolled prefix (daily-unique sums).
    const merged: Record<string, number> = {}
    for (const [name, visitors] of Object.entries(countryStats)) merged[name] = visitors.size
    for (const dayR of rolled) {
      for (const [name, cell] of Object.entries(dayR.countries || {}))
        merged[name] = (merged[name] || 0) + cell.v
    }

    const countries = Object.entries(merged)
      .map(([name, visitors]) => {
        // Emoji flag from the ISO code (Fathom/GA-style) — stored values are
        // display names (reverse-mapped) or bare ISO codes.
        const code = countryCodeOf(name) || ''
        return { name, code, flag: code ? countryFlagEmoji(code) : '', visitors }
      })
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

    // Rolled prefix (#172): settled days from ROLLUP#DIMS survive the raw TTL.
    // Filtered queries stay raw-only.
    const { days: rolled, rawWindowStart } = hasFilters(filters)
      ? { days: [] as DayDimRollup[], rawWindowStart: startDate }
      : await readDimRollupPrefix(siteId, startDate, endDate)

    const result = rawWindowStart <= endDate
      ? await querySessionItemsInRange(siteId, rawWindowStart, endDate) as { Items?: any[] }
      : { Items: [] }

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

    // Merge the rolled prefix (composite `${country}:${region}` keys).
    const merged: Record<string, number> = {}
    for (const [key, data] of Object.entries(regionStats)) merged[key] = data.visitors.size
    for (const dayR of rolled) {
      for (const [key, cell] of Object.entries(dayR.regions || {}))
        merged[key] = (merged[key] || 0) + cell.v
    }

    const regions = Object.entries(merged)
      .map(([key, visitors]) => {
        const [country, region] = key.split(':')
        return { name: region, country, visitors }
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

    // Rolled prefix (#172): settled days from ROLLUP#DIMS survive the raw TTL.
    // Filtered queries stay raw-only.
    const { days: rolled, rawWindowStart } = hasFilters(filters)
      ? { days: [] as DayDimRollup[], rawWindowStart: startDate }
      : await readDimRollupPrefix(siteId, startDate, endDate)

    const result = rawWindowStart <= endDate
      ? await querySessionItemsInRange(siteId, rawWindowStart, endDate) as { Items?: any[] }
      : { Items: [] }

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

    // Merge the rolled prefix (composite `${country}:${region}:${city}` keys).
    const merged: Record<string, number> = {}
    for (const [key, data] of Object.entries(cityStats)) merged[key] = data.visitors.size
    for (const dayR of rolled) {
      for (const [key, cell] of Object.entries(dayR.cities || {}))
        merged[key] = (merged[key] || 0) + cell.v
    }

    const cities = Object.entries(merged)
      .map(([key, visitors]) => {
        const [country, region, city] = key.split(':')
        return { name: city, country, region, visitors }
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

    // Pre-aggregation (#94): for day/month periods, complete past days come
    // from ROLLUP#DAY# items; raw pageviews are queried only from the first
    // un-rolled day onward (usually just today). Hour/minute periods are
    // short ranges and stay raw. Month buckets sum daily uniques.
    const rollupByDay = new Map<string, { views: number, visitors: number }>()
    let rawWindowStart = startDate
    if (period === 'day' || period === 'month') {
      // Serve only SETTLED days from rollups; the most-recent complete day stays
      // on the raw path so late-arriving events aren't dropped (#162).
      const eligible = fullyCoveredDays(startDate, endDate).filter(d => isSettledDay(d))
      if (eligible.length > 0) {
        const rollups = await readDayRollups(siteId, eligible[0], eligible[eligible.length - 1])
        for (const day of eligible) {
          const r = rollups.get(day)
          if (!r)
            break
          rollupByDay.set(day, { views: r.views, visitors: r.visitors })
        }
        if (rollupByDay.size > 0) {
          const lastRolled = [...rollupByDay.keys()].pop()!
          const next = new Date(`${lastRolled}T00:00:00.000Z`)
          next.setUTCDate(next.getUTCDate() + 1)
          rawWindowStart = next
        }
      }
    }

    // Query pageviews for the (remaining) raw window
    const result = rawWindowStart <= endDate
      ? await queryAllItems({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
          ExpressionAttributeValues: {
            ':pk': { S: `SITE#${siteId}` },
            ':start': { S: `PAGEVIEW#${rawWindowStart.toISOString()}` },
            ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
          },
        }) as { Items?: any[] }
      : { Items: [] }

    const pageviews = (result.Items || []).map(unmarshall)

    // Generate all time buckets in the range
    const allBuckets: string[] = []
    const current = new Date(startDate)
    const end = new Date(endDate)

    while (current <= end) {
      let key: string
      // Advance in UTC (#136): keys are UTC ISO strings but the cursor used
      // local-time setters — on non-UTC servers, DST transitions and offset
      // drift skipped or duplicated buckets.
      if (period === 'minute') {
        const mins = Math.floor(current.getUTCMinutes() / 5) * 5
        key = `${current.toISOString().slice(0, 14)}${mins.toString().padStart(2, '0')}:00.000Z`
        current.setUTCMinutes(current.getUTCMinutes() + 5)
      }
else if (period === 'hour') {
        key = `${current.toISOString().slice(0, 13)}:00:00.000Z`
        current.setUTCHours(current.getUTCHours() + 1)
      }
else if (period === 'month') {
        key = `${current.toISOString().slice(0, 7)}-01T00:00:00.000Z`
        current.setUTCMonth(current.getUTCMonth() + 1)
      }
else {
        key = `${current.toISOString().slice(0, 10)}T00:00:00.000Z`
        current.setUTCDate(current.getUTCDate() + 1)
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

    // Fold rollup days into their buckets. A day-bucket is either rolled or
    // raw (the raw window starts after the last rolled day); a month-bucket
    // can mix both, so its visitors are summed daily uniques.
    const rollupBuckets: Record<string, { views: number, visitors: number }> = {}
    for (const [day, r] of rollupByDay) {
      const key = period === 'month' ? `${day.slice(0, 7)}-01T00:00:00.000Z` : `${day}T00:00:00.000Z`
      if (!rollupBuckets[key])
        rollupBuckets[key] = { views: 0, visitors: 0 }
      rollupBuckets[key].views += r.views
      rollupBuckets[key].visitors += r.visitors
    }

    const timeSeries = allBuckets.map(bucket => ({
      timestamp: bucket,
      views: (bucketMap[bucket]?.views || 0) + (rollupBuckets[bucket]?.views || 0),
      visitors: (bucketMap[bucket]?.visitors.size || 0) + (rollupBuckets[bucket]?.visitors || 0),
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
    const result = await queryAllItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `EVENT#${startDate.toISOString()}` },
        ':end': { S: `EVENT#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const filters = parseFilters(query)
    const events = (result.Items || []).map(unmarshall).filter(e => matchesFilters(e, filters))

    // Aggregate by event name
    const eventStats: Record<string, { count: number; visitors: Set<string>; value: number }> = {}
    for (const e of events) {
      const name = e.name || 'unknown'
      if (!eventStats[name]) {
        eventStats[name] = { count: 0, visitors: new Set(), value: 0 }
      }
      eventStats[name].count++
      eventStats[name].visitors.add(e.visitorId)
      // Sum the event value so revenue/valued events report a total (#132).
      if (typeof e.value === 'number')
        eventStats[name].value += e.value
    }

    const eventsList = Object.entries(eventStats)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        visitors: stats.visitors.size,
        value: stats.value,
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
 * Aggregate custom events into per-(event, property key, property value) rows
 * with counts + unique visitors. Pure (no DynamoDB) so it is unit-testable.
 * The reserved name/value keys are skipped, and non-primitive values ignored.
 */
export function aggregateEventProperties(
  events: Array<{ name?: string, visitorId?: string, properties?: Record<string, any> | null }>,
  opts: { limit?: number } = {},
): {
  eventProperties: Array<{ event: string, key: string, value: string, count: number, visitors: number }>
  byEvent: Record<string, number>
  total: number
} {
  const limit = opts.limit ?? 100
  const groups: Record<string, Record<string, Record<string, { count: number, visitors: Set<string> }>>> = {}
  const byEvent: Record<string, number> = {}

  for (const e of events) {
    const event = e.name || 'unknown'
    byEvent[event] = (byEvent[event] || 0) + 1
    const props = e.properties
    if (!props || typeof props !== 'object') continue
    for (const [key, raw] of Object.entries(props)) {
      if (key === 'name' || key === 'value') continue
      if (raw === null || raw === undefined || typeof raw === 'object') continue
      const value = String(raw)
      const byKey = (groups[event] ||= {})
      const byValue = (byKey[key] ||= {})
      const bucket = (byValue[value] ||= { count: 0, visitors: new Set() })
      bucket.count++
      if (e.visitorId) bucket.visitors.add(e.visitorId)
    }
  }

  const eventProperties: Array<{ event: string, key: string, value: string, count: number, visitors: number }> = []
  for (const event of Object.keys(groups).sort()) {
    for (const key of Object.keys(groups[event]).sort()) {
      const rows = Object.entries(groups[event][key])
        .map(([value, b]) => ({ event, key, value, count: b.count, visitors: b.visitors.size }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
      eventProperties.push(...rows)
    }
  }

  return { eventProperties, byEvent, total: events.length }
}

/**
 * GET /api/sites/{siteId}/event-properties
 * Per-event property value distribution (e.g. signup -> plan=pro/free).
 */
export async function handleGetEventProperties(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 100, 200)
    const eventFilter = query.event
    const filters = parseFilters(query)

    const result = await queryAllItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `EVENT#${startDate.toISOString()}` },
        ':end': { S: `EVENT#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const events = (result.Items || [])
      .map(unmarshall)
      .filter((e: any) => (!eventFilter || e.name === eventFilter) && matchesFilters(e, filters))
      .map((e: any) => {
        // properties are persisted as a JSON string; parse defensively (mirrors the ORM read path)
        if (typeof e.properties === 'string') {
          try { e.properties = JSON.parse(e.properties) }
          catch { e.properties = {} }
        }
        return e
      })

    return jsonResponse(aggregateEventProperties(events, { limit }))
  }
catch (error) {
    console.error('Event properties error:', error)
    return errorResponse('Failed to fetch event properties')
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
    const result = await queryAllItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `CLICK#${startDate.toISOString()}` },
        ':end': { S: `CLICK#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const filters = parseFilters(query)
    const clicks = (result.Items || [])
      .map(unmarshall)
      .filter(c => (!kindFilter || c.kind === kindFilter) && matchesFilters(c, filters))

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
    const result = await queryAllItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ENGAGEMENT#${startDate.toISOString()}` },
        ':end': { S: `ENGAGEMENT#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    const filters = parseFilters(query)
    const samples = (result.Items || []).map(unmarshall).filter(s => matchesFilters(s, filters))

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

    // Rolled prefix (#172): settled days from ROLLUP#DIMS survive the raw TTL.
    const { days: rolled, rawWindowStart } = await readDimRollupPrefix(siteId, startDate, endDate)

    // Query sessions with UTM data for the live tail
    const result = rawWindowStart <= endDate
      ? await querySessionItemsInRange(siteId, rawWindowStart, endDate) as { Items?: any[] }
      : { Items: [] }

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

    // Merge the rolled prefix (daily-unique sums).
    const merged: Record<string, { visitors: number, sessions: number, source: string, medium: string }> = {}
    for (const [name, stats] of Object.entries(campaignStats))
      merged[name] = { visitors: stats.visitors.size, sessions: stats.sessions, source: stats.source, medium: stats.medium }
    for (const dayR of rolled) {
      for (const [name, cell] of Object.entries(dayR.campaigns || {})) {
        const m = (merged[name] ||= { visitors: 0, sessions: 0, source: cell.src, medium: cell.med })
        m.visitors += cell.v
        m.sessions += cell.s
      }
    }

    const campaigns = Object.entries(merged)
      .map(([name, stats]) => ({
        name,
        visitors: stats.visitors,
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

    // One filter parse + TWO queries over the combined span (#137) — the
    // old shape re-parsed filters and re-queried per period (4 queries).
    const filters = parseFilters(query)
    const [pageviewsResult, sessionsResult] = await Promise.all([
      queryAllItems({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':start': { S: `PAGEVIEW#${comparisonStartDate.toISOString()}` },
          ':end': { S: `PAGEVIEW#${endDate.toISOString()}` },
        },
      }) as Promise<{ Items?: any[] }>,
      querySessionItemsInRange(siteId, comparisonStartDate, endDate) as Promise<{ Items?: any[] }>,
    ])
    const allPageviews = (pageviewsResult.Items || []).map(unmarshall).filter((pv: any) => matchesFilters(pv, filters))
    const allSessions = (sessionsResult.Items || []).map(unmarshall).filter(s => matchesFilters(s, filters))

    function getStatsForPeriod(start: Date, end: Date) {
      const pageviews = allPageviews.filter((pv: any) => {
        const t = new Date(pv.timestamp)
        return t >= start && t <= end
      })
      const sessions = allSessions.filter((s) => {
        const t = new Date(s.startedAt)
        return t >= start && t <= end
      })

      const uniqueVisitors = new Set(pageviews.map((pv: any) => pv.visitorId)).size
      const totalViews = pageviews.length
      const totalSessions = sessions.length
      const bounces = sessions.filter(s => s.isBounce).length
      const bounceRate = totalSessions > 0 ? Math.round((bounces / totalSessions) * 100) : 0
      // Real engaged time when departure pings exist (#167), else wall-clock.
      const totalDuration = sessions.reduce((sum, s) => sum + (s.activeTime > 0 ? s.activeTime : (s.duration || 0)), 0)
      const avgDuration = totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0

      return {
        visitors: uniqueVisitors,
        views: totalViews,
        sessions: totalSessions,
        bounceRate,
        avgDuration,
      }
    }

    const currentStats = getStatsForPeriod(startDate, endDate)
    const previousStats = getStatsForPeriod(comparisonStartDate, comparisonEndDate)

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
