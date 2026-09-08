import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createSetupRegistry } from '@modules/setup/registry'
import { createSetupRoutes, isOwnerSession } from '@modules/setup/routes'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { generateId, sha256 } from '@shared/crypto'
import type { SetupRegistry } from '@modules/setup/types'

const testDb = createTestDb('setup-routes')
let db: ReturnType<typeof testDb.open>
let registry: SetupRegistry
let app: Hono

beforeEach(() => {
  db = testDb.open()
  registry = createSetupRegistry(db)

  registry.registerStep({
    id: 'root-owner',
    module: 'auth',
    title: 'Root Owner',
    description: 'Create admin account',
    required: true,
    order: 10,
    fields: [
      { name: 'username', type: 'text', label: 'Username', required: true },
      { name: 'password', type: 'password', label: 'Password', required: true },
    ],
    onComplete: async () => {},
  })

  registry.registerStep({
    id: 'optional-step',
    module: 'test',
    title: 'Optional Config',
    description: 'Something optional',
    required: false,
    order: 20,
    fields: [
      { name: 'value', type: 'text', label: 'Value', required: false },
    ],
    onComplete: async () => {},
  })

  app = new Hono()
  app.onError(errorHandler)
  createSetupRoutes(app, registry, db)
})

afterEach(() => {
  testDb.cleanup()
})

describe('GET /api/v1/setup/status', () => {
  it('returns incomplete status', async () => {
    const res = await app.request('/api/v1/setup/status')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.complete).toBe(false)
    expect(body.totalSteps).toBe(2)
    expect(body.completedSteps).toBe(0)
    expect(body.currentStep).toBe('root-owner')
  })

  it('returns complete status after all required steps done', async () => {
    await registry.completeStep('root-owner', { username: 'admin', password: 'test12345' })
    const res = await app.request('/api/v1/setup/status')
    const body = await res.json() as any
    expect(body.complete).toBe(true)
    expect(body.completedSteps).toBe(1)
  })
})

describe('GET /api/v1/setup/steps', () => {
  it('returns all steps with fields', async () => {
    const res = await app.request('/api/v1/setup/steps')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.steps).toHaveLength(2)
    expect(body.steps[0].id).toBe('root-owner')
    expect(body.steps[0].fields).toHaveLength(2)
    expect(body.steps[1].id).toBe('optional-step')
  })
})

describe('GET /api/v1/setup/steps/:id', () => {
  it('returns a single step', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.id).toBe('root-owner')
  })

  it('returns 404 for unknown step', async () => {
    const res = await app.request('/api/v1/setup/steps/unknown')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/setup/steps/:id', () => {
  it('completes a step', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'securepass1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.status).toBe('completed')
  })

  it('returns 400 when required field is missing', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 500 when onComplete throws', async () => {
    registry.registerStep({
      id: 'failing-step',
      module: 'test',
      title: 'Fail',
      description: 'This will fail',
      required: false,
      order: 30,
      fields: [{ name: 'x', type: 'text', label: 'X', required: true }],
      onComplete: async () => { throw new Error('Boom') },
    })
    const res = await app.request('/api/v1/setup/steps/failing-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 'test' }),
    })
    expect(res.status).toBe(500)
  })

  it('allows optional step POST while setup is still incomplete', async () => {
    // Optional step is completable as long as required steps remain pending
    // (setup not yet complete, so the wizard is still in progress).
    const res = await app.request('/api/v1/setup/steps/optional-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'test' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.status).toBe('completed')
  })

  it('rejects optional-step write once setup is complete (fail closed)', async () => {
    // Completing the only required step flips isComplete() to true. Any optional
    // step left 'pending' must NOT stay unauthenticated-writable on a live system.
    await registry.completeStep('root-owner', { username: 'admin', password: 'test12345' })
    expect(registry.isComplete()).toBe(true)
    const res = await app.request('/api/v1/setup/steps/optional-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'attacker' }),
    })
    expect(res.status).toBe(404)
    // The pending optional step must remain untouched
    expect(registry.getStep('optional-step')?.status).toBe('pending')
  })

  it('rejects optional-step skip once setup is complete (fail closed)', async () => {
    await registry.completeStep('root-owner', { username: 'admin', password: 'test12345' })
    const res = await app.request('/api/v1/setup/steps/optional-step/skip', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 for already completed step', async () => {
    await registry.completeStep('root-owner', { username: 'admin', password: 'test12345' })
    // Try to POST to already completed step
    const res = await app.request('/api/v1/setup/steps/root-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test12345' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/setup/steps/:id/skip', () => {
  it('skips an optional step', async () => {
    const res = await app.request('/api/v1/setup/steps/optional-step/skip', {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.status).toBe('skipped')
  })

  it('returns 403 when skipping a required step', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner/skip', {
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })
})

async function addSession(db: any, userId: string, token: string, expiresAt: string) {
  db.run(sql`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (${generateId()}, ${userId}, ${await sha256(token)}, ${expiresAt}, ${new Date().toISOString()})`)
}
const inHour = () => new Date(Date.now() + 3600_000).toISOString()
const anHourAgo = () => new Date(Date.now() - 3600_000).toISOString()

describe('isOwnerSession', () => {
  it('returns false without a token', async () => {
    expect(await isOwnerSession(db, undefined)).toBe(false)
  })

  it('returns true for an active owner session', async () => {
    const uid = await insertTestOwner(db, 'owner1', 'pw1234567')
    await addSession(db, uid, 'tok-owner', inHour())
    expect(await isOwnerSession(db, 'tok-owner')).toBe(true)
  })

  it('returns false for an expired session', async () => {
    const uid = await insertTestOwner(db, 'owner2', 'pw1234567')
    await addSession(db, uid, 'tok-exp', anHourAgo())
    expect(await isOwnerSession(db, 'tok-exp')).toBe(false)
  })

  it('returns false for an unknown token', async () => {
    expect(await isOwnerSession(db, 'no-such-token')).toBe(false)
  })

  it('returns false for a non-owner (role user) session', async () => {
    const uid = generateId()
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
      VALUES (${uid}, 'joe', 'Joe', 'x', 'user', 0, 0, 'active', ${now}, ${now})`)
    await addSession(db, uid, 'tok-user', inHour())
    expect(await isOwnerSession(db, 'tok-user')).toBe(false)
  })

  it('returns false for a suspended owner', async () => {
    const uid = generateId()
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
      VALUES (${uid}, 'susp', 'Susp', 'x', 'owner', 1, 0, 'suspended', ${now}, ${now})`)
    await addSession(db, uid, 'tok-susp', inHour())
    expect(await isOwnerSession(db, 'tok-susp')).toBe(false)
  })
})

describe('POST optional step once complete — owner auth gate', () => {
  it('allows an authenticated owner with the CSRF header', async () => {
    const uid = await insertTestOwner(db, 'owner-mw', 'pw1234567')
    await addSession(db, uid, 'mwtok', inHour())
    await registry.completeStep('root-owner', { username: 'admin', password: 'test12345' })
    expect(registry.isComplete()).toBe(true)

    const res = await app.request('/api/v1/setup/steps/optional-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Eyas-Request': '1', Cookie: 'eyas_session=mwtok' },
      body: JSON.stringify({ value: 'ok' }),
    })
    expect(res.status).toBe(200)
    expect(registry.getStep('optional-step')?.status).toBe('completed')
  })

  it('rejects an owner cookie without the CSRF header (404)', async () => {
    const uid = await insertTestOwner(db, 'owner-csrf', 'pw1234567')
    await addSession(db, uid, 'csrftok', inHour())
    await registry.completeStep('root-owner', { username: 'admin', password: 'test12345' })

    const res = await app.request('/api/v1/setup/steps/optional-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'eyas_session=csrftok' },
      body: JSON.stringify({ value: 'x' }),
    })
    expect(res.status).toBe(404)
    expect(registry.getStep('optional-step')?.status).toBe('pending')
  })

  it('rejects a non-owner session even with the CSRF header (404)', async () => {
    const uid = generateId()
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
      VALUES (${uid}, 'eve', 'Eve', 'x', 'user', 0, 0, 'active', ${now}, ${now})`)
    await addSession(db, uid, 'evetok', inHour())
    await registry.completeStep('root-owner', { username: 'admin', password: 'test12345' })

    const res = await app.request('/api/v1/setup/steps/optional-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Eyas-Request': '1', Cookie: 'eyas_session=evetok' },
      body: JSON.stringify({ value: 'x' }),
    })
    expect(res.status).toBe(404)
    expect(registry.getStep('optional-step')?.status).toBe('pending')
  })
})
