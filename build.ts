#!/usr/bin/env bun
/**
 * Library build — emits the package's JS + declarations so `@stacksjs/ts-analytics`
 * is importable (package.json's `module`/`exports`/`types` all point at ./dist).
 *
 * Builds two entrypoints so both exports resolve:
 *   `.`     → dist/index.js + dist/index.d.ts
 *   `./stx` → dist/integrations/stx.js + dist/integrations/stx.d.ts  (the tsAnalytics() module)
 *
 * The static dashboard SITE is a separate deploy artifact — `bun run build:site`
 * (build-site.ts → dist-site/). Keeping them apart stops the SSG's cleanOutput
 * from wiping the library and vice-versa. node_modules stays external.
 */
import { rmSync } from 'node:fs'
import { dts } from 'bun-plugin-dtsx'
import stx from 'bun-plugin-stx'

rmSync('./dist', { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ['./src/index.ts', './src/integrations/stx.ts'],
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

for (const f of ['./dist/index.js', './dist/integrations/stx.js']) {
  if (!(await Bun.file(f).exists())) {
    console.error(`[ts-analytics] build succeeded but ${f} is missing — check the entrypoints/exports`)
    process.exit(1)
  }
}
console.log(`[ts-analytics] library built → dist/ (${result.outputs.length} files; index.js + integrations/stx.js present)`)
