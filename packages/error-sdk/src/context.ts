/**
 * Collects browser/device environment context from the runtime.
 */

export interface EnvironmentContext {
  browser: string
  browserVersion: string
  os: string
  osVersion: string
  screenWidth: number
  screenHeight: number
  userAgent: string
  deviceType: string
}

export function collectContext(): EnvironmentContext {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

  return {
    browser: detectBrowser(ua),
    browserVersion: detectBrowserVersion(ua),
    os: detectOS(ua),
    osVersion: detectOSVersion(ua),
    screenWidth: typeof screen !== 'undefined' ? screen.width : 0,
    screenHeight: typeof screen !== 'undefined' ? screen.height : 0,
    userAgent: ua,
    deviceType: detectDeviceType(ua),
  }
}

function detectBrowser(ua: string): string {
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Edg')) return 'Edge'
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome'
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari'
  if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera'
  return 'Unknown'
}

function detectBrowserVersion(ua: string): string {
  const patterns: Array<[string, RegExp]> = [
    ['Firefox', /Firefox\/(\d+[\d.]*)/],
    ['Edge', /Edg\/(\d+[\d.]*)/],
    ['Chrome', /Chrome\/(\d+[\d.]*)/],
    ['Safari', /Version\/(\d+[\d.]*)/],
    ['Opera', /(?:Opera|OPR)\/(\d+[\d.]*)/],
  ]

  for (const [, regex] of patterns) {
    const match = ua.match(regex)
    if (match) return match[1]
  }

  return ''
}

function detectOS(ua: string): string {
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'macOS'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
  if (ua.includes('Linux')) return 'Linux'
  return 'Unknown'
}

function detectOSVersion(ua: string): string {
  const patterns: Array<[string, RegExp]> = [
    ['Windows', /Windows NT (\d+[\d.]*)/],
    ['macOS', /Mac OS X (\d+[_.\d]*)/],
    ['Android', /Android (\d+[\d.]*)/],
    ['iOS', /OS (\d+[_\d]*)/],
  ]

  for (const [, regex] of patterns) {
    const match = ua.match(regex)
    if (match) return match[1].replace(/_/g, '.')
  }

  return ''
}

function detectDeviceType(ua: string): string {
  if (/tablet|ipad/i.test(ua)) return 'tablet'
  if (/mobile|iphone|android(?!.*tablet)/i.test(ua)) return 'mobile'
  return 'desktop'
}
