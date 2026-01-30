#!/usr/bin/env bun
/**
 * Build STX views to HTML
 *
 * Uses STX's buildViews API to compile all .stx templates
 * with placeholder tokens for runtime replacement.
 */

import { buildViews } from '@stacksjs/stx'
import path from 'node:path'

const VIEWS_DIR = path.resolve(import.meta.dir, '../src/views')
const OUTPUT_DIR = path.resolve(import.meta.dir, '../dist/views')
const COMPONENTS_DIR = path.resolve(import.meta.dir, '../src/components')

// Placeholder tokens for runtime replacement
const PLACEHOLDERS = {
  siteId: '{{__SITE_ID__}}',
  apiEndpoint: '{{__API_ENDPOINT__}}',
  errorId: '{{__ERROR_ID__}}',
  section: '{{__SECTION__}}',
  title: '{{__TITLE__}}',
  iconPath: '{{__ICON_PATH__}}',
}

const result = await buildViews({
  viewsDir: VIEWS_DIR,
  outputDir: OUTPUT_DIR,
  componentsDir: COMPONENTS_DIR,
  layoutsDir: path.join(VIEWS_DIR, 'layouts'),
  partialsDir: path.join(VIEWS_DIR, 'partials'),
  placeholders: PLACEHOLDERS,
  debug: false,
  views: [
    { input: 'dashboard.stx' },
    { input: 'test-errors.stx' },
    { input: 'error-detail.stx' },
    { input: 'detail.stx' },
  ],
})

if (!result.success) {
  console.error('Build failed with errors:', result.errors)
  process.exit(1)
}
