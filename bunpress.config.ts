import type { BunPressConfig } from 'bunpress'

const config: BunPressConfig = {
  name: 'ts-analytics',
  description: 'Privacy-first analytics toolkit for web applications',
  url: 'https://ts-analytics.stacksjs.com',

  theme: 'vitepress',

  themeConfig: {
    colors: {
      primary: '#10b981', // Emerald green for analytics theme
    },
  },

  cloud: {
    driver: 'aws',
    region: 'us-east-1',
    domain: 'ts-analytics.stacksjs.com',
    subdomain: 'ts-analytics',
    baseDomain: 'stacksjs.com',
  },

  sidebar: [
    {
      text: 'Introduction',
      items: [
        { text: 'Overview', link: '/' },
        { text: 'Why ts-analytics', link: '/intro' },
      ],
    },
    {
      text: 'Getting Started',
      items: [
        { text: 'Installation', link: '/install' },
        { text: 'Quick Start', link: '/guide/getting-started' },
        { text: 'Configuration', link: '/config' },
      ],
    },
    {
      text: 'Guide',
      items: [
        { text: 'Tracking Script', link: '/guide/tracking-script' },
        { text: 'API Endpoints', link: '/guide/api' },
        { text: 'Dashboard Components', link: '/guide/dashboard' },
        { text: 'Infrastructure', link: '/guide/infrastructure' },
      ],
    },
    {
      text: 'Features',
      items: [
        { text: 'Privacy First', link: '/features/privacy' },
        { text: 'Real-time Analytics', link: '/features/realtime' },
        { text: 'Goal Tracking', link: '/features/goals' },
        { text: 'Funnel Analysis', link: '/features/funnels' },
        { text: 'DynamoDB Single-Table', link: '/features/dynamodb' },
      ],
    },
    {
      text: 'Deployment',
      items: [
        { text: 'AWS Deployment', link: '/deploy/aws' },
        { text: 'Local Development', link: '/deploy/local' },
        { text: 'Framework Integrations', link: '/deploy/integrations' },
      ],
    },
    {
      text: 'API Reference',
      items: [
        { text: 'AnalyticsStore', link: '/api/store' },
        { text: 'AnalyticsAPI', link: '/api/analytics-api' },
        { text: 'Tracking Script', link: '/api/tracking' },
        { text: 'Dashboard', link: '/api/dashboard' },
      ],
    },
    {
      text: 'Community',
      items: [
        { text: 'Team', link: '/team' },
        { text: 'Sponsors', link: '/sponsors' },
        { text: 'Partners', link: '/partners' },
        { text: 'Showcase', link: '/showcase' },
        { text: 'Stargazers', link: '/stargazers' },
      ],
    },
    {
      text: 'Other',
      items: [
        { text: 'License', link: '/license' },
        { text: 'Postcardware', link: '/postcardware' },
      ],
    },
  ],

  navbar: [
    { text: 'Home', link: '/' },
    { text: 'Guide', link: '/guide/getting-started' },
    { text: 'Features', link: '/features/privacy' },
    { text: 'API', link: '/api/store' },
    { text: 'GitHub', link: 'https://github.com/stacksjs/ts-analytics' },
  ],

  socialLinks: [
    { icon: 'github', link: 'https://github.com/stacksjs/ts-analytics' },
    { icon: 'discord', link: 'https://discord.gg/stacksjs' },
    { icon: 'twitter', link: 'https://twitter.com/stacksjs' },
  ],
}

export default config
