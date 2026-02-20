/**
 * Error handling utilities
 */

/**
 * Check if framework is a PHP framework
 */
function isPhpFramework(framework?: string): boolean {
  return framework === 'laravel'
}

/**
 * Escape HTML entities for safe output
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#039;',
  }
  return text.replace(/[&<>"']/g, m => map[m])
}

/**
 * Categorize JS/browser error by message
 */
function categorizeJsError(message: string): string {
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('network') || lowerMessage.includes('fetch') || lowerMessage.includes('xhr')) {
    return 'Network'
  }
  if (lowerMessage.includes('syntaxerror') || lowerMessage.includes('unexpected token')) {
    return 'Syntax'
  }
  if (lowerMessage.includes('typeerror') || lowerMessage.includes('is not a function') || lowerMessage.includes('undefined')) {
    return 'Type'
  }
  if (lowerMessage.includes('referenceerror') || lowerMessage.includes('is not defined')) {
    return 'Reference'
  }
  if (lowerMessage.includes('rangeerror') || lowerMessage.includes('maximum call stack')) {
    return 'Range'
  }
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return 'Timeout'
  }
  if (lowerMessage.includes('cors') || lowerMessage.includes('cross-origin')) {
    return 'CORS'
  }
  if (lowerMessage.includes('security') || lowerMessage.includes('csp')) {
    return 'Security'
  }
  if (lowerMessage.includes('memory') || lowerMessage.includes('out of memory')) {
    return 'Memory'
  }
  if (lowerMessage.includes('script error') || lowerMessage.includes('cross-origin script')) {
    return 'Third-party'
  }

  return 'Other'
}

/**
 * Categorize PHP error by exception type, then message fallback
 */
function categorizePhpError(message: string, type?: string): string {
  if (type) {
    const shortType = type.split('\\').pop() || type
    switch (shortType) {
      case 'PDOException':
      case 'QueryException':
        return 'Database'
      case 'AuthenticationException':
      case 'AuthorizationException':
      case 'TokenMismatchException':
        return 'Auth'
      case 'ValidationException':
        return 'Validation'
      case 'NotFoundHttpException':
        return 'HTTP 404'
      case 'MethodNotAllowedHttpException':
      case 'HttpException':
        return 'HTTP'
      case 'TypeError':
        return 'Type'
      case 'RuntimeException':
      case 'LogicException':
        return 'Runtime'
      case 'ParseError':
        return 'Syntax'
    }
  }

  const lowerMessage = message.toLowerCase()
  if (lowerMessage.includes('sqlstate') || lowerMessage.includes('pdo')) {
    return 'Database'
  }
  if (lowerMessage.includes('allowed memory size')) {
    return 'Memory'
  }
  if (lowerMessage.includes('maximum execution time')) {
    return 'Timeout'
  }
  if (lowerMessage.includes('view [') || lowerMessage.includes('blade')) {
    return 'View'
  }
  if (lowerMessage.includes('unauthenticated') || lowerMessage.includes('unauthorized') || lowerMessage.includes('token mismatch')) {
    return 'Auth'
  }
  if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
    return 'HTTP 404'
  }

  return 'Other'
}

/**
 * Categorize error by type/message
 */
export function categorizeError(message: string, type?: string, framework?: string): string {
  if (isPhpFramework(framework)) {
    return categorizePhpError(message, type)
  }
  return categorizeJsError(message)
}

/**
 * Get error severity based on type and frequency
 */
export function getErrorSeverity(category: string, count: number): 'low' | 'medium' | 'high' | 'critical' {
  // Critical categories
  if (['Security', 'Memory'].includes(category)) {
    return 'critical'
  }

  // High severity — breaking errors (JS + PHP Database)
  if (['Type', 'Reference', 'Syntax', 'Database'].includes(category)) {
    if (count > 100) return 'critical'
    if (count > 10) return 'high'
    if (category === 'Database') return 'high'
    return 'medium'
  }

  // Medium severity — network/timeout/runtime/auth/http/view
  if (['Network', 'Timeout', 'CORS', 'Auth', 'HTTP', 'Runtime', 'View'].includes(category)) {
    if (count > 100) return 'critical'
    if (count > 10) return 'high'
    return 'medium'
  }

  // Low severity — validation, HTTP 404
  if (['Validation', 'HTTP 404'].includes(category)) {
    if (count > 100) return 'medium'
    return 'low'
  }

  // Low severity by default
  if (count > 100) return 'medium'
  return 'low'
}

/**
 * Parse error stack trace to extract useful info
 */
export interface StackFrame {
  file: string
  line: number
  column: number
  function?: string
}

export function parseStackTrace(stack: string | undefined, framework?: string): StackFrame[] {
  if (!stack) return []

  const frames: StackFrame[] = []
  const lines = stack.split('\n')

  if (isPhpFramework(framework)) {
    for (const line of lines) {
      // PHP format: #0 /app/path.php(42): Class->method()
      const phpMatch = line.match(/^#\d+\s+(.+?)\((\d+)\):\s*(.+)$/)
      if (phpMatch) {
        frames.push({
          file: phpMatch[1],
          line: parseInt(phpMatch[2]),
          column: 0,
          function: phpMatch[3],
        })
      }
    }
    return frames
  }

  for (const line of lines) {
    // Chrome/Edge format: at functionName (file:line:column)
    const chromeMatch = line.match(/at\s+(?:(.+?)\s+)?\(?((?:https?:\/\/|file:\/\/)[^:]+):(\d+):(\d+)\)?/)
    if (chromeMatch) {
      frames.push({
        function: chromeMatch[1] || undefined,
        file: chromeMatch[2],
        line: parseInt(chromeMatch[3]),
        column: parseInt(chromeMatch[4]),
      })
      continue
    }

    // Firefox format: functionName@file:line:column
    const firefoxMatch = line.match(/^(.+)?@((?:https?:\/\/|file:\/\/)[^:]+):(\d+):(\d+)$/)
    if (firefoxMatch) {
      frames.push({
        function: firefoxMatch[1] || undefined,
        file: firefoxMatch[2],
        line: parseInt(firefoxMatch[3]),
        column: parseInt(firefoxMatch[4]),
      })
      continue
    }
  }

  return frames
}

/**
 * Group similar errors for deduplication
 */
export function getErrorFingerprint(message: string, stack: string | undefined, framework?: string): string {
  // Remove variable parts from message (numbers, hashes, etc)
  const normalizedMessage = message
    .replace(/\d+/g, 'N')
    .replace(/0x[a-f0-9]+/gi, 'HEX')
    .replace(/[a-f0-9]{8,}/gi, 'HASH')
    .toLowerCase()

  // Get first frame from stack for location
  const frames = parseStackTrace(stack, framework)
  const firstFrame = frames[0]
  const location = firstFrame ? `${firstFrame.file}:${firstFrame.line}` : 'unknown'

  return `${normalizedMessage}@${location}`
}

/**
 * Determine error trend based on timing and frequency
 */
export function getErrorTrend(firstSeen: string, lastSeen: string, count: number): 'new' | 'increasing' | 'decreasing' | 'stable' {
  const now = Date.now()
  const first = new Date(firstSeen).getTime()
  const last = new Date(lastSeen).getTime()
  const dayMs = 24 * 60 * 60 * 1000

  // New: first seen less than 24h ago
  if (now - first < dayMs) {
    return 'new'
  }

  // Decreasing: last seen more than 7 days ago
  if (now - last > 7 * dayMs) {
    return 'decreasing'
  }

  // Increasing: high rate (count per day > 10)
  const ageDays = Math.max(1, (now - first) / dayMs)
  if (count / ageDays > 10) {
    return 'increasing'
  }

  return 'stable'
}

/**
 * Check if error should be ignored (noise reduction)
 */
export function shouldIgnoreError(message: string, framework?: string): boolean {
  if (isPhpFramework(framework)) {
    const phpIgnorePatterns = [
      /^session store not set on request$/i,
      /^deprecated:/i,
      /deprecated\s+function/i,
      /undefined array key/i,
    ]
    return phpIgnorePatterns.some(pattern => pattern.test(message))
  }

  const jsIgnorePatterns = [
    /^script error\.?$/i,
    /^resizeobserver loop/i,
    /^cancelled$/i,
    /^loading chunk \d+ failed/i,
    /^network error/i,
    /extension/i,
    /^null$/,
  ]

  return jsIgnorePatterns.some(pattern => pattern.test(message))
}
