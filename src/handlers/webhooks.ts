/**
 * Webhook handlers
 */

import { createHmac } from 'node:crypto'
import { generateId } from '../index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../../deploy/lambda-adapter'

/**
 * POST /api/sites/{siteId}/webhooks
 */
export async function handleCreateWebhook(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.url || !body.events || !Array.isArray(body.events) || body.events.length === 0) {
      return jsonResponse({ error: 'Missing required fields: url, events (array)' }, 400)
    }

    const validEvents = ['pageview', 'session.start', 'session.end', 'goal.conversion', 'error', 'alert.triggered']
    const invalidEvents = body.events.filter((e: string) => !validEvents.includes(e))
    if (invalidEvents.length > 0) {
      return jsonResponse({ error: `Invalid events: ${invalidEvents.join(', ')}. Valid events: ${validEvents.join(', ')}` }, 400)
    }

    const webhookId = generateId()
    const webhook = {
      pk: `SITE#${siteId}`,
      sk: `WEBHOOK#${webhookId}`,
      id: webhookId,
      siteId,
      url: body.url,
      events: body.events,
      secret: body.secret || generateId(),
      headers: body.headers || {},
      isActive: body.isActive ?? true,
      lastTriggered: null,
      failureCount: 0,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(webhook),
    })

    return jsonResponse({ webhook }, 201)
  }
catch (error) {
    console.error('Create webhook error:', error)
    return errorResponse('Failed to create webhook')
  }
}

/**
 * GET /api/sites/{siteId}/webhooks
 */
export async function handleGetWebhooks(_request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'WEBHOOK#' },
      },
    }) as { Items?: any[] }

    const webhooks = (result.Items || []).map(unmarshall).map(w => ({
      id: w.id,
      url: w.url,
      events: w.events,
      isActive: w.isActive,
      lastTriggered: w.lastTriggered,
      failureCount: w.failureCount,
      createdAt: w.createdAt,
    }))

    return jsonResponse({ webhooks })
  }
catch (error) {
    console.error('Get webhooks error:', error)
    return errorResponse('Failed to fetch webhooks')
  }
}

/**
 * DELETE /api/sites/{siteId}/webhooks/{webhookId}
 */
export async function handleDeleteWebhook(_request: Request, siteId: string, webhookId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `WEBHOOK#${webhookId}`,
      }),
    })

    return jsonResponse({ success: true })
  }
catch (error) {
    console.error('Delete webhook error:', error)
    return errorResponse('Failed to delete webhook')
  }
}

// ── Webhook delivery (#92) ─────────────────────────────────────────────────
// Events are enqueued to a WEBHOOK_QUEUE partition (sk = nextAttemptIso#id) and
// drained by a scheduled job: each delivery is a signed POST (HMAC-SHA256),
// retried with backoff up to MAX_WEBHOOK_ATTEMPTS, then dropped (failureCount++).
const MAX_WEBHOOK_ATTEMPTS = 5
const BACKOFF_MS = [0, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]

/** Enqueue an event for every active webhook on the site subscribed to it. */
export async function enqueueWebhookEvent(siteId: string, eventType: string, payload: Record<string, unknown>): Promise<number> {
  const subs = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
    ExpressionAttributeValues: { ':pk': { S: `SITE#${siteId}` }, ':p': { S: 'WEBHOOK#' } },
  }) as { Items?: any[] }

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  let queued = 0
  for (const raw of (subs.Items || [])) {
    const wh = unmarshall(raw)
    if (wh.isActive === false)
      continue
    const events: string[] = wh.events || []
    if (!events.includes('*') && !events.includes(eventType))
      continue
    const id = generateId()
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: 'WEBHOOK_QUEUE', sk: `${nowIso}#${id}`, id, siteId, webhookId: wh.id, url: wh.url,
        secret: wh.secret, headers: wh.headers || {}, eventType, payload: JSON.stringify(payload),
        attempts: 0, createdAt: nowIso, ttl: Math.floor(now / 1000) + 3 * 24 * 60 * 60,
      }),
    })
    queued++
  }
  return queued
}

async function deliverOne(d: any): Promise<boolean> {
  try {
    let body: string = d.payload || '{}'
    // Native Slack incoming-webhooks (#129): Slack requires {text: ...} and
    // rejects arbitrary JSON — reshape the event into a readable message so
    // pointing a webhook at hooks.slack.com just works.
    if (/hooks\.slack\.com\//.test(String(d.url || ''))) {
      try {
        const evt = JSON.parse(body)
        const fields = Object.entries(evt)
          .filter(([k]) => !['event', 'siteId'].includes(k))
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join('\n')
        body = JSON.stringify({ text: `*${d.eventType || evt.event || 'analytics event'}* — ${evt.siteId || ''}\n${fields}` })
      }
      catch {}
    }
    const sig = createHmac('sha256', String(d.secret || '')).update(body).digest('hex')
    const res = await fetch(d.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': d.eventType || '', 'X-Webhook-Signature': `sha256=${sig}`, ...(d.headers || {}) },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    return res.status >= 200 && res.status < 300
  }
catch {
    return false
  }
}

async function updateWebhook(siteId: string, webhookId: string, expr: string, values: Record<string, any>): Promise<void> {
  try {
    await dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: `SITE#${siteId}` }, sk: { S: `WEBHOOK#${webhookId}` } },
      UpdateExpression: expr,
      ExpressionAttributeValues: values,
    })
  }
catch (e) {
    console.error('Webhook update failed:', (e as Error).message)
  }
}

/** Drain due webhook deliveries (scheduled job, #92/#90). Returns count processed. */
export async function processWebhookDeliveries(): Promise<number> {
  const nowIso = new Date().toISOString()
  const due = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND sk <= :now',
    ExpressionAttributeValues: { ':pk': { S: 'WEBHOOK_QUEUE' }, ':now': { S: nowIso } },
    Limit: 100,
  }) as { Items?: any[] }

  let processed = 0
  for (const raw of (due.Items || [])) {
    const d = unmarshall(raw)
    const ok = await deliverOne(d)
    await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: { pk: { S: 'WEBHOOK_QUEUE' }, sk: { S: d.sk } } })

    if (ok) {
      await updateWebhook(d.siteId, d.webhookId, 'SET lastTriggered = :now', { ':now': { S: nowIso } })
    }
    else {
      const attempts = (d.attempts || 0) + 1
      if (attempts < MAX_WEBHOOK_ATTEMPTS) {
        const next = Date.now() + (BACKOFF_MS[attempts] || 2 * 60 * 60_000)
        await dynamodb.putItem({ TableName: TABLE_NAME, Item: marshall({ ...d, sk: `${new Date(next).toISOString()}#${d.id}`, attempts }) })
      }
      else {
        await updateWebhook(d.siteId, d.webhookId, 'ADD failureCount :one', { ':one': { N: '1' } })
      }
    }
    processed++
  }
  return processed
}
