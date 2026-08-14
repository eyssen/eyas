import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createA2ATaskStore, registerA2ARoutes } from '@modules/communication/submodules/a2a/server'
import { generateAgentCard, DEFAULT_SKILLS } from '@modules/communication/submodules/a2a/agent-card'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { getVersion } from '@core/version'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'
import { sql } from 'drizzle-orm'
import pino from 'pino'

const logger = pino({ level: 'silent' })
const testDb = createTestDb('a2a-server')
let db: ReturnType<typeof testDb.open>
let app: Hono
let ownerToken: string
let authMiddleware: any
let taskStore: ReturnType<typeof createA2ATaskStore>
// Controllable executor for the default app. Default keeps the task 'running'
// (does not resolve to a terminal state) so tasks/get + tasks/cancel have a
// cancellable, in-flight task to work with.
let executorImpl: (task: { id: string; description: string; skill?: string }) => Promise<void>
const noopExecutor = async () => { /* leaves the task 'running' */ }

const auth = () => ({ Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' })

function rpc(method: string, params: Record<string, unknown> = {}, id: number | string = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params })
}

beforeEach(async () => {
  db = testDb.open()

  taskStore = createA2ATaskStore(db)
  executorImpl = noopExecutor
  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

  authMiddleware = createAuthMiddleware({
    verifyAccessToken: (token) => tokenService.verifyAccessToken(token),
    findSessionByHash: async (hash) => {
      const rows = db.all(sql`SELECT * FROM sessions WHERE token_hash = ${hash}`) as any[]
      const s = rows[0]
      return s ? { userId: s.user_id, expiresAt: s.expires_at } : null
    },
    findApiKeyByHash: async () => null,
    findUserById: async (id) => {
      const rows = db.all(sql`SELECT * FROM users WHERE id = ${id}`) as any[]
      const u = rows[0]
      return u ? { id: u.id, role: u.role, status: u.status } : null
    },
    buildAbilityForUser: (role) => buildAbilityForRole(role as RoleId, permRegistry),
  })

  app = new Hono()
  app.onError(errorHandler)

  // Auth routes for getting a token
  const { createAuthRoutes } = await import('@modules/auth/routes')
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })

  // Agent card endpoint
  const cardGenerator = () => generateAgentCard(DEFAULT_SKILLS, { url: 'http://localhost:3000' })
  app.get('/.well-known/agent-card.json', (c) => c.json(cardGenerator()))

  // A2A routes behind auth. The executor delegates to the swappable impl so
  // individual tests can drive the task lifecycle deterministically.
  app.use('/api/v1/a2a', authMiddleware)
  registerA2ARoutes({ app, taskStore, logger, executor: (t) => executorImpl(t) })

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => { testDb.cleanup() })

// ─── Agent Card ──────────────────────────────────────────────────────────────

describe('GET /.well-known/agent-card.json', () => {
  it('returns valid agent card JSON', async () => {
    const res = await app.request('/.well-known/agent-card.json')
    expect(res.status).toBe(200)
    const card = await res.json() as any
    expect(card.name).toBe('EYAS')
    expect(card.version).toBe(getVersion())
    expect(card.url).toBe('http://localhost:3000')
    expect(card.capabilities.streaming).toBe(true)
    expect(card.capabilities.pushNotifications).toBe(false)
    expect(card.authentication.schemes).toContain('bearer')
    expect(card.skills).toBeInstanceOf(Array)
    expect(card.skills.length).toBeGreaterThan(0)
    expect(card.skills[0]).toHaveProperty('id')
    expect(card.skills[0]).toHaveProperty('name')
    expect(card.skills[0]).toHaveProperty('description')
  })
})

// ─── tasks/send ──────────────────────────────────────────────────────────────

describe('tasks/send', () => {
  it('accepts a task for async execution and returns it running', async () => {
    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/send', { description: 'Analyze this codebase' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.jsonrpc).toBe('2.0')
    expect(json.id).toBe(1)
    expect(json.result.id).toBeDefined()
    // With an executor wired the task is accepted and moved to 'running' — it is
    // NOT left at a silent 'pending' that nothing ever advances.
    expect(json.result.status).toBe('running')
    expect(json.result.description).toBe('Analyze this codebase')
    expect(json.result.createdAt).toBeDefined()
  })

  it('accepts optional skill parameter', async () => {
    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/send', { description: 'Review code', skill: 'code-review' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.result.status).toBe('running')
  })

  it('runs the executor and the task reaches its terminal state', async () => {
    // Executor that completes the task — proves tasks/send actually triggers
    // execution (the H19 regression: nothing ever advanced pending tasks).
    executorImpl = async (t) => {
      taskStore.updateStatus(t.id, 'completed', { result: `done: ${t.description}` })
    }
    const createRes = await app.request('/api/v1/a2a', {
      method: 'POST', headers: auth(), body: rpc('tasks/send', { description: 'do it' }),
    })
    const taskId = ((await createRes.json()) as any).result.id
    // Let the fire-and-forget executor microtask settle.
    await new Promise((r) => setTimeout(r, 0))
    const getRes = await app.request('/api/v1/a2a', {
      method: 'POST', headers: auth(), body: rpc('tasks/get', { taskId }),
    })
    const task = ((await getRes.json()) as any).result
    expect(task.status).toBe('completed')
    expect(task.result).toBe('done: do it')
  })

  it('records executor failures on the task instead of leaving it running', async () => {
    executorImpl = async () => { throw new Error('boom') }
    const createRes = await app.request('/api/v1/a2a', {
      method: 'POST', headers: auth(), body: rpc('tasks/send', { description: 'will fail' }),
    })
    const taskId = ((await createRes.json()) as any).result.id
    await new Promise((r) => setTimeout(r, 0))
    const getRes = await app.request('/api/v1/a2a', {
      method: 'POST', headers: auth(), body: rpc('tasks/get', { taskId }),
    })
    const task = ((await getRes.json()) as any).result
    expect(task.status).toBe('failed')
    expect(task.error).toBe('boom')
  })

  it('rejects missing description', async () => {
    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/send', {}),
    })
    expect(res.status).toBe(400)
    const json = await res.json() as any
    expect(json.error.code).toBe(-32602)
  })
})

// ─── Honest failure when no executor is wired ────────────────────────────────

describe('tasks/send without an executor', () => {
  it('fails the task with a clear reason instead of silently pending', async () => {
    // A separate app with NO executor wired — the current production reality.
    const bare = new Hono()
    bare.onError(errorHandler)
    bare.use('/api/v1/a2a', authMiddleware)
    registerA2ARoutes({ app: bare, taskStore, logger })

    const res = await bare.request('/api/v1/a2a', {
      method: 'POST', headers: auth(), body: rpc('tasks/send', { description: 'orphan' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    // Never silently 'pending' — the caller gets a truthful terminal state.
    expect(json.result.status).toBe('failed')
    expect(json.result.error).toMatch(/not available/i)
  })
})

// ─── tasks/get ───────────────────────────────────────────────────────────────

describe('tasks/get', () => {
  it('returns task status by ID', async () => {
    // Create a task first
    const createRes = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/send', { description: 'Test task' }),
    })
    const taskId = ((await createRes.json()) as any).result.id

    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/get', { taskId }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.result.id).toBe(taskId)
    expect(json.result.status).toBe('running')
  })

  it('returns error for non-existent task', async () => {
    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/get', { taskId: 'nonexistent' }),
    })
    expect(res.status).toBe(404)
    const json = await res.json() as any
    expect(json.error.code).toBe(-32001)
  })
})

// ─── tasks/cancel ────────────────────────────────────────────────────────────

describe('tasks/cancel', () => {
  it('cancels a running task', async () => {
    const createRes = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/send', { description: 'Task to cancel' }),
    })
    const taskId = ((await createRes.json()) as any).result.id

    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/cancel', { taskId }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.result.status).toBe('cancelled')
    expect(json.result.completedAt).toBeDefined()
  })

  it('returns error for non-existent task', async () => {
    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/cancel', { taskId: 'nonexistent' }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── Error Handling ──────────────────────────────────────────────────────────

describe('error handling', () => {
  it('returns method not found for unknown method', async () => {
    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: auth(),
      body: rpc('tasks/unknown', {}),
    })
    expect(res.status).toBe(400)
    const json = await res.json() as any
    expect(json.error.code).toBe(-32601)
    expect(json.error.message).toBe('Method not found')
  })

  it('returns parse error for invalid JSON', async () => {
    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
    const json = await res.json() as any
    expect(json.error.code).toBe(-32700)
  })

  it('returns 401 without authentication', async () => {
    const res = await app.request('/api/v1/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rpc('tasks/send', { description: 'Test' }),
    })
    expect(res.status).toBe(401)
  })
})
