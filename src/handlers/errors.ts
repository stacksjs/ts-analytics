/**
 * Error tracking handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'
import { categorizeError, getErrorSeverity, getErrorFingerprint, shouldIgnoreError } from '../utils/errors'

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

    // Group errors by fingerprint (preferred) or message
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
      fingerprint: string
    }> = {}

    for (const error of errors) {
      const key = error.fingerprint || error.message || 'Unknown error'
      const message = error.message || 'Unknown error'
      if (!errorGroups[key]) {
        const category = error.category || categorizeError(message)
        errorGroups[key] = {
          message,
          count: 0,
          firstSeen: error.timestamp,
          lastSeen: error.timestamp,
          browsers: new Set(),
          urls: new Set(),
          status: error.status || 'open',
          category,
          errorId: error.errorId || error.id,
          fingerprint: error.fingerprint || getErrorFingerprint(message, error.stack),
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
      .map(([_key, data]) => ({
        errorId: data.errorId,
        message: data.message,
        count: data.count,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
        browsers: Array.from(data.browsers),
        affectedUrls: Array.from(data.urls).slice(0, 5),
        status: data.status,
        category: data.category,
        severity: getErrorSeverity(data.category, data.count),
        fingerprint: data.fingerprint,
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

/**
 * POST /errors/collect
 * Receives enriched error reports from the client SDK.
 */
export async function handleCollectError(request: Request, siteId: string, keyId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.message) {
      return new Response(null, { status: 400 })
    }

    if (shouldIgnoreError(body.message)) {
      return new Response(null, { status: 204 })
    }

    const timestamp = new Date()
    const id = generateId()
    const fingerprint = body.fingerprint || getErrorFingerprint(body.message, body.stack)
    const category = categorizeError(body.message)
    const severity = getErrorSeverity(category, 1)
    const dateKey = timestamp.toISOString().slice(0, 10)

    // Store individual error occurrence
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: `SITE#${siteId}`,
        sk: `ERROR#${timestamp.toISOString()}#${id}`,
        gsi1pk: `SITE#${siteId}#DATE#${dateKey}`,
        gsi1sk: `ERROR#${fingerprint}`,
        id,
        siteId,
        apiKeyId: keyId,
        message: String(body.message || '').slice(0, 500),
        errorType: body.type || 'Error',
        category,
        severity,
        fingerprint,
        source: body.source || '',
        line: body.line || 0,
        col: body.col || 0,
        stack: String(body.stack || '').slice(0, 4000),
        url: body.url || '',
        path: body.url ? new URL(body.url).pathname : '',
        browser: body.browser || '',
        browserVersion: body.browserVersion || '',
        os: body.os || '',
        osVersion: body.osVersion || '',
        deviceType: body.deviceType || 'unknown',
        screenWidth: body.screenWidth || 0,
        screenHeight: body.screenHeight || 0,
        framework: body.framework || 'vanilla',
        sdkVersion: body.sdkVersion || '',
        environment: body.environment || 'production',
        tags: body.tags ? JSON.stringify(body.tags) : '{}',
        breadcrumbs: body.breadcrumbs ? JSON.stringify((body.breadcrumbs as any[]).slice(-20)) : '[]',
        componentName: body.componentName || '',
        lifecycle: body.lifecycle || '',
        userAgent: body.userAgent || '',
        timestamp: timestamp.toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      }),
    })

    // Upsert error group with atomic counters
    await dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: `SITE#${siteId}` },
        sk: { S: `ERROR_GROUP#${fingerprint}` },
      },
      UpdateExpression: [
        'SET #count = if_not_exists(#count, :zero) + :one',
        'lastSeen = :now',
        'firstSeen = if_not_exists(firstSeen, :now)',
        'message = :msg',
        'category = :cat',
        'fingerprint = :fp',
        'siteId = :sid',
        '#status = if_not_exists(#status, :open)',
      ].join(', '),
      ExpressionAttributeNames: {
        '#count': 'count',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':zero': { N: '0' },
        ':one': { N: '1' },
        ':now': { S: timestamp.toISOString() },
        ':msg': { S: String(body.message || '').slice(0, 500) },
        ':cat': { S: category },
        ':fp': { S: fingerprint },
        ':sid': { S: siteId },
        ':open': { S: 'open' },
      },
    })

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('Collect error:', error)
    return errorResponse('Failed to collect error')
  }
}

/**
 * GET /api/sites/{siteId}/errors/{errorId}
 * Returns detailed information for a specific error group (by fingerprint).
 */
export async function handleGetErrorDetail(request: Request, siteId: string, errorId: string): Promise<Response> {
  try {
    const decodedId = decodeURIComponent(errorId)

    // First try to find the error group record
    const groupResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':sk': { S: `ERROR_GROUP#${decodedId}` },
      },
    }) as { Items?: any[] }

    // Query recent individual occurrences matching this fingerprint
    // Use GSI1 to find errors by fingerprint across dates
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const occurrencesResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      FilterExpression: 'fingerprint = :fp',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ERROR#${thirtyDaysAgo.toISOString()}` },
        ':end': { S: `ERROR#${now.toISOString()}z` },
        ':fp': { S: decodedId },
      },
      ScanIndexForward: false,
      Limit: 50,
    }) as { Items?: any[] }

    const occurrences = (occurrencesResult.Items || []).map(unmarshall)

    // If no group record found, try to build from occurrences
    let group: Record<string, any> | null = null
    if (groupResult.Items && groupResult.Items.length > 0) {
      group = unmarshall(groupResult.Items[0])
    }

    // If we still have no data, try querying by the raw errorId as a single occurrence
    if (!group && occurrences.length === 0) {
      const singleResult = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        FilterExpression: 'id = :id',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':prefix': { S: 'ERROR#' },
          ':id': { S: decodedId },
        },
        ScanIndexForward: false,
        Limit: 1,
      }) as { Items?: any[] }

      if (singleResult.Items && singleResult.Items.length > 0) {
        occurrences.push(unmarshall(singleResult.Items[0]))
      }
    }

    if (!group && occurrences.length === 0) {
      return jsonResponse({ error: 'Error not found' }, 404)
    }

    // Build the detail response
    const browsers = new Set<string>()
    const urls = new Set<string>()
    const devices = new Set<string>()
    const frameworks = new Set<string>()

    for (const occ of occurrences) {
      if (occ.browser) browsers.add(occ.browser)
      if (occ.url) urls.add(occ.url)
      if (occ.deviceType) devices.add(occ.deviceType)
      if (occ.framework) frameworks.add(occ.framework)
    }

    const latest = occurrences[0] || {}
    const category = group?.category || latest.category || categorizeError(latest.message || '')
    const count = group?.count || occurrences.length

    return jsonResponse({
      error: {
        fingerprint: decodedId,
        message: group?.message || latest.message || 'Unknown error',
        category,
        severity: getErrorSeverity(category, count),
        status: group?.status || 'open',
        count,
        firstSeen: group?.firstSeen || occurrences[occurrences.length - 1]?.timestamp,
        lastSeen: group?.lastSeen || latest.timestamp,
        browsers: Array.from(browsers),
        affectedUrls: Array.from(urls).slice(0, 10),
        devices: Array.from(devices),
        frameworks: Array.from(frameworks),
        // Latest occurrence details
        latestOccurrence: latest.id ? {
          id: latest.id,
          stack: latest.stack,
          source: latest.source,
          line: latest.line,
          col: latest.col,
          url: latest.url,
          browser: latest.browser,
          browserVersion: latest.browserVersion,
          os: latest.os,
          osVersion: latest.osVersion,
          deviceType: latest.deviceType,
          framework: latest.framework,
          sdkVersion: latest.sdkVersion,
          environment: latest.environment,
          componentName: latest.componentName,
          lifecycle: latest.lifecycle,
          tags: latest.tags ? JSON.parse(latest.tags) : {},
          breadcrumbs: latest.breadcrumbs ? JSON.parse(latest.breadcrumbs) : [],
          timestamp: latest.timestamp,
        } : null,
        // Recent occurrences timeline
        recentOccurrences: occurrences.slice(0, 20).map(occ => ({
          id: occ.id,
          timestamp: occ.timestamp,
          browser: occ.browser,
          os: occ.os,
          url: occ.url,
          environment: occ.environment,
        })),
      },
    })
  } catch (error) {
    console.error('Get error detail error:', error)
    return errorResponse('Failed to fetch error details')
  }
}
