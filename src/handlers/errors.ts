/**
 * Error tracking handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'
import { categorizeError, getErrorSeverity, getErrorFingerprint, getErrorTrend, shouldIgnoreError } from '../utils/errors'
import { getTimeInterval } from '../utils/date'

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

    const groupKey = {
      pk: { S: `SITE#${siteId}` },
      sk: { S: `ERROR_GROUP#${fingerprint}` },
    }

    // Upsert error group with atomic counters
    await dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: groupKey,
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

    // Track environment counts, browser and OS sets on the group record
    const env = body.environment || 'production'
    const browser = body.browser || 'Unknown'
    const os = body.os || 'Unknown'

    try {
      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: groupKey,
        UpdateExpression: 'SET environments = if_not_exists(environments, :emptyMap)',
        ExpressionAttributeValues: {
          ':emptyMap': { M: {} },
        },
      })

      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: groupKey,
        UpdateExpression: [
          'SET environments.#envKey = if_not_exists(environments.#envKey, :zero) + :one',
          'severity = :sev',
        ].join(', '),
        ExpressionAttributeNames: {
          '#envKey': env,
        },
        ExpressionAttributeValues: {
          ':zero': { N: '0' },
          ':one': { N: '1' },
          ':sev': { S: severity },
        },
      })

      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: groupKey,
        UpdateExpression: 'ADD browsers :browserSet, operatingSystems :osSet',
        ExpressionAttributeValues: {
          ':browserSet': { SS: [browser] },
          ':osSet': { SS: [os] },
        },
      })
    } catch (e) {
      // Non-critical — don't fail the request if env/browser tracking fails
      console.error('Error tracking group metadata:', e)
    }

    // Fire-and-forget: evaluate error alerts (with cooldown)
    evaluateErrorAlertsThrottled(siteId).catch(() => {})

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
    const operatingSystems = new Set<string>()
    const userAgents = new Set<string>()

    for (const occ of occurrences) {
      if (occ.browser) browsers.add(occ.browser)
      if (occ.url) urls.add(occ.url)
      if (occ.deviceType) devices.add(occ.deviceType)
      if (occ.framework) frameworks.add(occ.framework)
      if (occ.os) operatingSystems.add(occ.os)
      if (occ.userAgent) userAgents.add(occ.userAgent)
    }

    const latest = occurrences[0] || {}
    const category = group?.category || latest.category || categorizeError(latest.message || '')
    const count = group?.count || occurrences.length
    const firstSeen = group?.firstSeen || occurrences[occurrences.length - 1]?.timestamp
    const lastSeen = group?.lastSeen || latest.timestamp
    const trend = firstSeen && lastSeen ? getErrorTrend(firstSeen, lastSeen, count) : 'stable'

    return jsonResponse({
      error: {
        fingerprint: decodedId,
        message: group?.message || latest.message || 'Unknown error',
        category,
        severity: getErrorSeverity(category, count),
        status: group?.status || 'open',
        count,
        firstSeen,
        lastSeen,
        trend,
        browsers: Array.from(browsers),
        operatingSystems: Array.from(operatingSystems),
        affectedUrls: Array.from(urls).slice(0, 10),
        affectedVisitors: userAgents.size || occurrences.length,
        devices: Array.from(devices),
        frameworks: Array.from(frameworks),
        environments: group?.environments || {},
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

/**
 * GET /api/sites/{siteId}/errors/timeseries
 * Returns error counts bucketed by time period.
 */
export async function handleGetErrorTimeseries(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)
    const interval = getTimeInterval(startDate, endDate)

    // Query errors in the time range
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ERROR#${startDate.toISOString()}` },
        ':end': { S: `ERROR#${endDate.toISOString()}` },
      },
      ScanIndexForward: true,
    }) as { Items?: any[] }

    const errors = (result.Items || []).map(unmarshall)

    // Query all error groups to get firstSeen per fingerprint
    const groupResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'ERROR_GROUP#' },
      },
    }) as { Items?: any[] }

    const groups = (groupResult.Items || []).map(unmarshall)
    const groupFirstSeen: Record<string, string> = {}
    for (const g of groups) {
      if (g.fingerprint) groupFirstSeen[g.fingerprint] = g.firstSeen
    }

    // Build time buckets
    const buckets: Record<string, { timestamp: string, total: number, new: number, recurring: number }> = {}
    const fingerprints = new Set<string>()
    const newFingerprints = new Set<string>()

    for (const error of errors) {
      const ts = new Date(error.timestamp)
      let bucketKey: string

      if (interval === 'hour') {
        bucketKey = `${ts.toISOString().slice(0, 13)}:00:00.000Z`
      } else {
        bucketKey = `${ts.toISOString().slice(0, 10)}T00:00:00.000Z`
      }

      if (!buckets[bucketKey]) {
        buckets[bucketKey] = { timestamp: bucketKey, total: 0, new: 0, recurring: 0 }
      }

      buckets[bucketKey].total++
      fingerprints.add(error.fingerprint || error.message)

      // Check if this error was first seen within this bucket's window
      const fp = error.fingerprint || error.message
      const firstSeen = groupFirstSeen[fp]
      if (firstSeen) {
        const firstSeenDate = new Date(firstSeen)
        if (firstSeenDate >= startDate && firstSeenDate <= endDate) {
          buckets[bucketKey].new++
          newFingerprints.add(fp)
        } else {
          buckets[bucketKey].recurring++
        }
      } else {
        buckets[bucketKey].new++
        newFingerprints.add(fp)
      }
    }

    const timeseries = Object.values(buckets).sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    return jsonResponse({
      timeseries,
      summary: {
        totalErrors: errors.length,
        uniqueErrors: fingerprints.size,
        newErrors: newFingerprints.size,
      },
    })
  } catch (error) {
    console.error('Get error timeseries error:', error)
    return errorResponse('Failed to fetch error timeseries')
  }
}

/**
 * GET /api/sites/{siteId}/errors/comparison
 * Compares error counts between current and previous period.
 */
export async function handleGetErrorComparison(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    const periodMs = endDate.getTime() - startDate.getTime()
    const previousStart = new Date(startDate.getTime() - periodMs)
    const previousEnd = startDate

    // Query current period
    const currentResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ERROR#${startDate.toISOString()}` },
        ':end': { S: `ERROR#${endDate.toISOString()}` },
      },
    }) as { Items?: any[] }

    // Query previous period
    const previousResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ERROR#${previousStart.toISOString()}` },
        ':end': { S: `ERROR#${previousEnd.toISOString()}` },
      },
    }) as { Items?: any[] }

    const currentErrors = (currentResult.Items || []).map(unmarshall)
    const previousErrors = (previousResult.Items || []).map(unmarshall)

    const currentFingerprints = new Set(currentErrors.map(e => e.fingerprint || e.message))
    const previousFingerprints = new Set(previousErrors.map(e => e.fingerprint || e.message))

    const currentTotal = currentErrors.length
    const previousTotal = previousErrors.length
    const currentUnique = currentFingerprints.size
    const previousUnique = previousFingerprints.size

    const totalChange = previousTotal === 0 ? (currentTotal > 0 ? 100 : 0)
      : Math.round(((currentTotal - previousTotal) / previousTotal) * 100)
    const uniqueChange = previousUnique === 0 ? (currentUnique > 0 ? 100 : 0)
      : Math.round(((currentUnique - previousUnique) / previousUnique) * 100)

    return jsonResponse({
      current: { total: currentTotal, unique: currentUnique },
      previous: { total: previousTotal, unique: previousUnique },
      changes: { total: totalChange, unique: uniqueChange },
    })
  } catch (error) {
    console.error('Get error comparison error:', error)
    return errorResponse('Failed to fetch error comparison')
  }
}

/**
 * GET /api/sites/{siteId}/errors/groups
 * Returns enriched error groups with metadata.
 */
export async function handleGetErrorGroups(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const sort = query.sort || 'count' // count | lastSeen | firstSeen
    const status = query.status // open | resolved | ignored | all
    const category = query.category
    const limit = Math.min(Number(query.limit) || 50, 200)

    // Query all ERROR_GROUP# records
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'ERROR_GROUP#' },
      },
    }) as { Items?: any[] }

    let groups = (result.Items || []).map(unmarshall)

    // Filter by status
    if (status && status !== 'all') {
      groups = groups.filter(g => (g.status || 'open') === status)
    }

    // Filter by category
    if (category) {
      groups = groups.filter(g => g.category === category)
    }

    // Enrich groups with computed fields
    const enriched = groups.map(g => {
      const count = g.count || 0
      const cat = g.category || 'Other'
      const trend = g.firstSeen && g.lastSeen ? getErrorTrend(g.firstSeen, g.lastSeen, count) : 'stable'

      return {
        fingerprint: g.fingerprint,
        message: g.message || 'Unknown error',
        category: cat,
        count,
        firstSeen: g.firstSeen,
        lastSeen: g.lastSeen,
        status: g.status || 'open',
        severity: g.severity || getErrorSeverity(cat, count),
        trend,
        environments: g.environments || {},
        browsers: g.browsers || [],
        operatingSystems: g.operatingSystems || [],
      }
    })

    // Sort
    if (sort === 'lastSeen') {
      enriched.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''))
    } else if (sort === 'firstSeen') {
      enriched.sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''))
    } else {
      enriched.sort((a, b) => b.count - a.count)
    }

    const limited = enriched.slice(0, limit)

    // Summary stats
    let totalCount = 0
    let criticalCount = 0
    const envBreakdown: Record<string, number> = {}
    for (const g of enriched) {
      totalCount += g.count
      if (g.severity === 'critical') criticalCount++
      for (const [env, envCount] of Object.entries(g.environments)) {
        envBreakdown[env] = (envBreakdown[env] || 0) + (envCount as number)
      }
    }

    return jsonResponse({
      groups: limited,
      summary: {
        totalCount,
        uniqueGroups: enriched.length,
        criticalCount,
        environments: envBreakdown,
      },
    })
  } catch (error) {
    console.error('Get error groups error:', error)
    return errorResponse('Failed to fetch error groups')
  }
}

/**
 * GET /api/sites/{siteId}/errors/alerts
 * Returns error-specific alerts and recent triggers.
 */
export async function handleGetErrorAlerts(request: Request, siteId: string): Promise<Response> {
  try {
    // Query all ALERT# records and filter to error-specific ones
    const alertResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'ALERT#' },
      },
    }) as { Items?: any[] }

    const allAlerts = (alertResult.Items || []).map(unmarshall)
    const errorAlerts = allAlerts.filter(a => a.metric && String(a.metric).startsWith('error_'))

    // Query recent triggers (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const triggerResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':start': { S: `ALERT_TRIGGER#${sevenDaysAgo.toISOString()}` },
        ':end': { S: `ALERT_TRIGGER#${new Date().toISOString()}z` },
      },
      ScanIndexForward: false,
    }) as { Items?: any[] }

    const recentTriggers = (triggerResult.Items || []).map(unmarshall)

    return jsonResponse({ alerts: errorAlerts, recentTriggers })
  } catch (error) {
    console.error('Get error alerts error:', error)
    return errorResponse('Failed to fetch error alerts')
  }
}

/**
 * POST /api/sites/{siteId}/errors/alerts
 * Creates an error-specific alert.
 */
export async function handleCreateErrorAlert(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    const validTypes = ['error_rate_spike', 'new_error_type', 'error_threshold']
    if (!body.name || !body.type || !validTypes.includes(body.type)) {
      return jsonResponse({ error: `Missing or invalid fields. type must be: ${validTypes.join(', ')}` }, 400)
    }

    if (body.type !== 'new_error_type' && (body.threshold === undefined || body.threshold === null)) {
      return jsonResponse({ error: 'threshold is required for this alert type' }, 400)
    }

    const alertId = generateId()
    const alert = {
      pk: `SITE#${siteId}`,
      sk: `ALERT#${alertId}`,
      id: alertId,
      siteId,
      name: body.name,
      metric: body.type,
      condition: body.type === 'error_rate_spike' ? 'change_percent' : 'above',
      threshold: body.threshold || 0,
      windowMinutes: body.windowMinutes || 60,
      isActive: body.isActive ?? true,
      lastTriggered: null,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(alert),
    })

    return jsonResponse({ alert }, 201)
  } catch (error) {
    console.error('Create error alert error:', error)
    return errorResponse('Failed to create error alert')
  }
}

/**
 * POST /api/sites/{siteId}/errors/alerts/evaluate
 * Evaluates all active error alerts for the site.
 */
export async function handleEvaluateErrorAlerts(request: Request, siteId: string): Promise<Response> {
  try {
    const triggered = await evaluateErrorAlerts(siteId)
    return jsonResponse({ triggered })
  } catch (error) {
    console.error('Evaluate error alerts error:', error)
    return errorResponse('Failed to evaluate error alerts')
  }
}

// Cooldown map for throttled alert evaluation
const alertEvalCooldowns = new Map<string, number>()
const EVAL_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

async function evaluateErrorAlertsThrottled(siteId: string): Promise<void> {
  const lastEval = alertEvalCooldowns.get(siteId) || 0
  if (Date.now() - lastEval < EVAL_COOLDOWN_MS) return
  alertEvalCooldowns.set(siteId, Date.now())

  try {
    await evaluateErrorAlerts(siteId)
  } catch (e) {
    console.error('Throttled alert evaluation error:', e)
  }
}

async function evaluateErrorAlerts(siteId: string): Promise<any[]> {
  // Query active error alerts
  const alertResult = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: {
      ':pk': { S: `SITE#${siteId}` },
      ':prefix': { S: 'ALERT#' },
    },
  }) as { Items?: any[] }

  const allAlerts = (alertResult.Items || []).map(unmarshall)
  const errorAlerts = allAlerts.filter(a => a.isActive && a.metric && String(a.metric).startsWith('error_'))

  if (errorAlerts.length === 0) return []

  const now = new Date()
  const triggered: any[] = []

  for (const alert of errorAlerts) {
    const windowMs = (alert.windowMinutes || 60) * 60 * 1000
    const windowStart = new Date(now.getTime() - windowMs)

    let shouldTrigger = false
    let currentValue = 0

    if (alert.metric === 'error_rate_spike') {
      // Compare error count in current window vs previous window
      const prevWindowStart = new Date(windowStart.getTime() - windowMs)

      const [currentResult, prevResult] = await Promise.all([
        dynamodb.query({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
          ExpressionAttributeValues: {
            ':pk': { S: `SITE#${siteId}` },
            ':start': { S: `ERROR#${windowStart.toISOString()}` },
            ':end': { S: `ERROR#${now.toISOString()}` },
          },
          Select: 'COUNT',
        }) as Promise<{ Count?: number }>,
        dynamodb.query({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
          ExpressionAttributeValues: {
            ':pk': { S: `SITE#${siteId}` },
            ':start': { S: `ERROR#${prevWindowStart.toISOString()}` },
            ':end': { S: `ERROR#${windowStart.toISOString()}` },
          },
          Select: 'COUNT',
        }) as Promise<{ Count?: number }>,
      ])

      const currentCount = currentResult.Count || 0
      const prevCount = prevResult.Count || 0
      currentValue = prevCount === 0 ? (currentCount > 0 ? 100 : 0)
        : Math.round(((currentCount - prevCount) / prevCount) * 100)
      shouldTrigger = currentValue >= (alert.threshold || 50)
    } else if (alert.metric === 'new_error_type') {
      // Check if any ERROR_GROUP firstSeen is within window
      const groupResult = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':prefix': { S: 'ERROR_GROUP#' },
        },
      }) as { Items?: any[] }

      const groups = (groupResult.Items || []).map(unmarshall)
      const newGroups = groups.filter(g => g.firstSeen && new Date(g.firstSeen) >= windowStart)
      currentValue = newGroups.length
      shouldTrigger = currentValue > 0
    } else if (alert.metric === 'error_threshold') {
      // Count errors in window
      const countResult = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':start': { S: `ERROR#${windowStart.toISOString()}` },
          ':end': { S: `ERROR#${now.toISOString()}` },
        },
        Select: 'COUNT',
      }) as { Count?: number }

      currentValue = countResult.Count || 0
      shouldTrigger = currentValue >= (alert.threshold || 100)
    }

    if (shouldTrigger) {
      const triggerId = `${now.toISOString()}#${alert.id}`
      const trigger = {
        pk: `SITE#${siteId}`,
        sk: `ALERT_TRIGGER#${triggerId}`,
        alertId: alert.id,
        alertName: alert.name,
        metric: alert.metric,
        triggeredAt: now.toISOString(),
        currentValue,
        threshold: alert.threshold,
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
      }

      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: marshall(trigger),
      })

      // Update lastTriggered on the alert
      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: {
          pk: { S: `SITE#${siteId}` },
          sk: { S: `ALERT#${alert.id}` },
        },
        UpdateExpression: 'SET lastTriggered = :now',
        ExpressionAttributeValues: {
          ':now': { S: now.toISOString() },
        },
      })

      triggered.push(trigger)
    }
  }

  return triggered
}
