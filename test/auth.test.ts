import { describe, expect, it } from 'bun:test'
import { validateCredentials } from '../src/handlers/auth'

describe('validateCredentials', () => {
  it('rejects missing fields', () => {
    expect(validateCredentials('', 'password123')).toBeTruthy()
    expect(validateCredentials('a@b.com', '')).toBeTruthy()
  })

  it('rejects malformed emails', () => {
    expect(validateCredentials('not-an-email', 'password123')).toBeTruthy()
    expect(validateCredentials('a@b', 'password123')).toBeTruthy()
  })

  it('rejects short passwords', () => {
    expect(validateCredentials('a@b.com', 'short')).toBeTruthy()
  })

  it('accepts a valid email + password', () => {
    expect(validateCredentials('user@example.com', 'password123')).toBeNull()
  })
})
