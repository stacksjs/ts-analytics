import { describe, expect, it } from 'bun:test'
import { roleAtLeast } from '../src/lib/membership'

describe('roleAtLeast', () => {
  it('respects the role hierarchy', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true)
    expect(roleAtLeast('admin', 'editor')).toBe(true)
    expect(roleAtLeast('editor', 'viewer')).toBe(true)
    expect(roleAtLeast('viewer', 'editor')).toBe(false)
    expect(roleAtLeast('editor', 'admin')).toBe(false)
  })

  it('treats equal roles as sufficient', () => {
    expect(roleAtLeast('admin', 'admin')).toBe(true)
    expect(roleAtLeast('viewer', 'viewer')).toBe(true)
  })

  it('treats null/undefined as no access', () => {
    expect(roleAtLeast(null, 'viewer')).toBe(false)
    expect(roleAtLeast(undefined, 'viewer')).toBe(false)
  })
})
