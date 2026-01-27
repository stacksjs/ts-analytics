/**
 * Error tracking handlers
 */

import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../lambda-adapter'
import { categorizeError } from '../utils/errors'

/**
 * GET /api/sites/{siteId}/errors
 */
export async function handleGetErrors(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const limit = Math.min(Number(query.limit) || 50, 200)
    const status = query.status // 'open', 'resolved', 'ignored', 'all'

    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ERROR#${startDate.toISOString()}` },
        ':end': { S: `ERROR#${endDate.toISOString()}` },
      },
      ScanIndexForward: false,
      Limit: limit * 2,
    }) as { Items?: any[] }

    let errors = (result.Items || []).map(unmarshall)

    // Filter by status if specified
    if (status && status !== 'all') {
      errors = errors.filter(e => (e.status || 'open') === status)
    }

    // Group errors by message/fingerprint
    const errorGroups: Record<string, {
      message: string
      count: number
      firstSeen: string
      lastSeen: string
      browsers: Set<string>
      urls: Set<string>
      status: string
      category: string
      errorId: string
    }> = {}

    for (const error of errors) {
      const key = error.message || 'Unknown error'
      if (!errorGroups[key]) {
        errorGroups[key] = {
          message: key,
          count: 0,
          firstSeen: error.timestamp,
          lastSeen: error.timestamp,
          browsers: new Set(),
          urls: new Set(),
          status: error.status || 'open',
          category: categorizeError(key),
          errorId: error.errorId || error.id,
        }
      }
      errorGroups[key].count++
      if (error.timestamp < errorGroups[key].firstSeen) {
        errorGroups[key].firstSeen = error.timestamp
      }
      if (error.timestamp > errorGroups[key].lastSeen) {
        errorGroups[key].lastSeen = error.timestamp
      }
      if (error.browser) errorGroups[key].browsers.add(error.browser)
      if (error.url) errorGroups[key].urls.add(error.url)
    }

    const groupedErrors = Object.entries(errorGroups)
      .map(([message, data]) => ({
        errorId: data.errorId,
        message,
        count: data.count,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
        browsers: Array.from(data.browsers),
        affectedUrls: Array.from(data.urls).slice(0, 5),
        status: data.status,
        category: data.category,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    return jsonResponse({
      errors: groupedErrors,
      total: groupedErrors.length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Get errors error:', error)
    return errorResponse('Failed to fetch errors')
  }
}

/**
 * GET /api/sites/{siteId}/errors/statuses
 */
export async function handleGetErrorStatuses(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const errorIds = query.errorIds?.split(',') || []

    if (errorIds.length === 0) {
      return jsonResponse({ statuses: {} })
    }

    // Query error status records
    const statuses: Record<string, string> = {}
    for (const errorId of errorIds.slice(0, 50)) {
      const result = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':sk': { S: `ERROR_STATUS#${errorId}` },
        },
      }) as { Items?: any[] }

      if (result.Items && result.Items.length > 0) {
        const item = unmarshall(result.Items[0])
        statuses[errorId] = item.status || 'open'
      } else {
        statuses[errorId] = 'open'
      }
    }

    return jsonResponse({ statuses })
  } catch (error) {
    console.error('Get error statuses error:', error)
    return errorResponse('Failed to fetch error statuses')
  }
}

/**
 * POST /api/sites/{siteId}/errors/status
 */
export async function handleUpdateErrorStatus(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>
    const { errorId, status, errorIds, bulkStatus } = body

    // Handle bulk updates
    if (errorIds && Array.isArray(errorIds) && bulkStatus) {
      const validStatuses = ['open', 'resolved', 'ignored']
      if (!validStatuses.includes(bulkStatus)) {
        return jsonResponse({ error: 'Invalid status. Must be: open, resolved, or ignored' }, 400)
      }

      const results: Record<string, boolean> = {}
      for (const id of errorIds.slice(0, 100)) {
        try {
          await dynamodb.putItem({
            TableName: TABLE_NAME,
            Item: marshall({
              pk: `SITE#${siteId}`,
              sk: `ERROR_STATUS#${id}`,
              errorId: id,
              status: bulkStatus,
              updatedAt: new Date().toISOString(),
            }),
          })
          results[id] = true
        } catch (e) {
          results[id] = false
        }
      }

      return jsonResponse({ success: true, results })
    }

    // Single update
    if (!errorId || !status) {
      return jsonResponse({ error: 'Missing required fields: errorId, status' }, 400)
    }

    const validStatuses = ['open', 'resolved', 'ignored']
    if (!validStatuses.includes(status)) {
      return jsonResponse({ error: 'Invalid status. Must be: open, resolved, or ignored' }, 400)
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: `SITE#${siteId}`,
        sk: `ERROR_STATUS#${errorId}`,
        errorId,
        status,
        updatedAt: new Date().toISOString(),
      }),
    })

    return jsonResponse({ success: true, errorId, status })
  } catch (error) {
    console.error('Update error status error:', error)
    return errorResponse('Failed to update error status')
  }
}
