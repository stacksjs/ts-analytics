import { describe, expect, it } from 'bun:test'
import { getErrorFingerprint } from '../src/utils/errors'

const stackA = `TypeError: x is undefined
    at render (https://app.com/assets/main.js:1200:15)
    at update (https://app.com/assets/main.js:980:7)`

// Same code, different build: line numbers shifted + content-hashed bundle name.
const stackB = `TypeError: x is undefined
    at render (https://app.com/assets/main.4f3a2b1c.js:1322:9)
    at update (https://app.com/assets/main.4f3a2b1c.js:1051:3)`

// Genuinely different error path (different functions).
const stackC = `TypeError: x is undefined
    at save (https://app.com/assets/main.js:50:1)`

describe('getErrorFingerprint', () => {
  it('groups the same error across builds (line shifts + hashed bundle names)', () => {
    expect(getErrorFingerprint('x is undefined', stackA)).toBe(getErrorFingerprint('x is undefined', stackB))
  })

  it('separates errors with different stack frames', () => {
    expect(getErrorFingerprint('x is undefined', stackA)).not.toBe(getErrorFingerprint('x is undefined', stackC))
  })

  it('normalizes numbers in the message', () => {
    expect(getErrorFingerprint('failed after 30 retries', undefined))
      .toBe(getErrorFingerprint('failed after 99 retries', undefined))
  })

  it('still produces a fingerprint with no stack', () => {
    expect(getErrorFingerprint('boom', undefined)).toContain('@nostack')
  })
})
