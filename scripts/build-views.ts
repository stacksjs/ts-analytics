#!/usr/bin/env bun
/**
 * Build STX views to HTML
 *
 * Uses STX's buildViews API to compile all .stx templates
 * with placeholder tokens for runtime replacement.
 */

import { buildViews } from '@stacksjs/stx'
import path from 'node:path'
import fs from 'node:fs'

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

// Dashboard tab pages (file-based routing)
const dashboardPages = [
  'index', 'errors', 'sessions', 'vitals', 'live', 'funnels', 'flow', 'insights', 'settings',
  'pages', 'referrers', 'devices', 'browsers', 'countries', 'campaigns', 'events', 'goals'
]

const result = await buildViews({
  viewsDir: VIEWS_DIR,
  outputDir: OUTPUT_DIR,
  componentsDir: COMPONENTS_DIR,
  layoutsDir: path.join(VIEWS_DIR, 'layouts'),
  partialsDir: path.join(VIEWS_DIR, 'partials'),
  placeholders: PLACEHOLDERS,
  debug: false,
  views: [
    // Standalone pages
    { input: 'test-errors.stx' },
    { input: 'error-detail.stx' },
    { input: 'detail.stx' },
    // Dashboard pages (file-based routing)
    ...dashboardPages.map(page => ({ input: `dashboard/${page}.stx`, output: `dashboard/${page}.html` })),
  ],
})

if (!result.success) {
  console.error('Build failed with errors:', result.errors)
  process.exit(1)
}

// Post-process: Strip STX comments and fix script paths
console.log('Post-processing HTML files...')

function postProcessHtml(filePath: string) {
  let content = fs.readFileSync(filePath, 'utf-8')

  // Strip STX comments {{-- ... --}}
  content = content.replace(/\{\{--[\s\S]*?--\}\}/g, '')

  // Strip HTML comments that are just whitespace
  content = content.replace(/<!--\s*-->/g, '')

  // Fix script path: /dashboard/scripts/dashboard.ts -> /scripts/dashboard.js
  content = content.replace(
    /<script src="\/dashboard\/scripts\/dashboard\.ts"><\/script>/g,
    '<script src="/scripts/dashboard.js"></script>'
  )

  // Remove empty lines at the start
  content = content.replace(/^\s*\n/, '')

  fs.writeFileSync(filePath, content)
}

function processDirectory(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      processDirectory(fullPath)
    } else if (entry.name.endsWith('.html')) {
      postProcessHtml(fullPath)
    }
  }
}

processDirectory(OUTPUT_DIR)

// Compile dashboard.ts to dashboard.js
console.log('Compiling dashboard script...')
const scriptSrc = path.resolve(import.meta.dir, '../src/views/scripts/dashboard.ts')
const scriptOut = path.resolve(OUTPUT_DIR, 'scripts')

fs.mkdirSync(scriptOut, { recursive: true })

const scriptResult = await Bun.build({
  entrypoints: [scriptSrc],
  outdir: scriptOut,
  target: 'browser',
  minify: true,
  naming: '[name].js',
})

if (!scriptResult.success) {
  console.error('Script compilation failed:', scriptResult.logs)
  process.exit(1)
}

console.log('Build complete!')
