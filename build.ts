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

rmSync('./dist', { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: [
    './src/index.ts',
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

// bun-plugin-dtsx elides type-only imports from external packages, but the
// emitted nuxt.d.ts still references `NuxtModule<…>` (the explicit type
// isolatedDeclarations requires on the default export). Re-add the import so the
// declaration type-checks for consumers.
const nuxtDts = './dist/integrations/nuxt.d.ts'
if (await Bun.file(nuxtDts).exists()) {
  const dts = await Bun.file(nuxtDts).text()
  if (dts.includes('NuxtModule') && !/from ['"]@nuxt\/schema['"]/.test(dts)) {
    await Bun.write(nuxtDts, `import type { NuxtModule } from '@nuxt/schema'\n${dts}`)
    console.log('[ts-analytics] patched dist/integrations/nuxt.d.ts with the @nuxt/schema NuxtModule import')
  }
}

const required = [
  './dist/index.js',
  './dist/index.d.ts',
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
console.log(`[ts-analytics] library built → dist/ (${result.outputs.length} files; . + ./stx + ./nuxt entrypoints and their .d.ts present)`)
