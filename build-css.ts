/**
 * Crosswind CSS build script
 *
 * Scans .stx files for utility classes and generates the CSS output.
 * Also generates shortcut class rules (Crosswind shortcuts only ensure
 * individual utilities exist, they don't output combined class rules).
 *
 * Run: bun run build:css
 */

import { resolve } from 'node:path'
import { build, writeCSS, config as defaultConfig, CSSGenerator } from '@cwcss/crosswind'

const root = resolve(import.meta.dirname)

const shortcuts: Record<string, string> = {
  'stat-card': 'bg-bg-2 border border-border rounded-xl p-5 transition-colors duration-200 hover:border-accent',
  'panel': 'bg-bg-2 border border-border rounded-xl p-6',
  'panel-header': 'flex justify-between items-center mb-4',
  'panel-title': 'flex items-center gap-2 font-semibold text-sm text-text',
  'icon-btn': 'bg-transparent border-none p-1.5 cursor-pointer text-muted inline-flex items-center justify-center rounded-md transition-all duration-150 hover:bg-bg-3 hover:text-text',
  'date-range-btn': 'py-1.5 px-3 bg-bg-3 border border-transparent rounded-md text-text-2 text-xs font-medium cursor-pointer transition-all duration-150 hover:bg-bg hover:text-text',
  'date-range-btn-active': 'bg-accent text-white border-accent',
  'filter-select': 'py-2 pr-8 pl-3 bg-bg-2 border border-border rounded-lg text-text text-[0.8125rem] cursor-pointer transition-colors duration-150 appearance-none hover:border-muted focus:outline-none focus:border-accent',
  'badge': 'inline-flex items-center py-0.5 px-2 rounded-full text-[0.6875rem] font-medium',
  'badge-success': 'bg-success/15 text-success',
  'badge-warning': 'bg-warning/15 text-warning',
  'badge-error': 'bg-error/15 text-error',
  'badge-info': 'bg-accent/15 text-accent',
  'btn': 'inline-flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium cursor-pointer transition-all duration-150 border border-transparent',
  'btn-primary': 'bg-accent text-white hover:bg-accent-2',
  'btn-secondary': 'bg-bg-3 text-text border-border hover:bg-bg',
  'btn-danger': 'bg-error text-white hover:opacity-90',
  'empty-state': 'text-center p-8 text-muted',
  'progress-bar': 'h-1.5 bg-bg-3 rounded-sm overflow-hidden',
  'progress-bar-fill': 'h-full bg-accent rounded-sm transition-[width] duration-300',
  'tab-btn': 'py-2 px-4 bg-transparent border-none text-muted text-sm font-medium cursor-pointer border-b-2 border-b-transparent transition-all duration-150 hover:text-text',
  'tab-btn-active': 'text-accent border-b-accent',
  'form-input': 'w-full py-2.5 px-3 bg-bg-2 border border-border rounded-md text-text text-sm transition-colors duration-150 focus:outline-none focus:border-accent',
  'modal-overlay': 'fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] p-4',
  'modal-content': 'bg-bg border border-border rounded-xl w-full max-w-[600px] max-h-[90vh] overflow-y-auto',
  'modal-header': 'flex justify-between items-center px-6 py-4 border-b border-border',
  'modal-body': 'p-6',
  'modal-footer': 'flex justify-end gap-3 px-6 py-4 border-t border-border',
  'session-card': 'bg-bg-2 border border-border rounded-lg p-4 cursor-pointer transition-all duration-150 hover:border-accent hover:bg-bg-3',
  'vital-card': 'bg-bg-2 border border-border rounded-lg p-4 text-center',
  'error-card': 'bg-bg-2 border border-border rounded-lg p-4 cursor-pointer transition-all duration-150 hover:border-accent',
  'tooltip': 'absolute bg-bg border border-border rounded-lg py-2 px-3 text-xs shadow-lg pointer-events-none z-[100]',
}

const crosswindOptions = {
  content: [`${root}/src/**/*.{stx,html,ts,js}`],
  output: `${root}/src/assets/crosswind.css`,
  minify: false,
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: 'var(--bg)', 2: 'var(--bg2)', 3: 'var(--bg3)' },
        text: { DEFAULT: 'var(--text)', 2: 'var(--text2)' },
        muted: 'var(--muted)',
        border: 'var(--border)',
        accent: { DEFAULT: 'var(--accent)', 2: 'var(--accent2)' },
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
      },
    },
  },
  shortcuts,
  safelist: [
    'spinning', 'pulse', 'realtime-dot', 'good', 'needs-improvement', 'poor',
  ],
}

const config = {
  ...defaultConfig,
  ...crosswindOptions,
  theme: {
    ...defaultConfig.theme,
    ...crosswindOptions.theme,
    extend: {
      ...defaultConfig.theme?.extend,
      ...crosswindOptions.theme?.extend,
    },
  },
  shortcuts: {
    ...defaultConfig.shortcuts,
    ...crosswindOptions.shortcuts,
  },
  safelist: [
    ...(defaultConfig.safelist || []),
    ...(crosswindOptions.safelist || []),
  ],
}

// Build the utility CSS
const result = await build(config)

// Generate shortcut class rules by building each shortcut's utilities
// through the generator and extracting combined CSS
function generateShortcutCSS(): string {
  const lines: string[] = ['\n/* === Shortcut Classes === */']

  for (const [name, utilities] of Object.entries(shortcuts)) {
    const classes = utilities.split(/\s+/)

    // Separate hover/focus/etc variants from base classes
    const base: string[] = []
    const hoverVariants: string[] = []
    const focusVariants: string[] = []

    for (const cls of classes) {
      if (cls.startsWith('hover:')) hoverVariants.push(cls.slice(6))
      else if (cls.startsWith('focus:')) focusVariants.push(cls.slice(6))
      else base.push(cls)
    }

    // Generate base rule by getting CSS from each utility class
    const gen = new CSSGenerator(config)
    for (const cls of base) {
      gen.generate(cls)
    }
    const baseCss = gen.toCSS(false, false)

    // Extract properties from generated CSS
    const props = extractProperties(baseCss)
    if (props.length > 0) {
      lines.push(`.${name} {`)
      for (const prop of props) {
        lines.push(`  ${prop}`)
      }
      lines.push('}')
    }

    // Generate hover rule
    if (hoverVariants.length > 0) {
      const hGen = new CSSGenerator(config)
      for (const cls of hoverVariants) {
        hGen.generate(cls)
      }
      const hoverCss = hGen.toCSS(false, false)
      const hoverProps = extractProperties(hoverCss)
      if (hoverProps.length > 0) {
        lines.push(`.${name}:hover {`)
        for (const prop of hoverProps) {
          lines.push(`  ${prop}`)
        }
        lines.push('}')
      }
    }

    // Generate focus rule
    if (focusVariants.length > 0) {
      const fGen = new CSSGenerator(config)
      for (const cls of focusVariants) {
        fGen.generate(cls)
      }
      const focusCss = fGen.toCSS(false, false)
      const focusProps = extractProperties(focusCss)
      if (focusProps.length > 0) {
        lines.push(`.${name}:focus {`)
        for (const prop of focusProps) {
          lines.push(`  ${prop}`)
        }
        lines.push('}')
      }
    }
  }

  return lines.join('\n')
}

function extractProperties(css: string): string[] {
  const props: string[] = []
  // Match all property declarations inside rules
  const ruleRegex = /\{([^}]+)\}/g
  let match
  while ((match = ruleRegex.exec(css)) !== null) {
    const block = match[1].trim()
    for (const line of block.split(';')) {
      const trimmed = line.trim()
      if (trimmed && trimmed.includes(':')) {
        props.push(`${trimmed};`)
      }
    }
  }
  return props
}

const shortcutCSS = generateShortcutCSS()
const fullCSS = result.css + shortcutCSS

await writeCSS(fullCSS, config.output)

console.log(`Crosswind: generated ${result.classes.size} utility classes + ${Object.keys(shortcuts).length} shortcuts in ${result.duration}ms`)
