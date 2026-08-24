import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { setupGuard } from '@modules/setup/middleware'
import type { SetupRegistry } from '@modules/setup/types'

function createMockRegistry(complete: boolean): SetupRegistry {
  return {
    registerStep: vi.fn(),
    getSteps: vi.fn(() => []),
    getStep: vi.fn(),
    isComplete: vi.fn(() => complete),
    completeStep: vi.fn(),
    skipStep: vi.fn(),
  }
}

function createTestApp(registry: SetupRegistry) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', setupGuard(registry))
  app.get('/api/v1/health', (c) => c.json({ ok: true }))
  app.get('/api/v1/setup/status', (c) => c.json({ complete: false }))
  app.get('/api/v1/setup/steps', (c) => c.json({ steps: [] }))
  app.get('/api/v1/data', (c) => c.json({ data: 'secret' }))
  app.post('/api/v1/auth/login', (c) => c.json({ token: '...' }))
  return app
}

describe('setupGuard middleware', () => {
  it('returns 503 on non-setup endpoints when setup is incomplete', async () => {
    const app = createTestApp(createMockRegistry(false))
    const res = await app.request('/api/v1/data')
    expect(res.status).toBe(503)
    const body = await res.json() as Record<string, unknown>
    expect(body.setupRequired).toBe(true)
  })

  it('allows /api/v1/health during setup', async () => {
    const app = createTestApp(createMockRegistry(false))
    const res = await app.request('/api/v1/health')
    expect(res.status).toBe(200)
  })

  it('allows /api/v1/setup/* during setup', async () => {
    const app = createTestApp(createMockRegistry(false))
    const res = await app.request('/api/v1/setup/status')
    expect(res.status).toBe(200)
  })

  it('allows all endpoints when setup is complete', async () => {
    const app = createTestApp(createMockRegistry(true))
    const res = await app.request('/api/v1/data')
    expect(res.status).toBe(200)
  })

  it('blocks POST to non-setup endpoints during setup', async () => {
    const app = createTestApp(createMockRegistry(false))
    const res = await app.request('/api/v1/auth/login', { method: 'POST' })
    expect(res.status).toBe(503)
  })
})
