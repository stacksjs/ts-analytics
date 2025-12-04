import { describe, expect, it } from 'bun:test'

describe('StatCard Component', () => {
  it('should export StatCard component', async () => {
    const { StatCard } = await import('../../src/dashboard/components')
    expect(StatCard).toBeDefined()
  })

  it('should be a valid Vue component', async () => {
    const { StatCard } = await import('../../src/dashboard/components')
    expect(typeof StatCard).toBe('object')
  })
})
