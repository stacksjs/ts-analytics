/**
 * Funnel handlers
 */

import { generateId } from '../../src/index'
import { dynamodb, TABLE_NAME, unmarshall, marshall } from '../lib/dynamodb'
import { parseDateRange } from '../utils/date'
import { jsonResponse, errorResponse } from '../utils/response'
import { getQueryParams } from '../lambda-adapter'

/**
 * POST /api/sites/{siteId}/funnels
 */
export async function handleCreateFunnel(request: Request, siteId: string): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>

    if (!body.name || !body.steps || !Array.isArray(body.steps) || body.steps.length < 2) {
      return jsonResponse({ error: 'Missing required fields: name, steps (min 2 steps)' }, 400)
    }

    const funnelId = generateId()
    const funnel = {
      pk: `SITE#${siteId}`,
      sk: `FUNNEL#${funnelId}`,
      id: funnelId,
      siteId,
      name: body.name,
      steps: body.steps,
      createdAt: new Date().toISOString(),
    }

    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall(funnel),
    })

    return jsonResponse({ funnel }, 201)
  } catch (error) {
    console.error('Create funnel error:', error)
    return errorResponse('Failed to create funnel')
  }
}

/**
 * GET /api/sites/{siteId}/funnels
 */
export async function handleGetFunnels(request: Request, siteId: string): Promise<Response> {
  try {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'FUNNEL#' },
      },
    }) as { Items?: any[] }

    const funnels = (result.Items || []).map(unmarshall)

    return jsonResponse({ funnels })
  } catch (error) {
    console.error('Get funnels error:', error)
    return errorResponse('Failed to fetch funnels')
  }
}

/**
 * GET /api/sites/{siteId}/funnels/{funnelId}
 */
export async function handleGetFunnelAnalysis(request: Request, siteId: string, funnelId: string): Promise<Response> {
  try {
    const query = getQueryParams(request)
    const { startDate, endDate } = parseDateRange(query)

    // Get funnel definition
    const funnelResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':sk': { S: `FUNNEL#${funnelId}` },
      },
    }) as { Items?: any[] }

    if (!funnelResult.Items || funnelResult.Items.length === 0) {
      return jsonResponse({ error: 'Funnel not found' }, 404)
    }

    const funnel = unmarshall(funnelResult.Items[0])

    // Get sessions for analysis
    const sessionsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
    }) as { Items?: any[] }

    const sessions = (sessionsResult.Items || []).map(unmarshall).filter(s => {
      const sessionStart = new Date(s.startedAt)
      return sessionStart >= startDate && sessionStart <= endDate
    })

    // Analyze funnel steps
    const steps = funnel.steps as Array<{ name: string; pattern: string; type: 'pageview' | 'event' }>
    const stepResults = steps.map((step, index) => ({
      name: step.name,
      pattern: step.pattern,
      type: step.type,
      visitors: 0,
      sessions: 0,
      conversionRate: 0,
      dropoffRate: 0,
      stepIndex: index,
    }))

    // Track visitors through funnel steps
    for (const session of sessions) {
      const pageSequence = session.pageSequence || []
      const events = session.events || []

      let completedSteps = 0
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        let matched = false

        if (step.type === 'pageview') {
          matched = pageSequence.some((page: string) => {
            if (step.pattern.includes('*')) {
              const regex = new RegExp('^' + step.pattern.replace(/\*/g, '.*') + '$')
              return regex.test(page)
            }
            return page === step.pattern
          })
        } else {
          matched = events.some((event: any) => event.name === step.pattern)
        }

        if (matched) {
          completedSteps = i + 1
          stepResults[i].sessions++
        } else {
          break
        }
      }
    }

    // Calculate unique visitors and rates
    const totalSessions = sessions.length
    for (let i = 0; i < stepResults.length; i++) {
      const step = stepResults[i]
      const prevStep = i > 0 ? stepResults[i - 1] : null

      step.visitors = step.sessions // Simplified: using sessions as visitors
      step.conversionRate = totalSessions > 0
        ? Math.round((step.sessions / totalSessions) * 100)
        : 0

      if (prevStep) {
        step.dropoffRate = prevStep.sessions > 0
          ? Math.round(((prevStep.sessions - step.sessions) / prevStep.sessions) * 100)
          : 0
      }
    }

    // Calculate overall conversion rate
    const firstStep = stepResults[0]?.sessions || 0
    const lastStep = stepResults[stepResults.length - 1]?.sessions || 0
    const overallConversionRate = firstStep > 0
      ? Math.round((lastStep / firstStep) * 100)
      : 0

    return jsonResponse({
      funnel: {
        id: funnel.id,
        name: funnel.name,
      },
      steps: stepResults,
      summary: {
        totalSessions,
        enteredFunnel: firstStep,
        completedFunnel: lastStep,
        overallConversionRate,
      },
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    })
  } catch (error) {
    console.error('Get funnel analysis error:', error)
    return errorResponse('Failed to fetch funnel analysis')
  }
}

/**
 * DELETE /api/sites/{siteId}/funnels/{funnelId}
 */
export async function handleDeleteFunnel(_request: Request, siteId: string, funnelId: string): Promise<Response> {
  try {
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `SITE#${siteId}`,
        sk: `FUNNEL#${funnelId}`,
      }),
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Delete funnel error:', error)
    return errorResponse('Failed to delete funnel')
  }
}
