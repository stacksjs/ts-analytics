/**
 * View handlers for HTML pages
 *
 * Uses STX templates from src/views/ for rendering.
 */

import { processDirectives, extractVariables, defaultConfig } from '@stacksjs/stx'
import { generateTrackingScript, generateMinimalTrackingScript } from '../index'
import { htmlResponse, jsResponse } from '../utils/response'
import { getQueryParams, getLambdaEvent } from '../../deploy/lambda-adapter'
import path from 'node:path'

// Views directory path
const VIEWS_DIR = path.resolve(import.meta.dir, '../views')

/**
 * Render an STX template with context
 */
async function renderStx(templateName: string, props: Record<string, unknown> = {}): Promise<string> {
  const templatePath = path.join(VIEWS_DIR, templateName)
  const content = await Bun.file(templatePath).text()

  // Extract script content and template
  const scriptMatch = content.match(/<script\s+server\s*>([\s\S]*?)<\/script>/i)
  const scriptContent = scriptMatch ? scriptMatch[1] : ''
  let templateContent = scriptMatch
    ? content.replace(/<script\s+server\s*>[\s\S]*?<\/script>/i, '')
    : content

  // Replace <script client> with regular <script> for output
  templateContent = templateContent.replace(/<script\s+client\s*>/gi, '<script>')

  // Build context with props
  const context: Record<string, unknown> = {
    __filename: templatePath,
    __dirname: path.dirname(templatePath),
    props,
    ...props,
  }

  // Extract variables from server script
  if (scriptContent) {
    await extractVariables(scriptContent, context, templatePath)
  }

  // Process STX directives
  const config = {
    ...defaultConfig,
    componentsDir: path.join(VIEWS_DIR, 'components'),
    layoutsDir: path.join(VIEWS_DIR, 'layouts'),
    partialsDir: path.join(VIEWS_DIR, 'partials'),
  }

  const result = await processDirectives(templateContent, context, templatePath, config)
  return result
}

/**
 * GET /dashboard or /
 */
export async function handleDashboard(request: Request): Promise<Response> {
  const query = getQueryParams(request)
  const event = getLambdaEvent(request)
  const siteId = query.siteId || ''
  const apiEndpoint = `https://${event?.requestContext?.domainName || 'analytics.stacksjs.com'}`

  const html = await renderStx('dashboard.stx', {
    siteId,
    apiEndpoint,
  })

  return htmlResponse(html)
}

/**
 * GET /test-errors
 */
export async function handleTestErrors(request: Request): Promise<Response> {
  const query = getQueryParams(request)
  const event = getLambdaEvent(request)
  const siteId = query.siteId || 'test-site'
  const apiEndpoint = `https://${event?.requestContext?.domainName || 'analytics.stacksjs.com'}`

  const html = await renderStx('test-errors.stx', {
    siteId,
    apiEndpoint,
  })

  return htmlResponse(html)
}

/**
 * GET /errors/{errorId}
 */
export async function handleErrorDetailPage(request: Request, errorId: string): Promise<Response> {
  const query = getQueryParams(request)
  const event = getLambdaEvent(request)
  const siteId = query.siteId || ''
  const apiEndpoint = `https://${event?.requestContext?.domainName || 'analytics.stacksjs.com'}`

  const html = await renderStx('error-detail.stx', {
    errorId,
    siteId,
    apiEndpoint,
  })

  return htmlResponse(html)
}

/**
 * GET /dashboard/{section}
 */
export async function handleDetailPage(request: Request, section: string): Promise<Response> {
  const query = getQueryParams(request)
  const event = getLambdaEvent(request)
  const siteId = query.siteId || ''
  const apiEndpoint = `https://${event?.requestContext?.domainName || 'analytics.stacksjs.com'}`

  const titles: Record<string, string> = {
    pages: 'Pages',
    referrers: 'Referrers',
    devices: 'Devices',
    browsers: 'Browsers',
    countries: 'Countries',
    campaigns: 'Campaigns',
    events: 'Events',
    goals: 'Goals',
  }

  const icons: Record<string, string> = {
    pages: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>',
    referrers: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>',
    devices: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>',
    browsers: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>',
    countries: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    campaigns: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>',
    events: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"/>',
    goals: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
  }

  const title = titles[section] || section
  const iconPath = icons[section] || icons.pages

  const html = await renderStx('detail.stx', {
    section,
    siteId,
    apiEndpoint,
    title,
    iconPath,
  })

  return htmlResponse(html)
}

/**
 * GET /sites/{siteId}/script
 */
export async function handleScript(request: Request): Promise<Response> {
  const query = getQueryParams(request)
  const event = getLambdaEvent(request)
  const minimal = query.minimal === 'true'
  const apiEndpoint = `https://${event?.requestContext?.domainName || 'analytics.stacksjs.com'}`

  // Extract siteId from path
  const url = new URL(request.url)
  const pathMatch = url.pathname.match(/\/sites\/([^/]+)\/script/)
  const siteId = pathMatch?.[1] || 'unknown'

  const script = minimal
    ? generateMinimalTrackingScript({ siteId, endpoint: apiEndpoint })
    : generateTrackingScript({ siteId, endpoint: apiEndpoint })

  return jsResponse(script)
}
