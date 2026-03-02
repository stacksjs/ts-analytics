/**
 * Composables - Vue-style reusable logic for STX components
 * Loaded before dashboard.ts so all components can import from '@composables'
 */

/// <reference path="../../types/window.d.ts" />

interface Signal<T> {
  (): T
  set: (v: T) => void
  update: (fn: (v: T) => T) => void
}

interface UseSiteApiReturn {
  siteId: () => string
  apiUrl: (path: string) => string
  dateParams: () => string
  apiUrlWithDates: (path: string) => string
}

interface UseFetchDataReturn<T> {
  data: Signal<T>
  loading: Signal<boolean>
  error: Signal<string | null>
  fetchJson: (url: string, options?: RequestInit) => Promise<T>
  reset: () => void
}

interface UseFetchMultipleReturn {
  loading: Signal<boolean>
  error: Signal<string | null>
  fetchAll: (urls: Record<string, string>) => Promise<Record<string, unknown>>
}

interface ModalReturn {
  open: (options?: Record<string, unknown>) => void
  close: () => void
  confirm: (message: string, onConfirm: () => Promise<void>) => void
  alert: (title: string, message: string) => void
  getFormData: () => Record<string, string | boolean>
}

function useSiteApi(): UseSiteApiReturn {
  const siteId = (): string => window.siteId || ''
  const apiUrl = (path: string): string => {
    const apiPath = window.apiPath || ((u: string) => u)
    return apiPath(`${window.API_ENDPOINT || ''}/api/sites/${siteId()}${path}`)
  }
  const dateParams = (): string => window.getDateRangeParams ? window.getDateRangeParams() : ''
  const apiUrlWithDates = (path: string): string => apiUrl(path + dateParams())
  return { siteId, apiUrl, dateParams, apiUrlWithDates }
}

function useFetchData<T = unknown>(initialValue: T | null = null): UseFetchDataReturn<T | null> {
  const stx = window.stx
  const data: Signal<T | null> = stx.state(initialValue)
  const loading: Signal<boolean> = stx.state(false)
  const error: Signal<string | null> = stx.state<string | null>(null)

  async function fetchJson(url: string, options?: RequestInit): Promise<T | null> {
    loading.set(true)
    error.set(null)
    try {
      const res: Response = await fetch(url, options)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: T = await res.json()
      data.set(json)
      return json
    } catch (e: unknown) {
      error.set((e as Error).message)
      throw e
    } finally {
      loading.set(false)
    }
  }

  return {
    data,
    loading,
    error,
    fetchJson,
    reset(): void {
      data.set(initialValue)
      error.set(null)
    },
  }
}

function useFetchMultiple(): UseFetchMultipleReturn {
  const stx = window.stx
  const loading: Signal<boolean> = stx.state(false)
  const error: Signal<string | null> = stx.state<string | null>(null)

  async function fetchAll(urls: Record<string, string>): Promise<Record<string, unknown>> {
    loading.set(true)
    error.set(null)
    try {
      const keys: string[] = Object.keys(urls)
      const results: unknown[] = await Promise.all(
        keys.map((k: string) =>
          fetch(urls[k])
            .then((r: Response) => r.json())
            .catch(() => null),
        ),
      )
      const out: Record<string, unknown> = {}
      keys.forEach((k: string, i: number) => (out[k] = results[i]))
      return out
    } catch (e: unknown) {
      error.set((e as Error).message)
      throw e
    } finally {
      loading.set(false)
    }
  }

  return { loading, error, fetchAll }
}

function useModal(): ModalReturn {
  return window.Modal || { open() {}, close() {}, confirm() {}, alert() {}, getFormData() { return {} } }
}

// Register on window for STX import transform
window.__composables = {
  useSiteApi,
  useFetchData,
  useFetchMultiple,
  useModal,
}
