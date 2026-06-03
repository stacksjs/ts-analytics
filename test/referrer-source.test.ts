/**
 * Tests for the live referrer engine in src/utils/geolocation.ts:
 * source normalization, channel classification, and referral-spam detection.
 */

import { describe, expect, it } from 'bun:test'
import {
  parseReferrerSource,
  getReferrerChannel,
  getReferrerSourceChannel,
  isSpamReferrer,
} from '../src/utils/geolocation'

describe('parseReferrerSource', () => {
  it('returns Direct for empty referrer', () => {
    expect(parseReferrerSource('')).toBe('Direct')
    expect(parseReferrerSource(undefined)).toBe('Direct')
  })

  it('returns Unknown for invalid URLs', () => {
    expect(parseReferrerSource('not-a-url')).toBe('Unknown')
  })

  it('detects search engines (incl. ccTLDs)', () => {
    expect(parseReferrerSource('https://www.google.com/search?q=x')).toBe('Google')
    expect(parseReferrerSource('https://google.co.uk/')).toBe('Google')
    expect(parseReferrerSource('https://news.google.com/')).toBe('Google')
    expect(parseReferrerSource('https://www.bing.com/')).toBe('Bing')
    expect(parseReferrerSource('https://duckduckgo.com/?q=x')).toBe('DuckDuckGo')
    expect(parseReferrerSource('https://yandex.ru/')).toBe('Yandex')
    expect(parseReferrerSource('https://www.baidu.com/')).toBe('Baidu')
  })

  it('detects social platforms', () => {
    expect(parseReferrerSource('https://www.reddit.com/r/x')).toBe('Reddit')
    expect(parseReferrerSource('https://t.co/abc')).toBe('Twitter')
    expect(parseReferrerSource('https://twitter.com/u')).toBe('Twitter')
    expect(parseReferrerSource('https://x.com/u/status/1')).toBe('Twitter')
    expect(parseReferrerSource('https://www.facebook.com/')).toBe('Facebook')
    expect(parseReferrerSource('https://fb.com/x')).toBe('Facebook')
    expect(parseReferrerSource('https://www.linkedin.com/feed')).toBe('LinkedIn')
    expect(parseReferrerSource('https://news.ycombinator.com/item?id=1')).toBe('Hacker News')
  })

  it('detects AI assistants (before Google for gemini)', () => {
    expect(parseReferrerSource('https://chatgpt.com/')).toBe('ChatGPT')
    expect(parseReferrerSource('https://chat.openai.com/')).toBe('ChatGPT')
    expect(parseReferrerSource('https://www.perplexity.ai/')).toBe('Perplexity')
    expect(parseReferrerSource('https://claude.ai/')).toBe('Claude')
    expect(parseReferrerSource('https://gemini.google.com/app')).toBe('Gemini')
  })

  it('treats webmail as Email source, not the search engine', () => {
    expect(parseReferrerSource('https://mail.google.com/mail/u/0')).toBe('Gmail')
    expect(parseReferrerSource('https://outlook.live.com/mail')).toBe('Outlook')
  })

  it('does not false-positive short hosts (t.co / x.com)', () => {
    // "first.com" ends in "t.com" but must NOT be classified as Twitter
    expect(parseReferrerSource('https://first.com/page')).toBe('first.com')
  })

  it('falls back to the bare domain (www stripped) for unknown hosts', () => {
    expect(parseReferrerSource('https://www.example.com/page')).toBe('example.com')
    expect(parseReferrerSource('https://blog.company.com/post')).toBe('blog.company.com')
  })
})

describe('getReferrerSourceChannel', () => {
  it('maps known source names to channels', () => {
    expect(getReferrerSourceChannel('Google')).toBe('Search')
    expect(getReferrerSourceChannel('Reddit')).toBe('Social')
    expect(getReferrerSourceChannel('ChatGPT')).toBe('AI')
    expect(getReferrerSourceChannel('GitHub')).toBe('Referral')
  })

  it('handles direct and unknown', () => {
    expect(getReferrerSourceChannel('Direct')).toBe('Direct')
    expect(getReferrerSourceChannel('direct')).toBe('Direct')
    expect(getReferrerSourceChannel(undefined)).toBe('Direct')
    expect(getReferrerSourceChannel('example.com')).toBe('Referral')
  })
})

describe('getReferrerChannel', () => {
  it('classifies paid traffic from click IDs and medium', () => {
    expect(getReferrerChannel({ gclid: 'abc' })).toBe('Paid')
    expect(getReferrerChannel({ fbclid: 'abc' })).toBe('Paid')
    expect(getReferrerChannel({ utmMedium: 'cpc' })).toBe('Paid')
    expect(getReferrerChannel({ utmMedium: 'PPC' })).toBe('Paid')
  })

  it('honors email/social/search mediums', () => {
    expect(getReferrerChannel({ utmMedium: 'email' })).toBe('Email')
    expect(getReferrerChannel({ utmMedium: 'social' })).toBe('Social')
    expect(getReferrerChannel({ utmMedium: 'organic' })).toBe('Search')
  })

  it('falls back to referrer classification', () => {
    expect(getReferrerChannel({ referrer: 'https://www.google.com/' })).toBe('Search')
    expect(getReferrerChannel({ referrer: 'https://reddit.com/' })).toBe('Social')
    expect(getReferrerChannel({ referrer: 'https://claude.ai/' })).toBe('AI')
    expect(getReferrerChannel({ referrer: 'https://random-blog.com/' })).toBe('Referral')
  })

  it('is Direct with no signal', () => {
    expect(getReferrerChannel({})).toBe('Direct')
  })
})

describe('isSpamReferrer', () => {
  it('flags known spam domains and their subdomains', () => {
    expect(isSpamReferrer('https://semalt.com/project')).toBe(true)
    expect(isSpamReferrer('https://www.darodar.com/')).toBe(true)
    expect(isSpamReferrer('https://traffic.semalt.com/x')).toBe(true)
  })

  it('passes legitimate referrers and empties', () => {
    expect(isSpamReferrer('https://www.google.com/')).toBe(false)
    expect(isSpamReferrer('')).toBe(false)
    expect(isSpamReferrer('not-a-url')).toBe(false)
  })
})
