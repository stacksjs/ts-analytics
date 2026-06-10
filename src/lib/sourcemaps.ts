/**
 * Source maps: upload, storage, and stack symbolication (#74).
 *
 * Maps are uploaded per (release, file) and stored in DynamoDB chunked under
 * the site partition (maps routinely exceed the 400KB item limit):
 *   SITE#{siteId} / SOURCEMAP#{release}#{fileKey}        — meta (chunk count)
 *   SITE#{siteId} / SOURCEMAP#{release}#{fileKey}#{i}    — JSON chunks
 * fileKey is the bundle URL's pathname (e.g. /assets/app-abc123.js) — the same
 * thing error stack frames carry — so lookup at display time is exact.
 *
 * Symbolication decodes the map's base64-VLQ `mappings` and binary-searches
 * the generated (line, column) to the original source/line/name. The decoder
 * is hand-rolled (the format is small and stable) and pure — unit tested.
 */
import { dynamodb, TABLE_NAME, marshall, unmarshall } from './dynamodb'

export interface SourceMapJson {
  version: number
  sources: string[]
  names: string[]
  mappings: string
  sourceRoot?: string
}

export interface OriginalPosition {
  source: string
  line: number // 1-based
  column: number // 0-based
  name: string | null
}

// ── VLQ decoding ────────────────────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_LOOKUP: Record<string, number> = {}
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64[i]] = i

/** Decode one base64-VLQ value starting at `pos`; returns [value, nextPos]. */
export function decodeVlq(s: string, pos: number): [number, number] {
  let result = 0
  let shift = 0
  let cont = true
  while (cont) {
    const digit = B64_LOOKUP[s[pos]]
    if (digit === undefined)
      throw new Error(`Invalid VLQ character at ${pos}`)
    pos++
    cont = (digit & 32) !== 0
    result += (digit & 31) << shift
    shift += 5
  }
  const negative = (result & 1) === 1
  result >>>= 1
  return [negative ? -result : result, pos]
}

/** A mapping segment: [generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex?]. */
export type Segment = [number, number, number, number, number]

/** Decode the full `mappings` string into per-generated-line segment arrays. */
export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = []
  let genCol = 0
  let srcIdx = 0
  let srcLine = 0
  let srcCol = 0
  let nameIdx = 0
  let line: Segment[] = []
  let pos = 0

  while (pos < mappings.length) {
    const ch = mappings[pos]
    if (ch === ';') {
      lines.push(line)
      line = []
      genCol = 0
      pos++
      continue
    }
    if (ch === ',') {
      pos++
      continue
    }
    let v: number
    ;[v, pos] = decodeVlq(mappings, pos)
    genCol += v
    let segSrcIdx = -1
    let segSrcLine = -1
    let segSrcCol = -1
    let segNameIdx = -1
    if (pos < mappings.length && mappings[pos] !== ',' && mappings[pos] !== ';') {
      ;[v, pos] = decodeVlq(mappings, pos)
      srcIdx += v
      segSrcIdx = srcIdx
      ;[v, pos] = decodeVlq(mappings, pos)
      srcLine += v
      segSrcLine = srcLine
      ;[v, pos] = decodeVlq(mappings, pos)
      srcCol += v
      segSrcCol = srcCol
      if (pos < mappings.length && mappings[pos] !== ',' && mappings[pos] !== ';') {
        ;[v, pos] = decodeVlq(mappings, pos)
        nameIdx += v
        segNameIdx = nameIdx
      }
    }
    line.push([genCol, segSrcIdx, segSrcLine, segSrcCol, segNameIdx])
  }
  lines.push(line)
  return lines
}

/**
 * Map a generated (line, column) — both 1-based line, 0-based column — to the
 * original position, or null when the map has no segment for it.
 */
export function originalPositionFor(map: SourceMapJson, decoded: Segment[][], line: number, column: number): OriginalPosition | null {
  const segments = decoded[line - 1]
  if (!segments || segments.length === 0)
    return null
  // Binary search: last segment with generatedColumn <= column.
  let lo = 0
  let hi = segments.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid][0] <= column) {
      best = mid
      lo = mid + 1
    }
    else {
      hi = mid - 1
    }
  }
  if (best === -1)
    return null
  const [, srcIdx, srcLine, srcCol, nameIdx] = segments[best]
  if (srcIdx < 0 || !map.sources[srcIdx])
    return null
  const root = map.sourceRoot ? map.sourceRoot.replace(/\/$/, '') + '/' : ''
  return {
    source: root + map.sources[srcIdx],
    line: srcLine + 1,
    column: srcCol,
    name: nameIdx >= 0 ? (map.names[nameIdx] || null) : null,
  }
}

// ── Storage ─────────────────────────────────────────────────────────────────
// Bytes of JSON per item — comfortably below the 400KB DynamoDB item limit.
const CHUNK_SIZE = 350_000
const MAX_MAP_BYTES = 20 * 1024 * 1024

/** Normalize a bundle URL/path to the lookup key (its pathname). */
export function fileKeyFor(fileUrl: string): string {
  try {
    return new URL(fileUrl).pathname
  }
  catch {
    return fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`
  }
}

function mapSk(release: string, fileKey: string): string {
  return `SOURCEMAP#${release}#${fileKey}`
}

export async function storeSourceMap(siteId: string, release: string, fileUrl: string, mapJson: string): Promise<{ fileKey: string, chunks: number }> {
  if (mapJson.length > MAX_MAP_BYTES)
    throw new Error(`Source map too large (${mapJson.length} bytes; max ${MAX_MAP_BYTES})`)
  // Validate it parses and looks like a map before writing anything.
  const parsed = JSON.parse(mapJson) as SourceMapJson
  if (!parsed.mappings || !Array.isArray(parsed.sources))
    throw new Error('Not a valid source map (missing mappings/sources)')

  const fileKey = fileKeyFor(fileUrl)
  const base = mapSk(release, fileKey)
  const chunks: string[] = []
  for (let i = 0; i < mapJson.length; i += CHUNK_SIZE) chunks.push(mapJson.slice(i, i + CHUNK_SIZE))

  for (let i = 0; i < chunks.length; i++) {
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: marshall({ pk: `SITE#${siteId}`, sk: `${base}#${String(i).padStart(4, '0')}`, chunk: chunks[i] }),
    })
  }
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `SITE#${siteId}`,
      sk: base,
      release,
      fileKey,
      chunks: chunks.length,
      bytes: mapJson.length,
      uploadedAt: new Date().toISOString(),
    }),
  })
  return { fileKey, chunks: chunks.length }
}

export async function loadSourceMap(siteId: string, release: string, fileKey: string): Promise<SourceMapJson | null> {
  const base = mapSk(release, fileKey)
  const meta = await dynamodb.getItem({
    TableName: TABLE_NAME,
    Key: { pk: { S: `SITE#${siteId}` }, sk: { S: base } },
  }) as { Item?: Record<string, any> }
  if (!meta.Item)
    return null
  const { chunks } = unmarshall(meta.Item) as { chunks: number }
  let json = ''
  for (let i = 0; i < chunks; i++) {
    const part = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: { pk: { S: `SITE#${siteId}` }, sk: { S: `${base}#${String(i).padStart(4, '0')}` } },
    }) as { Item?: Record<string, any> }
    if (!part.Item)
      return null
    json += unmarshall(part.Item).chunk
  }
  try {
    return JSON.parse(json) as SourceMapJson
  }
  catch {
    return null
  }
}

export async function listSourceMaps(siteId: string, release?: string): Promise<Array<{ release: string, fileKey: string, bytes: number, uploadedAt: string }>> {
  const prefix = release ? `SOURCEMAP#${release}#` : 'SOURCEMAP#'
  const res = await dynamodb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
    ExpressionAttributeValues: { ':pk': { S: `SITE#${siteId}` }, ':p': { S: prefix } },
  }) as { Items?: any[] }
  return (res.Items || [])
    .map(unmarshall)
    .filter(i => i.chunks !== undefined) // meta items only, not chunks
    .map(i => ({ release: i.release, fileKey: i.fileKey, bytes: i.bytes || 0, uploadedAt: i.uploadedAt || '' }))
}

// ── Symbolication ───────────────────────────────────────────────────────────
const FRAME_RE = /^(\s*at\s+)(?:(.+?)\s+\()?((?:https?|file):\/\/[^\s)]+|\/[^\s)]+):(\d+):(\d+)(\)?)\s*$/

/**
 * Symbolicate a raw stack trace using the release's uploaded maps. Frames
 * without a matching map pass through unchanged. Returns null when nothing
 * could be symbolicated (no maps for the release).
 */
export async function symbolicateStack(siteId: string, release: string, stack: string): Promise<string | null> {
  if (!release || !stack)
    return null
  const cache = new Map<string, { map: SourceMapJson, decoded: Segment[][] } | null>()
  let any = false

  const lines = await Promise.all(stack.split('\n').map(async (lineText) => {
    const m = lineText.match(FRAME_RE)
    if (!m)
      return lineText
    const [, prefix, fnName, fileUrl, lineStr, colStr] = m
    const fileKey = fileKeyFor(fileUrl)
    if (!cache.has(fileKey)) {
      const map = await loadSourceMap(siteId, release, fileKey)
      cache.set(fileKey, map ? { map, decoded: decodeMappings(map.mappings) } : null)
    }
    const entry = cache.get(fileKey)
    if (!entry)
      return lineText
    const pos = originalPositionFor(entry.map, entry.decoded, Number(lineStr), Number(colStr) - 1)
    if (!pos)
      return lineText
    any = true
    const name = pos.name || fnName || '<anonymous>'
    return `${prefix}${name} (${pos.source}:${pos.line}:${pos.column + 1})`
  }))

  return any ? lines.join('\n') : null
}
