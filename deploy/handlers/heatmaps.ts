/**
 * Heatmap handlers
 */

import { dynamodb, TABLE_NAME, unmarshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../lambda-adapter'

/**
 * GET /api/sites/{siteId}/heatmap/clicks
 */
export async function handleGetHeatmapClicks(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const path = query.path
    const device = query.device
    const limit = Math.min(Number(query.limit) || 1000, 10000)

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

    if (path) {
      clicks = clicks.filter(c => c.path === path || c.path === decodeURIComponent(path))
    }

    if (device && device !== 'all') {
      clicks = clicks.filter(c => c.deviceType === device)
    }

    const gridSize = Number(query.gridSize) || 20
    const clickGrid: Record<string, { count: number; elements: Record<string, number> }> = {}

    for (const click of clicks) {
      const gridX = Math.floor(click.documentX / gridSize) * gridSize
      const gridY = Math.floor(click.documentY / gridSize) * gridSize
      const key = `${gridX},${gridY}`

      if (!clickGrid[key]) {
        clickGrid[key] = { count: 0, elements: {} }
      }
      clickGrid[key].count++

      if (click.selector) {
        clickGrid[key].elements[click.selector] = (clickGrid[key].elements[click.selector] || 0) + 1
      }
    }

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

    return jsonResponse({
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
    return errorResponse('Failed to fetch heatmap clicks')
  }
}

/**
 * GET /api/sites/{siteId}/heatmap/scroll
 */
export async function handleGetHeatmapScroll(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const path = query.path
    const device = query.device

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

    if (path) {
      scrollData = scrollData.filter(s => s.path === path || s.path === decodeURIComponent(path))
    }

    if (device && device !== 'all') {
      scrollData = scrollData.filter(s => s.deviceType === device)
    }

    const depthBuckets: Record<number, { sessions: number; totalTime: number }> = {}
    let totalSessions = 0
    let totalMaxDepth = 0

    for (const scroll of scrollData) {
      totalSessions++
      totalMaxDepth += scroll.maxScrollDepth || 0

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

    const scrollDepths = Object.entries(depthBuckets)
      .map(([depth, data]) => ({
        depth: Number(depth),
        reachPercentage: totalSessions > 0 ? Math.round((data.sessions / totalSessions) * 100) : 0,
        avgTimeMs: data.sessions > 0 ? Math.round(data.totalTime / data.sessions) : 0,
        sessions: data.sessions,
      }))
      .sort((a, b) => a.depth - b.depth)

    const avgMaxDepth = totalSessions > 0 ? Math.round(totalMaxDepth / totalSessions) : 0

    return jsonResponse({
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
    return errorResponse('Failed to fetch heatmap scroll data')
  }
}

/**
 * GET /api/sites/{siteId}/heatmap/pages
 */
export async function handleGetHeatmapPages(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 20, 100)

    const clicksResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `HMCLICK#${startDate.toISOString()}` },
        ':end': { S: `HMCLICK#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

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

    return jsonResponse({
      pages,
      totalPages: Object.keys(pageStats).length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Heatmap pages error:', error)
    return errorResponse('Failed to fetch heatmap pages')
  }
}
