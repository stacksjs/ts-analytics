import { describe, expect, it } from 'bun:test'
import { buildDsn } from '../src/handlers/api-keys'

describe('buildDsn', () => {
  it('builds a Sentry-style DSN from an https origin', () => {
    expect(buildDsn('https://a.example.com', 'acme', 'ak_abc')).toBe('https://ak_abc@a.example.com/acme')
  })

  it('preserves a non-standard port', () => {
    expect(buildDsn('http://localhost:3001', 'acme', 'ak_xyz')).toBe('http://ak_xyz@localhost:3001/acme')
  })

  it('falls back gracefully on a non-URL origin', () => {
    expect(buildDsn('not a url', 'acme', 'ak_1')).toBe('not a url/acme?key=ak_1')
  })
})
