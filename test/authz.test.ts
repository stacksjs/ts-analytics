import { describe, expect, it } from 'bun:test'
import { guardedSiteId } from '../src/handlers/authz'

describe('guardedSiteId', () => {
  it('extracts the site id from per-project routes', () => {
    expect(guardedSiteId('/api/sites/acme/stats')).toBe('acme')
    expect(guardedSiteId('/api/sites/acme/errors/groups')).toBe('acme')
    expect(guardedSiteId('/api/p/acme/summary')).toBe('acme')
  })

  it('ignores non-project routes', () => {
    expect(guardedSiteId('/api/sites')).toBeNull()
    expect(guardedSiteId('/api/auth/me')).toBeNull()
    expect(guardedSiteId('/collect')).toBeNull()
    expect(guardedSiteId('/health')).toBeNull()
  })

  it('exempts the public tracker script', () => {
    expect(guardedSiteId('/api/sites/acme/script')).toBeNull()
    expect(guardedSiteId('/api/sites/acme/script.js')).toBeNull()
  })
})
