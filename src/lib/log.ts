/**
 * Leveled logger (#175). JSON lines in production (parseable by CloudWatch /
 * any log shipper), human-readable in dev. `debug` is emitted only when
 * ANALYTICS_DEBUG=true. Use instead of bare console.* in operational paths so
 * failures are queryable (level, event, fields) rather than prose.
 */

type Fields = Record<string, unknown>

const JSON_LOGS: boolean = process.env.LOG_FORMAT === 'json'
  || (process.env.NODE_ENV === 'production' && process.env.LOG_FORMAT !== 'pretty')

function emit(level: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Fields): void {
  if (level === 'debug' && process.env.ANALYTICS_DEBUG !== 'true')
    return
  if (JSON_LOGS) {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }))
    return
  }
  const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : ''
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](`[${event}]${suffix}`)
}

export const log: {
  debug: (event: string, fields?: Fields) => void
  info: (event: string, fields?: Fields) => void
  warn: (event: string, fields?: Fields) => void
  error: (event: string, fields?: Fields) => void
} = {
  debug: (event, fields) => emit('debug', event, fields),
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
}
