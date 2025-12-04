import { describe, expect, it } from 'bun:test'

/**
 * Breakdown Components Tests
 *
 * Tests for device, browser, OS, country, and campaign breakdowns.
 */

describe('Breakdown Components', () => {
  describe('DeviceBreakdown', () => {
    it('should be exported', async () => {
      const { DeviceBreakdown } = await import('../../src/dashboard/components')
      expect(DeviceBreakdown).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { DeviceBreakdown } = await import('../../src/dashboard/components')
      expect(typeof DeviceBreakdown).toBe('object')
    })
  })

  describe('BrowserBreakdown', () => {
    it('should be exported', async () => {
      const { BrowserBreakdown } = await import('../../src/dashboard/components')
      expect(BrowserBreakdown).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { BrowserBreakdown } = await import('../../src/dashboard/components')
      expect(typeof BrowserBreakdown).toBe('object')
    })
  })

  describe('OSBreakdown', () => {
    it('should be exported', async () => {
      const { OSBreakdown } = await import('../../src/dashboard/components')
      expect(OSBreakdown).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { OSBreakdown } = await import('../../src/dashboard/components')
      expect(typeof OSBreakdown).toBe('object')
    })
  })

  describe('CountryList', () => {
    it('should be exported', async () => {
      const { CountryList } = await import('../../src/dashboard/components')
      expect(CountryList).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { CountryList } = await import('../../src/dashboard/components')
      expect(typeof CountryList).toBe('object')
    })
  })

  describe('CampaignBreakdown', () => {
    it('should be exported', async () => {
      const { CampaignBreakdown } = await import('../../src/dashboard/components')
      expect(CampaignBreakdown).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { CampaignBreakdown } = await import('../../src/dashboard/components')
      expect(typeof CampaignBreakdown).toBe('object')
    })
  })
})
