/**
 * Core ErrorReporter — framework-agnostic error tracking.
 */

import type { ErrorTrackerConfig, ErrorReport, Breadcrumb, UserContext } from './types'
import { generateFingerprint } from './fingerprint'
import { collectContext } from './context'
import { BreadcrumbCollector } from './breadcrumbs'
import { ErrorTransport } from './transport'

const SDK_VERSION = '0.1.0'

export class ErrorReporter {
  private config: Required<ErrorTrackerConfig>
  private breadcrumbs: BreadcrumbCollector
  private transport: ErrorTransport
  private isInitialized = false
  private originalOnError: OnErrorEventHandler = null
  private originalOnUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null

  constructor(config: ErrorTrackerConfig) {
    this.config = {
      token: config.token,
      endpoint: config.endpoint,
      environment: config.environment || 'production',
      maxBreadcrumbs: config.maxBreadcrumbs || 20,
      ignoreErrors: config.ignoreErrors || [],
      beforeSend: config.beforeSend || ((r) => r),
      captureConsoleErrors: config.captureConsoleErrors || false,
      captureUnhandledRejections: config.captureUnhandledRejections !== false,
      tags: config.tags || {},
      user: config.user || {},
      framework: config.framework || 'vanilla',
    }

    this.breadcrumbs = new BreadcrumbCollector(this.config.maxBreadcrumbs)
    this.transport = new ErrorTransport(this.config.endpoint, this.config.token)
  }

  /** Initialize global error handlers */
  init(): this {
    if (this.isInitialized || typeof window === 'undefined') return this
    this.isInitialized = true

    this.breadcrumbs.install({ console: this.config.captureConsoleErrors })

    // window.onerror
    this.originalOnError = window.onerror
    window.onerror = (message, source, line, col, error) => {
      this.captureError(
        error || new Error(String(message)),
        { source: String(source || ''), line: line || 0, col: col || 0 },
      )
      if (this.originalOnError) {
        return (this.originalOnError as any)(message, source, line, col, error)
      }
      return false
    }

    // window.onunhandledrejection
    if (this.config.captureUnhandledRejections) {
      this.originalOnUnhandledRejection = window.onunhandledrejection as any
      window.onunhandledrejection = (event: PromiseRejectionEvent) => {
        const error = event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason))
        this.captureError(error, { source: 'unhandledrejection' })
        if (this.originalOnUnhandledRejection) {
          this.originalOnUnhandledRejection(event)
        }
      }
    }

    return this
  }

  /** Manually report an Error object */
  captureError(error: Error, context?: Record<string, any>): void {
    const report = this.buildReport(error, context)
    this.send(report)
  }

  /** Report a plain message */
  captureMessage(message: string, level: string = 'info'): void {
    const error = new Error(message)
    const report = this.buildReport(error, { level })
    this.send(report)
  }

  /** Add a custom breadcrumb */
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
    this.breadcrumbs.add(breadcrumb)
  }

  /** Set user context */
  setUser(user: UserContext): void {
    this.config.user = user
  }

  /** Set a custom tag */
  setTag(key: string, value: string): void {
    this.config.tags[key] = value
  }

  /** Set multiple tags */
  setTags(tags: Record<string, string>): void {
    Object.assign(this.config.tags, tags)
  }

  private buildReport(error: Error, extra?: Record<string, any>): ErrorReport {
    const ctx = collectContext()

    return {
      message: error.message || String(error),
      type: error.name || 'Error',
      stack: error.stack,
      source: extra?.source || '',
      line: extra?.line || 0,
      col: extra?.col || 0,
      fingerprint: generateFingerprint(error.message || String(error), error.stack),
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: ctx.userAgent,
      browser: ctx.browser,
      browserVersion: ctx.browserVersion,
      os: ctx.os,
      osVersion: ctx.osVersion,
      screenWidth: ctx.screenWidth,
      screenHeight: ctx.screenHeight,
      deviceType: ctx.deviceType,
      framework: this.config.framework,
      sdkVersion: SDK_VERSION,
      environment: this.config.environment,
      tags: { ...this.config.tags },
      breadcrumbs: this.breadcrumbs.getAll(),
      timestamp: new Date().toISOString(),
      user: this.config.user?.id ? this.config.user : undefined,
      componentName: extra?.componentName,
      lifecycle: extra?.lifecycle,
    }
  }

  private send(report: ErrorReport): void {
    // Check ignore patterns
    for (const pattern of this.config.ignoreErrors) {
      if (typeof pattern === 'string' && report.message.includes(pattern)) return
      if (pattern instanceof RegExp && pattern.test(report.message)) return
    }

    // Apply beforeSend
    const result = this.config.beforeSend(report)
    if (result === false) return

    this.transport.send(result)
  }
}

/** Factory function */
export function createErrorTracker(config: ErrorTrackerConfig): ErrorReporter {
  return new ErrorReporter(config)
}
