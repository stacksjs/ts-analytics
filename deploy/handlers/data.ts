/**
 * Data export, GDPR, and retention handlers
 */

import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../lambda-adapter'

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
  } catch (error) {
    console.error('Export error:', error)
    return errorResponse('Failed to export data')
  }
}

/**
 * GET /api/sites/{siteId}/retention
 */
export async function handleGetRetentionSettings(request: Request, siteId: string): Promise<Response> {
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
  } catch (error) {
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

    const settings = {
      pk: `SITE#${siteId}`,
      sk: 'RETENTION_SETTINGS',
      siteId,
      retentionDays: body.retentionDays || 365,
      autoDelete: body.autoDelete ?? true,
      anonymizeAfterDays: body.anonymizeAfterDays || 90,
      updatedAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(settings),
    })

    return jsonResponse({ settings })
  } catch (error) {
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

    // Query all data for this visitor
    const [pageviews, sessions, events] = await Promise.all([
      dynamodb.query({
        TableName: TABLE_NAME,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: `VISITOR#${visitorId}` },
        },
      }),
      dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        FilterExpression: 'visitorId = :visitorId',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':prefix': { S: 'SESSION#' },
          ':visitorId': { S: visitorId },
        },
      }),
      dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        FilterExpression: 'visitorId = :visitorId',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':prefix': { S: 'EVENT#' },
          ':visitorId': { S: visitorId },
        },
      }),
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
  } catch (error) {
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

    // Query all items for this visitor
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `VISITOR#${visitorId}` },
      },
    }) as { Items?: any[] }

    const items = (result.Items || []).map(unmarshall)

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
      } catch (e) {
        console.error('Failed to delete item:', e)
      }
    }

    return jsonResponse({
      success: true,
      visitorId,
      deletedCount,
      deletedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('GDPR delete error:', error)
    return errorResponse('Failed to delete GDPR data')
  }
}

/**
 * GET /api/sites/{siteId}/insights
 */
export async function handleGetInsights(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    // Get current and previous period data
    const duration = endDate.getTime() - startDate.getTime()
    const previousStartDate = new Date(startDate.getTime() - duration)
    const previousEndDate = new Date(startDate.getTime() - 1)

    // Query sessions for both periods
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const allSessions = (result.Items || []).map(unmarshall)

    const currentSessions = allSessions.filter(s => {
      const t = new Date(s.startedAt)
      return t >= startDate && t <= endDate
    })

    const previousSessions = allSessions.filter(s => {
      const t = new Date(s.startedAt)
      return t >= previousStartDate && t <= previousEndDate
    })

    // Generate insights
    const insights: Array<{ type: string; title: string; description: string; metric?: string; change?: number }> = []

    // Traffic change
    const currentTraffic = currentSessions.length
    const previousTraffic = previousSessions.length
    if (previousTraffic > 0) {
      const change = ((currentTraffic - previousTraffic) / previousTraffic) * 100
      if (Math.abs(change) > 10) {
        insights.push({
          type: change > 0 ? 'positive' : 'negative',
          title: change > 0 ? 'Traffic Increase' : 'Traffic Decrease',
          description: `Sessions ${change > 0 ? 'increased' : 'decreased'} by ${Math.abs(Math.round(change))}% compared to the previous period`,
          metric: 'sessions',
          change: Math.round(change),
        })
      }
    }

    // Bounce rate insight
    const currentBounces = currentSessions.filter(s => s.isBounce).length
    const currentBounceRate = currentSessions.length > 0 ? (currentBounces / currentSessions.length) * 100 : 0
    if (currentBounceRate > 70) {
      insights.push({
        type: 'warning',
        title: 'High Bounce Rate',
        description: `Your bounce rate is ${Math.round(currentBounceRate)}%. Consider improving page load times or content relevance.`,
        metric: 'bounceRate',
      })
    }

    // Mobile traffic insight
    const mobileSession = currentSessions.filter(s => s.deviceType === 'mobile').length
    const mobilePercent = currentSessions.length > 0 ? (mobileSession / currentSessions.length) * 100 : 0
    if (mobilePercent > 50) {
      insights.push({
        type: 'info',
        title: 'Mobile-First Traffic',
        description: `${Math.round(mobilePercent)}% of your traffic comes from mobile devices. Ensure your site is mobile-optimized.`,
        metric: 'mobilePercent',
      })
    }

    return jsonResponse({
      insights,
      summary: {
        currentPeriod: { start: startDate.toISOString(), end: endDate.toISOString(), sessions: currentTraffic },
        previousPeriod: { start: previousStartDate.toISOString(), end: previousEndDate.toISOString(), sessions: previousTraffic },
      },
    })
  } catch (error) {
    console.error('Get insights error:', error)
    return errorResponse('Failed to fetch insights')
  }
}
