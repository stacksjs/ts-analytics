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

// #69 — every error READ/triage endpoint must resolve to a guarded site id so
// the membership middleware applies; triage writes must demand editor.
describe('error endpoints are guarded (#69)', () => {
  const reads = [
    '/api/sites/acme/errors',
    '/api/sites/acme/errors/statuses',
    '/api/sites/acme/errors/timeseries',
    '/api/sites/acme/errors/comparison',
    '/api/sites/acme/errors/groups',
    '/api/sites/acme/errors/detail',
    '/api/sites/acme/errors/err_123',
    '/api/sites/acme/errors/alerts',
    '/api/p/acme/issues',
    '/api/p/acme/issues/states',
    '/api/p/acme/issues/err_123',
  ]

  it('every error read route is membership-guarded at viewer', () => {
    for (const path of reads) {
      expect(guardedSiteId(path)).toBe('acme')
      expect(requiredRole('GET', path)).toBe('viewer')
    }
  })

  it('triage writes are guarded and demand editor', () => {
    for (const path of ['/api/sites/acme/errors/status', '/api/sites/acme/errors/assign', '/api/p/acme/issues/state']) {
      expect(guardedSiteId(path)).toBe('acme')
      expect(requiredRole('POST', path)).toBe('editor')
    }
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
