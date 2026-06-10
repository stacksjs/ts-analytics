/**
 * OAuth/SSO sign-in — Google + GitHub (#53).
 *
 * Standard authorization-code flow, linking to the existing USER# accounts by
 * verified email (created on first login). Email/password stays primary.
 *
 * Configuration (per provider; the start endpoint 503s when unset):
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
 * The provider app's callback URL must be
 *   {APP_BASE_URL}/api/auth/oauth/{provider}/callback
 *
 * CSRF: each start mints a single-use state record (OAUTH#{state}, 10min TTL)
 * that the callback consumes; a mismatched or replayed state is rejected.
 */
import { dynamodb, TABLE_NAME, marshall, unmarshall } from '../lib/dynamodb'
import { jsonResponse, errorResponse } from '../utils/response'
import { getUserByEmail, createOAuthUser, createSession, sessionCookie, updateUserFields } from './auth'
import { acceptInvites } from '../lib/membership'
import { appBaseUrl } from '../lib/email'

export type OAuthProvider = 'google' | 'github'

interface ProviderConfig {
  authorizeUrl: string
  tokenUrl: string
  scope: string
  clientId: string
  clientSecret: string
}

/** Provider endpoints + credentials; null when the env credentials are unset. */
export function providerConfig(provider: string): ProviderConfig | null {
  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID || ''
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
    if (!clientId || !clientSecret)
      return null
    return {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
      clientId,
      clientSecret,
    }
  }
  if (provider === 'github') {
    const clientId = process.env.GITHUB_CLIENT_ID || ''
    const clientSecret = process.env.GITHUB_CLIENT_SECRET || ''
    if (!clientId || !clientSecret)
      return null
    return {
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scope: 'read:user user:email',
      clientId,
      clientSecret,
    }
  }
  return null
}

/** The authorize redirect URL. Pure — unit tested. */
export function buildAuthorizeUrl(cfg: Pick<ProviderConfig, 'authorizeUrl' | 'clientId' | 'scope'>, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scope,
    state,
  })
  return `${cfg.authorizeUrl}?${params}`
}

function redirectUriFor(provider: string): string {
  return `${appBaseUrl()}/api/auth/oauth/${provider}/callback`
}

// ── Single-use CSRF state ───────────────────────────────────────────────────
async function createState(provider: string): Promise<string> {
  const state = crypto.randomUUID()
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `OAUTH#${state}`,
      sk: `OAUTH#${state}`,
      provider,
      ttl: Math.floor(Date.now() / 1000) + 600,
    }),
  })
  return state
}

async function consumeState(state: string): Promise<string | null> {
  const key = { pk: { S: `OAUTH#${state}` }, sk: { S: `OAUTH#${state}` } }
  const r = await dynamodb.getItem({ TableName: TABLE_NAME, Key: key })
  if (!r.Item)
    return null
  await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: key })
  const item = unmarshall(r.Item)
  if (item.ttl && item.ttl < Math.floor(Date.now() / 1000))
    return null
  return item.provider || null
}

// ── Handlers ────────────────────────────────────────────────────────────────

/** GET /api/auth/oauth/{provider} — redirect to the provider's consent page. */
export async function handleOAuthStart(_request: Request, provider: string): Promise<Response> {
  const cfg = providerConfig(provider)
  if (!cfg) {
    return jsonResponse({ error: `${provider} sign-in is not configured on this server` }, 503)
  }
  const state = await createState(provider)
  const url = buildAuthorizeUrl(cfg, redirectUriFor(provider), state)
  return new Response(null, { status: 302, headers: { Location: url } })
}

interface OAuthProfile {
  email: string
  emailVerified: boolean
  name: string
  providerId: string
}

async function exchangeCode(cfg: ProviderConfig, provider: string, code: string): Promise<string | null> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUriFor(provider),
    }),
  })
  if (!res.ok)
    return null
  const data = await res.json() as { access_token?: string }
  return data.access_token || null
}

async function fetchProfile(provider: string, accessToken: string): Promise<OAuthProfile | null> {
  const auth = { Authorization: `Bearer ${accessToken}` }
  if (provider === 'google') {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: auth })
    if (!res.ok)
      return null
    const p = await res.json() as { sub?: string, email?: string, email_verified?: boolean, name?: string }
    if (!p.email)
      return null
    return { email: p.email, emailVerified: !!p.email_verified, name: p.name || '', providerId: String(p.sub || '') }
  }
  if (provider === 'github') {
    const res = await fetch('https://api.github.com/user', { headers: { ...auth, 'User-Agent': 'ts-analytics' } })
    if (!res.ok)
      return null
    const p = await res.json() as { id?: number, name?: string, login?: string, email?: string | null }
    let email = p.email || ''
    let verified = false
    const emailsRes = await fetch('https://api.github.com/user/emails', { headers: { ...auth, 'User-Agent': 'ts-analytics' } })
    if (emailsRes.ok) {
      const emails = await emailsRes.json() as Array<{ email: string, primary: boolean, verified: boolean }>
      const primary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified)
      if (primary) {
        email = primary.email
        verified = true
      }
    }
    if (!email)
      return null
    return { email, emailVerified: verified, name: p.name || p.login || '', providerId: String(p.id || '') }
  }
  return null
}

function loginRedirect(reason: string): Response {
  return new Response(null, { status: 302, headers: { Location: `/login?error=${encodeURIComponent(reason)}` } })
}

/** GET /api/auth/oauth/{provider}/callback — exchange, link/create, sign in. */
export async function handleOAuthCallback(request: Request, provider: string): Promise<Response> {
  try {
    const cfg = providerConfig(provider)
    if (!cfg)
      return jsonResponse({ error: `${provider} sign-in is not configured on this server` }, 503)

    const url = new URL(request.url)
    const code = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    if (!code || !state)
      return loginRedirect('oauth')

    const stateProvider = await consumeState(state)
    if (stateProvider !== provider)
      return loginRedirect('oauth')

    const accessToken = await exchangeCode(cfg, provider, code)
    if (!accessToken)
      return loginRedirect('oauth')

    const profile = await fetchProfile(provider, accessToken)
    if (!profile)
      return loginRedirect('oauth')

    // Only trust provider-verified emails to link to an existing account —
    // otherwise an attacker could claim someone's address on the provider and
    // take over their account here.
    let user = await getUserByEmail(profile.email)
    if (user && !profile.emailVerified)
      return loginRedirect('oauth-unverified-email')

    if (!user) {
      const created = await createOAuthUser(profile.email, profile.name, profile.emailVerified)
      await acceptInvites(created.userId, created.email)
      user = { userId: created.userId, email: created.email }
    }

    // Record the provider link (idempotent) so the account shows how it signs in.
    await updateUserFields(user.userId, { [`${provider}Id`]: profile.providerId, updatedAt: new Date().toISOString() })

    const token = await createSession(user.userId, user.email)
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/dashboard', 'Set-Cookie': sessionCookie(token) },
    })
  }
  catch (error) {
    console.error('OAuth callback error:', error)
    return errorResponse('OAuth sign-in failed')
  }
}
