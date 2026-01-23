/**
 * Heatmap Tracking Module
 *
 * Provides client-side tracking for click heatmaps, movement heatmaps,
 * and scroll depth visualization.
 *
 * @example
 * ```typescript
 * import { generateHeatmapScript, buildHeatmapTracking } from './heatmap'
 *
 * // Generate a standalone heatmap script
 * const script = generateHeatmapScript('my-site', 'https://api.example.com', {
 *   trackClicks: true,
 *   trackMovements: true,
 *   trackScrollPositions: true,
 * })
 *
 * // Or build just the tracking code to integrate with main script
 * const trackingCode = buildHeatmapTracking({
 *   trackClicks: true,
 *   trackMovements: true,
 * })
 * ```
 */

export { buildHeatmapTracking, generateHeatmapScript } from './tracking-script'
export type {
  HeatmapConfig,
  HeatmapClickEvent,
  HeatmapMovementBatch,
  HeatmapScrollData,
} from './types'
