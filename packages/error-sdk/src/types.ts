export interface ErrorTrackerConfig {
  /** API key with error-tracking permission (ak_...) */
  token: string
  /** Analytics endpoint URL (e.g. https://analytics.example.com) */
  endpoint: string
  /** Environment name (defaults to 'production') */
  environment?: string
  /** Maximum breadcrumbs to keep (defaults to 20) */
  maxBreadcrumbs?: number
  /** Error message patterns to ignore (string or RegExp) */
  ignoreErrors?: Array<string | RegExp>
  /** Callback before sending — return false to suppress */
  beforeSend?: (report: ErrorReport) => ErrorReport | false
  /** Capture console.error calls as errors (defaults to false) */
  captureConsoleErrors?: boolean
  /** Capture unhandled promise rejections (defaults to true) */
  captureUnhandledRejections?: boolean
  /** Custom tags attached to every error */
  tags?: Record<string, string>
  /** User context */
  user?: UserContext
  /** Framework identifier (auto-set by Vue/Nuxt plugins) */
  framework?: string
}

export interface UserContext {
  id?: string
  email?: string
  name?: string
}

export interface ErrorReport {
  message: string
  type: string
  stack?: string
  source?: string
  line?: number
  col?: number
  fingerprint: string
  url: string
  userAgent: string
  browser: string
  browserVersion: string
  os: string
  osVersion: string
  screenWidth: number
  screenHeight: number
  framework: string
  sdkVersion: string
  environment: string
  tags: Record<string, string>
  breadcrumbs: Breadcrumb[]
  timestamp: string
  user?: UserContext
  componentName?: string
  lifecycle?: string
  deviceType?: string
}

export interface Breadcrumb {
  type: 'error' | 'navigation' | 'ui' | 'console' | 'http' | 'custom'
  category: string
  message: string
  data?: Record<string, any>
  timestamp: string
}
