/**
 * Source-map decoding + symbolication lookup (#74).
 *
 * The test builds mappings with its own tiny VLQ encoder so the expected
 * positions are known exactly (round-trip, not golden strings).
 */
import { describe, expect, it } from 'bun:test'
import { decodeVlq, decodeMappings, originalPositionFor, fileKeyFor, type SourceMapJson } from '../src/lib/sourcemaps'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeVlq(value: number): string {
  let v = value < 0 ? ((-value) << 1) | 1 : value << 1
  let out = ''
  do {
    let digit = v & 31
    v >>>= 5
    if (v > 0)
      digit |= 32
    out += B64[digit]
  } while (v > 0)
  return out
}

function seg(...nums: number[]): string {
  return nums.map(encodeVlq).join('')
}

describe('decodeVlq', () => {
  it('round-trips values through the encoder', () => {
    for (const v of [0, 1, -1, 15, 16, -16, 31, 32, 1000, -1000, 123456]) {
      const [decoded, next] = decodeVlq(encodeVlq(v), 0)
      expect(decoded).toBe(v)
      expect(next).toBe(encodeVlq(v).length)
    }
  })
})

describe('decodeMappings + originalPositionFor', () => {
  // Generated file with 2 lines. Line 1 has two segments:
  //   genCol 0  → src 0, line 9 (0-based), col 4, name 0
  //   genCol 12 → src 0, line 20, col 2, name 1
  // Line 2 has one segment: genCol 0 → src 1, line 0, col 2 (no name).
  // Fields are deltas; line 2's deltas continue from line 1's running state.
  const mappings = [
    seg(0, 0, 9, 4, 0) + ',' + seg(12, 0, 11, -2, 1),
    seg(0, 1, -20, 0),
  ].join(';')

  const map: SourceMapJson = {
    version: 3,
    sources: ['src/app.ts', 'src/util.ts'],
    names: ['doThing', 'helper'],
    mappings,
  }
  const decoded = decodeMappings(mappings)

  it('maps an exact segment start', () => {
    const pos = originalPositionFor(map, decoded, 1, 0)
    expect(pos).toEqual({ source: 'src/app.ts', line: 10, column: 4, name: 'doThing' })
  })

  it('maps a column between segments to the preceding segment', () => {
    const pos = originalPositionFor(map, decoded, 1, 7)
    expect(pos?.name).toBe('doThing')
  })

  it('maps a column past the last segment to that segment', () => {
    const pos = originalPositionFor(map, decoded, 1, 99)
    expect(pos).toEqual({ source: 'src/app.ts', line: 21, column: 2, name: 'helper' })
  })

  it('maps the second generated line', () => {
    const pos = originalPositionFor(map, decoded, 2, 5)
    expect(pos).toEqual({ source: 'src/util.ts', line: 1, column: 2, name: null })
  })

  it('returns null for lines without mappings', () => {
    expect(originalPositionFor(map, decoded, 7, 0)).toBeNull()
  })

  it('applies sourceRoot', () => {
    const rooted = { ...map, sourceRoot: 'webpack://app/' }
    const pos = originalPositionFor(rooted, decoded, 1, 0)
    expect(pos?.source).toBe('webpack://app/src/app.ts')
  })
})

describe('fileKeyFor', () => {
  it('uses the pathname of a full URL', () => {
    expect(fileKeyFor('https://example.com/assets/app-abc.js?x=1')).toBe('/assets/app-abc.js')
  })

  it('passes through absolute paths and roots relative ones', () => {
    expect(fileKeyFor('/assets/app.js')).toBe('/assets/app.js')
    expect(fileKeyFor('app.js')).toBe('/app.js')
  })
})
