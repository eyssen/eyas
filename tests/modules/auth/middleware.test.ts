import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware, csrfProtection } from '@modules/auth/middleware'
import { errorHandler } from '@core/http/middleware/error-handler'

const mockVerifyAccessToken = vi.fn()
const mockFindSessionByHash = vi.fn()
const mockFindApiKeyByHash = vi.fn()
const mockFindUserById = vi.fn()
const mockBuildAbility = vi.fn()

function createTestApp() {
  const authenticate = createAuthMiddleware({
    verifyAccessToken: mockVerifyAccessToken,
    findSessionByHash: mockFindSessionByHash,
    findApiKeyByHash: mockFindApiKeyByHash,
    findUserById: mockFindUserById,
    buildAbilityForUser: mockBuildAbility,
  })
  const app = new Hono()
  app.onError(errorHandler)
  app.get('/protected', authenticate, (c: any) => {
    return c.json({ userId: c.get('userId'), role: c.get('role') })
  })
  return app
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no auth is provided', async () => {
    const app = createTestApp()
    const res = await app.request('/protected')
    expect(res.status).toBe(401)
  })

  it('authenticates via JWT bearer token', async () => {
    mockVerifyAccessToken.mockResolvedValue({ sub: 'user-1', role: 'owner' })
    mockFindUserById.mockResolvedValue({ id: 'user-1', role: 'owner', status: 'active' })
    mockBuildAbility.mockReturnValue({ can: () => true })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer jwt-placeholder-header.payload.signature' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.userId).toBe('user-1')
    expect(body.role).toBe('owner')
  })

  it('rejects suspended user via JWT', async () => {
    mockVerifyAccessToken.mockResolvedValue({ sub: 'user-5', role: 'user' })
    mockFindUserById.mockResolvedValue({ id: 'user-5', role: 'user', status: 'suspended' })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer jwt-placeholder-header.payload.signature' },
    })
    expect(res.status).toBe(403)
  })

  it('authenticates via API key', async () => {
    mockFindApiKeyByHash.mockResolvedValue({ userId: 'user-2' })
    mockFindUserById.mockResolvedValue({ id: 'user-2', role: 'agent', status: 'active' })
    mockBuildAbility.mockReturnValue({ can: () => true })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer eyas_k1_abcdef1234567890abcdef1234567890' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.userId).toBe('user-2')
  })

  it('authenticates via session cookie', async () => {
    mockFindSessionByHash.mockResolvedValue({ userId: 'user-3', expiresAt: new Date(Date.now() + 86400000).toISOString() })
    mockFindUserById.mockResolvedValue({ id: 'user-3', role: 'owner', status: 'active' })
    mockBuildAbility.mockReturnValue({ can: () => true })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Cookie: 'eyas_session=some-session-token' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.userId).toBe('user-3')
  })

  it('rejects expired session', async () => {
    mockFindSessionByHash.mockResolvedValue({ userId: 'user-3', expiresAt: new Date(Date.now() - 1000).toISOString() })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Cookie: 'eyas_session=expired-token' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects suspended user', async () => {
    mockFindApiKeyByHash.mockResolvedValue({ userId: 'user-4' })
    mockFindUserById.mockResolvedValue({ id: 'user-4', role: 'agent', status: 'suspended' })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer eyas_k1_abcdef1234567890abcdef1234567890' },
    })
    expect(res.status).toBe(403)
  })
})

describe('csrfProtection middleware', () => {
  it('allows GET requests without header', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', csrfProtection)
    app.get('/test', (c) => c.json({ ok: true }))
    const res = await app.request('/test')
    expect(res.status).toBe(200)
  })

  it('blocks POST without X-Eyas-Request header when cookie is present', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', csrfProtection)
    app.post('/test', (c) => c.json({ ok: true }))
    const res = await app.request('/test', {
      method: 'POST',
      headers: { Cookie: 'eyas_session=abc', 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  it('allows POST with X-Eyas-Request header', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', csrfProtection)
    app.post('/test', (c) => c.json({ ok: true }))
    const res = await app.request('/test', {
      method: 'POST',
      headers: { Cookie: 'eyas_session=abc', 'X-Eyas-Request': '1', 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
  })

  it('allows POST without cookie (API auth, no CSRF needed)', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', csrfProtection)
    app.post('/test', (c) => c.json({ ok: true }))
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
  })
})
