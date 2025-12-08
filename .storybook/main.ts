import type { StorybookConfig } from '@storybook/vue3-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-onboarding',
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
  ],
  framework: {
    name: '@storybook/vue3-vite',
    options: {},
  },
  viteFinal: async (config) => {
    config.plugins = config.plugins || []
    // Configure Vue plugin to handle .stx files as Vue SFCs
    config.plugins.push(vue({
      include: [/\.vue$/, /\.stx$/],
    }))
    config.plugins.push(UnoCSS())
    return config
  },
}

export default config
