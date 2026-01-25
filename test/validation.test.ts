/**
 * Input validation and security tests
 * Tests payload validation, XSS prevention, and input sanitization
 */

import { describe, expect, it } from 'bun:test'

// ============================================================================
// Input Validation Tests
// ============================================================================

describe('Input Validation', () => {
  describe('validateCollectPayload', () => {
    it('should accept valid pageview payload', () => {
      const payload = {
        s: 'site-123',
        e: 'pageview',
        u: 'https://example.com/page',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject payload with missing siteId', () => {
      const payload = {
        e: 'pageview',
        u: 'https://example.com/page',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing siteId (s)')
    })

    it('should reject payload with missing event type', () => {
      const payload = {
        s: 'site-123',
        u: 'https://example.com/page',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing event type (e)')
    })

    it('should reject payload with missing URL', () => {
      const payload = {
        s: 'site-123',
        e: 'pageview',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing URL (u)')
    })

    it('should reject payload with invalid URL', () => {
      const payload = {
        s: 'site-123',
        e: 'pageview',
        u: 'not-a-valid-url',
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid URL format')
    })

    it('should accept valid event payload with properties', () => {
      const payload = {
        s: 'site-123',
        e: 'event',
        u: 'https://example.com/page',
        n: 'button_click',
        v: 99.99,
      }

      const result = validateCollectPayload(payload)

      expect(result.valid).toBe(true)
    })
  })
})

function validateCollectPayload(payload: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!payload.s) errors.push('Missing siteId (s)')
  if (!payload.e) errors.push('Missing event type (e)')
  if (!payload.u) errors.push('Missing URL (u)')

  if (payload.u && typeof payload.u === 'string') {
    try {
      new URL(payload.u)
    } catch {
      errors.push('Invalid URL format')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================================
// Security Tests
// ============================================================================

describe('Security', () => {
  describe('XSS Prevention', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    })

    it('should escape ampersands', () => {
      expect(escapeHtml('A & B')).toBe('A &amp; B')
    })

    it('should escape quotes', () => {
      expect(escapeHtml("It's a \"test\"")).toBe('It&#039;s a &quot;test&quot;')
    })

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('')
    })

    it('should handle string with no special chars', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World')
    })

    it('should escape script tags', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).not.toContain('<script>')
    })

    it('should escape event handlers', () => {
      const escaped = escapeHtml('<img onerror="alert(1)">')
      expect(escaped).not.toContain('<img')
      expect(escaped).toContain('&lt;img')
    })

    it('should escape javascript: URLs', () => {
      const escaped = escapeHtml('<a href="javascript:alert(1)">click</a>')
      expect(escaped).not.toContain('<a href')
    })

    it('should handle nested encoding attacks', () => {
      expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;')
    })
  })

  describe('Input Sanitization', () => {
    it('should reject excessively long siteIds', () => {
      const longId = 'a'.repeat(1000)
      expect(validateSiteId(longId)).toBe(false)
    })

    it('should reject siteIds with special characters', () => {
      expect(validateSiteId('<script>alert(1)</script>')).toBe(false)
      expect(validateSiteId('site; DROP TABLE users;')).toBe(false)
      expect(validateSiteId('../../../etc/passwd')).toBe(false)
    })

    it('should accept valid siteIds', () => {
      expect(validateSiteId('site-123')).toBe(true)
      expect(validateSiteId('my_site_456')).toBe(true)
      expect(validateSiteId('Site123')).toBe(true)
    })

    it('should validate URL parameters', () => {
      expect(validateUrl('https://example.com/page')).toBe(true)
      expect(validateUrl('javascript:alert(1)')).toBe(false)
      expect(validateUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    })
  })
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function validateSiteId(siteId: string): boolean {
  if (!siteId || siteId.length > 100) return false
  return /^[a-zA-Z0-9_-]+$/.test(siteId)
}

function validateUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

// ============================================================================
// Event Validation Tests
// ============================================================================

describe('Event Validation', () => {
  describe('validateEventPayload', () => {
    it('should accept valid custom event', () => {
      const event = {
        name: 'button_click',
        properties: { button_id: 'submit', page: '/checkout' },
      }
      expect(validateEventPayload(event)).toEqual({ valid: true, errors: [] })
    })

    it('should reject events with too long names', () => {
      const event = { name: 'a'.repeat(256) }
      expect(validateEventPayload(event).valid).toBe(false)
    })

    it('should reject events with invalid property types', () => {
      const event = { name: 'test', properties: { nested: { deep: 'object' } } }
      expect(validateEventPayload(event).valid).toBe(false)
    })

    it('should limit number of properties', () => {
      const properties: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        properties[`prop${i}`] = 'value'
      }
      const event = { name: 'test', properties }
      expect(validateEventPayload(event).valid).toBe(false)
    })

    it('should reject reserved event names', () => {
      expect(validateEventPayload({ name: 'pageview' }).valid).toBe(false)
      expect(validateEventPayload({ name: 'session_start' }).valid).toBe(false)
    })
  })
})

function validateEventPayload(event: { name: string; properties?: Record<string, unknown> }): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const reservedNames = ['pageview', 'session_start', 'session_end']

  if (!event.name || typeof event.name !== 'string') {
    errors.push('Event name is required')
  } else if (event.name.length > 255) {
    errors.push('Event name too long (max 255 characters)')
  } else if (reservedNames.includes(event.name.toLowerCase())) {
    errors.push('Event name is reserved')
  }

  if (event.properties) {
    const propCount = Object.keys(event.properties).length
    if (propCount > 50) {
      errors.push('Too many properties (max 50)')
    }

    for (const [key, value] of Object.entries(event.properties)) {
      if (typeof value === 'object' && value !== null) {
        errors.push(`Property "${key}" cannot be an object`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================================
// Do Not Track Tests
// ============================================================================

describe('Do Not Track', () => {
  describe('shouldTrack', () => {
    it('should respect DNT: 1 header', () => {
      expect(shouldTrack({ dnt: '1' })).toBe(false)
    })

    it('should track when DNT: 0', () => {
      expect(shouldTrack({ dnt: '0' })).toBe(true)
    })

    it('should track when DNT header is missing', () => {
      expect(shouldTrack({})).toBe(true)
    })

    it('should respect Sec-GPC header', () => {
      expect(shouldTrack({ 'sec-gpc': '1' })).toBe(false)
    })

    it('should handle case-insensitive headers', () => {
      expect(shouldTrack({ DNT: '1' })).toBe(false)
      expect(shouldTrack({ 'Sec-GPC': '1' })).toBe(false)
    })
  })
})

function shouldTrack(headers: Record<string, string>): boolean {
  const normalizedHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value
  }

  if (normalizedHeaders.dnt === '1') return false
  if (normalizedHeaders['sec-gpc'] === '1') return false
  return true
}
