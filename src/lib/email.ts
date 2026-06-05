/**
 * Pluggable transactional email sender.
 *
 * Until a real provider (SES/SMTP/Resend) is configured via env, emails are
 * logged to the server console so verification / reset links are usable in
 * development. Wire a provider in `deliver()` for production.
 */

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

/** Base URL used to build links in emails (falls back to localhost in dev). */
export function appBaseUrl(): string {
  return process.env.ANALYTICS_APP_URL || process.env.STX_PUBLIC_API_ENDPOINT || 'http://localhost:3000'
}

async function deliver(msg: EmailMessage): Promise<void> {
  // TODO: plug a real provider here (SES via @aws-sdk/client-ses, SMTP, Resend…)
  // when ANALYTICS_EMAIL_PROVIDER is configured. Until then, log so dev works.
  console.log(`[email] to=${msg.to} | ${msg.subject}\n${msg.text}\n`)
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  try {
    await deliver(msg)
  }
catch (e) {
    console.error('[email] delivery failed:', (e as Error).message)
  }
}
