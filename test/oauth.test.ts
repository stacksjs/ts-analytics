/**
 * OAuth sign-in (#53) — pure config + URL building.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { buildAuthorizeUrl, providerConfig } from '../src/handlers/oauth'

const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']
const saved: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) saved[k] = process.env[k]

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('providerConfig (#53)', () => {
  it('is null when credentials are unset', () => {
    for (const k of ENV_KEYS) delete process.env[k]
    expect(providerConfig('google')).toBeNull()
    expect(providerConfig('github')).toBeNull()
  })

  it('is null for unknown providers', () => {
    expect(providerConfig('facebook')).toBeNull()
  })

  it('resolves when both credentials are set', () => {
    process.env.GOOGLE_CLIENT_ID = 'gid'
    process.env.GOOGLE_CLIENT_SECRET = 'gsec'
    const cfg = providerConfig('google')
    expect(cfg?.clientId).toBe('gid')
    expect(cfg?.authorizeUrl).toContain('accounts.google.com')
  })
})

describe('buildAuthorizeUrl', () => {
  it('includes client id, redirect, scope, and state', () => {
    const url = new URL(buildAuthorizeUrl(
      { authorizeUrl: 'https://github.com/login/oauth/authorize', clientId: 'abc', scope: 'read:user user:email' },
      'https://app.example.com/api/auth/oauth/github/callback',
      'state-123',
    ))
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('abc')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/auth/oauth/github/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('read:user user:email')
    expect(url.searchParams.get('state')).toBe('state-123')
  })
})
