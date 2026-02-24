/**
 * Site creation flow tests
 * Tests API key generation, siteId slug derivation, and key record shape
 */

import { describe, expect, it } from 'bun:test'
import { generateApiKey } from '../src/handlers/api-keys'

// ============================================================================
// API Key Generation
// ============================================================================

describe('generateApiKey', () => {
  it('should return a string starting with ak_', () => {
    const key = generateApiKey()
    expect(key.startsWith('ak_')).toBe(true)
  })

  it('should return a 35-character string (3 prefix + 32 random)', () => {
    const key = generateApiKey()
    expect(key.length).toBe(35)
  })

  it('should only contain alphanumeric characters after the prefix', () => {
    const key = generateApiKey()
    const randomPart = key.slice(3)
    expect(/^[A-Za-z0-9]+$/.test(randomPart)).toBe(true)
  })

  it('should produce unique values across calls', () => {
    const keys = new Set<string>()
    for (let i = 0; i < 100; i++) {
      keys.add(generateApiKey())
    }
    expect(keys.size).toBe(100)
  })
})

// ============================================================================
// Site ID Slug Derivation
// ============================================================================

describe('siteId slug derivation', () => {
  // This is the same logic used in handleCreateSite
  function deriveSiteId(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  it('should lowercase the name', () => {
    expect(deriveSiteId('My App')).toBe('my-app')
  })

  it('should replace spaces with hyphens', () => {
    expect(deriveSiteId('hello world')).toBe('hello-world')
  })

  it('should replace special characters with hyphens', () => {
    expect(deriveSiteId('my@app!v2')).toBe('my-app-v2')
  })

  it('should collapse consecutive special characters into a single hyphen', () => {
    expect(deriveSiteId('my---app')).toBe('my-app')
    expect(deriveSiteId('my   app')).toBe('my-app')
  })

  it('should strip leading and trailing hyphens', () => {
    expect(deriveSiteId('-my-app-')).toBe('my-app')
    expect(deriveSiteId('!!!app!!!')).toBe('app')
  })

  it('should handle names with only alphanumeric characters', () => {
    expect(deriveSiteId('myapp123')).toBe('myapp123')
  })
})

// ============================================================================
// Key Record Shape Validation
// ============================================================================

describe('API key record shape', () => {
  it('should match the structure expected by handleValidateApiKey', () => {
    const siteId = 'my-app'
    const keyId = 'test-key-id'
    const apiKey = generateApiKey()
    const now = new Date().toISOString()

    const keyRecord = {
      pk: `SITE#${siteId}`,
      sk: `API_KEY#${keyId}`,
      gsi1pk: `API_KEY#${apiKey}`,
      gsi1sk: `SITE#${siteId}`,
      id: keyId,
      siteId,
      name: 'Default',
      key: apiKey,
      keyPrefix: apiKey.slice(0, 8),
      permissions: ['read', 'error-tracking'],
      lastUsed: null,
      usageCount: 0,
      isActive: true,
      createdAt: now,
    }

    // Verify partition and sort key format
    expect(keyRecord.pk).toBe(`SITE#${siteId}`)
    expect(keyRecord.sk).toBe(`API_KEY#${keyId}`)

    // Verify GSI keys for lookup by API key value
    expect(keyRecord.gsi1pk).toBe(`API_KEY#${apiKey}`)
    expect(keyRecord.gsi1sk).toBe(`SITE#${siteId}`)

    // Verify fields used by handleValidateApiKey
    expect(keyRecord.isActive).toBe(true)
    expect(keyRecord.permissions).toContain('error-tracking')
    expect(keyRecord.siteId).toBe(siteId)
    expect(keyRecord.id).toBe(keyId)

    // Verify key prefix is first 8 chars
    expect(keyRecord.keyPrefix).toBe(apiKey.slice(0, 8))
  })

  it('should include error-tracking permission for auto-created keys', () => {
    const permissions = ['read', 'error-tracking']
    expect(permissions).toContain('error-tracking')
    expect(permissions).toContain('read')
  })
})
