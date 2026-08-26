import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb } from '../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import { createSetupRoutes } from '@modules/setup/routes'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { generateId } from '@shared/crypto'
import { hashPassword } from '@modules/auth/providers/local'
import type { SetupRegistry } from '@modules/setup/types'

const testDb = createTestDb('auth-setup-integration')
let db: ReturnType<typeof testDb.open>
let app: Hono
let setupRegistry: SetupRegistry

beforeEach(() => {
  db = testDb.open()
  setupRegistry = createSetupRegistry(db)

  setupRegistry.registerStep({
    id: 'root-owner', module: 'auth', title: 'Root Owner', description: 'Create admin', required: true, order: 10,
    fields: [
      { name: 'username', type: 'text', label: 'Username', required: true },
      { name: 'password', type: 'password', label: 'Password', required: true },
      { name: 'displayName', type: 'text', label: 'Display Name', required: false },
    ],
    async onComplete(data) {
      const id = generateId()
      const now = new Date().toISOString()
      const pwHash = await hashPassword(data.password as string)
      db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
        VALUES (${id}, ${data.username as string}, ${(data.displayName as string) || (data.username as string)}, ${pwHash}, 'owner', 1, 0, 'active', ${now}, ${now})`)
    },
  })

  setupRegistry.registerStep({
    id: 'first-agent', module: 'auth', title: 'First Agent', description: 'Create agent', required: true, order: 20,
    fields: [{ name: 'name', type: 'text', label: 'Agent Name', required: true }],
    async onComplete(data) {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
        VALUES (${id}, ${data.name as string}, ${data.name as string}, ${null}, 'agent', 0, 1, 'active', ${now}, ${now})`)
    },
  })

  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')
  app = new Hono()
  app.onError(errorHandler)
  createSetupRoutes(app, setupRegistry, db)
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })
})

afterEach(() => { testDb.cleanup() })

describe('setup wizard — auth steps', () => {
  it('shows incomplete status with 2 steps', async () => {
    const res = await app.request('/api/v1/setup/status')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.complete).toBe(false)
    expect(body.totalSteps).toBe(2)
    expect(body.currentStep).toBe('root-owner')
  })

  it('root-owner step creates the root user', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'securepass123', displayName: 'Admin' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.status).toBe('completed')
  })

  it('first-agent step creates an agent', async () => {
    await setupRegistry.completeStep('root-owner', { username: 'admin', password: 'securepass123' })
    const res = await app.request('/api/v1/setup/steps/first-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'assistant' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.status).toBe('completed')
  })

  it('setup complete after both steps', async () => {
    await setupRegistry.completeStep('root-owner', { username: 'admin', password: 'securepass123' })
    await setupRegistry.completeStep('first-agent', { name: 'assistant' })
    const res = await app.request('/api/v1/setup/status')
    const body = await res.json() as any
    expect(body.complete).toBe(true)
  })

  it('login works after setup', async () => {
    await setupRegistry.completeStep('root-owner', { username: 'admin', password: 'securepass123' })
    await setupRegistry.completeStep('first-agent', { name: 'assistant' })
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'securepass123' }),
    })
    expect(res.status).toBe(200)
  })

  it('an authenticated owner can finish an optional step after required setup is complete', async () => {
    // Optional step registered after the required ones — mirrors team-agents/ai-models.
    let applied = false
    setupRegistry.registerStep({
      id: 'team-agents', module: 'auth', title: 'Team Agents', description: 'Optional',
      required: false, order: 30,
      fields: [{ name: 'selectedAgents', type: 'text', label: 'Agents', required: false }],
      onComplete: async () => { applied = true },
    })
    await setupRegistry.completeStep('root-owner', { username: 'admin', password: 'securepass123' })
    await setupRegistry.completeStep('first-agent', { name: 'assistant' })
    expect(setupRegistry.isComplete()).toBe(true)

    // Unauthenticated write is rejected (fail closed) even with the CSRF header.
    const anon = await app.request('/api/v1/setup/steps/team-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Eyas-Request': '1' },
      body: JSON.stringify({ selectedAgents: 'devils-advocate' }),
    })
    expect(anon.status).toBe(404)
    expect(applied).toBe(false)

    // Log in as the owner → obtain the real session cookie.
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'securepass123' }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]
    expect(cookie).toContain('eyas_session=')

    // Authenticated owner + CSRF header → allowed.
    const ok = await app.request('/api/v1/setup/steps/team-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Eyas-Request': '1', Cookie: cookie },
      body: JSON.stringify({ selectedAgents: 'devils-advocate' }),
    })
    expect(ok.status).toBe(200)
    expect(applied).toBe(true)
  })
})
