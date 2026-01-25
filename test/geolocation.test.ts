import { describe, expect, test } from 'bun:test'
import {
  CityLoader,
  extractCloudflareGeo,
  extractVercelGeo,
  formatGeoLocation,
  formatGeoLocationShort,
  GeolocationService,
} from '../src/geolocation'

describe('Geolocation', () => {
  describe('CityLoader', () => {
    test('loads US cities', () => {
      const cities = CityLoader.getAllCities('US')
      expect(cities.length).toBeGreaterThan(0)
    })

    test('finds Santa Monica', () => {
      const city = CityLoader.getCity('US', 'santa-monica')
      expect(city).not.toBeNull()
      expect(city?.getName()).toBe('Santa Monica')
      expect(city?.getState()).toBe('California')
      expect(city?.getStateCode()).toBe('CA')
      expect(city?.getMetro()).toBe('Los Angeles-Long Beach-Anaheim')
    })

    test('searches cities by name', () => {
      const cities = CityLoader.searchByName('US', 'Los Angeles')
      expect(cities.length).toBeGreaterThan(0)
      expect(cities[0].getName()).toBe('Los Angeles')
    })

    test('gets cities in a state', () => {
      const cities = CityLoader.getCitiesInState('US', 'CA')
      expect(cities.length).toBeGreaterThan(0)
      expect(cities.every(c => c.getStateCode() === 'CA')).toBe(true)
    })

    test('gets cities in a metro area', () => {
      const cities = CityLoader.getCitiesInMetro('US', 'Los Angeles')
      expect(cities.length).toBeGreaterThan(0)
    })

    test('finds nearest city to coordinates', () => {
      // Coordinates near Santa Monica
      const city = CityLoader.findNearest('US', 34.02, -118.49, 10)
      expect(city).not.toBeNull()
      expect(city?.getName()).toBe('Santa Monica')
    })

    test('finds cities within radius', () => {
      // 20km radius around Santa Monica
      const results = CityLoader.findWithinRadius('US', 34.02, -118.49, 20)
      expect(results.length).toBeGreaterThan(0)

      const cityNames = results.map(r => r.city.getName())
      expect(cityNames).toContain('Santa Monica')
    })

    test('gets top cities by population', () => {
      const cities = CityLoader.getTopCities('US', 5)
      expect(cities.length).toBe(5)
      expect(cities[0].getName()).toBe('New York')
    })
  })

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

    test('lookupFromHeaders works with Cloudflare headers', () => {
      const service = new GeolocationService()
      const headers = {
        'cf-connecting-ip': '1.2.3.4',
        'cf-ipcountry': 'US',
        'cf-ipcity': 'Santa Monica',
        'cf-region-code': 'CA',
      }

      const result = service.lookupFromHeaders(headers)
      expect(result).not.toBeNull()
      expect(result?.countryCode).toBe('US')
      expect(result?.city).toBe('Santa Monica')
    })

    test('privacy mode removes city-level data', () => {
      const service = new GeolocationService({ privacyMode: true })
      const headers = {
        'cf-connecting-ip': '1.2.3.4',
        'cf-ipcountry': 'US',
        'cf-ipcity': 'Santa Monica',
        'cf-iplat': '34.0195',
        'cf-iplon': '-118.4912',
      }

      const result = service.lookupFromHeaders(headers)
      expect(result?.city).toBeUndefined()
      expect(result?.latitude).toBe(34.0) // Rounded
    })
  })

  describe('City distance calculations', () => {
    test('calculates distance between cities', () => {
      const santaMonica = CityLoader.getCity('US', 'santa-monica')
      const losAngeles = CityLoader.getCity('US', 'los-angeles')

      expect(santaMonica).not.toBeNull()
      expect(losAngeles).not.toBeNull()

      const distance = santaMonica!.distanceTo(losAngeles!)
      // Santa Monica to LA downtown is about 24km
      expect(distance).toBeGreaterThan(20)
      expect(distance).toBeLessThan(30)
    })

    test('calculates distance to coordinates', () => {
      const santaMonica = CityLoader.getCity('US', 'santa-monica')
      expect(santaMonica).not.toBeNull()

      // Distance to exact same location should be ~0
      const distance = santaMonica!.distanceToCoordinates(
        santaMonica!.getLatitude(),
        santaMonica!.getLongitude(),
      )
      expect(distance).toBeLessThan(1)
    })
  })
})
