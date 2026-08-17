/**
 * User Agent parsing tests — browser, device and OS detection, and bots.
 *
 * ## These tests used to test themselves
 *
 * Every function here was previously re-implemented at the bottom of this file
 * and the tests called the local copy, never `src/`. Deleting the shipped
 * parser would not have turned a single one of them red.
 *
 * The copies had also drifted into being MORE correct than the code they stood
 * in for — they checked tablets before mobile and iOS before macOS, which is
 * exactly what the real parser got wrong — so the suite reported green on two
 * bugs it was written to describe:
 *
 *   - `tablet` was unreachable. Every tablet UA also matches a mobile pattern
 *     (an iPad sends "Mobile/15E148", a Fire tablet sends "Silk"), so testing
 *     mobile first meant no User-Agent on earth could produce `tablet`.
 *   - Every iPhone and iPad reported `macOS`, because iOS UAs read "like Mac
 *     OS X" and /mac os x/ was tested first.
 *
 * Everything below imports from `src/`. The device and OS cases are written as
 * table-driven sweeps so a new pattern cannot be added without a real UA to
 * justify it.
 */

import { describe, expect, it } from 'bun:test'
import { getBrowserFamily, isBot, parseUserAgent } from '../src/utils/user-agent'

// Real User-Agent strings. Anything asserted below is asserted against one of
// these, so a rule that only holds for a UA nobody sends is not a rule.
const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  ieWindows: 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko',
  operaWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
  braveWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Brave/120',
  vivaldiWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Vivaldi/6.5',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  arcMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Arc/1.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
  safariIpad: 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  samsungPhone: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  ucPhone: 'Mozilla/5.0 (Linux; U; Android 9; en-US; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) UCBrowser/13.4.0.1306 Mobile Safari/537.36',
  fireTablet: 'Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/119.1 like Chrome/119.0.0.0 Safari/537.36',
  // Silk has a mobile/desktop view toggle, and in mobile view a Fire TABLET
  // sends "Mobile Safari". This is the UA that makes the silk/kindle rule
  // load-bearing: the Android-without-Mobile rule cannot catch it, because the
  // token is present. Without it the rule is dead weight that no test defends.
  fireTabletMobileView: 'Mozilla/5.0 (Linux; Android 5.1.1; KFAUWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/87.3.14 like Chrome/87.0.4280.141 Mobile Safari/537.36',
} as const

describe('device detection', () => {
  // The regression that motivated the rewrite. Each of these UAs matches a
  // mobile pattern as well as a tablet one, so each would come back `mobile`
  // under the old ordering.
  it.each([
    ['iPad Safari, whose UA contains "Mobile/15E148"', UA.safariIpad],
    ['an Android tablet, which omits the "Mobile" token', UA.androidTablet],
    ['a Fire tablet, which sends Silk alongside Android', UA.fireTablet],
    ['a Fire tablet in mobile view, which sends Silk AND "Mobile Safari"', UA.fireTabletMobileView],
  ])('%s is a tablet', (_name, ua) => {
    expect(parseUserAgent(ua).deviceType).toBe('tablet')
  })

  it.each([
    ['iPhone Safari', UA.safariIphone],
    ['an Android phone, which includes the "Mobile" token', UA.androidPhone],
    ['a Samsung phone', UA.samsungPhone],
    ['a UC Browser phone', UA.ucPhone],
  ])('%s is mobile', (_name, ua) => {
    expect(parseUserAgent(ua).deviceType).toBe('mobile')
  })

  it.each([
    ['Chrome on Windows', UA.chromeWindows],
    ['Safari on macOS', UA.safariMac],
    ['Firefox on Linux', UA.firefoxLinux],
    ['Chrome OS', UA.chromeOs],
  ])('%s is desktop', (_name, ua) => {
    expect(parseUserAgent(ua).deviceType).toBe('desktop')
  })

  it('an Android phone and an Android tablet are told apart', () => {
    // The "Mobile" token is the only signal Android gives us. If this pair ever
    // agrees, the tablet rule has collapsed back into the mobile one.
    expect(parseUserAgent(UA.androidPhone).deviceType).toBe('mobile')
    expect(parseUserAgent(UA.androidTablet).deviceType).toBe('tablet')
  })

  it('every device class is reachable by some real User-Agent', () => {
    // `tablet` was previously unreachable: no UA could produce it. A class the
    // parser cannot return is a permanently empty bucket in every report built
    // on it, and nothing about the reports themselves looks wrong.
    const reachable = new Set(Object.values(UA).map(ua => parseUserAgent(ua).deviceType))
    expect([...reachable].sort()).toEqual(['desktop', 'mobile', 'tablet'])
  })

  it('an iPad asking for the desktop site is indistinguishable, and that is not a bug', () => {
    // iPadOS 13+ defaults to "Request Desktop Website", which sends a UA byte
    // for byte identical to a Mac's. No parser can separate them without client
    // hints. Documented so the next person does not go looking for the rule
    // that is missing.
    expect(parseUserAgent(UA.safariMac).deviceType).toBe('desktop')
  })
})

describe('OS detection', () => {
  it.each([
    ['iPhone Safari', UA.safariIphone],
    ['Firefox on iOS', UA.firefoxIphone],
    ['Chrome on iOS', UA.chromeIphone],
    ['iPad Safari', UA.safariIpad],
  ])('%s reports iOS, not macOS', (_name, ua) => {
    // iOS UAs read "CPU iPhone OS 17_1 like Mac OS X". Matching /mac os x/
    // first sent every iOS visit into the macOS bucket.
    expect(parseUserAgent(ua).os).toBe('iOS')
  })

  it.each([
    [UA.safariMac, 'macOS'],
    [UA.arcMac, 'macOS'],
    [UA.androidPhone, 'Android'],
    [UA.androidTablet, 'Android'],
    [UA.firefoxLinux, 'Linux'],
    [UA.chromeOs, 'Chrome OS'],
    [UA.chromeWindows, 'Windows 10'],
  ])('%s reports %s', (ua, expected) => {
    expect(parseUserAgent(ua).os).toBe(expected)
  })

  it('Android is not swallowed by Linux', () => {
    // Android UAs open with "(Linux; Android 14; ...)".
    expect(parseUserAgent(UA.androidPhone).os).toBe('Android')
  })

  it('Chrome OS does not match the "cros" inside "microsoft"', () => {
    // /cros/ unanchored is a substring of "microsoft". Without a word boundary
    // this files Microsoft's own clients under Chrome OS.
    const outlook = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Microsoft Outlook 16.0.17328'
    expect(parseUserAgent(outlook).os).not.toBe('Chrome OS')
  })

  it('every OS the parser can name is reachable', () => {
    const reachable = new Set(Object.values(UA).map(ua => parseUserAgent(ua).os))
    for (const os of ['iOS', 'Android', 'macOS', 'Linux', 'Chrome OS', 'Windows 10'])
      expect([...reachable]).toContain(os)
  })
})

describe('browser detection', () => {
  it.each([
    [UA.chromeWindows, 'Chrome'],
    [UA.edgeWindows, 'Edge'],
    [UA.operaWindows, 'Opera'],
    [UA.braveWindows, 'Brave'],
    [UA.vivaldiWindows, 'Vivaldi'],
    [UA.ieWindows, 'IE'],
    [UA.safariMac, 'Safari'],
    [UA.arcMac, 'Arc'],
    [UA.firefoxLinux, 'Firefox'],
    [UA.safariIphone, 'Safari'],
    [UA.firefoxIphone, 'Firefox'],
    [UA.chromeIphone, 'Chrome'],
    [UA.samsungPhone, 'Samsung Internet'],
    [UA.ucPhone, 'UC Browser'],
    [UA.fireTablet, 'Amazon Silk'],
  ])('%s is %s', (ua, expected) => {
    expect(parseUserAgent(ua).browser).toBe(expected)
  })

  it('Chromium-based browsers are not all reported as Chrome', () => {
    // Every one of these carries "Chrome/" in its UA, so a naive order collapses
    // the whole browser report into one row.
    const chromiumBased = [UA.edgeWindows, UA.operaWindows, UA.braveWindows, UA.vivaldiWindows, UA.arcMac, UA.samsungPhone]
    for (const ua of chromiumBased)
      expect(parseUserAgent(ua).browser).not.toBe('Chrome')
  })

  it('Safari is not claimed by Chrome, which also sends "Safari/537.36"', () => {
    expect(parseUserAgent(UA.safariMac).browser).toBe('Safari')
    expect(parseUserAgent(UA.chromeWindows).browser).toBe('Chrome')
  })

  it('getBrowserFamily folds the Chromium forks together', () => {
    for (const ua of [UA.chromeWindows, UA.edgeWindows, UA.braveWindows, UA.arcMac, UA.samsungPhone])
      expect(getBrowserFamily(parseUserAgent(ua).browser)).toBe('Chromium')
    expect(getBrowserFamily(parseUserAgent(UA.firefoxLinux).browser)).toBe('Firefox')
    expect(getBrowserFamily(parseUserAgent(UA.safariMac).browser)).toBe('Safari')
    expect(getBrowserFamily('Netscape')).toBe('Other')
  })
})

describe('empty and unknown input', () => {
  it('an absent User-Agent is desktop/Unknown rather than a crash', () => {
    expect(parseUserAgent('')).toEqual({ deviceType: 'desktop', browser: 'Unknown', os: 'Unknown' })
    expect(parseUserAgent(undefined as unknown as string)).toEqual({ deviceType: 'desktop', browser: 'Unknown', os: 'Unknown' })
    expect(parseUserAgent('unknown')).toEqual({ deviceType: 'desktop', browser: 'Unknown', os: 'Unknown' })
  })

  it('an unrecognised browser is named, not guessed', () => {
    expect(parseUserAgent('Netscape/4.0 (Win95; I)').browser).toBe('Unknown')
  })
})

describe('bot detection', () => {
  it.each([
    ['Googlebot/2.1 (+http://www.google.com/bot.html)'],
    ['Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    ['Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)'],
    ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['Twitterbot/1.0'],
    ['LinkedInBot/1.0'],
    ['AhrefsBot/7.0'],
    ['SemrushBot/7~bl'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/90.0'],
    ['PhantomJS/2.1.1'],
    ['Puppeteer/2.0.0'],
    ['Mozilla/5.0 (compatible; BingPreview/1.0b)'],
    ['Slackbot-LinkExpanding 1.0'],
    ['WhatsApp/2.21.12.21'],
    ['GPTBot/1.0 (+https://openai.com/gptbot)'],
    ['ClaudeBot/1.0 (+claudebot@anthropic.com)'],
    ['curl/8.4.0'],
    ['python-requests/2.31.0'],
    ['Go-http-client/2.0'],
  ])('%s is a bot', (ua) => {
    expect(isBot(ua)).toBe(true)
  })

  it('a missing or implausibly short UA counts as a bot, not a visitor', () => {
    // Every real browser sends a UA. Treating absent ones as human is how
    // scripted traffic used to land in the visitor counts (#166).
    expect(isBot('')).toBe(true)
    expect(isBot(undefined as unknown as string)).toBe(true)
    expect(isBot('unknown')).toBe(true)
    expect(isBot('short')).toBe(true)
  })

  it.each(Object.entries(UA))('%s is not a bot', (_name, ua) => {
    // Every real browser UA in the table above. A bot pattern broad enough to
    // catch one of these silently deletes real traffic, which is the more
    // expensive direction to be wrong in.
    expect(isBot(ua)).toBe(false)
  })
})
