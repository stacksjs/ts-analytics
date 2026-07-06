/**
 * Split-domain credentialed CORS (#118): the REAL router served over HTTP —
 * origin echo + credentials on /api/*, preflights, the CSRF gate for
 * non-allowlisted origins, cookie SameSite mode, and public endpoints
 * keeping their wildcard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { sessionCookie } from '../src/handlers/auth'

const DASH = 'https://app.example.com'
let base = ''
let stop: () => void = () => {}

beforeAll(async () => {
  process.env.CORS_ORIGINS = `${DASH}, https://alt.example.com`
  const { createRouter } = await import('../src/router')
  const router = await createRouter()
  await router.serve({ port: 0 })
  const server = (router as any).serverInstance
  base = `http://127.0.0.1:${server.port}`
  stop = () => server?.stop?.(true)
})

afterAll(() => {
  delete process.env.CORS_ORIGINS
  stop()
})

describe('split-domain CORS (#118)', () => {
  it('echoes an allowlisted origin with credentials on /api/*', async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: { origin: DASH } })
    expect(res.headers.get('access-control-allow-origin')).toBe(DASH)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('vary')).toContain('Origin')
  })

  it('answers credentialed preflights for /api/*', async () => {
    const res = await fetch(`${base}/api/sites`, {
      method: 'OPTIONS',
      headers: { 'origin': DASH, 'access-control-request-method': 'GET' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(DASH)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('access-control-allow-headers')).toContain('X-Share-Token')
  })

  it('non-allowlisted origins get NO credentials grant', async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: { origin: 'https://evil.com' } })
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://evil.com')
    expect(res.headers.get('access-control-allow-credentials')).not.toBe('true')
  })

  it('CSRF gate: mutations from a foreign browser origin are rejected', async () => {
    const res = await fetch(`${base}/api/sites`, {
      method: 'POST',
      headers: { 'origin': 'https://evil.com', 'content-type': 'application/json' },
      body: '{"name":"x"}',
    })
    expect(res.status).toBe(403)
  })

  it('non-browser clients (no Origin) are unaffected by the gate', async () => {
    const res = await fetch(`${base}/api/auth/me`)
    expect([200, 401]).toContain(res.status)
  })

  it('public collect keeps its origin-echo behavior for any host site', async () => {
    const res = await fetch(`${base}/collect`, {
      method: 'OPTIONS',
      headers: { origin: 'https://any-customer-site.com' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://any-customer-site.com')
  })

  it('session cookies switch to SameSite=None; Secure in split-domain mode', () => {
    const cookie = sessionCookie('tok123')
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Secure')
    const prev = process.env.CORS_ORIGINS
    delete process.env.CORS_ORIGINS
    try {
      expect(sessionCookie('tok123')).toContain('SameSite=Lax')
    }
    finally {
      process.env.CORS_ORIGINS = prev
    }
  })
})
