/**
 * Tests for the shared dashboard filter layer (src/utils/filters.ts).
 */

import { describe, expect, it } from 'bun:test'
import { parseFilters, hasFilters, matchesFilters } from '../src/utils/filters'

describe('parseFilters', () => {
  it('maps query params (incl. short + canonical names)', () => {
    const f = parseFilters({
      country: 'US',
      device: 'mobile',
      browser: 'Chrome',
      os: 'iOS',
      referrer: 'Google',
      channel: 'Search',
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'launch',
    })
    expect(f.country).toBe('US')
    expect(f.device).toBe('mobile')
    expect(f.browser).toBe('Chrome')
    expect(f.os).toBe('iOS')
    expect(f.referrerSource).toBe('Google')
    expect(f.channel).toBe('Search')
    expect(f.utmSource).toBe('newsletter')
    expect(f.utmMedium).toBe('email')
    expect(f.utmCampaign).toBe('launch')
  })

  it('leaves absent params undefined', () => {
    const f = parseFilters({ country: 'US' })
    expect(f.country).toBe('US')
    expect(f.browser).toBeUndefined()
    expect(f.device).toBeUndefined()
  })
})

describe('hasFilters', () => {
  it('detects active filters', () => {
    expect(hasFilters(parseFilters({}))).toBe(false)
    expect(hasFilters(parseFilters({ browser: 'Chrome' }))).toBe(true)
  })
})

describe('matchesFilters', () => {
  const rec = {
    country: 'US',
    deviceType: 'mobile',
    browser: 'Chrome',
    os: 'iOS',
    referrerSource: 'Google',
    utmSource: 'newsletter',
  }

  it('passes everything when no filters set', () => {
    expect(matchesFilters(rec, parseFilters({}))).toBe(true)
  })

  it('matches direct fields (device maps to deviceType)', () => {
    expect(matchesFilters(rec, parseFilters({ device: 'mobile' }))).toBe(true)
    expect(matchesFilters(rec, parseFilters({ device: 'desktop' }))).toBe(false)
    expect(matchesFilters(rec, parseFilters({ browser: 'Chrome' }))).toBe(true)
    expect(matchesFilters(rec, parseFilters({ browser: 'Safari' }))).toBe(false)
    expect(matchesFilters(rec, parseFilters({ country: 'US' }))).toBe(true)
    expect(matchesFilters(rec, parseFilters({ country: 'GB' }))).toBe(false)
  })

  it('derives channel from referrerSource', () => {
    expect(matchesFilters(rec, parseFilters({ channel: 'Search' }))).toBe(true)
    expect(matchesFilters(rec, parseFilters({ channel: 'Social' }))).toBe(false)
  })

  it('ANDs multiple filters', () => {
    expect(matchesFilters(rec, parseFilters({ device: 'mobile', browser: 'Chrome' }))).toBe(true)
    expect(matchesFilters(rec, parseFilters({ device: 'mobile', browser: 'Safari' }))).toBe(false)
  })

  it('matches UTM source', () => {
    expect(matchesFilters(rec, parseFilters({ utm_source: 'newsletter' }))).toBe(true)
    expect(matchesFilters(rec, parseFilters({ utm_source: 'other' }))).toBe(false)
  })
})
