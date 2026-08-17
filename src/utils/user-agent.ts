/**
 * User agent parsing utilities
 */

export interface ParsedUserAgent {
  deviceType: 'desktop' | 'mobile' | 'tablet'
  browser: string
  os: string
}

/**
 * Parse user agent string to extract device, browser, and OS info
 */
export function parseUserAgent(ua: string): ParsedUserAgent {
  if (!ua || ua === 'unknown') {
    return { deviceType: 'desktop', browser: 'Unknown', os: 'Unknown' }
  }

  // Detect device type.
  //
  // TABLETS ARE TESTED FIRST, and the order is the whole correctness argument:
  // every tablet User-Agent also matches the mobile patterns below. An iPad
  // sends "...(iPad; CPU OS 17_5 like Mac OS X)... Mobile/15E148", a Fire tablet
  // sends "Silk" alongside "Android", and an Android tablet sends "Android".
  // Testing mobile first made this branch unreachable for every real device --
  // `tablet` was a value the parser could not return, so the bucket was
  // permanently empty and its traffic sat in `mobile`.
  //
  // Android phones include the literal token "Mobile" in their UA and Android
  // tablets do not. That absence is the only signal Android gives us, so it is
  // what distinguishes the two.
  let deviceType: 'desktop' | 'mobile' | 'tablet' = 'desktop'
  if (/ipad|tablet|playbook|silk|kindle/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
    deviceType = 'tablet'
  }
  else if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    deviceType = 'mobile'
  }

  // Detect browser - order matters (more specific first)
  // Chromium-based browsers should be detected before Chrome
  let browser = 'Unknown'
  // Dia browser - check various possible formats
  if (/\bdia\b|diahq|diabrowser/i.test(ua)) browser = 'Dia'
  else if (/arc\//i.test(ua)) browser = 'Arc'
  else if (/edg/i.test(ua)) browser = 'Edge'
  else if (/opr\b|opera/i.test(ua)) browser = 'Opera'
  else if (/brave/i.test(ua)) browser = 'Brave'
  else if (/vivaldi/i.test(ua)) browser = 'Vivaldi'
  else if (/yabrowser/i.test(ua)) browser = 'Yandex'
  else if (/whale/i.test(ua)) browser = 'Whale'
  else if (/puffin/i.test(ua)) browser = 'Puffin'
  else if (/qqbrowser/i.test(ua)) browser = 'QQ Browser'
  else if (/ucbrowser/i.test(ua)) browser = 'UC Browser'
  else if (/samsungbrowser/i.test(ua)) browser = 'Samsung Internet'
  else if (/silk/i.test(ua)) browser = 'Amazon Silk'
  else if (/duckduckgo/i.test(ua)) browser = 'DuckDuckGo'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/chrome|chromium|crios/i.test(ua)) browser = 'Chrome'
  else if (/safari/i.test(ua) && !/chrome|chromium/i.test(ua)) browser = 'Safari'
  else if (/trident|msie/i.test(ua)) browser = 'IE'
  else if (/bot|crawl|spider|slurp|bingpreview/i.test(ua)) browser = 'Bot'

  // Detect OS — most specific first, for the same reason as the device block.
  //
  // iOS BEFORE macOS: an iPhone or iPad reports "CPU iPhone OS 17_5 like Mac
  // OS X". Testing /mac os x/ first matched that phrase and attributed every
  // iOS visit to macOS, which left the iOS bucket permanently empty and
  // inflated macOS by all of it.
  //
  // Android BEFORE Linux: Android UAs open with "(Linux; Android 14; ...)".
  //
  // Chrome OS is matched on a WORD BOUNDARY. "cros" unanchored is a substring of
  // "microsoft", so an unbounded test would file Microsoft's own clients under
  // Chrome OS.
  let os = 'Unknown'
  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/\bcros\b/i.test(ua)) os = 'Chrome OS'
  // Windows 11 is NOT detectable here: it reports "Windows NT 10.0" exactly as
  // Windows 10 does, and telling them apart needs User-Agent Client Hints. This
  // branch only catches a literal "Windows NT 11" that Microsoft has never
  // shipped, and is kept so the value is never silently wrong rather than merely
  // coarse.
  else if (/windows nt 11/i.test(ua)) os = 'Windows 11'
  else if (/windows nt 10/i.test(ua)) os = 'Windows 10'
  else if (/windows/i.test(ua)) os = 'Windows'
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS'
  else if (/linux/i.test(ua)) os = 'Linux'

  return { deviceType, browser, os }
}

/**
 * Whether a user agent is a bot / non-human client (#166).
 *
 * Three signals, applied at ingestion so bots never pollute the numbers
 * (Fathom-style):
 * 1. A MISSING or unrecognizably short UA — real browsers always send one;
 *    UA-less curl/scripts previously counted as human visitors.
 * 2. Generic bot markers (bot/crawl/spider/preview...).
 * 3. Known non-human client families: headless browsers, HTTP libraries,
 *    monitoring agents, and AI scrapers.
 */
const BOT_UA_PATTERN = new RegExp([
  // generic markers
  'bot|crawl|spider|slurp|preview|scan|probe|monitor(?:ing)?|checker|validator',
  // headless / automation
  'headless|phantomjs|puppeteer|playwright|selenium|webdriver|electron',
  // http libraries & CLI clients
  'curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|okhttp',
  'java/|libwww|lwp::|php/|guzzle|axios|node-fetch|undici|bun/',
  // feed/link expanders, previews, misc known agents
  'facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|twitterbot',
  'pingdom|uptimerobot|statuscake|newrelic|datadog|site24x7',
  // AI scrapers
  'gptbot|claudebot|ccbot|bytespider|amazonbot|anthropic|perplexity',
].join('|'), 'i')

export function isBot(ua: string): boolean {
  // No/garbage UA: every real browser sends a UA string. Treat absent or
  // implausibly short values as non-human instead of counting them as
  // visitors (previously `if (!ua) return false` let them ALL through).
  if (!ua || ua === 'unknown' || ua.length < 12)
    return true
  return BOT_UA_PATTERN.test(ua)
}

/**
 * Get browser family (simplifies browser name to family)
 */
export function getBrowserFamily(browser: string): string {
  const chromiumBased = ['Chrome', 'Edge', 'Opera', 'Brave', 'Vivaldi', 'Arc', 'Dia', 'Whale', 'Samsung Internet']
  if (chromiumBased.includes(browser)) return 'Chromium'
  if (browser === 'Firefox') return 'Firefox'
  if (browser === 'Safari') return 'Safari'
  return 'Other'
}
