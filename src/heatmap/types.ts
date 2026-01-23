/**
 * Heatmap Tracking Types
 */

/**
 * Configuration for heatmap tracking
 */
export interface HeatmapConfig {
  /** Enable click tracking */
  trackClicks?: boolean
  /** Enable mouse movement tracking */
  trackMovements?: boolean
  /** Movement sampling interval in ms (default: 100) */
  movementSampleInterval?: number
  /** Maximum movement points per page before flush (default: 500) */
  maxMovementPoints?: number
  /** Enable scroll position tracking */
  trackScrollPositions?: boolean
  /** Flush interval for batched data in ms (default: 5000) */
  flushInterval?: number
  /** Maximum CSS selector depth (default: 5) */
  selectorDepth?: number
  /** Debug mode */
  debug?: boolean
}

/**
 * Click event data sent to the API
 */
export interface HeatmapClickEvent {
  /** Viewport X coordinate */
  vx: number
  /** Viewport Y coordinate */
  vy: number
  /** Document X coordinate */
  dx: number
  /** Document Y coordinate */
  dy: number
  /** CSS selector path to element */
  selector: string
  /** Element tag name */
  tag: string
  /** Element text content (truncated) */
  text?: string
  /** data-* attributes */
  dataAttrs?: Record<string, string>
  /** Viewport width */
  vw: number
  /** Viewport height */
  vh: number
  /** Timestamp */
  ts: number
}

/**
 * Movement batch data sent to the API
 */
export interface HeatmapMovementBatch {
  /** Array of [x, y, timestamp] tuples */
  points: Array<[number, number, number]>
  /** Viewport width */
  vw: number
  /** Viewport height */
  vh: number
}

/**
 * Scroll position data sent to the API
 */
export interface HeatmapScrollData {
  /** Scroll depth percentages reached with time spent */
  depths: Record<number, number>
  /** Maximum scroll depth reached (0-100) */
  maxDepth: number
  /** Maximum scroll position in pixels */
  maxY: number
  /** Total document height */
  docHeight: number
}
