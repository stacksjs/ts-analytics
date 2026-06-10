/**
 * Error tracking handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'
import { categorizeError, getErrorSeverity, getErrorFingerprint, getErrorTrend, shouldIgnoreError } from '../utils/errors'
import { rateLimitAllow } from '../lib/rate-limit'
import { getMembership } from '../lib/membership'
import { recordEventWithinQuota } from '../lib/quota'
import { sendEmail } from '../lib/email'
import { enqueueWebhookEvent } from './webhooks'
import { symbolicateStack, storeSourceMap, listSourceMaps } from '../lib/sourcemaps'

/** Max error events per minute per ingest key (429 beyond this). */
const ERROR_INGEST_LIMIT = Number(process.env.ANALYTICS_ERROR_RATE_LIMIT) || 300
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

    // Issue list reads ERROR_GROUP# rollups maintained at ingest (#83) instead
    // of scanning raw occurrences — one bounded query per dashboard load, and
    // counts survive the raw events' 30-day TTL. An issue is listed when its
    // active window overlaps the requested range; `count` is the group's
    // lifetime total (Sentry semantics), not occurrences-in-range.
    const groups: any[] = []
    let lastKey: Record<string, any> | undefined
    do {
      const page = await dynamodb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${siteId}` },
          ':prefix': { S: 'ERROR_GROUP#' },
        },
        ExclusiveStartKey: lastKey,
      }) as { Items?: any[], LastEvaluatedKey?: Record<string, any> }
      groups.push(...(page.Items || []).map(unmarshall))
      lastKey = page.LastEvaluatedKey
    } while (lastKey && groups.length < 5000)

    // Triage state lives in ERROR_STATUS# (same partition) — join it in so the
    // status filter reflects resolves/ignores, which raw items never carried.
    const statusByFingerprint: Record<string, string> = {}
    const statusResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'ERROR_STATUS#' },
      },
    }) as { Items?: any[] }
    for (const raw of (statusResult.Items || [])) {
      const s = unmarshall(raw)
      if (s.errorId) statusByFingerprint[s.errorId] = s.status || 'open'
    }

    const startIso = startDate.toISOString()
    const endIso = endDate.toISOString()

    const groupedErrors = groups
      .filter(g => g.fingerprint && g.lastSeen >= startIso && g.firstSeen <= endIso)
      .map((g) => {
        const issueStatus = statusByFingerprint[g.fingerprint] || g.status || 'open'
        return {
          errorId: g.fingerprint,
          message: g.message || 'Unknown error',
          count: Number(g.count) || 0,
          firstSeen: g.firstSeen,
          lastSeen: g.lastSeen,
          browsers: (g.browsers as string[] | undefined) || [],
          status: issueStatus,
          category: g.category || 'unknown',
          severity: getErrorSeverity(g.category || 'unknown', Number(g.count) || 0),
          fingerprint: g.fingerprint,
        }
      })
      .filter(g => !status || status === 'all' ? true : g.status === status)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    return jsonResponse({
      errors: groupedErrors,
      total: groupedErrors.length,
      dateRange: {
        start: startIso,
        end: endIso,
      },
    })
  }
catch (error) {
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
    const errorIds = query.errorIds?.split(',').filter(Boolean) || []

    if (errorIds.length > 0) {
      // Query specific error status records
      const statuses: Record<string, { status: string, regressed?: boolean, assignee?: string }> = {}
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
          statuses[errorId] = { status: item.status || 'new', regressed: !!item.regressed, assignee: item.assignee }
        }
      }
      return jsonResponse({ statuses })
    }

    // No errorIds specified — return all statuses for this site
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'ERROR_STATUS#' },
      },
    }) as { Items?: any[] }

    const statuses: Record<string, { status: string, regressed?: boolean, assignee?: string }> = {}
    for (const item of (result.Items || []).map(unmarshall)) {
      if (item.errorId) {
        statuses[item.errorId] = { status: item.status || 'new', regressed: !!item.regressed, assignee: item.assignee }
      }
    }

    return jsonResponse({ statuses })
  }
catch (error) {
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
      const validStatuses = ['new', 'open', 'resolved', 'ignored']
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
        }
catch (e) {
          results[id] = false
        }
      }

      return jsonResponse({ success: true, results })
    }

    // Single update
    if (!errorId || !status) {
      return jsonResponse({ error: 'Missing required fields: errorId, status' }, 400)
    }

    const validStatuses = ['new', 'open', 'resolved', 'ignored']
    if (!validStatuses.includes(status)) {
      return jsonResponse({ error: 'Invalid status. Must be: open, resolved, or ignored' }, 400)
    }

    const now = new Date().toISOString()
    const statusItem: Record<string, any> = {
      pk: `SITE#${siteId}`,
      sk: `ERROR_STATUS#${errorId}`,
      errorId,
      status,
      updatedAt: now,
      regressed: false,
    }
    if (status === 'resolved') {
      statusItem.resolvedAt = now
      if (body.release) statusItem.resolvedRelease = body.release
    }
    await dynamodb.putItem({ TableName: TABLE_NAME, Item: marshall(statusItem) })

    return jsonResponse({ success: true, errorId, status })
  }
catch (error) {
    console.error('Update error status error:', error)
    return errorResponse('Failed to update error status')
  }
}

/**
 * POST /api/sites/{siteId}/errors/assign — assign an issue to a project member
 * (assignee = userId, or null/omitted to unassign). Stored on the issue's
 * ERROR_STATUS# record.
 */
export async function handleAssignError(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>
    const errorId = body.errorId
    const assignee = body.assignee || null
    if (!errorId) return jsonResponse({ error: 'Missing required field: errorId' }, 400)

    if (assignee) {
      const role = await getMembership(assignee, siteId)
      if (!role) return jsonResponse({ error: 'Assignee is not a member of this project' }, 400)
    }

    const now = new Date().toISOString()
    const key = { pk: { S: `SITE#${siteId}` }, sk: { S: `ERROR_STATUS#${errorId}` } }
    if (assignee) {
      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: 'SET assignee = :a, errorId = :eid, updatedAt = :now',
        ExpressionAttributeValues: { ':a': { S: assignee }, ':eid': { S: errorId }, ':now': { S: now } },
      })
    }
else {
      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: 'REMOVE assignee SET errorId = :eid, updatedAt = :now',
        ExpressionAttributeValues: { ':eid': { S: errorId }, ':now': { S: now } },
      })
    }

    return jsonResponse({ success: true, errorId, assignee })
  }
catch (error) {
    console.error('Assign error error:', error)
    return errorResponse('Failed to assign error')
  }
}

/**
 * POST /errors/collect
 * Receives enriched error reports from the client SDK.
 */
export async function handleCollectError(request: Request, siteId: string, keyId: string): Promise<Response> {
  try {
    if (!rateLimitAllow(`err:${keyId}`, ERROR_INGEST_LIMIT, 60_000)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      })
    }

    const body = await request.json() as Record<string, any>

    if (!body.message) {
      return new Response(null, { status: 400 })
    }

    if (shouldIgnoreError(body.message, body.framework)) {
      return new Response(null, { status: 204 })
    }

    // Monthly per-project event quota (coarse cap; no-op unless configured).
    if (!(await recordEventWithinQuota(siteId))) {
      return new Response(JSON.stringify({ error: 'Monthly event quota exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const timestamp = new Date()
    const id = generateId()
    const fingerprint = body.fingerprint || getErrorFingerprint(body.message, body.stack, body.framework)
    const category = categorizeError(body.message, body.type, body.framework)
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
        path: (() => { try { return body.url ? new URL(body.url).pathname : '' }
catch { return body.url || '' } })(),
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
        release: body.release || '',
        level: body.level || 'error',
        user: body.user ? JSON.stringify(body.user) : '',
        extra: body.extra ? JSON.stringify(body.extra) : '{}',
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

    // Upsert error group with atomic counters. Browser names accumulate as a
    // string set so the issue list can read them off the rollup (#83) — low
    // cardinality, so the item stays small.
    const groupBrowser = String(body.browser || '').slice(0, 50)
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
        'firstRelease = if_not_exists(firstRelease, :rel)',
        'lastRelease = :rel',
        '#status = if_not_exists(#status, :open)',
      ].join(', ') + (groupBrowser ? ' ADD browsers :br' : ''),
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
        ':rel': { S: body.release || 'unknown' },
        ...(groupBrowser ? { ':br': { SS: [groupBrowser] } } : {}),
      },
    })

    // Auto-regression: a new occurrence of a *resolved* issue reopens it. The
    // conditional update only fires when an ERROR_STATUS# record exists and is
    // 'resolved'; otherwise ConditionalCheckFailed (expected) and we move on.
    try {
      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: { pk: { S: `SITE#${siteId}` }, sk: { S: `ERROR_STATUS#${fingerprint}` } },
        UpdateExpression: 'SET #s = :open, regressed = :t, regressedAt = :now, regressedInRelease = :rel, updatedAt = :now',
        ConditionExpression: '#s = :resolved',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':open': { S: 'open' },
          ':resolved': { S: 'resolved' },
          ':t': { BOOL: true },
          ':now': { S: timestamp.toISOString() },
          ':rel': { S: body.release || 'unknown' },
        },
      })
    }
catch (e: any) {
      if (!String(e?.name || e).includes('ConditionalCheckFailed')) console.error('Regression update failed:', e)
    }

    // Fan out to any webhooks subscribed to error events (#92). Fire-and-forget
    // so webhook delivery never blocks ingest.
    void enqueueWebhookEvent(siteId, 'error', {
      fingerprint,
      message: String(body.message || '').slice(0, 200),
      type: body.type || 'Error',
      url: body.url,
    }).catch(() => {})

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
    }
catch (e) {
      // Non-critical — don't fail the request if env/browser tracking fails
      console.error('Error tracking group metadata:', e)
    }

    // Fire-and-forget: evaluate error alerts (with cooldown)
    evaluateErrorAlertsThrottled(siteId).catch(() => {})

    return new Response(null, { status: 204 })
  }
catch (error) {
    console.error('Collect error:', error)
    return errorResponse('Failed to collect error')
  }
}

/**
 * GET /api/sites/{siteId}/errors/{errorId}
 * Returns detailed information for a specific error group (by fingerprint).
 */
export async function handleGetErrorDetail(_request: Request, siteId: string, errorId: string): Promise<Response> {
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
    const category = group?.category || latest.category || categorizeError(latest.message || '', latest.errorType, latest.framework)
    const count = group?.count || occurrences.length
    const firstSeen = group?.firstSeen || occurrences[occurrences.length - 1]?.timestamp
    const lastSeen = group?.lastSeen || latest.timestamp
    const trend = firstSeen && lastSeen ? getErrorTrend(firstSeen, lastSeen, count) : 'stable'

    // Symbolicate the minified stack against the release's uploaded source
    // maps (#74); null when no maps match — the UI then shows the raw stack.
    let symbolicatedStack: string | null = null
    if (latest.stack && latest.release) {
      symbolicatedStack = await symbolicateStack(siteId, latest.release, latest.stack).catch(() => null)
    }

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
          symbolicatedStack,
          release: latest.release || '',
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
  }
catch (error) {
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
      }
else {
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
        }
else {
          buckets[bucketKey].recurring++
        }
      }
else {
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
  }
catch (error) {
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
  }
catch (error) {
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
    }
else if (sort === 'firstSeen') {
      enriched.sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''))
    }
else {
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
  }
catch (error) {
    console.error('Get error groups error:', error)
    return errorResponse('Failed to fetch error groups')
  }
}

/**
 * GET /api/sites/{siteId}/errors/alerts
 * Returns error-specific alerts and recent triggers.
 */
export async function handleGetErrorAlerts(_request: Request, siteId: string): Promise<Response> {
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
  }
catch (error) {
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
  }
catch (error) {
    console.error('Create error alert error:', error)
    return errorResponse('Failed to create error alert')
  }
}

/**
 * POST /api/sites/{siteId}/errors/alerts/evaluate
 * Evaluates all active error alerts for the site.
 */
export async function handleEvaluateErrorAlerts(_request: Request, siteId: string): Promise<Response> {
  try {
    const triggered = await evaluateErrorAlerts(siteId)
    return jsonResponse({ triggered })
  }
catch (error) {
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
  }
catch (e) {
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
    }
else if (alert.metric === 'new_error_type') {
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
    }
else if (alert.metric === 'error_threshold') {
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

    // Cooldown: don't re-fire while still inside the same window (avoids
    // re-notifying on every scheduler tick while the condition persists).
    if (shouldTrigger && alert.lastTriggered && now.getTime() - new Date(alert.lastTriggered).getTime() < windowMs) {
      shouldTrigger = false
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
      await notifyAlert(alert, trigger)
    }
  }

  return triggered
}

/** Notify an alert's configured channels (email + webhook) when it fires. */
async function notifyAlert(alert: any, trigger: any): Promise<void> {
  const msg = `Alert "${alert.name}" triggered: ${alert.metric} = ${trigger.currentValue} (threshold ${alert.threshold ?? '—'})`
  if (alert.email) {
    await sendEmail({ to: alert.email, subject: `[Alert] ${alert.name}`, text: msg })
  }
  // Site-level webhook subscriptions to alert.triggered go through the signed
  // delivery queue (#92); alert.webhookUrl below is the alert's own direct URL.
  if (alert.siteId) {
    void enqueueWebhookEvent(alert.siteId, 'alert.triggered', {
      alert: alert.name,
      metric: alert.metric,
      value: trigger.currentValue,
      threshold: alert.threshold,
      triggeredAt: trigger.triggeredAt,
    }).catch((e: Error) => console.error('Alert webhook enqueue failed:', e.message))
  }
  if (alert.webhookUrl) {
    try {
      await fetch(alert.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert: alert.name, metric: alert.metric, value: trigger.currentValue, threshold: alert.threshold, triggeredAt: trigger.triggeredAt }),
      })
    }
catch (e) {
      console.error('Alert webhook failed:', (e as Error).message)
    }
  }
}

/** Evaluate error alerts for every site (driven by the scheduled job, #80/#90). */
export async function evaluateAllSitesErrorAlerts(): Promise<number> {
  const sitesResult = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: 'SITES' } },
  }) as { Items?: any[] }

  let total = 0
  for (const raw of (sitesResult.Items || [])) {
    const site = unmarshall(raw)
    const id = site.siteId || site.id
    if (!id) continue
    try {
      total += (await evaluateErrorAlerts(id)).length
    }
catch (e) {
      console.error(`[jobs] alert eval ${id} failed:`, (e as Error).message)
    }
  }
  return total
}

// ── Source maps (#74) ───────────────────────────────────────────────────────

/**
 * POST /api/sites/{siteId}/sourcemaps — upload a map for (release, file).
 * Body: { release, file, map } where map is the JSON string (or object).
 * Editor-gated by the global authz middleware like every per-project write.
 */
export async function handleUploadSourceMap(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as { release?: string, file?: string, map?: unknown }
    if (!body.release || !body.file || !body.map) {
      return jsonResponse({ error: 'Missing required fields: release, file, map' }, 400)
    }
    const mapJson = typeof body.map === 'string' ? body.map : JSON.stringify(body.map)
    const result = await storeSourceMap(siteId, String(body.release), String(body.file), mapJson)
    return jsonResponse({ ok: true, release: body.release, ...result }, 201)
  }
catch (error) {
    const msg = (error as Error).message || 'Failed to store source map'
    const userFacing = msg.includes('too large') || msg.includes('Not a valid source map')
    console.error('Upload source map error:', error)
    return jsonResponse({ error: userFacing ? msg : 'Failed to store source map' }, userFacing ? 400 : 500)
  }
}

/**
 * GET /api/sites/{siteId}/sourcemaps[?release=] — list uploaded maps.
 */
export async function handleListSourceMaps(request: Request, siteId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const maps = await listSourceMaps(siteId, query.release)
    return jsonResponse({ sourcemaps: maps })
  }
catch (error) {
    console.error('List source maps error:', error)
    return errorResponse('Failed to list source maps')
  }
}
