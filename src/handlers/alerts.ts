/**
 * Alerts and Email Reports handlers
 */

import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'
import { sendEmail } from '../lib/email'

/**
 * POST /api/sites/{siteId}/alerts
 */
export async function handleCreateAlert(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.name || !body.metric || !body.condition || body.threshold === undefined) {
      return jsonResponse({ error: 'Missing required fields: name, metric, condition, threshold' }, 400)
    }

    const validConditions = ['above', 'below', 'equals', 'change_percent']
    if (!validConditions.includes(body.condition)) {
      return jsonResponse({ error: `Invalid condition. Must be one of: ${validConditions.join(', ')}` }, 400)
    }

    const alertId = generateId()
    const alert = {
      pk: `SITE#${siteId}`,
      sk: `ALERT#${alertId}`,
      id: alertId,
      siteId,
      name: body.name,
      metric: body.metric,
      condition: body.condition,
      threshold: body.threshold,
      email: body.email,
      webhookUrl: body.webhookUrl,
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
    console.error('Create alert error:', error)
    return errorResponse('Failed to create alert')
  }
}

/**
 * GET /api/sites/{siteId}/alerts
 */
export async function handleGetAlerts(_request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'ALERT#' },
      },
    }) as { Items?: any[] }

    const alerts = (result.Items || []).map(unmarshall)

    return jsonResponse({ alerts })
  }
catch (error) {
    console.error('Get alerts error:', error)
    return errorResponse('Failed to fetch alerts')
  }
}

/**
 * DELETE /api/sites/{siteId}/alerts/{alertId}
 */
export async function handleDeleteAlert(_request: Request, siteId: string, alertId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `ALERT#${alertId}`,
      }),
    })

    return jsonResponse({ success: true })
  }
catch (error) {
    console.error('Delete alert error:', error)
    return errorResponse('Failed to delete alert')
  }
}

/**
 * POST /api/sites/{siteId}/email-reports
 */
export async function handleCreateEmailReport(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.email || !body.schedule) {
      return jsonResponse({ error: 'Missing required fields: email, schedule' }, 400)
    }

    const validSchedules = ['daily', 'weekly', 'monthly']
    if (!validSchedules.includes(body.schedule)) {
      return jsonResponse({ error: `Invalid schedule. Must be one of: ${validSchedules.join(', ')}` }, 400)
    }

    const reportId = generateId()
    const report = {
      pk: `SITE#${siteId}`,
      sk: `EMAIL_REPORT#${reportId}`,
      id: reportId,
      siteId,
      email: body.email,
      schedule: body.schedule,
      metrics: body.metrics || ['visitors', 'pageviews', 'bounceRate', 'avgDuration'],
      isActive: body.isActive ?? true,
      lastSent: null,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(report),
    })

    return jsonResponse({ report }, 201)
  }
catch (error) {
    console.error('Create email report error:', error)
    return errorResponse('Failed to create email report')
  }
}

/**
 * GET /api/sites/{siteId}/email-reports
 */
export async function handleGetEmailReports(_request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'EMAIL_REPORT#' },
      },
    }) as { Items?: any[] }

    const reports = (result.Items || []).map(unmarshall)

    return jsonResponse({ reports })
  }
catch (error) {
    console.error('Get email reports error:', error)
    return errorResponse('Failed to fetch email reports')
  }
}

/**
 * DELETE /api/sites/{siteId}/email-reports/{reportId}
 */
export async function handleDeleteEmailReport(_request: Request, siteId: string, reportId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `EMAIL_REPORT#${reportId}`,
      }),
    })

    return jsonResponse({ success: true })
  }
catch (error) {
    console.error('Delete email report error:', error)
    return errorResponse('Failed to delete email report')
  }
}

// ── Scheduled email digests (#93) ──────────────────────────────────────────
const DIGEST_PERIOD_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
}

/** Pure: whether a digest on `schedule` is due given its last send. */
export function digestDue(schedule: string, lastSentMs: number | null, now: number): boolean {
  const period = DIGEST_PERIOD_MS[schedule] ?? DIGEST_PERIOD_MS.weekly
  return lastSentMs === null || now - lastSentMs >= period
}

async function countPageviews(siteId: string, startIso: string, endIso: string): Promise<number> {
  const r = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk BETWEEN :s AND :e',
    ExpressionAttributeValues: { ':pk': { S: `SITE#${siteId}` }, ':s': { S: `PAGEVIEW#${startIso}` }, ':e': { S: `PAGEVIEW#${endIso}` } },
    Select: 'COUNT',
  }) as { Count?: number }
  return r.Count || 0
}

/** Send every due email-report digest across all sites (scheduled job, #93/#90). */
export async function sendDueEmailDigests(): Promise<number> {
  const sites = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: 'SITES' } },
  }) as { Items?: any[] }

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  let sent = 0

  for (const raw of (sites.Items || [])) {
    const site = unmarshall(raw)
    const siteId = site.siteId || site.id
    if (!siteId)
      continue
    const reports = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
      ExpressionAttributeValues: { ':pk': { S: `SITE#${siteId}` }, ':p': { S: 'EMAIL_REPORT#' } },
    }) as { Items?: any[] }

    for (const rraw of (reports.Items || [])) {
      const report = unmarshall(rraw)
      if (report.isActive === false)
        continue
      const lastSentMs = report.lastSent ? new Date(report.lastSent).getTime() : null
      if (!digestDue(report.schedule, lastSentMs, now))
        continue

      const period = DIGEST_PERIOD_MS[report.schedule] ?? DIGEST_PERIOD_MS.weekly
      const sinceIso = new Date(now - period).toISOString()
      const label = report.schedule === 'daily' ? 'day' : report.schedule === 'monthly' ? 'month' : 'week'
      const pv = await countPageviews(siteId, sinceIso, nowIso)

      await sendEmail({
        to: report.email,
        subject: `Your ${report.schedule} analytics report — ${siteId}`,
        text: `Analytics summary for ${siteId}\n\n${pv} pageviews in the last ${label}.`,
      })
      await dynamodb.updateItem({
        TableName: TABLE_NAME,
        Key: { pk: { S: `SITE#${siteId}` }, sk: { S: report.sk } },
        UpdateExpression: 'SET lastSent = :now',
        ExpressionAttributeValues: { ':now': { S: nowIso } },
      })
      sent++
    }
  }
  return sent
}
