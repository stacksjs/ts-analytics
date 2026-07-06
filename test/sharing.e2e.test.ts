/**
 * Shared dashboards (#152): mint → public resolve → token-scoped reads
 * through the auth guard, whitelist enforcement, passwords, expiry, revoke.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { handleCreateShareLink, handleGetSharedDashboard, handleListShareLinks, handleRevokeShareLink, clearShareTokenCache } from '../src/handlers/sharing'
import { siteAuthGuard } from '../src/handlers/authz'
import { dynamodb, TABLE_NAME, marshall } from '../src/lib/dynamodb'

const SITE = `sharesite${Math.random().toString(36).slice(2, 8)}`
let token = ''
let pwToken = ''

async function mint(body: Record<string, unknown> = {}): Promise<any> {
  const res = await handleCreateShareLink(new Request(`http://l/api/sites/${SITE}/share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), SITE)
  expect(res.status).toBe(201)
  return (await res.json()).shareLink
}

// Guard behavior needs enforcement ON (the harness default is off).
beforeAll(async () => {
  process.env.ANALYTICS_REQUIRE_AUTH = 'true'
  await dynamodb.putItem({
    TableName: TABLE_NAME,
    Item: marshall({ pk: 'SITES', sk: `SITE#${SITE}`, id: SITE, siteId: SITE, name: 'Share Test Site', domains: [] }),
  })
})
afterAll(() => {
  process.env.ANALYTICS_REQUIRE_AUTH = 'false'
})

const guard = (path: string, headers: Record<string, string> = {}): Promise<Response | null> =>
  siteAuthGuard(new Request(`http://l${path}`, { headers }))

describe('share links (#152)', () => {
  it('mints, lists, and resolves a link (with the site name)', async () => {
    token = (await mint()).token
    expect(token.length).toBeGreaterThanOrEqual(16)

    const list = await (await handleListShareLinks(new Request('http://l'), SITE)).json()
    expect(list.links.length).toBe(1)
    expect(list.links[0].token).toBe(token)

    const pub = await (await handleGetSharedDashboard(new Request(`http://l/api/share/${token}`), token)).json()
    expect(pub.valid).toBe(true)
    expect(pub.siteId).toBe(SITE)
    expect(pub.siteName).toBe('Share Test Site')
  })

  it('token grants read access to aggregate endpoints through the guard', async () => {
    expect(await guard(`/api/sites/${SITE}/stats?share=${token}`)).toBeNull()
    expect(await guard(`/api/sites/${SITE}/pages`, { 'X-Share-Token': token })).toBeNull()
    expect(await guard(`/api/p/${SITE}/summary?share=${token}`)).toBeNull() // stealth alias
  })

  it('token does NOT grant access outside the whitelist or without it', async () => {
    const denied = await guard(`/api/sites/${SITE}/api-keys?share=${token}`)
    expect(denied?.status).toBe(401)
    const sessions = await guard(`/api/sites/${SITE}/sessions?share=${token}`)
    expect(sessions?.status).toBe(401)
    const bare = await guard(`/api/sites/${SITE}/stats`)
    expect(bare?.status).toBe(401)
    const wrongSite = await guard(`/api/sites/OTHERSITE/stats?share=${token}`)
    expect(wrongSite?.status).toBe(401)
  })

  it('password-protected links require the password end to end', async () => {
    pwToken = (await mint({ password: 'hunter2' })).token
    clearShareTokenCache()

    const noPw = await handleGetSharedDashboard(new Request(`http://l/api/share/${pwToken}`), pwToken)
    expect(noPw.status).toBe(401)
    expect((await noPw.json()).requiresPassword).toBe(true)

    const okPw = await handleGetSharedDashboard(new Request(`http://l/api/share/${pwToken}?password=hunter2`), pwToken)
    expect(okPw.status).toBe(200)

    expect((await guard(`/api/sites/${SITE}/stats?share=${pwToken}`))?.status).toBe(401)
    expect(await guard(`/api/sites/${SITE}/stats?share=${pwToken}&share_pw=hunter2`)).toBeNull()
  })

  it('expired links stop working', async () => {
    const expired = (await mint({ expiresAt: new Date(Date.now() - 60_000).toISOString() })).token
    clearShareTokenCache()
    const res = await handleGetSharedDashboard(new Request(`http://l/api/share/${expired}`), expired)
    expect([404, 410]).toContain(res.status)
    expect((await guard(`/api/sites/${SITE}/stats?share=${expired}`))?.status).toBe(401)
  })

  it('revoked links stop working immediately', async () => {
    const res = await handleRevokeShareLink(new Request('http://l', { method: 'DELETE' }), SITE, token)
    expect(res.status).toBe(200)
    clearShareTokenCache()
    expect((await guard(`/api/sites/${SITE}/stats?share=${token}`))?.status).toBe(401)
    const list = await (await handleListShareLinks(new Request('http://l'), SITE)).json()
    expect(list.links.find((l: any) => l.token === token)).toBeUndefined()
  })
})
