/**
 * User Agent parsing tests
 * Tests browser, device, OS detection and bot identification
 */

import { describe, expect, it } from 'bun:test'

// ============================================================================
// User Agent Parsing Tests
// ============================================================================

describe('User Agent Parsing', () => {
  describe('parseUserAgent', () => {
    it('should detect Chrome on Windows Desktop', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Chrome')
      expect(result.deviceType).toBe('Desktop')
      expect(result.os).toBe('Windows')
    })

    it('should detect Safari on iPhone (Mobile)', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Safari')
      expect(result.deviceType).toBe('Mobile')
      expect(result.os).toBe('iOS')
    })

    it('should detect Safari on iPad (Tablet)', () => {
      const ua = 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
      const result = parseUserAgent(ua)

      expect(result.deviceType).toBe('Tablet')
    })

    it('should detect Firefox on Linux', () => {
      const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Firefox')
      expect(result.os).toBe('Linux')
    })

    it('should detect Edge browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Edge')
    })

    it('should detect Android Mobile', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      const result = parseUserAgent(ua)

      expect(result.deviceType).toBe('Mobile')
      expect(result.os).toBe('Android')
    })

    it('should detect Arc browser', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Arc/1.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Arc')
    })

    it('should detect Dia browser', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Dia/1.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Dia')
    })

    it('should handle unknown user agents gracefully', () => {
      const ua = 'CustomBot/1.0'
      const result = parseUserAgent(ua)

      expect(result.browser).toBe('Unknown')
      expect(result.deviceType).toBe('Desktop')
      expect(result.os).toBe('Unknown')
    })

    it('should handle empty or null user agents', () => {
      expect(parseUserAgent('')).toEqual({ browser: 'Unknown', deviceType: 'Desktop', os: 'Unknown' })
      expect(parseUserAgent(undefined as unknown as string)).toEqual({ browser: 'Unknown', deviceType: 'Desktop', os: 'Unknown' })
    })
  })
})

function parseUserAgent(ua: string): { browser: string; deviceType: string; os: string } {
  if (!ua) return { browser: 'Unknown', deviceType: 'Desktop', os: 'Unknown' }

  const uaLower = ua.toLowerCase()

  // Detect device type (order matters - check tablet/iPad before mobile since iPad UA contains "Mobile")
  let deviceType = 'Desktop'
  if (/ipad|tablet|android(?!.*mobile)/.test(uaLower)) {
    deviceType = 'Tablet'
  } else if (/mobile|android.*mobile|iphone|ipod/.test(uaLower)) {
    deviceType = 'Mobile'
  }

  // Detect browser (order matters - check specific before generic)
  let browser = 'Unknown'
  if (uaLower.includes('dia/')) {
    browser = 'Dia'
  } else if (uaLower.includes('arc/')) {
    browser = 'Arc'
  } else if (uaLower.includes('edg/')) {
    browser = 'Edge'
  } else if (uaLower.includes('firefox/')) {
    browser = 'Firefox'
  } else if (uaLower.includes('safari/') && !uaLower.includes('chrome/')) {
    browser = 'Safari'
  } else if (uaLower.includes('chrome/')) {
    browser = 'Chrome'
  }

  // Detect OS (order matters - check iOS before macOS since iOS UAs contain "Mac OS X")
  let os = 'Unknown'
  if (uaLower.includes('iphone') || uaLower.includes('ipad')) {
    os = 'iOS'
  } else if (uaLower.includes('android')) {
    os = 'Android'
  } else if (uaLower.includes('windows')) {
    os = 'Windows'
  } else if (uaLower.includes('mac os x') || uaLower.includes('macintosh')) {
    os = 'macOS'
  } else if (uaLower.includes('linux')) {
    os = 'Linux'
  }

  return { browser, deviceType, os }
}

// ============================================================================
// Extended User Agent Detection Tests
// ============================================================================

describe('Extended User Agent Detection', () => {
  describe('parseUserAgentExtended', () => {
    it('should detect Opera browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 OPR/106.0.0.0 Safari/537.36'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Opera')
    })

    it('should detect Brave browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Brave/120'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Brave')
    })

    it('should detect Vivaldi browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Vivaldi/6.5'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Vivaldi')
    })

    it('should detect Internet Explorer', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('IE')
    })

    it('should detect Windows 10 vs Windows 11', () => {
      expect(parseUserAgentExtended('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0').os).toBe('Windows 10')
    })

    it('should detect Chrome OS', () => {
      const ua = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      const result = parseUserAgentExtended(ua)
      expect(result.os).toBe('Chrome OS')
    })

    it('should detect Firefox on iOS (FxiOS)', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 FxiOS/121.0 Mobile/15E148 Safari/605.1.15'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Firefox')
      expect(result.os).toBe('iOS')
    })

    it('should detect Chrome on iOS (CriOS)', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Chrome')
      expect(result.os).toBe('iOS')
    })

    it('should detect Android tablet vs phone', () => {
      const phone = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
      expect(parseUserAgentExtended(phone).deviceType).toBe('Mobile')

      const tablet = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      expect(parseUserAgentExtended(tablet).deviceType).toBe('Tablet')
    })

    it('should detect Samsung Internet browser', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('Samsung Internet')
    })

    it('should detect UC Browser', () => {
      const ua = 'Mozilla/5.0 (Linux; U; Android 9; en-US; SM-G960F) AppleWebKit/537.36 UCBrowser/13.4.0.1306 Mobile Safari/537.36'
      const result = parseUserAgentExtended(ua)
      expect(result.browser).toBe('UC Browser')
    })
  })
})

function parseUserAgentExtended(ua: string): { browser: string; deviceType: string; os: string } {
  if (!ua) return { browser: 'Unknown', deviceType: 'Desktop', os: 'Unknown' }

  const uaLower = ua.toLowerCase()

  // Detect device type
  let deviceType = 'Desktop'
  if (/ipad|tablet/.test(uaLower)) {
    deviceType = 'Tablet'
  } else if (/android(?!.*mobile)/.test(uaLower)) {
    deviceType = 'Tablet'
  } else if (/mobile|android.*mobile|iphone|ipod|blackberry|iemobile|opera mini/i.test(uaLower)) {
    deviceType = 'Mobile'
  }

  // Detect browser (order matters - more specific first)
  let browser = 'Unknown'
  if (/samsungbrowser/i.test(ua)) browser = 'Samsung Internet'
  else if (/ucbrowser/i.test(ua)) browser = 'UC Browser'
  else if (/dia\//i.test(ua)) browser = 'Dia'
  else if (/arc\//i.test(ua)) browser = 'Arc'
  else if (/brave/i.test(ua)) browser = 'Brave'
  else if (/vivaldi/i.test(ua)) browser = 'Vivaldi'
  else if (/edg/i.test(ua)) browser = 'Edge'
  else if (/opr|opera/i.test(ua)) browser = 'Opera'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/chrome|chromium|crios/i.test(ua)) browser = 'Chrome'
  else if (/safari/i.test(ua) && !/chrome|chromium/i.test(ua)) browser = 'Safari'
  else if (/trident|msie/i.test(ua)) browser = 'IE'
  else if (/bot|crawl|spider/i.test(ua)) browser = 'Bot'

  // Detect OS (order matters)
  let os = 'Unknown'
  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/cros/i.test(ua)) os = 'Chrome OS'
  else if (/windows nt 10/i.test(ua)) os = 'Windows 10'
  else if (/windows nt 11/i.test(ua)) os = 'Windows 11'
  else if (/windows/i.test(ua)) os = 'Windows'
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS'
  else if (/linux/i.test(ua)) os = 'Linux'

  return { browser, deviceType, os }
}

// ============================================================================
// Bot Detection Tests
// ============================================================================

describe('Bot Detection', () => {
  describe('isBot', () => {
    it('should detect common web crawlers', () => {
      expect(isBot('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe(true)
      expect(isBot('Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true)
      expect(isBot('Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)')).toBe(true)
    })

    it('should detect social media crawlers', () => {
      expect(isBot('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true)
      expect(isBot('Twitterbot/1.0')).toBe(true)
      expect(isBot('LinkedInBot/1.0')).toBe(true)
    })

    it('should detect SEO and monitoring tools', () => {
      expect(isBot('AhrefsBot/7.0')).toBe(true)
      expect(isBot('SemrushBot/7~bl')).toBe(true)
      expect(isBot('MJ12bot/v1.4.8')).toBe(true)
      expect(isBot('DotBot/1.2')).toBe(true)
    })

    it('should detect headless browsers', () => {
      expect(isBot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/90.0')).toBe(true)
      expect(isBot('PhantomJS/2.1.1')).toBe(true)
      expect(isBot('Puppeteer/2.0.0')).toBe(true)
    })

    it('should NOT detect regular browsers as bots', () => {
      expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')).toBe(false)
      expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) Safari/604.1')).toBe(false)
      expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/121.0')).toBe(false)
    })

    it('should handle preview bots', () => {
      expect(isBot('Mozilla/5.0 (compatible; BingPreview/1.0b)')).toBe(true)
      expect(isBot('Slackbot-LinkExpanding 1.0')).toBe(true)
      expect(isBot('WhatsApp/2.21.12.21')).toBe(true)
    })
  })
})

function isBot(ua: string): boolean {
  if (!ua) return false
  const botPatterns = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot|ahrefsbot|semrushbot|mj12bot|dotbot|headlesschrome|phantomjs|puppeteer|slackbot|whatsapp/i
  return botPatterns.test(ua)
}
