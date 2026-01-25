/**
 * Referrer and Campaign tracking tests
 * Tests referrer source detection and UTM parameter parsing
 */

import { describe, expect, it } from 'bun:test'

// ============================================================================
// Referrer Source Detection Tests
// ============================================================================

describe('Referrer Source Detection', () => {
  describe('parseReferrerSource', () => {
    it('should return "Direct" for empty referrer', () => {
      expect(parseReferrerSource('')).toBe('Direct')
      expect(parseReferrerSource(undefined as unknown as string)).toBe('Direct')
    })

    it('should detect Google', () => {
      expect(parseReferrerSource('https://www.google.com/search?q=test')).toBe('Google')
      expect(parseReferrerSource('https://google.co.uk/')).toBe('Google')
    })

    it('should detect social media platforms', () => {
      expect(parseReferrerSource('https://www.facebook.com/')).toBe('Facebook')
      expect(parseReferrerSource('https://t.co/abc123')).toBe('Twitter')
      expect(parseReferrerSource('https://twitter.com/user')).toBe('Twitter')
      expect(parseReferrerSource('https://www.linkedin.com/feed')).toBe('LinkedIn')
      expect(parseReferrerSource('https://www.reddit.com/r/test')).toBe('Reddit')
      expect(parseReferrerSource('https://www.youtube.com/watch?v=123')).toBe('YouTube')
    })

    it('should detect search engines', () => {
      expect(parseReferrerSource('https://www.bing.com/search?q=test')).toBe('Bing')
      expect(parseReferrerSource('https://duckduckgo.com/?q=test')).toBe('DuckDuckGo')
      expect(parseReferrerSource('https://search.yahoo.com/search?p=test')).toBe('Yahoo')
    })

    it('should extract domain for unknown referrers', () => {
      expect(parseReferrerSource('https://blog.example.com/post')).toBe('blog.example.com')
    })

    it('should handle invalid URLs gracefully', () => {
      expect(parseReferrerSource('not-a-valid-url')).toBe('Unknown')
    })
  })
})

function parseReferrerSource(referrer: string): string {
  if (!referrer) return 'Direct'

  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()

    if (host.includes('google')) return 'Google'
    if (host.includes('bing')) return 'Bing'
    if (host.includes('duckduckgo')) return 'DuckDuckGo'
    if (host.includes('yahoo')) return 'Yahoo'
    if (host.includes('facebook') || host.includes('fb.com')) return 'Facebook'
    if (host.includes('reddit')) return 'Reddit' // Must check before Twitter since reddit.com contains 't.co'
    if (host.includes('twitter') || host === 't.co') return 'Twitter'
    if (host.includes('linkedin')) return 'LinkedIn'
    if (host.includes('youtube')) return 'YouTube'

    return host
  } catch {
    return 'Unknown'
  }
}

// ============================================================================
// Extended Referrer Detection Tests
// ============================================================================

describe('Extended Referrer Detection', () => {
  describe('parseReferrerSourceExtended', () => {
    it('should detect x.com (new Twitter domain)', () => {
      expect(parseReferrerSourceExtended('https://x.com/user/status/123')).toBe('Twitter')
    })

    it('should detect GitHub', () => {
      expect(parseReferrerSourceExtended('https://github.com/user/repo')).toBe('GitHub')
    })

    it('should detect Pinterest', () => {
      expect(parseReferrerSourceExtended('https://www.pinterest.com/pin/123')).toBe('Pinterest')
    })

    it('should detect TikTok', () => {
      expect(parseReferrerSourceExtended('https://www.tiktok.com/@user/video/123')).toBe('TikTok')
    })

    it('should detect Instagram', () => {
      expect(parseReferrerSourceExtended('https://www.instagram.com/p/abc123')).toBe('Instagram')
    })

    it('should detect Hacker News', () => {
      expect(parseReferrerSourceExtended('https://news.ycombinator.com/item?id=123')).toBe('Hacker News')
    })

    it('should detect email providers', () => {
      expect(parseReferrerSourceExtended('https://mail.google.com/mail/u/0')).toBe('Gmail')
      expect(parseReferrerSourceExtended('https://outlook.live.com/mail')).toBe('Outlook')
    })

    it('should detect Baidu (Chinese search)', () => {
      expect(parseReferrerSourceExtended('https://www.baidu.com/s?wd=test')).toBe('Baidu')
    })

    it('should detect Yandex (Russian search)', () => {
      expect(parseReferrerSourceExtended('https://yandex.ru/search/?text=test')).toBe('Yandex')
    })

    it('should extract clean domain for unknown referrers', () => {
      expect(parseReferrerSourceExtended('https://blog.company.com/post')).toBe('blog.company.com')
      expect(parseReferrerSourceExtended('https://www.example.com/page')).toBe('example.com')
    })
  })
})

function parseReferrerSourceExtended(referrer: string): string {
  if (!referrer) return 'Direct'

  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()

    // Search engines
    if (host.includes('google') && !host.includes('mail.google')) return 'Google'
    if (host.includes('bing')) return 'Bing'
    if (host.includes('duckduckgo')) return 'DuckDuckGo'
    if (host.includes('yahoo')) return 'Yahoo'
    if (host.includes('baidu')) return 'Baidu'
    if (host.includes('yandex')) return 'Yandex'

    // Social media (order matters for reddit vs t.co issue)
    if (host.includes('reddit')) return 'Reddit'
    if (host.includes('facebook') || host.includes('fb.com')) return 'Facebook'
    if (host.includes('instagram')) return 'Instagram'
    if (host.includes('twitter') || host === 't.co' || host.includes('x.com')) return 'Twitter'
    if (host.includes('linkedin')) return 'LinkedIn'
    if (host.includes('youtube')) return 'YouTube'
    if (host.includes('pinterest')) return 'Pinterest'
    if (host.includes('tiktok')) return 'TikTok'

    // Developer platforms
    if (host.includes('github')) return 'GitHub'
    if (host.includes('ycombinator') || host.includes('news.ycombinator')) return 'Hacker News'

    // Email providers
    if (host.includes('mail.google')) return 'Gmail'
    if (host.includes('outlook')) return 'Outlook'

    // Clean up domain for unknown
    let domain = host
    if (domain.startsWith('www.')) domain = domain.slice(4)

    return domain
  } catch {
    return 'Unknown'
  }
}

// ============================================================================
// UTM Campaign Parameter Tests
// ============================================================================

describe('UTM Campaign Parameters', () => {
  describe('parseUTMParams', () => {
    it('should parse all UTM parameters', () => {
      const url = 'https://example.com?utm_source=google&utm_medium=cpc&utm_campaign=summer_sale&utm_term=shoes&utm_content=ad1'
      const params = parseUTMParams(url)

      expect(params.source).toBe('google')
      expect(params.medium).toBe('cpc')
      expect(params.campaign).toBe('summer_sale')
      expect(params.term).toBe('shoes')
      expect(params.content).toBe('ad1')
    })

    it('should handle missing UTM parameters', () => {
      const url = 'https://example.com?utm_source=google'
      const params = parseUTMParams(url)

      expect(params.source).toBe('google')
      expect(params.medium).toBeUndefined()
      expect(params.campaign).toBeUndefined()
    })

    it('should handle URLs without UTM parameters', () => {
      const url = 'https://example.com/page'
      const params = parseUTMParams(url)

      expect(params.source).toBeUndefined()
    })

    it('should handle encoded UTM values', () => {
      const url = 'https://example.com?utm_campaign=summer%20sale%202024'
      const params = parseUTMParams(url)

      expect(params.campaign).toBe('summer sale 2024')
    })

    it('should handle case variations', () => {
      const url = 'https://example.com?UTM_SOURCE=Google&utm_medium=CPC'
      const params = parseUTMParams(url)

      expect(params.source).toBe('Google')
      expect(params.medium).toBe('CPC')
    })
  })
})

function parseUTMParams(url: string): {
  source?: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
} {
  try {
    const parsed = new URL(url)
    const params: Record<string, string> = {}

    for (const [key, value] of parsed.searchParams.entries()) {
      params[key.toLowerCase()] = value
    }

    return {
      source: params.utm_source,
      medium: params.utm_medium,
      campaign: params.utm_campaign,
      term: params.utm_term,
      content: params.utm_content,
    }
  } catch {
    return {}
  }
}
