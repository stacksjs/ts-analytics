/**
 * Authentication handlers
 *
 * Cookie-based session auth with DynamoDB storage.
 * Uses Bun.password (built-in bcrypt) for password hashing.
 */

import { dynamodb, TABLE_NAME, marshall, unmarshall } from '../lib/dynamodb'
import { htmlResponse, jsonResponse, errorResponse } from '../utils/response'
import { sendEmail, appBaseUrl } from '../lib/email'
import { getQueryParams } from '../../deploy/lambda-adapter'
import path from 'node:path'
import fs from 'node:fs'

// Session cookie config
const SESSION_COOKIE = 'session'
const SESSION_TTL_DAYS = 30

/**
 * Create a new user in DynamoDB
 */
async function createUser(email: string, password: string, name = ''): Promise<{ userId: string; email: string; name: string }> {
  const userId = crypto.randomUUID()
  const hash = await Bun.password.hash(password, 'argon2id')
  const now = new Date().toISOString()

  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `USER#${userId}`,
      sk: `USER#${userId}`,
      gsi1pk: `EMAIL#${email.toLowerCase()}`,
      gsi1sk: `USER#${userId}`,
      userId,
      email: email.toLowerCase(),
      name,
      passwordHash: hash,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    }),
  })

  return { userId, email: email.toLowerCase(), name }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Validate sign-up / credential input. Returns an error message, or null if valid. */
export function validateCredentials(email: string, password: string): string | null {
  if (!email || !password) return 'Email and password are required'
  if (!EMAIL_RE.test(email)) return 'Please enter a valid email address'
  if (password.length < 8) return 'Password must be at least 8 characters'
  return null
}

const SESSION_MAX_AGE = SESSION_TTL_DAYS * 86400

/** Build the session Set-Cookie header (Secure in production). */
function sessionCookie(token: string, maxAge: number = SESSION_MAX_AGE): string {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
  return `${SESSION_COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

/**
 * POST /api/auth/signup — create an account (JSON) and start a session.
 */
export async function handleSignup(request: Request): Promise<Response> {
  let body: { email?: string; password?: string; name?: string }
  try {
    body = await request.json() as typeof body
  }
catch {
    return errorResponse('Invalid request body', 400)
  }

  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''
  const name = (body.name || '').trim()

  const invalid = validateCredentials(email, password)
  if (invalid) return errorResponse(invalid, 400)

  const existing = await getUserByEmail(email)
  if (existing) return errorResponse('An account with this email already exists', 409)

  const user = await createUser(email, password, name)
  await sendVerificationEmail(user.userId, user.email)
  const token = await createSession(user.userId, user.email)

  return jsonResponse(
    { user: { userId: user.userId, email: user.email, name, emailVerified: false } },
    201,
    { 'Set-Cookie': sessionCookie(token) },
  )
}

/**
 * POST /api/auth/login — authenticate (JSON) and start a session.
 */
export async function handleAuthLogin(request: Request): Promise<Response> {
  let body: { email?: string; password?: string }
  try {
    body = await request.json() as typeof body
  }
catch {
    return errorResponse('Invalid request body', 400)
  }

  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''
  if (!email || !password) return errorResponse('Email and password are required', 400)

  if (await getLoginFailures(email) >= MAX_LOGIN_ATTEMPTS) {
    return errorResponse('Too many failed attempts. Please try again in a few minutes.', 429)
  }

  const user = await getUserByEmail(email)
  const ok = user ? await Bun.password.verify(password, user.passwordHash) : false
  if (!user || !ok) {
    await recordLoginFailure(email)
    return errorResponse('Invalid email or password', 401)
  }

  await clearLoginFailures(email)
  const token = await createSession(user.userId, user.email)
  return jsonResponse({ user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(token) })
}

/**
 * GET /api/auth/me — return the currently authenticated user.
 */
export async function handleMe(request: Request): Promise<Response> {
  const session = await getSessionFromRequest(request)
  if (!session) return errorResponse('Not authenticated', 401)
  const user = await getUserById(session.userId)
  if (!user) return errorResponse('Not authenticated', 401)
  return jsonResponse({ user: publicUser(user) })
}

/**
 * POST /api/auth/logout — destroy the session (JSON variant of /logout).
 */
export async function handleApiLogout(request: Request): Promise<Response> {
  const token = getSessionToken(request)
  if (token) {
    try {
      await deleteSession(token)
    }
catch {
      // best-effort
    }
  }
  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  })
}

/**
 * GET /api/auth/verify?token= — confirm an email address (single-use token).
 */
export async function handleVerifyEmail(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') || ''
  if (!token) return errorResponse('Missing token', 400)

  const userId = await consumeToken('VERIFY', token)
  if (!userId) return errorResponse('This verification link is invalid or has expired', 400)

  await updateUserFields(userId, { emailVerified: true })
  return new Response(null, { status: 302, headers: { Location: '/dashboard?verified=1' } })
}

/**
 * POST /api/auth/verify/resend — re-send the verification email (auth required).
 */
export async function handleResendVerification(request: Request): Promise<Response> {
  const session = await getSessionFromRequest(request)
  if (!session) return errorResponse('Not authenticated', 401)
  const user = await getUserById(session.userId)
  if (!user) return errorResponse('Not authenticated', 401)
  if (user.emailVerified) return jsonResponse({ ok: true, alreadyVerified: true })

  await sendVerificationEmail(user.userId, user.email)
  return jsonResponse({ ok: true })
}

/**
 * POST /api/auth/forgot — email a password-reset link. Always 200 (never
 * reveals whether an account exists).
 */
export async function handleForgotPassword(request: Request): Promise<Response> {
  let body: { email?: string }
  try {
    body = await request.json() as typeof body
  }
catch {
    return errorResponse('Invalid request body', 400)
  }

  const email = (body.email || '').trim().toLowerCase()
  if (email && EMAIL_RE.test(email)) {
    const user = await getUserByEmail(email)
    if (user) {
      const token = await createToken('RESET', user.userId, 3600)
      const link = `${appBaseUrl()}/reset-password?token=${token}`
      await sendEmail({
        to: email,
        subject: 'Reset your password',
        text: `Reset your password here:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request it, you can safely ignore this email.`,
      })
    }
  }

  return jsonResponse({ ok: true })
}

/**
 * POST /api/auth/reset — set a new password from a reset token, then sign out
 * every existing session.
 */
export async function handleResetPassword(request: Request): Promise<Response> {
  let body: { token?: string; password?: string }
  try {
    body = await request.json() as typeof body
  }
catch {
    return errorResponse('Invalid request body', 400)
  }

  const token = body.token || ''
  const password = body.password || ''
  if (!token) return errorResponse('Missing token', 400)
  if (password.length < 8) return errorResponse('Password must be at least 8 characters', 400)

  const userId = await consumeToken('RESET', token)
  if (!userId) return errorResponse('This reset link is invalid or has expired', 400)

  const hash = await Bun.password.hash(password, 'argon2id')
  await updateUserFields(userId, { passwordHash: hash })
  await invalidateUserSessions(userId)
  return jsonResponse({ ok: true })
}

/**
 * Look up a user by email using GSI1
 */
async function getUserByEmail(email: string): Promise<any | null> {
  const result = await dynamodb.query({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'gsi1pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `EMAIL#${email.toLowerCase()}` },
    },
  }) as { Items?: any[] }

  if (!result.Items || result.Items.length === 0) return null
  return unmarshall(result.Items[0])
}

/**
 * Look up a user by id
 */
async function getUserById(userId: string): Promise<any | null> {
  const result = await dynamodb.getItem({
    TableName: TABLE_NAME,
    Key: { pk: { S: `USER#${userId}` }, sk: { S: `USER#${userId}` } },
  })
  return result.Item ? unmarshall(result.Item) : null
}

/** Shape a user record for API responses (never leaks the password hash). */
function publicUser(u: any): { userId: string; email: string; name: string; emailVerified: boolean } {
  return { userId: u.userId, email: u.email, name: u.name || '', emailVerified: !!u.emailVerified }
}

/** Patch fields on a user record. */
async function updateUserFields(userId: string, fields: Record<string, string | boolean>): Promise<void> {
  const keys = Object.keys(fields)
  if (keys.length === 0) return
  const names: Record<string, string> = { '#u': 'updatedAt' }
  const values: Record<string, any> = marshall({ ':u': new Date().toISOString() })
  const sets: string[] = ['#u = :u']
  keys.forEach((k, i) => {
    names[`#k${i}`] = k
    Object.assign(values, marshall({ [`:v${i}`]: fields[k] }))
    sets.push(`#k${i} = :v${i}`)
  })
  await dynamodb.updateItem({
    TableName: TABLE_NAME,
    Key: { pk: { S: `USER#${userId}` }, sk: { S: `USER#${userId}` } },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  })
}

// ---- Single-use email tokens (verify / reset) ------------------------------
type TokenKind = 'VERIFY' | 'RESET'

async function createToken(kind: TokenKind, userId: string, ttlSec: number): Promise<string> {
  const token = crypto.randomUUID()
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `${kind}#${token}`,
      sk: `${kind}#${token}`,
      userId,
      kind,
      createdAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + ttlSec,
    }),
  })
  return token
}

/** Validate + consume a single-use token, returning its userId (or null). */
async function consumeToken(kind: TokenKind, token: string): Promise<string | null> {
  const r = await dynamodb.getItem({
    TableName: TABLE_NAME,
    Key: { pk: { S: `${kind}#${token}` }, sk: { S: `${kind}#${token}` } },
  })
  if (!r.Item) return null
  const item = unmarshall(r.Item)
  await dynamodb.deleteItem({
    TableName: TABLE_NAME,
    Key: { pk: { S: `${kind}#${token}` }, sk: { S: `${kind}#${token}` } },
  })
  if (item.ttl && item.ttl < Math.floor(Date.now() / 1000)) return null
  return item.userId || null
}

async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = await createToken('VERIFY', userId, 24 * 3600)
  const link = `${appBaseUrl()}/api/auth/verify?token=${token}`
  await sendEmail({
    to: email,
    subject: 'Verify your email',
    text: `Welcome to Analytics! Confirm your email address:\n\n${link}\n\nThis link expires in 24 hours.`,
  })
}

/**
 * Create a session in DynamoDB with TTL
 */
async function createSession(userId: string, email: string): Promise<string> {
  const token = crypto.randomUUID()
  const now = new Date()
  const ttl = Math.floor(now.getTime() / 1000) + (SESSION_TTL_DAYS * 86400)

  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `SESSION#${token}`,
      sk: `SESSION#${token}`,
      gsi1pk: `USER_SESSIONS#${userId}`,
      gsi1sk: `SESSION#${token}`,
      userId,
      email,
      createdAt: now.toISOString(),
      ttl,
    }),
  })

  return token
}

/** Delete every session for a user (password reset, log-out-everywhere). */
export async function invalidateUserSessions(userId: string): Promise<void> {
  const r = await dynamodb.query({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'gsi1pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: `USER_SESSIONS#${userId}` } },
  }) as { Items?: any[] }
  for (const raw of (r.Items || [])) {
    const s = unmarshall(raw)
    await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: { pk: { S: s.pk }, sk: { S: s.sk } } })
  }
}

/**
 * Get session data from DynamoDB
 */
async function getSession(token: string): Promise<{ userId: string; email: string } | null> {
  const result = await dynamodb.getItem({
    TableName: TABLE_NAME,
    Key: {
      pk: { S: `SESSION#${token}` },
      sk: { S: `SESSION#${token}` },
    },
  })

  if (!result.Item) return null

  const session = unmarshall(result.Item)

  // Check TTL manually (DynamoDB TTL can be delayed)
  if (session.ttl && session.ttl < Math.floor(Date.now() / 1000)) {
    await deleteSession(token)
    return null
  }

  return { userId: session.userId, email: session.email }
}

/**
 * Delete a session from DynamoDB
 */
async function deleteSession(token: string): Promise<void> {
  await dynamodb.deleteItem({
    TableName: TABLE_NAME,
    Key: {
      pk: { S: `SESSION#${token}` },
      sk: { S: `SESSION#${token}` },
    },
  })
}

// ---- Login throttling (brute-force protection) -----------------------------
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_WINDOW_SEC = 15 * 60

function failKey(email: string): { pk: { S: string }; sk: { S: string } } {
  return { pk: { S: `LOGINFAIL#${email}` }, sk: { S: `LOGINFAIL#${email}` } }
}

/** Failed-login count within the active window (0 if none/expired). */
export async function getLoginFailures(email: string): Promise<number> {
  const r = await dynamodb.getItem({ TableName: TABLE_NAME, Key: failKey(email) })
  if (!r.Item) return 0
  const item = unmarshall(r.Item)
  const now = Math.floor(Date.now() / 1000)
  if (!item.windowStart || now - item.windowStart >= LOGIN_WINDOW_SEC) return 0
  return item.count || 0
}

async function recordLoginFailure(email: string): Promise<void> {
  const r = await dynamodb.getItem({ TableName: TABLE_NAME, Key: failKey(email) })
  const now = Math.floor(Date.now() / 1000)
  let count = 1
  let windowStart = now
  if (r.Item) {
    const item = unmarshall(r.Item)
    if (item.windowStart && now - item.windowStart < LOGIN_WINDOW_SEC) {
      count = (item.count || 0) + 1
      windowStart = item.windowStart
    }
  }
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({ pk: `LOGINFAIL#${email}`, sk: `LOGINFAIL#${email}`, count, windowStart, ttl: windowStart + LOGIN_WINDOW_SEC }),
  })
}

async function clearLoginFailures(email: string): Promise<void> {
  try {
    await dynamodb.deleteItem({ TableName: TABLE_NAME, Key: failKey(email) })
  }
catch {
    // best-effort
  }
}

/**
 * Parse the session cookie from a request
 */
function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null

  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/)
  return match ? match[1] : null
}

/**
 * Get authenticated user from request, or null
 */
export async function getSessionFromRequest(request: Request): Promise<{ userId: string; email: string } | null> {
  const token = getSessionToken(request)
  if (!token) return null
  return getSession(token)
}

/**
 * Auth guard — returns user data or a redirect Response
 */
export async function requireAuth(request: Request): Promise<{ userId: string; email: string } | Response> {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login' },
    })
  }
  return session
}

/**
 * GET /login — render login page
 */
export async function handleLoginPage(request: Request): Promise<Response> {
  // If already authenticated, redirect to dashboard
  const session = await getSessionFromRequest(request)
  if (session) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/dashboard' },
    })
  }

  const query = getQueryParams(request)
  const error = query.error || ''

  // Try pre-built view first, then STX fallback
  const prebuiltPath = path.resolve(process.cwd(), 'dist/views/login.html')
  if (fs.existsSync(prebuiltPath)) {
    let html = await Bun.file(prebuiltPath).text()
    html = html.replace('{{__ERROR__}}', error)
    return htmlResponse(html)
  }

  // STX fallback for dev
  try {
    const { processDirectives, extractVariables, defaultConfig } = await import('@stacksjs/stx')
    const viewsDir = path.resolve(import.meta.dir, '../views')
    const templatePath = path.join(viewsDir, 'login.stx')
    const content = await Bun.file(templatePath).text()

    const scriptMatch = content.match(/<script\s+server\s*>([\s\S]*?)<\/script>/i)
    const scriptContent = scriptMatch ? scriptMatch[1] : ''
    let templateContent = scriptMatch
      ? content.replace(/<script\s+server\s*>[\s\S]*?<\/script>/i, '')
      : content

    templateContent = templateContent.replace(/<script\s+client\s*>/gi, '<script>')

    const context: Record<string, unknown> = {
      __filename: templatePath,
      __dirname: path.dirname(templatePath),
      props: { error },
      error,
    }

    if (scriptContent) {
      await extractVariables(scriptContent, context, templatePath)
    }

    const config = {
      ...defaultConfig,
      componentsDir: path.resolve(import.meta.dir, '../components'),
      layoutsDir: path.join(viewsDir, 'layouts'),
      partialsDir: path.join(viewsDir, 'partials'),
    }

    const html = await processDirectives(templateContent, context, templatePath, config, new Set())
    return htmlResponse(html)
  }
catch (e) {
    console.error('[auth] Failed to render login page:', e)
    return htmlResponse(loginFallbackHtml(error))
  }
}

/**
 * Fallback HTML if STX rendering fails
 */
function loginFallbackHtml(error: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — Analytics</title>
  <style>
    :root, [data-theme="dark"] {
      --bg: #0f1117; --bg2: #1a1d27; --bg3: #252830;
      --text: #e4e6eb; --text2: #8b8fa3; --border: #2d3040;
      --accent: #6366f1; --accent-hover: #5558e6;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .login-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 2.5rem; width: 100%; max-width: 400px; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .subtitle { color: var(--text2); font-size: 0.875rem; margin-bottom: 2rem; }
    .error { background: #3b1219; color: #f87171; border: 1px solid #5c2130; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-size: 0.875rem; }
    label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.375rem; color: var(--text2); }
    input { width: 100%; padding: 0.625rem 0.875rem; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.9375rem; outline: none; margin-bottom: 1.25rem; }
    input:focus { border-color: var(--accent); }
    button { width: 100%; padding: 0.75rem; background: var(--accent); color: white; border: none; border-radius: 8px; font-size: 0.9375rem; font-weight: 600; cursor: pointer; }
    button:hover { background: var(--accent-hover); }
  </style>
</head>
<body>
  <div class="login-card">
    <h1>Welcome back</h1>
    <p class="subtitle">Sign in to your analytics dashboard</p>
    ${error ? `<div class="error">${error === 'invalid' ? 'Invalid email or password' : error === 'missing' ? 'Please fill in all fields' : 'An error occurred'}</div>` : ''}
    <form method="POST" action="/login">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autocomplete="email" autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`
}

/**
 * POST /login — authenticate and create session
 */
export async function handleLogin(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get('content-type') || ''
    let email = ''
    let password = ''

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      email = (formData.get('email') as string || '').trim()
      password = formData.get('password') as string || ''
    }
else {
      const body = await request.json() as { email?: string; password?: string }
      email = (body.email || '').trim()
      password = body.password || ''
    }

    if (!email || !password) {
      return new Response(null, {
        status: 302,
        headers: { Location: '/login?error=missing' },
      })
    }

    if (await getLoginFailures(email) >= MAX_LOGIN_ATTEMPTS) {
      return new Response(null, {
        status: 302,
        headers: { Location: '/login?error=throttled' },
      })
    }

    const user = await getUserByEmail(email)
    if (!user) {
      await recordLoginFailure(email)
      return new Response(null, {
        status: 302,
        headers: { Location: '/login?error=invalid' },
      })
    }

    const valid = await Bun.password.verify(password, user.passwordHash)
    if (!valid) {
      await recordLoginFailure(email)
      return new Response(null, {
        status: 302,
        headers: { Location: '/login?error=invalid' },
      })
    }

    await clearLoginFailures(email)
    const token = await createSession(user.userId, user.email)
    const maxAge = SESSION_TTL_DAYS * 86400

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/dashboard',
        'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
      },
    })
  }
catch (error) {
    console.error('[auth] Login error:', error)
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?error=server' },
    })
  }
}

/**
 * POST /logout — destroy session and clear cookie
 */
export async function handleLogout(request: Request): Promise<Response> {
  const token = getSessionToken(request)
  if (token) {
    try {
      await deleteSession(token)
    }
catch (e) {
      console.error('[auth] Logout error:', e)
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login',
      'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    },
  })
}

/**
 * Assign unowned sites to the default admin user.
 * The user account is created out-of-band (not in source).
 */
export async function assignUnownedSites(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) return

  try {
    const admin = await getUserByEmail(adminEmail)
    if (!admin) {
      console.log(`[auth] Admin user ${adminEmail} not found, skipping site assignment`)
      return
    }

    const userId = admin.userId

    // Assign any unowned sites to admin
    const sitesResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: 'SITES' },
      },
    }) as { Items?: any[] }

    for (const raw of (sitesResult.Items || [])) {
      const site = unmarshall(raw)
      if (!site.ownerId) {
        await dynamodb.updateItem({
          TableName: TABLE_NAME,
          Key: {
            pk: { S: 'SITES' },
            sk: { S: site.sk },
          },
          UpdateExpression: 'SET ownerId = :ownerId, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk',
          ExpressionAttributeValues: {
            ':ownerId': { S: userId },
            ':gsi1pk': { S: `OWNER#${userId}` },
            ':gsi1sk': { S: site.sk },
          },
        })
        console.log(`[auth] Assigned site ${site.siteId || site.id} to ${adminEmail}`)
      }
    }
  }
catch (error) {
    console.error('[auth] Site assignment error:', error)
  }
}
