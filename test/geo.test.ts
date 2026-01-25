/**
 * Geographic and IP detection tests
 * Tests country detection and private IP handling
 */

import { describe, expect, it } from 'bun:test'

// ============================================================================
// Country Detection Tests
// ============================================================================

describe('Country Detection', () => {
  describe('getCountryFromHeaders', () => {
    it('should extract country from CloudFront header', () => {
      const headers = { 'cloudfront-viewer-country': 'US' }
      expect(getCountryFromHeaders(headers)).toBe('US')
    })

    it('should extract country from CF-IPCountry header', () => {
      const headers = { 'cf-ipcountry': 'GB' }
      expect(getCountryFromHeaders(headers)).toBe('GB')
    })

    it('should return Unknown for missing headers', () => {
      expect(getCountryFromHeaders({})).toBe('Unknown')
    })

    it('should prefer CloudFront header over CF header', () => {
      const headers = {
        'cloudfront-viewer-country': 'US',
        'cf-ipcountry': 'GB',
      }
      expect(getCountryFromHeaders(headers)).toBe('US')
    })
  })
})

function getCountryFromHeaders(headers: Record<string, string>): string {
  return headers['cloudfront-viewer-country'] || headers['cf-ipcountry'] || 'Unknown'
}

// ============================================================================
// Country Header Parsing Tests
// ============================================================================

describe('Country Header Parsing', () => {
  describe('getCountryFromHeadersExtended', () => {
    it('should extract from CloudFront header', () => {
      expect(getCountryFromHeadersExtended({ 'cloudfront-viewer-country': 'US' })).toBe('United States')
    })

    it('should extract from CloudFront header (different case)', () => {
      expect(getCountryFromHeadersExtended({ 'CloudFront-Viewer-Country': 'GB' })).toBe('United Kingdom')
    })

    it('should extract from Cloudflare header', () => {
      expect(getCountryFromHeadersExtended({ 'cf-ipcountry': 'DE' })).toBe('Germany')
    })

    it('should extract from x-country-code header', () => {
      expect(getCountryFromHeadersExtended({ 'x-country-code': 'FR' })).toBe('France')
    })

    it('should handle XX (unknown) country code', () => {
      expect(getCountryFromHeadersExtended({ 'cloudfront-viewer-country': 'XX' })).toBeUndefined()
    })

    it('should prefer CloudFront over other headers', () => {
      const headers = {
        'cloudfront-viewer-country': 'US',
        'cf-ipcountry': 'GB',
        'x-country-code': 'DE',
      }
      expect(getCountryFromHeadersExtended(headers)).toBe('United States')
    })

    it('should return raw code for unknown countries', () => {
      expect(getCountryFromHeadersExtended({ 'cloudfront-viewer-country': 'ZZ' })).toBe('ZZ')
    })

    it('should handle lowercase country codes', () => {
      expect(getCountryFromHeadersExtended({ 'cloudfront-viewer-country': 'us' })).toBe('United States')
    })
  })
})

function getCountryFromHeadersExtended(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined

  const countryCode =
    headers['cloudfront-viewer-country'] ||
    headers['CloudFront-Viewer-Country'] ||
    headers['x-country-code'] ||
    headers['cf-ipcountry']

  if (!countryCode || countryCode.toUpperCase() === 'XX') return undefined

  const code = countryCode.toUpperCase()

  const countryNames: Record<string, string> = {
    US: 'United States',
    GB: 'United Kingdom',
    CA: 'Canada',
    AU: 'Australia',
    DE: 'Germany',
    FR: 'France',
    JP: 'Japan',
    CN: 'China',
    IN: 'India',
    BR: 'Brazil',
  }

  return countryNames[code] || code
}

// ============================================================================
// Private IP Detection Tests
// ============================================================================

describe('Private IP Detection', () => {
  describe('isPrivateIP', () => {
    it('should detect localhost', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true)
      expect(isPrivateIP('127.0.0.0')).toBe(true)
      expect(isPrivateIP('127.255.255.255')).toBe(true)
    })

    it('should detect Class A private range (10.x.x.x)', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true)
      expect(isPrivateIP('10.255.255.255')).toBe(true)
      expect(isPrivateIP('10.100.50.25')).toBe(true)
    })

    it('should detect Class B private range (172.16-31.x.x)', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true)
      expect(isPrivateIP('172.31.255.255')).toBe(true)
      expect(isPrivateIP('172.20.10.5')).toBe(true)
    })

    it('should NOT detect non-private 172.x addresses', () => {
      expect(isPrivateIP('172.15.0.1')).toBe(false)
      expect(isPrivateIP('172.32.0.1')).toBe(false)
    })

    it('should detect Class C private range (192.168.x.x)', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true)
      expect(isPrivateIP('192.168.1.1')).toBe(true)
      expect(isPrivateIP('192.168.255.255')).toBe(true)
    })

    it('should NOT detect public IPs as private', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false)
      expect(isPrivateIP('1.1.1.1')).toBe(false)
      expect(isPrivateIP('203.0.113.50')).toBe(false)
    })

    it('should handle invalid IPs', () => {
      expect(isPrivateIP('')).toBe(true) // Empty should be treated as private/invalid
      expect(isPrivateIP('unknown')).toBe(true)
      expect(isPrivateIP('not-an-ip')).toBe(false)
    })
  })
})

function isPrivateIP(ip: string): boolean {
  if (!ip || ip === 'unknown') return true

  // Localhost
  if (ip.startsWith('127.')) return true

  // Class A: 10.0.0.0 - 10.255.255.255
  if (ip.startsWith('10.')) return true

  // Class C: 192.168.0.0 - 192.168.255.255
  if (ip.startsWith('192.168.')) return true

  // Class B: 172.16.0.0 - 172.31.255.255
  if (ip.startsWith('172.')) {
    const secondOctet = Number.parseInt(ip.split('.')[1], 10)
    if (secondOctet >= 16 && secondOctet <= 31) return true
  }

  return false
}
