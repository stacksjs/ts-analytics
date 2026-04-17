#!/usr/bin/env bun
/**
 * ts-analytics dev/prod entry.
 *
 * Uses bun-plugin-stx/serve for page rendering, SPA routing, and asset
 * serving. The API server (server/) runs separately.
 */

import { serve } from 'bun-plugin-stx/serve'

const args = process.argv.slice(2)
const portIdx = args.indexOf('--port')
const port = portIdx >= 0 && args[portIdx + 1] ? Number(args[portIdx + 1]) : 3000

await serve({
  patterns: ['resources/views/'],
  port,
  layoutsDir: 'resources/layouts',
  partialsDir: 'resources/components',
})
