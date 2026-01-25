import { describe, expect, it } from 'bun:test'

/**
 * StatCard Component Tests
 *
 * Tests for the StatCard stx component.
 */

describe('StatCard Component', () => {
  it('should export StatCard component', async () => {
    const { StatCard } = await import('../../src/dashboard/components')
    expect(StatCard).toBeDefined()
  })

  it('should be a valid stx component', async () => {
    const { StatCard } = await import('../../src/dashboard/components')
    expect(typeof StatCard).toBe('string')
  })
})
