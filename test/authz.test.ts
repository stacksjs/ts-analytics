import { describe, expect, it } from 'bun:test'
import { guardedSiteId, requiredRole } from '../src/handlers/authz'

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

describe('requiredRole', () => {
  it('reads only need viewer', () => {
    expect(requiredRole('GET', '/api/sites/a/stats')).toBe('viewer')
    expect(requiredRole('GET', '/api/sites/a/team')).toBe('viewer')
  })

  it('member management needs admin', () => {
    expect(requiredRole('POST', '/api/sites/a/team')).toBe('admin')
    expect(requiredRole('DELETE', '/api/sites/a/team/m1')).toBe('admin')
    expect(requiredRole('POST', '/api/p/a/members')).toBe('admin')
  })

  it('other writes need editor', () => {
    expect(requiredRole('POST', '/api/sites/a/alerts')).toBe('editor')
    expect(requiredRole('PUT', '/api/sites/a/retention')).toBe('editor')
  })
})
