export default {
  componentsDir: 'components',
  layoutsDir: 'layouts',
  partialsDir: 'partials',
  pagesDir: 'pages',
  publicDir: 'public',
  storesDir: 'stores',

  app: {
    head: {
      title: 'Analytics Dashboard',
      lang: 'en',
      meta: [
        { name: 'description', content: 'Privacy-first analytics dashboard powered by DynamoDB' },
        { name: 'theme-color', content: '#0f1117' },
      ],
      link: [
        { rel: 'stylesheet', href: '/assets/crosswind.css' },
      ],
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
