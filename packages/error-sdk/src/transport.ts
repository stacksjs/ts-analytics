/**
 * HTTP transport for sending error reports to the analytics endpoint.
 */

import type { ErrorReport } from './types'

export class ErrorTransport {
  private endpoint: string
  private token: string
  private queue: ErrorReport[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(endpoint: string, token: string) {
    this.endpoint = endpoint.replace(/\/$/, '')
    this.token = token

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush(true))
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flush(true)
        }
      })
    }
  }

  /** Queue an error report for sending */
  send(report: ErrorReport): void {
    this.queue.push(report)

    // Batch: wait 100ms to collect multiple rapid errors
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 100)
    }
  }

  /** Flush the queue, sending all pending reports */
  private flush(useBeacon: boolean = false): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (this.queue.length === 0) return

    const reports = this.queue.splice(0)
    const url = `${this.endpoint}/errors/collect`

    for (const report of reports) {
      const body = JSON.stringify(report)

      if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' })
        // sendBeacon doesn't support custom headers, fall back to fetch if available
        try {
          navigator.sendBeacon(url, blob)
        } catch {
          // Silently fail on unload
        }
      } else {
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Analytics-Token': this.token,
          },
          body,
          keepalive: true,
        }).catch(() => {
          // Silently fail — error tracking should never break the app
        })
      }
    }
  }
}
