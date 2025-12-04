import { describe, expect, it } from 'bun:test'

/**
 * Chart Components Tests
 *
 * Tests for all chart-related components.
 */

describe('Chart Components', () => {
  describe('TimeSeriesChart', () => {
    it('should be exported', async () => {
      const { TimeSeriesChart } = await import('../../src/dashboard/components')
      expect(TimeSeriesChart).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { TimeSeriesChart } = await import('../../src/dashboard/components')
      expect(typeof TimeSeriesChart).toBe('object')
    })
  })

  describe('DonutChart', () => {
    it('should be exported', async () => {
      const { DonutChart } = await import('../../src/dashboard/components')
      expect(DonutChart).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { DonutChart } = await import('../../src/dashboard/components')
      expect(typeof DonutChart).toBe('object')
    })
  })

  describe('SparklineChart', () => {
    it('should be exported', async () => {
      const { SparklineChart } = await import('../../src/dashboard/components')
      expect(SparklineChart).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { SparklineChart } = await import('../../src/dashboard/components')
      expect(typeof SparklineChart).toBe('object')
    })
  })

  describe('HeatmapChart', () => {
    it('should be exported', async () => {
      const { HeatmapChart } = await import('../../src/dashboard/components')
      expect(HeatmapChart).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { HeatmapChart } = await import('../../src/dashboard/components')
      expect(typeof HeatmapChart).toBe('object')
    })
  })

  describe('FunnelChart', () => {
    it('should be exported', async () => {
      const { FunnelChart } = await import('../../src/dashboard/components')
      expect(FunnelChart).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { FunnelChart } = await import('../../src/dashboard/components')
      expect(typeof FunnelChart).toBe('object')
    })
  })

  describe('BarChart', () => {
    it('should be exported', async () => {
      const { BarChart } = await import('../../src/dashboard/components')
      expect(BarChart).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { BarChart } = await import('../../src/dashboard/components')
      expect(typeof BarChart).toBe('object')
    })
  })

  describe('ProgressRing', () => {
    it('should be exported', async () => {
      const { ProgressRing } = await import('../../src/dashboard/components')
      expect(ProgressRing).toBeDefined()
    })

    it('should be a Vue component', async () => {
      const { ProgressRing } = await import('../../src/dashboard/components')
      expect(typeof ProgressRing).toBe('object')
    })
  })
})
