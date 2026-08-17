#!/usr/bin/env bun
/**
 * Library build — emits the package's JS + declarations so `@stacksjs/ts-analytics`
 * is importable (package.json's `module`/`exports`/`types` all point at ./dist).
 *
 * Builds the entrypoints so every export resolves:
 *   `.`      → dist/index.js + dist/index.d.ts
 *   `./stx`  → dist/integrations/stx.js + dist/integrations/stx.d.ts   (the tsAnalytics() helper)
 *   `./nuxt` → dist/integrations/nuxt.js + dist/integrations/nuxt.d.ts (the Nuxt module)
 *
 * The Nuxt module's `useTsAnalytics()` composable is referenced by a runtime
 * path string (addImports → ./runtime/use-ts-analytics), not a static import, so
 * it is its own entrypoint to land at dist/integrations/runtime/.
 *
 * The static dashboard SITE is a separate deploy artifact — `bun run build:site`
 * (build-site.ts → dist-site/). Keeping them apart stops the SSG's cleanOutput
 * from wiping the library and vice-versa. node_modules stays external.
 */
import { rmSync } from 'node:fs'
import { dts } from 'bun-plugin-dtsx'
import stx from 'bun-plugin-stx'
import pkg from './package.json'
import { TRACKER_VERSION } from './src/version'

/**
 * Refuse to build a tracker that misreports its own version (#179).
 *
 * TRACKER_VERSION is stamped into every beacon so support can tell which build
 * a site is running. `bumpx` bumps package.json and does not touch src/version.ts,
 * so the two drift on every release unless something stops it.
 *
 * A test already asserted this — and it had been red since 0.1.1 while releases
 * shipped past it, leaving every beacon in the field reporting 0.1.0. A red test
 * is a report; this is a gate, and it sits at the last point before an artifact
 * exists to publish.
 *
 * Imported from package.json here rather than in src/version.ts on purpose: this
 * file is not published, so reading it costs nothing, whereas the same import in
 * src inlines the whole manifest — devDependencies included — into the bundle.
 */
if (TRACKER_VERSION !== pkg.version) {
  console.error(
    `\n  Version mismatch — refusing to build.\n`
    + `    package.json     ${pkg.version}\n`
    + `    src/version.ts   ${TRACKER_VERSION}\n\n`
    + `  TRACKER_VERSION ships in every beacon. Set it to ${pkg.version} in src/version.ts\n`
    + `  and commit it alongside the version bump.\n`,
  )
  process.exit(1)
}

rmSync('./dist', { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: [
    './src/index.ts',
    './src/Analytics.ts',
    './src/tracking.ts',
    './src/integrations/stx.ts',
    './src/integrations/nuxt.ts',
    './src/integrations/runtime/use-ts-analytics.ts',
  ],
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

const required = [
  './dist/index.js',
  './dist/index.d.ts',
  './dist/tracking.js',
  './dist/tracking.d.ts',
  './dist/Analytics.js',
  './dist/Analytics.d.ts',
  './dist/integrations/stx.js',
  './dist/integrations/stx.d.ts',
  './dist/integrations/nuxt.js',
  './dist/integrations/nuxt.d.ts',
  './dist/integrations/runtime/use-ts-analytics.js',
  './dist/integrations/runtime/use-ts-analytics.d.ts',
]
for (const f of required) {
  if (!(await Bun.file(f).exists())) {
    console.error(`[ts-analytics] build succeeded but ${f} is missing — check the entrypoints/exports`)
    process.exit(1)
  }
}
console.log(`[ts-analytics] library built → dist/ (${result.outputs.length} files; . + ./tracking + ./stx + ./nuxt entrypoints and their .d.ts present)`)
