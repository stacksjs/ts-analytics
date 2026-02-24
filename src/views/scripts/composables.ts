/**
 * Composables - Vue-style reusable logic for STX components
 * Loaded before dashboard.ts so all components can import from '@composables'
 */

function useSiteApi() {
  const siteId = () => (window as any).siteId || ''
  const apiUrl = (path: string) => {
    const apiPath = (window as any).apiPath || ((u: string) => u)
    return apiPath(`${(window as any).API_ENDPOINT || ''}/api/sites/${siteId()}${path}`)
  }
  const dateParams = () => (window as any).getDateRangeParams ? (window as any).getDateRangeParams() : ''
  const apiUrlWithDates = (path: string) => apiUrl(path + dateParams())
  return { siteId, apiUrl, dateParams, apiUrlWithDates }
}

function useFetchData(initialValue: any = null) {
  const stx = (window as any).stx
  const data = stx.state(initialValue)
  const loading = stx.state(false)
  const error = stx.state(null)

  async function fetchJson(url: string, options?: RequestInit) {
    loading.set(true)
    error.set(null)
    try {
      const res = await fetch(url, options)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      data.set(json)
      return json
    } catch (e: any) {
      error.set(e.message)
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
    reset() {
      data.set(initialValue)
      error.set(null)
    },
  }
}

function useFetchMultiple() {
  const stx = (window as any).stx
  const loading = stx.state(false)
  const error = stx.state(null)

  async function fetchAll(urls: Record<string, string>) {
    loading.set(true)
    error.set(null)
    try {
      const keys = Object.keys(urls)
      const results = await Promise.all(
        keys.map((k) =>
          fetch(urls[k])
            .then((r) => r.json())
            .catch(() => null),
        ),
      )
      const out: Record<string, any> = {}
      keys.forEach((k, i) => (out[k] = results[i]))
      return out
    } catch (e: any) {
      error.set(e.message)
      throw e
    } finally {
      loading.set(false)
    }
  }

  return { loading, error, fetchAll }
}

function useModal() {
  return (window as any).Modal || { open() {}, close() {}, confirm() {}, alert() {}, getFormData() { return {} } }
}

// Register on window for STX import transform
;(window as any).__composables = {
  useSiteApi,
  useFetchData,
  useFetchMultiple,
  useModal,
}
