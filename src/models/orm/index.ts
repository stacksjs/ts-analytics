/**
 * ts-analytics ORM Models
 *
 * ActiveRecord-style ORM models for DynamoDB using bun-query-builder.
 * These models provide a clean API for working with analytics data.
 *
 * @example
 * ```typescript
 * import { PageView, Session, CustomEvent, configureAnalytics } from './models/orm'
 *
 * // Configure the connection
 * configureAnalytics({
 *   tableName: 'ts-analytics',
 *   region: 'us-east-1',
 * })
 *
 * // Create a page view
 * const pv = await PageView.create({
 *   id: generateId(),
 *   siteId: 'my-site',
 *   visitorId: 'abc123',
 *   sessionId: 'sess-123',
 *   path: '/home',
 *   hostname: 'example.com',
 * })
 *
 * // Query page views for a site
 * const views = await PageView.forSite('my-site')
 *   .since(new Date('2024-01-01'))
 *   .limit(100)
 *   .get()
 *
 * // Find a session
 * const session = await Session.find('sess-123')
 * ```
 */

// Import from bun-query-builder - these will be bundled during Lambda deployment
// Note: Using a direct path for reliable resolution
import { Model, configureModels } from '../../../../bun-query-builder/packages/bun-query-builder/src/dynamodb/model'
import { DynamoDBClient, createClient } from '../../../../bun-query-builder/packages/bun-query-builder/src/dynamodb/client'
import type { DeviceType } from '../../types'

// ============================================================================
// Configuration
// ============================================================================

let tableName = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'

export interface AnalyticsConfig {
  tableName?: string
  region?: string
  endpoint?: string
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
}

/**
 * Configure the analytics models
 */
export function configureAnalytics(config: AnalyticsConfig): void {
  if (config.tableName) {
    tableName = config.tableName
  }

  configureModels({
    region: config.region,
    endpoint: config.endpoint,
    credentials: config.credentials,
  })
}

// ============================================================================
// PageView Model
// ============================================================================

/**
 * PageView model for tracking page views
 *
 * DynamoDB Keys:
 * - PK: SITE#{siteId}
 * - SK: PAGEVIEW#{timestamp}#{id}
 * - GSI1PK: SITE#{siteId}#DATE#{date}
 * - GSI1SK: PATH#{path}
 */
export class PageView extends Model {
  static get tableName() { return tableName }
  static pkPrefix = 'SITE'
  static skPrefix = 'PAGEVIEW'
  static primaryKey = 'id'
  static timestamps = true

  // Attributes
  id!: string
  siteId!: string
  visitorId!: string
  sessionId!: string
  path!: string
  hostname!: string
  title?: string
  referrer?: string
  referrerSource?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  country?: string
  region?: string
  city?: string
  deviceType?: DeviceType
  browser?: string
  browserVersion?: string
  os?: string
  osVersion?: string
  screenWidth?: number
  screenHeight?: number
  isUnique!: boolean
  isBounce!: boolean
  timeOnPage?: number
  timestamp!: Date | string

  /**
   * Generate the partition key for this page view
   */
  getPk(): string {
    return `SITE#${this.siteId}`
  }

  /**
   * Generate the sort key for this page view
   */
  getSk(): string {
    const ts = this.timestamp instanceof Date ? this.timestamp.toISOString() : this.timestamp
    return `PAGEVIEW#${ts}#${this.id}`
  }

  /**
   * Query page views for a specific site
   */
  static forSite(siteId: string): PageViewQueryBuilder {
    return new PageViewQueryBuilder(siteId)
  }

  /**
   * Create a page view with proper key generation
   */
  static async record(data: Omit<PageViewData, 'pk' | 'sk' | 'gsi1pk' | 'gsi1sk'>): Promise<PageView> {
    const timestamp = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp || Date.now())
    const dateStr = timestamp.toISOString().slice(0, 10)

    const item = {
      ...data,
      pk: `SITE#${data.siteId}`,
      sk: `PAGEVIEW#${timestamp.toISOString()}#${data.id}`,
      gsi1pk: `SITE#${data.siteId}#DATE#${dateStr}`,
      gsi1sk: `PATH#${data.path}`,
      timestamp: timestamp.toISOString(),
      _et: 'PageView',
    }

    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    await client.putItem({
      TableName: tableName,
      Item: marshall(item),
    })

    return new PageView(item)
  }
}

interface PageViewData {
  id: string
  siteId: string
  visitorId: string
  sessionId: string
  path: string
  hostname: string
  title?: string
  referrer?: string
  referrerSource?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  deviceType?: DeviceType
  browser?: string
  os?: string
  screenWidth?: number
  screenHeight?: number
  isUnique: boolean
  isBounce: boolean
  timestamp?: Date | string
}

class PageViewQueryBuilder {
  private siteId: string
  private startDate?: Date
  private endDate?: Date
  private _limit?: number
  private _path?: string

  constructor(siteId: string) {
    this.siteId = siteId
  }

  since(date: Date): this {
    this.startDate = date
    return this
  }

  until(date: Date): this {
    this.endDate = date
    return this
  }

  onPath(path: string): this {
    this._path = path
    return this
  }

  limit(count: number): this {
    this._limit = count
    return this
  }

  async get(): Promise<PageView[]> {
    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    const startKey = this.startDate
      ? `PAGEVIEW#${this.startDate.toISOString()}`
      : 'PAGEVIEW#'
    const endKey = this.endDate
      ? `PAGEVIEW#${this.endDate.toISOString()}`
      : 'PAGEVIEW#\uffff'

    const result = await client.query({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${this.siteId}` },
        ':start': { S: startKey },
        ':end': { S: endKey },
      },
      ...(this._limit && { Limit: this._limit }),
      ScanIndexForward: false,
    })

    return (result.Items || []).map((item: any) => new PageView(unmarshall(item)))
  }

  async count(): Promise<number> {
    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    const startKey = this.startDate
      ? `PAGEVIEW#${this.startDate.toISOString()}`
      : 'PAGEVIEW#'
    const endKey = this.endDate
      ? `PAGEVIEW#${this.endDate.toISOString()}`
      : 'PAGEVIEW#\uffff'

    const result = await client.query({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${this.siteId}` },
        ':start': { S: startKey },
        ':end': { S: endKey },
      },
      Select: 'COUNT',
    })

    return result.Count || 0
  }
}

// ============================================================================
// Session Model
// ============================================================================

/**
 * Session model for tracking visitor sessions
 *
 * DynamoDB Keys:
 * - PK: SITE#{siteId}
 * - SK: SESSION#{sessionId}
 */
export class Session extends Model {
  static get tableName() { return tableName }
  static pkPrefix = 'SITE'
  static skPrefix = 'SESSION'
  static primaryKey = 'id'
  static timestamps = true

  // Attributes
  id!: string
  siteId!: string
  visitorId!: string
  entryPath!: string
  exitPath!: string
  referrer?: string
  referrerSource?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  country?: string
  deviceType?: DeviceType
  browser?: string
  os?: string
  pageViewCount!: number
  eventCount!: number
  isBounce!: boolean
  duration!: number
  startedAt!: Date | string
  endedAt!: Date | string

  /**
   * Find a session by site and session ID
   */
  static async findByKey(siteId: string, sessionId: string): Promise<Session | null> {
    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    const result = await client.getItem({
      TableName: tableName,
      Key: {
        pk: { S: `SITE#${siteId}` },
        sk: { S: `SESSION#${sessionId}` },
      },
    })

    if (!result.Item) return null
    return new Session(unmarshall(result.Item))
  }

  /**
   * Query sessions for a specific site
   */
  static forSite(siteId: string): SessionQueryBuilder {
    return new SessionQueryBuilder(siteId)
  }

  /**
   * Create or update a session
   */
  static async upsert(data: SessionData): Promise<Session> {
    const item = {
      ...data,
      pk: `SITE#${data.siteId}`,
      sk: `SESSION#${data.id}`,
      startedAt: data.startedAt instanceof Date ? data.startedAt.toISOString() : data.startedAt,
      endedAt: data.endedAt instanceof Date ? data.endedAt.toISOString() : data.endedAt,
      _et: 'Session',
    }

    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    await client.putItem({
      TableName: tableName,
      Item: marshall(item),
    })

    return new Session(item)
  }

  /**
   * Update session metrics
   */
  async updateMetrics(updates: Partial<Pick<Session, 'exitPath' | 'pageViewCount' | 'eventCount' | 'isBounce' | 'duration' | 'endedAt'>>): Promise<this> {
    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    const setParts: string[] = []
    const exprNames: Record<string, string> = {}
    const exprValues: Record<string, any> = {}
    let idx = 0

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const nameKey = `#attr${idx}`
        const valueKey = `:val${idx}`
        exprNames[nameKey] = key
        exprValues[valueKey] = marshallValue(key === 'endedAt' && value instanceof Date ? value.toISOString() : value)
        setParts.push(`${nameKey} = ${valueKey}`)
        ;(this as any)[key] = value
        idx++
      }
    }

    if (setParts.length > 0) {
      await client.updateItem({
        TableName: tableName,
        Key: {
          pk: { S: `SITE#${this.siteId}` },
          sk: { S: `SESSION#${this.id}` },
        },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
      })
    }

    return this
  }
}

interface SessionData {
  id: string
  siteId: string
  visitorId: string
  entryPath: string
  exitPath: string
  referrer?: string
  referrerSource?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  deviceType?: DeviceType
  browser?: string
  os?: string
  pageViewCount: number
  eventCount: number
  isBounce: boolean
  duration: number
  startedAt: Date | string
  endedAt: Date | string
}

class SessionQueryBuilder {
  private siteId: string
  private startDate?: Date
  private endDate?: Date
  private _limit?: number

  constructor(siteId: string) {
    this.siteId = siteId
  }

  since(date: Date): this {
    this.startDate = date
    return this
  }

  until(date: Date): this {
    this.endDate = date
    return this
  }

  limit(count: number): this {
    this._limit = count
    return this
  }

  async get(): Promise<Session[]> {
    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    const result = await client.query({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${this.siteId}` },
        ':prefix': { S: 'SESSION#' },
      },
      ...(this._limit && { Limit: this._limit }),
    })

    let sessions = (result.Items || []).map((item: any) => new Session(unmarshall(item)))

    // Filter by date range if specified
    if (this.startDate || this.endDate) {
      sessions = sessions.filter(s => {
        const sessionStart = new Date(s.startedAt)
        if (this.startDate && sessionStart < this.startDate) return false
        if (this.endDate && sessionStart > this.endDate) return false
        return true
      })
    }

    return sessions
  }

  async count(): Promise<number> {
    const sessions = await this.get()
    return sessions.length
  }
}

// ============================================================================
// CustomEvent Model
// ============================================================================

/**
 * CustomEvent model for tracking custom events
 *
 * DynamoDB Keys:
 * - PK: SITE#{siteId}
 * - SK: EVENT#{timestamp}#{id}
 * - GSI1PK: SITE#{siteId}#DATE#{date}
 * - GSI1SK: EVENT#{name}
 */
export class CustomEvent extends Model {
  static get tableName() { return tableName }
  static pkPrefix = 'SITE'
  static skPrefix = 'EVENT'
  static primaryKey = 'id'
  static timestamps = true

  // Attributes
  id!: string
  siteId!: string
  visitorId!: string
  sessionId!: string
  name!: string
  category?: string
  value?: number
  properties?: Record<string, string | number | boolean>
  path!: string
  timestamp!: Date | string

  /**
   * Query events for a specific site
   */
  static forSite(siteId: string): EventQueryBuilder {
    return new EventQueryBuilder(siteId)
  }

  /**
   * Record a custom event
   */
  static async record(data: EventData): Promise<CustomEvent> {
    const timestamp = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp || Date.now())
    const dateStr = timestamp.toISOString().slice(0, 10)

    const item: any = {
      ...data,
      pk: `SITE#${data.siteId}`,
      sk: `EVENT#${timestamp.toISOString()}#${data.id}`,
      gsi1pk: `SITE#${data.siteId}#DATE#${dateStr}`,
      gsi1sk: `EVENT#${data.name}`,
      timestamp: timestamp.toISOString(),
      _et: 'CustomEvent',
    }

    // Serialize properties as JSON string
    if (data.properties) {
      item.properties = JSON.stringify(data.properties)
    }

    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    await client.putItem({
      TableName: tableName,
      Item: marshall(item),
    })

    return new CustomEvent(item)
  }
}

interface EventData {
  id: string
  siteId: string
  visitorId: string
  sessionId: string
  name: string
  category?: string
  value?: number
  properties?: Record<string, string | number | boolean>
  path: string
  timestamp?: Date | string
}

class EventQueryBuilder {
  private siteId: string
  private startDate?: Date
  private endDate?: Date
  private _limit?: number
  private _name?: string

  constructor(siteId: string) {
    this.siteId = siteId
  }

  since(date: Date): this {
    this.startDate = date
    return this
  }

  until(date: Date): this {
    this.endDate = date
    return this
  }

  named(name: string): this {
    this._name = name
    return this
  }

  limit(count: number): this {
    this._limit = count
    return this
  }

  async get(): Promise<CustomEvent[]> {
    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    const startKey = this.startDate
      ? `EVENT#${this.startDate.toISOString()}`
      : 'EVENT#'
    const endKey = this.endDate
      ? `EVENT#${this.endDate.toISOString()}`
      : 'EVENT#\uffff'

    const result = await client.query({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${this.siteId}` },
        ':start': { S: startKey },
        ':end': { S: endKey },
      },
      ...(this._limit && { Limit: this._limit }),
      ScanIndexForward: false,
    })

    let events = (result.Items || []).map((item: any) => {
      const data = unmarshall(item)
      // Parse properties from JSON if present
      if (typeof data.properties === 'string') {
        try {
          data.properties = JSON.parse(data.properties)
        } catch {}
      }
      return new CustomEvent(data)
    })

    // Filter by name if specified
    if (this._name) {
      events = events.filter(e => e.name === this._name)
    }

    return events
  }

  async count(): Promise<number> {
    const events = await this.get()
    return events.length
  }

  async aggregate(): Promise<Array<{ name: string; count: number; visitors: number; totalValue: number }>> {
    const events = await this.get()

    const stats: Record<string, { count: number; visitors: Set<string>; totalValue: number }> = {}
    for (const e of events) {
      if (!stats[e.name]) {
        stats[e.name] = { count: 0, visitors: new Set(), totalValue: 0 }
      }
      stats[e.name].count++
      stats[e.name].visitors.add(e.visitorId)
      if (e.value) stats[e.name].totalValue += e.value
    }

    return Object.entries(stats)
      .map(([name, s]) => ({
        name,
        count: s.count,
        visitors: s.visitors.size,
        totalValue: s.totalValue,
      }))
      .sort((a, b) => b.count - a.count)
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Marshall a JavaScript object to DynamoDB format
 */
export function marshall(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = marshallValue(value)
  }
  return result
}

/**
 * Marshall a single value to DynamoDB format
 */
function marshallValue(value: any): any {
  if (value === null || value === undefined) {
    return { NULL: true }
  }
  if (typeof value === 'string') {
    return { S: value }
  }
  if (typeof value === 'number') {
    return { N: String(value) }
  }
  if (typeof value === 'boolean') {
    return { BOOL: value }
  }
  if (Array.isArray(value)) {
    return { L: value.map(marshallValue) }
  }
  if (typeof value === 'object') {
    const m: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      m[k] = marshallValue(v)
    }
    return { M: m }
  }
  return { S: String(value) }
}

/**
 * Unmarshall a DynamoDB item to a JavaScript object
 */
export function unmarshall(item: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(item)) {
    result[key] = unmarshallValue(value)
  }
  return result
}

/**
 * Unmarshall a single DynamoDB value
 */
function unmarshallValue(value: any): any {
  if ('S' in value) return value.S
  if ('N' in value) return Number(value.N)
  if ('BOOL' in value) return value.BOOL
  if ('NULL' in value) return null
  if ('L' in value) return value.L.map(unmarshallValue)
  if ('M' in value) return unmarshall(value.M)
  return value
}

// ============================================================================
// HeatmapClick Model
// ============================================================================

/**
 * HeatmapClick model for tracking user clicks on pages
 *
 * DynamoDB Keys:
 * - PK: SITE#{siteId}
 * - SK: HMCLICK#{timestamp}#{id}
 * - GSI1PK: SITE#{siteId}#PATH#{encodedPath}
 * - GSI1SK: HMCLICK#{timestamp}
 */
export class HeatmapClick extends Model {
  static get tableName() { return tableName }
  static pkPrefix = 'SITE'
  static skPrefix = 'HMCLICK'
  static primaryKey = 'id'
  static timestamps = true

  // Attributes
  id!: string
  siteId!: string
  sessionId!: string
  visitorId!: string
  path!: string
  viewportX!: number
  viewportY!: number
  documentX!: number
  documentY!: number
  viewportWidth!: number
  viewportHeight!: number
  selector!: string
  elementTag!: string
  elementText?: string
  deviceType?: DeviceType
  timestamp!: Date | string

  /**
   * Query heatmap clicks for a specific site
   */
  static forSite(siteId: string): HeatmapClickQueryBuilder {
    return new HeatmapClickQueryBuilder(siteId)
  }

  /**
   * Record a heatmap click
   */
  static async record(data: HeatmapClickData): Promise<HeatmapClick> {
    const timestamp = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp || Date.now())
    const encodedPath = encodeURIComponent(data.path)

    const item = {
      ...data,
      pk: `SITE#${data.siteId}`,
      sk: `HMCLICK#${timestamp.toISOString()}#${data.id}`,
      gsi1pk: `SITE#${data.siteId}#PATH#${encodedPath}`,
      gsi1sk: `HMCLICK#${timestamp.toISOString()}`,
      timestamp: timestamp.toISOString(),
      _et: 'HeatmapClick',
    }

    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    await client.putItem({
      TableName: tableName,
      Item: marshall(item),
    })

    return new HeatmapClick(item)
  }
}

interface HeatmapClickData {
  id: string
  siteId: string
  sessionId: string
  visitorId: string
  path: string
  viewportX: number
  viewportY: number
  documentX: number
  documentY: number
  viewportWidth: number
  viewportHeight: number
  selector: string
  elementTag: string
  elementText?: string
  deviceType?: DeviceType
  timestamp?: Date | string
}

class HeatmapClickQueryBuilder {
  private siteId: string
  private startDate?: Date
  private endDate?: Date
  private _path?: string
  private _limit?: number
  private _deviceType?: DeviceType

  constructor(siteId: string) {
    this.siteId = siteId
  }

  since(date: Date): this {
    this.startDate = date
    return this
  }

  until(date: Date): this {
    this.endDate = date
    return this
  }

  onPath(path: string): this {
    this._path = path
    return this
  }

  device(deviceType: DeviceType): this {
    this._deviceType = deviceType
    return this
  }

  limit(count: number): this {
    this._limit = count
    return this
  }

  async get(): Promise<HeatmapClick[]> {
    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    // If path is specified, use GSI
    if (this._path) {
      const encodedPath = encodeURIComponent(this._path)
      const startKey = this.startDate
        ? `HMCLICK#${this.startDate.toISOString()}`
        : 'HMCLICK#'
      const endKey = this.endDate
        ? `HMCLICK#${this.endDate.toISOString()}`
        : 'HMCLICK#\uffff'

      const result = await client.query({
        TableName: tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: `SITE#${this.siteId}#PATH#${encodedPath}` },
          ':start': { S: startKey },
          ':end': { S: endKey },
        },
        ...(this._limit && { Limit: this._limit }),
        ScanIndexForward: false,
      })

      let clicks = (result.Items || []).map((item: any) => new HeatmapClick(unmarshall(item)))

      if (this._deviceType) {
        clicks = clicks.filter(c => c.deviceType === this._deviceType)
      }

      return clicks
    }

    // Otherwise query by site
    const startKey = this.startDate
      ? `HMCLICK#${this.startDate.toISOString()}`
      : 'HMCLICK#'
    const endKey = this.endDate
      ? `HMCLICK#${this.endDate.toISOString()}`
      : 'HMCLICK#\uffff'

    const result = await client.query({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${this.siteId}` },
        ':start': { S: startKey },
        ':end': { S: endKey },
      },
      ...(this._limit && { Limit: this._limit }),
      ScanIndexForward: false,
    })

    let clicks = (result.Items || []).map((item: any) => new HeatmapClick(unmarshall(item)))

    if (this._deviceType) {
      clicks = clicks.filter(c => c.deviceType === this._deviceType)
    }

    return clicks
  }

  async count(): Promise<number> {
    const clicks = await this.get()
    return clicks.length
  }

  /**
   * Get aggregated click data for heatmap visualization
   */
  async aggregate(gridSize: number = 10): Promise<HeatmapAggregation> {
    const clicks = await this.get()

    if (clicks.length === 0) {
      return { grid: [], totalClicks: 0, maxDensity: 0 }
    }

    // Group by normalized grid position
    const grid: Record<string, { x: number; y: number; count: number }> = {}

    for (const click of clicks) {
      // Normalize to percentage of viewport
      const normX = Math.floor((click.viewportX / click.viewportWidth) * 100 / gridSize) * gridSize
      const normY = Math.floor((click.viewportY / click.viewportHeight) * 100 / gridSize) * gridSize
      const key = `${normX}-${normY}`

      if (!grid[key]) {
        grid[key] = { x: normX, y: normY, count: 0 }
      }
      grid[key].count++
    }

    const gridArray = Object.values(grid)
    const maxDensity = Math.max(...gridArray.map(g => g.count))

    return {
      grid: gridArray,
      totalClicks: clicks.length,
      maxDensity,
    }
  }
}

interface HeatmapAggregation {
  grid: Array<{ x: number; y: number; count: number }>
  totalClicks: number
  maxDensity: number
}

// ============================================================================
// HeatmapMovement Model
// ============================================================================

/**
 * HeatmapMovement model for tracking mouse movement batches
 *
 * DynamoDB Keys:
 * - PK: SITE#{siteId}
 * - SK: HMMOVE#{sessionId}#{path}#{timestamp}
 */
export class HeatmapMovement extends Model {
  static get tableName() { return tableName }
  static pkPrefix = 'SITE'
  static skPrefix = 'HMMOVE'
  static primaryKey = 'id'
  static timestamps = true

  // Attributes
  id!: string
  siteId!: string
  sessionId!: string
  visitorId!: string
  path!: string
  points!: Array<[number, number, number]> // [x, y, timestamp]
  pointCount!: number
  viewportWidth!: number
  viewportHeight!: number
  deviceType?: DeviceType
  timestamp!: Date | string

  /**
   * Query heatmap movements for a specific site
   */
  static forSite(siteId: string): HeatmapMovementQueryBuilder {
    return new HeatmapMovementQueryBuilder(siteId)
  }

  /**
   * Record a movement batch
   */
  static async record(data: HeatmapMovementData): Promise<HeatmapMovement> {
    const timestamp = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp || Date.now())
    const encodedPath = encodeURIComponent(data.path)

    const item = {
      ...data,
      pk: `SITE#${data.siteId}`,
      sk: `HMMOVE#${data.sessionId}#${encodedPath}#${timestamp.toISOString()}`,
      points: JSON.stringify(data.points),
      pointCount: data.points.length,
      timestamp: timestamp.toISOString(),
      _et: 'HeatmapMovement',
    }

    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    await client.putItem({
      TableName: tableName,
      Item: marshall(item),
    })

    return new HeatmapMovement({ ...item, points: data.points })
  }
}

interface HeatmapMovementData {
  id: string
  siteId: string
  sessionId: string
  visitorId: string
  path: string
  points: Array<[number, number, number]>
  viewportWidth: number
  viewportHeight: number
  deviceType?: DeviceType
  timestamp?: Date | string
}

class HeatmapMovementQueryBuilder {
  private siteId: string
  private startDate?: Date
  private endDate?: Date
  private _path?: string
  private _limit?: number

  constructor(siteId: string) {
    this.siteId = siteId
  }

  since(date: Date): this {
    this.startDate = date
    return this
  }

  until(date: Date): this {
    this.endDate = date
    return this
  }

  onPath(path: string): this {
    this._path = path
    return this
  }

  limit(count: number): this {
    this._limit = count
    return this
  }

  async get(): Promise<HeatmapMovement[]> {
    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    const result = await client.query({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${this.siteId}` },
        ':prefix': { S: 'HMMOVE#' },
      },
      ...(this._limit && { Limit: this._limit }),
      ScanIndexForward: false,
    })

    let movements = (result.Items || []).map((item: any) => {
      const data = unmarshall(item)
      // Parse points from JSON
      if (typeof data.points === 'string') {
        try {
          data.points = JSON.parse(data.points)
        } catch {
          data.points = []
        }
      }
      return new HeatmapMovement(data)
    })

    // Filter by path if specified
    if (this._path) {
      movements = movements.filter(m => m.path === this._path)
    }

    // Filter by date if specified
    if (this.startDate || this.endDate) {
      movements = movements.filter(m => {
        const ts = new Date(m.timestamp)
        if (this.startDate && ts < this.startDate) return false
        if (this.endDate && ts > this.endDate) return false
        return true
      })
    }

    return movements
  }
}

// ============================================================================
// HeatmapScroll Model
// ============================================================================

/**
 * HeatmapScroll model for tracking scroll depth
 *
 * DynamoDB Keys:
 * - PK: SITE#{siteId}
 * - SK: HMSCROLL#{sessionId}#{path}
 */
export class HeatmapScroll extends Model {
  static get tableName() { return tableName }
  static pkPrefix = 'SITE'
  static skPrefix = 'HMSCROLL'
  static primaryKey = 'id'
  static timestamps = true

  // Attributes
  id!: string
  siteId!: string
  sessionId!: string
  visitorId!: string
  path!: string
  maxScrollDepth!: number // 0-100 percentage
  scrollDepths!: Record<number, number> // depth percentage -> time spent in ms
  documentHeight!: number
  viewportHeight!: number
  deviceType?: DeviceType
  timestamp!: Date | string

  /**
   * Query scroll data for a specific site
   */
  static forSite(siteId: string): HeatmapScrollQueryBuilder {
    return new HeatmapScrollQueryBuilder(siteId)
  }

  /**
   * Record scroll data
   */
  static async record(data: HeatmapScrollData): Promise<HeatmapScroll> {
    const timestamp = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp || Date.now())
    const encodedPath = encodeURIComponent(data.path)

    const item = {
      ...data,
      pk: `SITE#${data.siteId}`,
      sk: `HMSCROLL#${data.sessionId}#${encodedPath}`,
      scrollDepths: JSON.stringify(data.scrollDepths),
      timestamp: timestamp.toISOString(),
      _et: 'HeatmapScroll',
    }

    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    await client.putItem({
      TableName: tableName,
      Item: marshall(item),
    })

    return new HeatmapScroll({ ...item, scrollDepths: data.scrollDepths })
  }

  /**
   * Update scroll data for an existing session
   */
  static async upsert(data: HeatmapScrollData): Promise<HeatmapScroll> {
    const timestamp = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp || Date.now())
    const encodedPath = encodeURIComponent(data.path)

    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    // Check if exists
    const pk = `SITE#${data.siteId}`
    const sk = `HMSCROLL#${data.sessionId}#${encodedPath}`

    const existing = await client.getItem({
      TableName: tableName,
      Key: { pk: { S: pk }, sk: { S: sk } },
    })

    if (existing.Item) {
      // Update with merged scroll depths
      const existingData = unmarshall(existing.Item)
      const existingDepths = typeof existingData.scrollDepths === 'string'
        ? JSON.parse(existingData.scrollDepths)
        : existingData.scrollDepths || {}

      // Merge depths (take max time for each depth)
      const mergedDepths: Record<number, number> = { ...existingDepths }
      for (const [depth, time] of Object.entries(data.scrollDepths)) {
        const d = Number(depth)
        mergedDepths[d] = Math.max(mergedDepths[d] || 0, time as number)
      }

      const maxDepth = Math.max(existingData.maxScrollDepth || 0, data.maxScrollDepth)

      await client.updateItem({
        TableName: tableName,
        Key: { pk: { S: pk }, sk: { S: sk } },
        UpdateExpression: 'SET scrollDepths = :depths, maxScrollDepth = :max, #ts = :ts',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':depths': { S: JSON.stringify(mergedDepths) },
          ':max': { N: String(maxDepth) },
          ':ts': { S: timestamp.toISOString() },
        },
      })

      return new HeatmapScroll({
        ...existingData,
        scrollDepths: mergedDepths,
        maxScrollDepth: maxDepth,
        timestamp: timestamp.toISOString(),
      })
    }

    // Create new
    return HeatmapScroll.record(data)
  }
}

interface HeatmapScrollData {
  id: string
  siteId: string
  sessionId: string
  visitorId: string
  path: string
  maxScrollDepth: number
  scrollDepths: Record<number, number>
  documentHeight: number
  viewportHeight: number
  deviceType?: DeviceType
  timestamp?: Date | string
}

class HeatmapScrollQueryBuilder {
  private siteId: string
  private startDate?: Date
  private endDate?: Date
  private _path?: string
  private _limit?: number

  constructor(siteId: string) {
    this.siteId = siteId
  }

  since(date: Date): this {
    this.startDate = date
    return this
  }

  until(date: Date): this {
    this.endDate = date
    return this
  }

  onPath(path: string): this {
    this._path = path
    return this
  }

  limit(count: number): this {
    this._limit = count
    return this
  }

  async get(): Promise<HeatmapScroll[]> {
    const client = createClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })

    const result = await client.query({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `SITE#${this.siteId}` },
        ':prefix': { S: 'HMSCROLL#' },
      },
      ...(this._limit && { Limit: this._limit }),
      ScanIndexForward: false,
    })

    let scrolls = (result.Items || []).map((item: any) => {
      const data = unmarshall(item)
      // Parse scrollDepths from JSON
      if (typeof data.scrollDepths === 'string') {
        try {
          data.scrollDepths = JSON.parse(data.scrollDepths)
        } catch {
          data.scrollDepths = {}
        }
      }
      return new HeatmapScroll(data)
    })

    // Filter by path if specified
    if (this._path) {
      scrolls = scrolls.filter(s => s.path === this._path)
    }

    // Filter by date if specified
    if (this.startDate || this.endDate) {
      scrolls = scrolls.filter(s => {
        const ts = new Date(s.timestamp)
        if (this.startDate && ts < this.startDate) return false
        if (this.endDate && ts > this.endDate) return false
        return true
      })
    }

    return scrolls
  }

  /**
   * Aggregate scroll data for visualization
   */
  async aggregate(): Promise<ScrollAggregation> {
    const scrolls = await this.get()

    if (scrolls.length === 0) {
      return { depths: {}, avgMaxDepth: 0, totalSessions: 0 }
    }

    // Aggregate depth data
    const depthCounts: Record<number, number> = {}
    let totalMaxDepth = 0

    for (const scroll of scrolls) {
      totalMaxDepth += scroll.maxScrollDepth
      for (const [depth] of Object.entries(scroll.scrollDepths)) {
        const d = Number(depth)
        depthCounts[d] = (depthCounts[d] || 0) + 1
      }
    }

    // Convert to percentages
    const depths: Record<number, number> = {}
    for (const [depth, count] of Object.entries(depthCounts)) {
      depths[Number(depth)] = Math.round((count / scrolls.length) * 100)
    }

    return {
      depths, // percentage -> % of visitors reaching that depth
      avgMaxDepth: Math.round(totalMaxDepth / scrolls.length),
      totalSessions: scrolls.length,
    }
  }
}

interface ScrollAggregation {
  depths: Record<number, number> // depth % -> % of visitors
  avgMaxDepth: number
  totalSessions: number
}

// ============================================================================
// Re-exports
// ============================================================================

export { Model, configureModels, DynamoDBClient, createClient }
