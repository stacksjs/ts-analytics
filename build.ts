#!/usr/bin/env bun
/**
 * Library build — emits dist/index.js (+ every module under ./*) and
 * declarations, so `@stacksjs/ts-analytics` is importable as a package
 * (package.json `module`/`exports`/`types` all point at ./dist).
 *
 * The static dashboard SITE is a separate deploy artifact — see build-site.ts
 * (`bun run build:site` → dist-site/). Keeping them apart stops the SSG's
 * cleanOutput from wiping the library and vice-versa.
 *
 * Mirrors the sibling stacks library builds: every source module is built so
 * the `./*` subpath export resolves to real JS (not just a .d.ts stub), with
 * node_modules left external (`packages: 'external'`).
 */
import { rmSync } from 'node:fs'
import { dts } from 'bun-plugin-dtsx'
import stx from 'bun-plugin-stx'

rmSync('./dist', { recursive: true, force: true })

// Build from the public entry only and let Bun follow the import graph, so the
// dashboard-UI shims (src/components/dashboard re-exports repo-root `.stx`) that
// aren't part of the library API are excluded automatically. `splitting` keeps
// shared code in chunks instead of duplicating it into index.js.
const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  splitting: true,
  outdir: './dist',
  root: './src',
  // bun-plugin-stx resolves the `.stx` imports a few library modules carry
  // (e.g. handlers render dashboard views server-side); dts() emits declarations.
  plugins: [stx(), dts()],
  target: 'bun',
  format: 'esm',
  packages: 'external',
})

if (!result.success) {
  console.error('[ts-analytics] library build failed:')
  for (const log of result.logs)
    console.error(log)
  process.exit(1)
}

const hasIndex = await Bun.file('./dist/index.js').exists()
if (!hasIndex) {
  console.error('[ts-analytics] build succeeded but dist/index.js is missing — check src/index.ts')
  process.exit(1)
}
console.log(`[ts-analytics] library built → dist/ (${result.outputs.length} files, dist/index.js present)`)
