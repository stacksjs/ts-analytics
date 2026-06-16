#!/usr/bin/env bun
/**
 * Static dashboard SITE build (deploy artifact for Netlify / Vercel / S3 /
 * the lambda views) → dist-site/. This is NOT the npm package output — the
 * importable library is built by build.ts (`bun run build`) into dist/.
 *
 * Run with `bun run build:site`.
 */
import { generateStaticSite } from '@stacksjs/stx/ssg'

await generateStaticSite({
  pagesDir: 'pages',
  outputDir: 'dist-site',
  publicDir: 'public',
  sitemap: true,
  cleanOutput: true,
})
