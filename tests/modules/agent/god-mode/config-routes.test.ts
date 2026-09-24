// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../../helpers/test-db'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { createGodModeStore } from '@modules/agent/god-mode/store'
import { createGodModeRoutes } from '@modules/agent/god-mode/routes'

const testDb = createTestDb('god-mode-config-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let ownerToken: string

const three = {
  participants: [
    { id: 'a', providerId: 'anthropic', modelId: 'claude' },
    { id: 'b', providerId: 'xai', modelId: 'grok' },
    { id: 'c', providerId: 'openai', modelId: 'gpt' },
  ],
  chairParticipantId: 'a',
}

const liveKeys = new Set(['anthropic/claude', 'xai/grok', 'openai/gpt'])

beforeEach(async () => {
  db = testDb.open()
  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

  app = new Hono()
  app.onError(errorHandler)
  createAuthRoutes(app, {
    db,
    registry: permRegistry,
    tokenService,
    sessionDuration: 86400,
    accessTokenDuration: 900,
    refreshTokenDuration: 2592000,
  })
  createGodModeRoutes(app, createGodModeStore(db), {
    getLimits: () => ({ min: 2, max: 5 }),
    getLiveKeys: () => liveKeys,
  })

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => { testDb.cleanup() })

function authHeaders(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${ownerToken}`, ...extra }
}

describe('GET /api/v1/god-mode/config', () => {
  it('returns the default empty roster when no row exists', async () => {
    const res = await app.request('/api/v1/god-mode/config', {
      headers: authHeaders(),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.participants).toEqual([])
    expect(body.chairParticipantId).toBeNull()
    expect(body.costCeilingUsd).toBeNull()
    expect(body.workspaceRetentionHours).toBe(72)
    expect(typeof body.updatedAt).toBe('string')
    expect(body.limits).toEqual({ min: 2, max: 5 })
  })
})

describe('PUT /api/v1/god-mode/config', () => {
  it('saves a 3-model roster', async () => {
    const res = await app.request('/api/v1/god-mode/config', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(three),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.participants).toHaveLength(3)
    expect(body.chairParticipantId).toBe('a')
    expect(body.limits).toEqual({ min: 2, max: 5 })
  })

  it('rejects an even roster without a chair', async () => {
    const res = await app.request('/api/v1/god-mode/config', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        participants: three.participants.slice(0, 2),
        chairParticipantId: null,
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toMatch(/chair/i)
  })

  it('requires authentication', async () => {
    const res = await app.request('/api/v1/god-mode/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(three),
    })
    expect([401, 403]).toContain(res.status)
  })
})
