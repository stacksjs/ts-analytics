import type { UserConfig } from 'unocss'
import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetUno,
  presetWind,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

const config: UserConfig = defineConfig({
  // Tailwind CSS compatible preset (for existing classes)
  presets: [
    presetUno(),
    presetWind(), // Tailwind compatibility
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      warn: true,
    }),
  ],

  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],

  // Theme customization for analytics dashboard
  theme: {
    colors: {
      primary: {
        50: '#eef2ff',
        100: '#e0e7ff',
        200: '#c7d2fe',
        300: '#a5b4fc',
        400: '#818cf8',
        500: '#6366f1',
        600: '#4f46e5',
        700: '#4338ca',
        800: '#3730a3',
        900: '#312e81',
      },
    },
  },

  // Shortcuts for common patterns
  shortcuts: {
    // Cards
    'card': 'bg-white rounded-lg border border-gray-200 shadow-sm',
    'card-hover': 'card hover:shadow-md transition-shadow duration-200',

    // Stat cards
    'stat-card': 'card-hover p-6',
    'stat-title': 'text-sm font-medium text-gray-500',
    'stat-value': 'text-3xl font-semibold text-gray-900',
    'stat-change-up': 'text-sm text-green-600',
    'stat-change-down': 'text-sm text-red-600',

    // Buttons
    'btn': 'px-4 py-2 rounded-lg font-medium transition-colors duration-150',
    'btn-primary': 'btn bg-primary-600 text-white hover:bg-primary-700',
    'btn-secondary': 'btn bg-white border border-gray-300 text-gray-700 hover:bg-gray-50',
    'btn-ghost': 'btn text-gray-500 hover:text-gray-700 hover:bg-gray-100',
    'btn-icon': 'p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100',

    // Layout
    'dashboard-grid': 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4',
    'dashboard-grid-3': 'grid grid-cols-1 lg:grid-cols-3 gap-6',

    // Loading states
    'skeleton': 'animate-pulse bg-gray-200 rounded',
    'skeleton-text': 'skeleton h-4 w-full',
    'skeleton-title': 'skeleton h-6 w-32',

    // Progress bars
    'progress-bar': 'h-2 bg-gray-100 rounded-full overflow-hidden',
    'progress-fill': 'h-full rounded-full transition-all duration-300',

    // Realtime indicator
    'pulse-dot': 'w-3 h-3 rounded-full',
    'pulse-ring': 'absolute inset-0 w-3 h-3 rounded-full animate-ping opacity-75',

    // Lists
    'list-item': 'flex items-center justify-between text-sm',
    'list-label': 'text-gray-900 truncate flex-1 mr-2',
    'list-value': 'text-gray-600 tabular-nums flex-shrink-0',

    // Chart
    'chart-container': 'card-hover p-6',
    'chart-legend': 'flex items-center gap-4 mb-4',
    'chart-legend-item': 'flex items-center gap-2 text-sm',
    'chart-legend-dot': 'w-3 h-3 rounded-full',

    // Dropdown
    'dropdown': 'absolute right-0 mt-2 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10',
    'dropdown-item': 'w-full px-4 py-2 text-left text-sm hover:bg-gray-50 text-gray-700',
    'dropdown-item-active': 'dropdown-item text-primary-600 bg-primary-50',
  },

  // Safelist classes that are dynamically generated
  safelist: [
    'animate-pulse',
    'animate-spin',
    'animate-ping',
    'text-green-600',
    'text-red-600',
    'bg-blue-100',
    'bg-blue-500',
    'text-blue-600',
    'bg-green-100',
    'bg-green-500',
    'text-green-600',
    'bg-purple-100',
    'bg-purple-500',
    'text-purple-600',
    'bg-gray-100',
    'text-gray-600',
    'bg-indigo-50',
    'bg-indigo-500',
    'text-indigo-600',
  ],
})

export default config
