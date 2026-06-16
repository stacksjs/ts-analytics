import { describe, expect, it } from 'bun:test'
import { processDirectives } from '@stacksjs/stx'
import stxPlugin from '../src/integrations/stx'

// The plugin adapts `{ appId }` into stx's native single-driver analytics
// (enabled + driver:'custom' + custom.inlineScript) so the tracker injects via
// injectAnalytics. stx reprocesses that inline <script> into a data-stx-scoped
// IIFE and re-runs it on every SPA navigation — so the `if(!window.__tsAnalytics)`
// guard is LOAD-BEARING. These tests pin that contract (and would have caught
// the inverted-comment drift the review flagged).
function setup(analytics: Record<string, unknown>, options?: Record<string, unknown>) {
  const config: any = { analytics }
  stxPlugin.setup(options as any, { config })
  return config
}

describe('ts-analytics stx integration', () => {
  it('adapts { appId } into native analytics and injects the tracker before </head>', async () => {
    const config = setup({ appId: 'app_123' })
    expect(config.analytics.enabled).toBe(true)
    expect(config.analytics.driver).toBe('custom')
    expect(config.analytics.custom.inlineScript).toContain('app_123')
    expect(config.analytics.custom.inlineScript).toContain('/api/analytics/collect')

    const page = `<!doctype html><html><head><title>D</title></head><body></body></html>`
    const out = await processDirectives(page, {}, 'page.stx', config, new Set())
    const tracker = out.indexOf('__tsAnalytics')
    expect(tracker).toBeGreaterThan(-1)
    expect(tracker).toBeLessThan(out.indexOf('</head>'))
  })

  it('wraps the tracker in the load-bearing idempotency guard', () => {
    const config = setup({ appId: 'app_g' })
    expect(config.analytics.custom.inlineScript.startsWith('if(!window.__tsAnalytics)')).toBe(true)
    expect(config.analytics.custom.__tsAnalytics).toBe(true)
  })

  it('normalizes a trailing slash on apiEndpoint (no //collect)', () => {
    const s = setup({ appId: 'x', apiEndpoint: '/api/analytics/' }).analytics.custom.inlineScript
    expect(s).toContain('/api/analytics/collect')
    expect(s).not.toContain('//collect')
  })

  it('rejects an appId / apiEndpoint that could break out of the inline script', () => {
    expect(setup({ appId: 'x\');alert(1)//' }).analytics.custom).toBeUndefined()
    expect(setup({ appId: 'ok', apiEndpoint: '/a</script>' }).analytics.custom).toBeUndefined()
  })

  it('is an idempotent no-op when setup runs again (HMR / re-load)', () => {
    const config: any = { analytics: { appId: 'app_r' } }
    stxPlugin.setup(undefined, { config })
    const first = config.analytics.custom.inlineScript
    stxPlugin.setup(undefined, { config })
    expect(config.analytics.custom.inlineScript).toBe(first)
  })

  it('skips when no appId is configured, and backs off an explicit native driver', () => {
    expect(setup({}).analytics.custom).toBeUndefined()
    expect(setup({ appId: 'x' }, { appId: 'x', driver: 'fathom' }).analytics.custom).toBeUndefined()
  })

  it('is exposed as the package default export (plugins: [\'@stacksjs/ts-analytics\'])', () => {
    expect(stxPlugin.name).toBe('ts-analytics')
    expect(typeof stxPlugin.setup).toBe('function')
  })
})
