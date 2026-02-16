import { describe, expect, test } from 'bun:test'
import {
  extractCloudflareGeo,
  extractVercelGeo,
  formatGeoLocation,
  formatGeoLocationShort,
  GeolocationService,
} from '../src/geolocation'

// Note: CityLoader tests are skipped until ts-countries publishes the CityLoader export

describe('Geolocation', () => {
  describe('Cloudflare geo extraction', () => {
    test('extracts geo from Cloudflare headers', () => {
      const headers = {
        'cf-connecting-ip': '1.2.3.4',
        'cf-ipcountry': 'US',
        'cf-region': 'California',
        'cf-region-code': 'CA',
        'cf-ipcity': 'Santa Monica',
        'cf-iplat': '34.0195',
        'cf-iplon': '-118.4912',
      }

      const result = extractCloudflareGeo(headers)
      expect(result).not.toBeNull()
      expect(result?.ip).toBe('1.2.3.4')
      expect(result?.countryCode).toBe('US')
      expect(result?.city).toBe('Santa Monica')
      expect(result?.regionCode).toBe('CA')
      expect(result?.latitude).toBe(34.0195)
    })

    test('returns null for missing headers', () => {
      const result = extractCloudflareGeo({})
      expect(result).toBeNull()
    })
  })

  describe('Vercel geo extraction', () => {
    test('extracts geo from Vercel headers', () => {
      const headers = {
        'x-forwarded-for': '1.2.3.4',
        'x-vercel-ip-country': 'US',
        'x-vercel-ip-country-region': 'CA',
        'x-vercel-ip-city': 'Santa Monica',
        'x-vercel-ip-latitude': '34.0195',
        'x-vercel-ip-longitude': '-118.4912',
      }

      const result = extractVercelGeo(headers)
      expect(result).not.toBeNull()
      expect(result?.ip).toBe('1.2.3.4')
      expect(result?.countryCode).toBe('US')
      expect(result?.city).toBe('Santa Monica')
    })
  })

  describe('formatGeoLocation', () => {
    test('formats full location', () => {
      const result = formatGeoLocation({
        ip: '1.2.3.4',
        countryCode: 'US',
        country: 'United States',
        regionCode: 'CA',
        region: 'California',
        city: 'Santa Monica',
      })
      expect(result).toBe('Santa Monica, California, United States')
    })

    test('formats location without city', () => {
      const result = formatGeoLocation({
        ip: '1.2.3.4',
        countryCode: 'US',
        country: 'United States',
        region: 'California',
      })
      expect(result).toBe('California, United States')
    })
  })

  describe('formatGeoLocationShort', () => {
    test('formats short location with city and region code', () => {
      const result = formatGeoLocationShort({
        ip: '1.2.3.4',
        countryCode: 'US',
        country: 'United States',
        regionCode: 'CA',
        city: 'Santa Monica',
      })
      expect(result).toBe('Santa Monica, CA')
    })

    test('formats short location without city', () => {
      const result = formatGeoLocationShort({
        ip: '1.2.3.4',
        countryCode: 'US',
        country: 'United States',
        region: 'California',
      })
      expect(result).toBe('California')
    })
  })

  describe('GeolocationService', () => {
    test('creates service with default config', () => {
      const service = new GeolocationService()
      expect(service).toBeDefined()
    })

    test('lookupFromHeaders works with Cloudflare headers', async () => {
      const service = new GeolocationService()
      const headers = {
        'cf-connecting-ip': '1.2.3.4',
        'cf-ipcountry': 'US',
        'cf-ipcity': 'Santa Monica',
        'cf-region-code': 'CA',
      }

      const result = await service.lookupFromHeaders(headers)
      expect(result).not.toBeNull()
      expect(result?.countryCode).toBe('US')
      expect(result?.city).toBe('Santa Monica')
    })

    test('privacy mode removes city-level data', async () => {
      const service = new GeolocationService({ privacyMode: true })
      const headers = {
        'cf-connecting-ip': '1.2.3.4',
        'cf-ipcountry': 'US',
        'cf-ipcity': 'Santa Monica',
        'cf-iplat': '34.0195',
        'cf-iplon': '-118.4912',
      }

      const result = await service.lookupFromHeaders(headers)
      expect(result?.city).toBeUndefined()
      expect(result?.latitude).toBe(34.0) // Rounded
    })
  })

  // Note: City distance calculation tests are skipped until ts-countries publishes CityLoader
})
