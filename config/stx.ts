export default {
  // stx-components.plugin registers the @stacksjs/components library (stx does
  // not auto-resolve it). The app's own resources/components no longer needs a
  // plugin — stx walks componentsDir recursively since stx@d914f3ab83, so subdir
  // kebab tags (<site-selector> → components/dashboard/SiteSelector.stx) resolve
  // natively. (Removed the old stx-app-components.plugin.ts workaround.)
  plugins: ['./stx-components.plugin.ts'] as const,
  // Paths relative to root ('resources', auto-detected).
  // Don't include the 'resources/' prefix — it's already the root.
  componentsDir: 'components',
  layoutsDir: 'layouts',
  partialsDir: 'components',
  pagesDir: 'views',
  publicDir: 'public',
  storesDir: 'stores',

  app: {
    head: {
      title: 'Analytics Dashboard',
      lang: 'en',
      meta: [
        { name: 'description', content: 'Privacy-first analytics dashboard powered by DynamoDB' },
        { name: 'theme-color', content: '#0f1117' },
      ] as const,
      bodyClass: 'bg-bg text-text font-sans antialiased',
    },
  },

  css: './crosswind.ts',

  ssr: true,

  // Verbose stx render/component/directive logging. stx quieted its logs (debug
  // defaults to false), so this is off by default and opt-in per run:
  //   STX_DEBUG=true bun serve.ts
  debug: (process.env.STX_DEBUG === 'true') as boolean,

  router: {
    container: '#main-content',
    viewTransitions: true,
    prefetch: true,
  },
}
