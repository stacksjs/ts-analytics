export default {
  componentsDir: 'resources/components',
  layoutsDir: 'resources/layouts',
  partialsDir: 'resources/components',
  pagesDir: 'resources/views',
  publicDir: 'public',
  storesDir: 'resources/stores',

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

  css: './crosswind.config.ts',

  ssr: true,

  router: {
    container: '#main-content',
    viewTransitions: true,
    prefetch: true,
  },
}
