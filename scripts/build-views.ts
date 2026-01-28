#!/usr/bin/env bun
/**
 * Pre-build STX views to HTML
 *
 * This script compiles all .stx templates to static HTML files
 * that can be bundled with the Lambda function.
 *
 * Dynamic values (siteId, apiEndpoint) use placeholder tokens
 * that are replaced at runtime.
 */

import { processDirectives, extractVariables, defaultConfig } from '@stacksjs/stx'
import path from 'node:path'
import fs from 'node:fs'

const VIEWS_DIR = path.resolve(import.meta.dir, '../src/views')
const OUTPUT_DIR = path.resolve(import.meta.dir, '../dist/views')

// Placeholder tokens for runtime replacement
const PLACEHOLDERS = {
  siteId: '{{__SITE_ID__}}',
  apiEndpoint: '{{__API_ENDPOINT__}}',
  errorId: '{{__ERROR_ID__}}',
  section: '{{__SECTION__}}',
  title: '{{__TITLE__}}',
  iconPath: '{{__ICON_PATH__}}',
}

/**
 * Render an STX template to HTML
 */
async function renderStx(templatePath: string, props: Record<string, unknown> = {}): Promise<string> {
  const content = await Bun.file(templatePath).text()

  // Extract script content and template
  const scriptMatch = content.match(/<script\s+server\s*>([\s\S]*?)<\/script>/i)
  const scriptContent = scriptMatch ? scriptMatch[1] : ''
  let templateContent = scriptMatch
    ? content.replace(/<script\s+server\s*>[\s\S]*?<\/script>/i, '')
    : content

  // Replace <script client> with regular <script> for output
  templateContent = templateContent.replace(/<script\s+client\s*>/gi, '<script>')

  // Build context with props - only pass props as nested object to avoid conflicts
  // with exports in the server script
  const context: Record<string, unknown> = {
    __filename: templatePath,
    __dirname: path.dirname(templatePath),
    props, // Pass props as nested object for templates that use props.xxx
  }

  // Extract variables from server script FIRST before processing directives
  // This ensures variables like siteId, apiEndpoint are available for @layout
  if (scriptContent) {
    await extractVariables(scriptContent, context, templatePath)
  }

  // Process STX directives with the context that now has the extracted variables
  const config = {
    ...defaultConfig,
    componentsDir: path.join(VIEWS_DIR, 'components/dashboard'),
    layoutsDir: path.join(VIEWS_DIR, 'layouts'),
    partialsDir: path.join(VIEWS_DIR, 'partials'),
  }

  const result = await processDirectives(templateContent, context, templatePath, config, new Set())
  return result
}

/**
 * Build all views
 */
async function buildViews() {
  console.log('Building STX views...')
  console.log(`  Source: ${VIEWS_DIR}`)
  console.log(`  Output: ${OUTPUT_DIR}`)

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  // Build dashboard.stx
  console.log('\n  Building dashboard.stx...')
  const dashboardHtml = await renderStx(path.join(VIEWS_DIR, 'dashboard.stx'), {
    siteId: PLACEHOLDERS.siteId,
    apiEndpoint: PLACEHOLDERS.apiEndpoint,
  })
  await Bun.write(path.join(OUTPUT_DIR, 'dashboard.html'), dashboardHtml)

  // Build test-errors.stx
  console.log('  Building test-errors.stx...')
  const testErrorsHtml = await renderStx(path.join(VIEWS_DIR, 'test-errors.stx'), {
    siteId: PLACEHOLDERS.siteId,
    apiEndpoint: PLACEHOLDERS.apiEndpoint,
  })
  await Bun.write(path.join(OUTPUT_DIR, 'test-errors.html'), testErrorsHtml)

  // Build error-detail.stx
  console.log('  Building error-detail.stx...')
  const errorDetailHtml = await renderStx(path.join(VIEWS_DIR, 'error-detail.stx'), {
    errorId: PLACEHOLDERS.errorId,
    siteId: PLACEHOLDERS.siteId,
    apiEndpoint: PLACEHOLDERS.apiEndpoint,
  })
  await Bun.write(path.join(OUTPUT_DIR, 'error-detail.html'), errorDetailHtml)

  // Build detail.stx
  console.log('  Building detail.stx...')
  const detailHtml = await renderStx(path.join(VIEWS_DIR, 'detail.stx'), {
    section: PLACEHOLDERS.section,
    siteId: PLACEHOLDERS.siteId,
    apiEndpoint: PLACEHOLDERS.apiEndpoint,
    title: PLACEHOLDERS.title,
    iconPath: PLACEHOLDERS.iconPath,
  })
  await Bun.write(path.join(OUTPUT_DIR, 'detail.html'), detailHtml)

  console.log('\n✅ Views built successfully!')

  // Generate a manifest of built views
  const manifest = {
    buildTime: new Date().toISOString(),
    views: ['dashboard.html', 'test-errors.html', 'error-detail.html', 'detail.html'],
    placeholders: PLACEHOLDERS,
  }
  await Bun.write(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

buildViews().catch(console.error)
