// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createAgentRoutes } from '@modules/agent/routes'

// Mock requirePermission to pass through — auth is exercised elsewhere.
vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}))

function makeRegistry(existing: Record<string, any> = {}) {
  const store: Record<string, any> = { ...existing }
  return {
    create: vi.fn((input: any) => { store[input.id] = input; return input }),
    get: vi.fn((id: string) => store[id]),
    list: vi.fn().mockReturnValue([]),
    update: vi.fn(),
    delete: vi.fn(),
    toggle: vi.fn(),
  }
}

function makeApp(registry: any) {
  const app = new Hono()
  createAgentRoutes(app, registry)
  return app
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

describe('POST /api/v1/agents validation', () => {
  it('rejects a body missing required fields with 400 and does not INSERT', async () => {
    const registry = makeRegistry()
    const res = await makeApp(registry).request('/api/v1/agents', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect(registry.create).not.toHaveBeenCalled()
  })

  it('creates a valid agent with 201 and forces source=user (strips client source)', async () => {
    const registry = makeRegistry()
    const res = await makeApp(registry).request('/api/v1/agents', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ id: 'a1', name: 'Agent One', source: 'seed' }),
    })
    expect(res.status).toBe(201)
    expect(registry.create).toHaveBeenCalledTimes(1)
    const input = registry.create.mock.calls[0][0]
    expect(input.source).toBe('user')
    // Array fields defaulted so the INSERT never binds undefined.
    expect(input.capabilities).toEqual([])
    expect(input.tools).toEqual([])
    expect(input.constraints).toEqual([])
  })

  it('rejects a colliding primary key with 409 instead of an opaque 500', async () => {
    const registry = makeRegistry({ a1: { id: 'a1', name: 'Existing' } })
    const res = await makeApp(registry).request('/api/v1/agents', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ id: 'a1', name: 'Duplicate' }),
    })
    expect(res.status).toBe(409)
    expect(registry.create).not.toHaveBeenCalled()
  })
})
