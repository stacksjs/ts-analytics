/**
 * Visitor and session tracking tests
 * Tests visitor ID hashing, session management, and fingerprinting
 */

import { describe, expect, it } from 'bun:test'

// ============================================================================
// Visitor ID Hashing Tests
// ============================================================================

describe('Visitor ID Hashing', () => {
  describe('hashVisitorId', () => {
    it('should generate consistent hashes for same inputs', async () => {
      const hash1 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt')
      const hash2 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt')

      expect(hash1).toBe(hash2)
    })

    it('should generate different hashes for different IPs', async () => {
      const hash1 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt')
      const hash2 = await hashVisitorId('192.168.1.2', 'Mozilla/5.0', 'site-123', 'salt')

      expect(hash1).not.toBe(hash2)
    })

    it('should generate different hashes for different salts', async () => {
      const hash1 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt1')
      const hash2 = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt2')

      expect(hash1).not.toBe(hash2)
    })

    it('should generate 64-character hex strings (SHA-256)', async () => {
      const hash = await hashVisitorId('192.168.1.1', 'Mozilla/5.0', 'site-123', 'salt')

      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })
})

async function hashVisitorId(ip: string, userAgent: string, siteId: string, salt: string): Promise<string> {
  const data = `${ip}|${userAgent}|${siteId}|${salt}`
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ============================================================================
// Visitor Uniqueness Tests
// ============================================================================

describe('Visitor Uniqueness', () => {
  describe('generateVisitorFingerprint', () => {
    it('should generate consistent fingerprints for same inputs', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      expect(fp1).toBe(fp2)
    })

    it('should generate different fingerprints for different IPs', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.2', 'Mozilla/5.0', 'site-1', '2024-01-15')
      expect(fp1).not.toBe(fp2)
    })

    it('should generate different fingerprints for different user agents', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Chrome/120', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.1', 'Firefox/121', 'site-1', '2024-01-15')
      expect(fp1).not.toBe(fp2)
    })

    it('should generate different fingerprints for different sites', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-2', '2024-01-15')
      expect(fp1).not.toBe(fp2)
    })

    it('should generate different fingerprints for different days (privacy rotation)', async () => {
      const fp1 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-15')
      const fp2 = await generateVisitorFingerprint('192.168.1.1', 'Mozilla/5.0', 'site-1', '2024-01-16')
      expect(fp1).not.toBe(fp2)
    })
  })
})

async function generateVisitorFingerprint(
  ip: string,
  userAgent: string,
  siteId: string,
  dateSalt: string,
): Promise<string> {
  const data = `${ip}|${userAgent}|${siteId}|${dateSalt}`
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// Session Management Tests
// ============================================================================

describe('Session Management', () => {
  describe('SessionCache', () => {
    it('should store and retrieve sessions', () => {
      const cache = new SessionCache()
      const session = { id: 'sess-1', visitorId: 'v-1', startTime: new Date() }

      cache.set('key-1', session, 1800)
      expect(cache.get('key-1')).toEqual(session)
    })

    it('should return null for expired sessions', () => {
      const cache = new SessionCache()
      const session = { id: 'sess-1', visitorId: 'v-1', startTime: new Date() }

      cache.set('key-1', session, 0) // 0 TTL = expired immediately
      expect(cache.get('key-1')).toBeNull()
    })

    it('should return null for non-existent keys', () => {
      const cache = new SessionCache()
      expect(cache.get('non-existent')).toBeNull()
    })

    it('should delete expired sessions on access', () => {
      const cache = new SessionCache()
      const session = { id: 'sess-1', visitorId: 'v-1', startTime: new Date() }

      cache.set('key-1', session, -1) // Already expired
      cache.get('key-1') // This should delete it
      expect(cache.has('key-1')).toBe(false)
    })
  })
})

class SessionCache {
  private storage = new Map<string, { session: unknown; expires: number }>()

  get(key: string): unknown | null {
    const cached = this.storage.get(key)
    if (cached && cached.expires > Date.now()) {
      return cached.session
    }
    this.storage.delete(key)
    return null
  }

  set(key: string, session: unknown, ttlSeconds: number): void {
    this.storage.set(key, {
      session,
      expires: Date.now() + ttlSeconds * 1000,
    })
  }

  has(key: string): boolean {
    return this.storage.has(key)
  }
}
