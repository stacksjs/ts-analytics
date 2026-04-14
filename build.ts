#!/usr/bin/env bun
import { generateStaticSite } from '@stacksjs/stx/ssg'

await generateStaticSite({
  pagesDir: 'pages',
  outputDir: 'dist',
  publicDir: 'public',
  sitemap: true,
  cleanOutput: true,
})
