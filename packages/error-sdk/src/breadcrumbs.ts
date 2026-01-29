/**
 * Breadcrumb collector — captures a trail of actions leading up to an error.
 */

import type { Breadcrumb } from './types'

export class BreadcrumbCollector {
  private breadcrumbs: Breadcrumb[] = []
  private maxBreadcrumbs: number
  private originalConsoleError: typeof console.error | null = null
  private originalConsoleWarn: typeof console.warn | null = null

  constructor(maxBreadcrumbs: number = 20) {
    this.maxBreadcrumbs = maxBreadcrumbs
  }

  /** Install automatic breadcrumb collection */
  install(options: { console?: boolean } = {}): void {
    if (typeof window === 'undefined') return

    this.installClickListener()
    this.installNavigationListener()

    if (options.console) {
      this.installConsoleWrappers()
    }
  }

  /** Uninstall automatic breadcrumb collection */
  uninstall(): void {
    if (typeof window === 'undefined') return

    if (this.originalConsoleError) {
      console.error = this.originalConsoleError
      this.originalConsoleError = null
    }
    if (this.originalConsoleWarn) {
      console.warn = this.originalConsoleWarn
      this.originalConsoleWarn = null
    }
  }

  /** Add a breadcrumb */
  add(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
    this.breadcrumbs.push({
      ...breadcrumb,
      timestamp: new Date().toISOString(),
    })

    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.shift()
    }
  }

  /** Get all collected breadcrumbs */
  getAll(): Breadcrumb[] {
    return [...this.breadcrumbs]
  }

  /** Clear all breadcrumbs */
  clear(): void {
    this.breadcrumbs = []
  }

  private installClickListener(): void {
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      if (!target) return

      const tag = target.tagName?.toLowerCase() || ''
      const id = target.id ? `#${target.id}` : ''
      const className = target.className && typeof target.className === 'string'
        ? `.${target.className.split(' ').filter(Boolean).join('.')}`
        : ''
      const text = target.textContent?.trim().slice(0, 50) || ''

      this.add({
        type: 'ui',
        category: 'click',
        message: `${tag}${id}${className}${text ? ` "${text}"` : ''}`,
      })
    }, { capture: true })
  }

  private installNavigationListener(): void {
    const original = history.pushState.bind(history)
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      this.add({
        type: 'navigation',
        category: 'pushState',
        message: String(args[2] || ''),
      })
      return original(...args)
    }

    const originalReplace = history.replaceState.bind(history)
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      this.add({
        type: 'navigation',
        category: 'replaceState',
        message: String(args[2] || ''),
      })
      return originalReplace(...args)
    }

    window.addEventListener('popstate', () => {
      this.add({
        type: 'navigation',
        category: 'popstate',
        message: window.location.pathname,
      })
    })
  }

  private installConsoleWrappers(): void {
    this.originalConsoleError = console.error
    console.error = (...args: any[]) => {
      this.add({
        type: 'console',
        category: 'error',
        message: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 200),
      })
      this.originalConsoleError!(...args)
    }

    this.originalConsoleWarn = console.warn
    console.warn = (...args: any[]) => {
      this.add({
        type: 'console',
        category: 'warn',
        message: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 200),
      })
      this.originalConsoleWarn!(...args)
    }
  }
}
