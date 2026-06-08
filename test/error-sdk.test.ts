import { describe, expect, it } from 'bun:test'
import { generateErrorSdk } from '../src/error-sdk'

describe('generateErrorSdk', () => {
  const sdk = generateErrorSdk()

  it('is syntactically valid JS', () => {
    expect(() => new Function(sdk)).not.toThrow()
  })

  it('exposes the SDK surface', () => {
    expect(sdk).toContain('init:')
    expect(sdk).toContain('captureException:')
    expect(sdk).toContain('captureMessage:')
    expect(sdk).toContain('g.TSA=TSA')
  })

  it('posts to /errors/collect with the ingest token header', () => {
    expect(sdk).toContain('/errors/collect')
    expect(sdk).toContain('X-Analytics-Token')
  })

  it('installs global handlers + parses a DSN', () => {
    expect(sdk).toContain("addEventListener('error'")
    expect(sdk).toContain("addEventListener('unhandledrejection'")
    expect(sdk).toContain('parseDsn')
  })

  it('evaluates and registers window.TSA in a faux browser global', () => {
    const listeners: string[] = []
    const win: any = { addEventListener: (t: string) => listeners.push(t), location: { href: 'x' } }
    // eslint-disable-next-line no-new-func
    new Function('window', 'URL', `${sdk}`)(win, URL)
    expect(typeof win.TSA.init).toBe('function')
    expect(typeof win.TSA.captureException).toBe('function')
    win.TSA.init({ dsn: 'https://ak_key@host.com/acme' })
    expect(listeners).toContain('error')
    expect(listeners).toContain('unhandledrejection')
  })
})
