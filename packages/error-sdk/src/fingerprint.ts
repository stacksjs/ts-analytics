/**
 * Client-side error fingerprinting for deduplication.
 * Mirrors the server-side getErrorFingerprint from src/utils/errors.ts.
 */

export function generateFingerprint(message: string, stack?: string): string {
  const normalizedMessage = message
    .replace(/\d+/g, 'N')
    .replace(/0x[a-f0-9]+/gi, 'HEX')
    .replace(/[a-f0-9]{8,}/gi, 'HASH')
    .toLowerCase()

  const location = parseFirstStackFrame(stack)
  return simpleHash(`${normalizedMessage}@${location}`)
}

function parseFirstStackFrame(stack?: string): string {
  if (!stack) return 'unknown'

  const lines = stack.split('\n')
  for (const line of lines) {
    // Chrome/Edge: at functionName (file:line:column)
    const chromeMatch = line.match(/at\s+(?:.+?\s+)?\(?((?:https?:\/\/|file:\/\/)[^:]+):(\d+):\d+\)?/)
    if (chromeMatch) {
      return `${chromeMatch[1]}:${chromeMatch[2]}`
    }

    // Firefox: functionName@file:line:column
    const firefoxMatch = line.match(/^.+?@((?:https?:\/\/|file:\/\/)[^:]+):(\d+):\d+$/)
    if (firefoxMatch) {
      return `${firefoxMatch[1]}:${firefoxMatch[2]}`
    }
  }

  return 'unknown'
}

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0 // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36)
}
