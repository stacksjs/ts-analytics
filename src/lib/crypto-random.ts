/**
 * Cryptographically-secure random tokens.
 *
 * `Math.random()` is not a CSPRNG — its output is predictable, so anything that
 * must be unguessable (API keys, share tokens, ids used as capabilities) has to
 * come from `crypto.getRandomValues()`. Rejection sampling avoids the modulo
 * bias you'd get from `byte % charset.length`. (#130)
 */
const DEFAULT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** A random string of `length` chars drawn uniformly from `chars`. */
export function randomToken(length: number, chars: string = DEFAULT_CHARS): string {
  if (length <= 0)
    return ''
  // Largest multiple of charset length that fits in a byte; reject above it so
  // every character is equally likely.
  const limit = Math.floor(256 / chars.length) * chars.length
  let out = ''
  const buf = new Uint8Array(length * 2)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    for (let i = 0; i < buf.length && out.length < length; i++) {
      if (buf[i] < limit)
        out += chars[buf[i] % chars.length]
    }
  }
  return out
}
