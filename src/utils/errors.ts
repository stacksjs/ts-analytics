/**
 * Error handling utilities
 */

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
 * Categorize error by type/message
 */
export function categorizeError(message: string): string {
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
 * Get error severity based on type and frequency
 */
export function getErrorSeverity(category: string, count: number): 'low' | 'medium' | 'high' | 'critical' {
  // Critical categories
  if (['Security', 'Memory'].includes(category)) {
    return 'critical'
  }

  // High severity for common breaking errors
  if (['Type', 'Reference', 'Syntax'].includes(category)) {
    if (count > 100) return 'critical'
    if (count > 10) return 'high'
    return 'medium'
  }

  // Medium severity for network/timeout issues
  if (['Network', 'Timeout', 'CORS'].includes(category)) {
    if (count > 100) return 'high'
    return 'medium'
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

export function parseStackTrace(stack: string | undefined): StackFrame[] {
  if (!stack) return []

  const frames: StackFrame[] = []
  const lines = stack.split('\n')

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
export function getErrorFingerprint(message: string, stack: string | undefined): string {
  // Remove variable parts from message (numbers, hashes, etc)
  const normalizedMessage = message
    .replace(/\d+/g, 'N')
    .replace(/0x[a-f0-9]+/gi, 'HEX')
    .replace(/[a-f0-9]{8,}/gi, 'HASH')
    .toLowerCase()

  // Get first frame from stack for location
  const frames = parseStackTrace(stack)
  const firstFrame = frames[0]
  const location = firstFrame ? `${firstFrame.file}:${firstFrame.line}` : 'unknown'

  return `${normalizedMessage}@${location}`
}

/**
 * Check if error should be ignored (noise reduction)
 */
export function shouldIgnoreError(message: string): boolean {
  const ignorePatterns = [
    /^script error\.?$/i,
    /^resizeobserver loop/i,
    /^cancelled$/i,
    /^loading chunk \d+ failed/i,
    /^network error/i,
    /extension/i,
    /^null$/,
  ]

  return ignorePatterns.some(pattern => pattern.test(message))
}
