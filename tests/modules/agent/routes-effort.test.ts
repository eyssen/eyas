// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E3 — a colleague's effort is Zod-validated on create and on PATCH (PATCH
// moves from a raw passthrough to a partial schema), and a rung the
// colleague's model does not accept is a coded 400. An unknown model, or no
// model, accepts any canonical rung (the gateway clamps at run time). The
// target is resolved the way agent/index.ts wires it: model id or tier alias
// → owning provider (resolveModelRef) → reasoning capability.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createAgentRoutes } from '@modules/agent/routes'
import { createAgentRegistry, type AgentRegistry } from '@modules/agent/agent-registry'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { resolveModelRef } from '@modules/model/binding'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import { clearOffLadderEffort } from '@modules/model/reasoning/stored-effort'
import type { ModelInfo } from '@modules/model/types'
import { createTestDb } from '../../helpers/test-db'

// Auth is exercised elsewhere; these tests are about the body.
vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}))

const testDb = createTestDb('agent-routes-effort')
const JSON_HEADERS = { 'Content-Type': 'application/json' }

function info(provider: string, id: string): ModelInfo {
  return { id, name: id, provider, contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: false, supportsStreaming: true }
}

describe('agent routes — effort validation (E3)', () => {
  let db: any
  let app: Hono
  let registry: AgentRegistry

  beforeEach(() => {
    db = testDb.open()
    const config = createProviderConfigService(db)
    for (const id of ['anthropic', 'mystery']) {
      config.ensureProvider(id)
      config.updateProvider(id, { enabled: true })
    }
    config.upsertModels('anthropic', [info('anthropic', 'claude-opus-4-8'), info('anthropic', 'claude-opus-4-6')])
    config.upsertModels('mystery', [info('mystery', 'mystery-1')])
    const reasoning = createReasoningRegistry({ getDiscovered: () => null })

    registry = createAgentRegistry(db)
    app = new Hono()
    createAgentRoutes(app, registry, {
      db,
      dataDir: 'data',
      effortTargetFor: (model) => {
        const ref = resolveModelRef({ providerConfig: config, isRegistered: () => true }, model)
        return ref ? { ...ref, capability: reasoning.get(ref.providerId, ref.modelId) } : null
      },
    })
  })

  afterEach(() => testDb.cleanup())

  async function post(body: Record<string, unknown>) {
    const res = await app.request('/api/v1/agents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json() as any }
  }

  async function patch(id: string, body: unknown) {
    const res = await app.request(`/api/v1/agents/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json() as any }
  }

  it("POST: 'xhigh' is accepted for a model that has it (positive)", async () => {
    const res = await post({ id: 'dev', name: 'Dev', model: 'claude-opus-4-8', effort: 'xhigh' })
    expect(res.status).toBe(201)
    expect(registry.get('dev')!.effort).toBe('xhigh')
  })

  it("POST: 'xhigh' on Opus 4.6 is a coded 400 and nothing is created (negative)", async () => {
    const res = await post({ id: 'dev', name: 'Dev', model: 'claude-opus-4-6', effort: 'xhigh' })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'EFFORT_UNSUPPORTED', level: 'xhigh', levels: ['none', 'low', 'medium', 'high', 'max'] })
    expect(registry.get('dev')).toBeUndefined()
  })

  it("POST: 'auto' is stored as Auto, and an off-ladder value is a 400", async () => {
    expect((await post({ id: 'a', name: 'A', effort: 'auto' })).status).toBe(201)
    expect(registry.get('a')!.effort).toBeUndefined()
    expect((await post({ id: 'b', name: 'B', effort: 'turbo' })).status).toBe(400)
  })

  it("PATCH: 'bogus' is a 400 and nothing is written (negative)", async () => {
    await post({ id: 'dev', name: 'Dev', model: 'claude-opus-4-8', effort: 'high' })
    const res = await patch('dev', { effort: 'bogus', name: 'Renamed' })
    expect(res.status).toBe(400)
    expect(res.body.details).toBeDefined()
    expect(registry.get('dev')).toMatchObject({ name: 'Dev', effort: 'high' })
  })

  it("PATCH: a level the colleague's model does not accept is a coded 400 (negative)", async () => {
    await post({ id: 'dev', name: 'Dev', model: 'claude-opus-4-6' })
    const res = await patch('dev', { effort: 'xhigh' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('EFFORT_UNSUPPORTED')
    expect(registry.get('dev')!.effort).toBeUndefined()
  })

  it('PATCH: the level is judged against the patched model, not the stored one', async () => {
    await post({ id: 'dev', name: 'Dev', model: 'claude-opus-4-8', effort: 'high' })
    expect((await patch('dev', { model: 'claude-opus-4-6', effort: 'xhigh' })).status).toBe(400)
    expect(registry.get('dev')!.model).toBe('claude-opus-4-8')
    expect((await patch('dev', { model: 'claude-opus-4-6', effort: 'max' })).status).toBe(200)
    expect(registry.get('dev')).toMatchObject({ model: 'claude-opus-4-6', effort: 'max' })
  })

  it('PATCH: an unknown model or no model accepts any canonical level', async () => {
    await post({ id: 'm', name: 'M', model: 'mystery-1' })
    expect((await patch('m', { effort: 'minimal' })).status).toBe(200)
    expect(registry.get('m')!.effort).toBe('minimal')
    await post({ id: 'n', name: 'N' })
    expect((await patch('n', { effort: 'xhigh' })).status).toBe(200)
    // A model no provider lists: EYAS cannot tell, the runtime clamps.
    await post({ id: 'u', name: 'U', model: 'not-in-any-catalog' })
    expect((await patch('u', { effort: 'max' })).status).toBe(200)
  })

  it("PATCH: 'auto' and null clear the effort", async () => {
    await post({ id: 'dev', name: 'Dev', model: 'claude-opus-4-8', effort: 'high' })
    expect((await patch('dev', { effort: 'auto' })).status).toBe(200)
    expect(registry.get('dev')!.effort).toBeUndefined()
    await patch('dev', { effort: 'low' })
    expect((await patch('dev', { effort: null })).status).toBe(200)
    expect(registry.get('dev')!.effort).toBeUndefined()
  })

  it("PATCH: the agent editor's full save body is accepted and every field is saved", async () => {
    await post({ id: 'dev', name: 'Dev', model: 'claude-opus-4-8' })
    // The exact shape agent-detail-page.tsx handleSave sends.
    const res = await patch('dev', {
      name: 'Developer',
      role: 'engineer',
      description: 'writes code',
      systemPrompt: 'You write code',
      model: 'claude-opus-4-6',
      maxTurns: 12,
      effort: 'high',
      tools: ['read_file', 'write_file'],
      constraints: ['no force push'],
      capabilities: ['code'],
      avatar: undefined,
      monthlyTokenBudget: 5000,
      goal: 'ship',
      backstory: 'veteran',
      tier: 'team',
      agentType: 'developer',
    })
    expect(res.status).toBe(200)
    expect(registry.get('dev')).toMatchObject({
      name: 'Developer', role: 'engineer', model: 'claude-opus-4-6', maxTurns: 12, effort: 'high',
      tools: ['read_file', 'write_file'], constraints: ['no force push'], capabilities: ['code'],
      monthlyTokenBudget: 5000, goal: 'ship', backstory: 'veteran', tier: 'team', agentType: 'developer',
    })
    expect(res.body.agent.name).toBe('Developer')
  })

  it("PATCH: a stored rung the model no longer offers does not block a name edit (the editor re-sends it unchanged)", async () => {
    await post({ id: 'dev', name: 'Dev', model: 'claude-opus-4-6' })
    // Stored before E3 (or before the model lost the rung): written directly.
    registry.update('dev', { effort: 'xhigh' })
    const res = await patch('dev', { name: 'Renamed', model: 'claude-opus-4-6', effort: 'xhigh', systemPrompt: 'new prompt' })
    expect(res.status).toBe(200)
    expect(registry.get('dev')).toMatchObject({ name: 'Renamed', systemPrompt: 'new prompt', effort: 'xhigh' })
  })

  it('PATCH: an unchanged rung is judged again when the model changes (negative)', async () => {
    await post({ id: 'dev', name: 'Dev', model: 'claude-opus-4-8', effort: 'xhigh' })
    const res = await patch('dev', { name: 'Renamed', model: 'claude-opus-4-6', effort: 'xhigh' })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'EFFORT_UNSUPPORTED', level: 'xhigh' })
    expect(registry.get('dev')).toMatchObject({ name: 'Dev', model: 'claude-opus-4-8' })
    // The stored rung is judged even when the body leaves effort out.
    expect((await patch('dev', { model: 'claude-opus-4-6' })).status).toBe(400)
  })

  it('PATCH: a partial body keeps every other field (no create defaults leak in)', async () => {
    await post({ id: 'dev', name: 'Dev', role: 'dev role', model: 'claude-opus-4-8', tools: ['read_file'], effort: 'high' })
    expect((await patch('dev', { name: 'Renamed' })).status).toBe(200)
    expect(registry.get('dev')).toMatchObject({ name: 'Renamed', role: 'dev role', tools: ['read_file'], model: 'claude-opus-4-8', effort: 'high' })
  })

  it('PATCH: unknown keys (source, id) are stripped (negative)', async () => {
    await post({ id: 'dev', name: 'Dev' })
    const res = await patch('dev', { source: 'seed', id: 'other', name: 'Still dev' })
    expect(res.status).toBe(200)
    const row = (db.all(sql`SELECT id, source, name FROM agent_definitions`) as any[])
    expect(row).toEqual([{ id: 'dev', source: 'user', name: 'Still dev' }])
  })

  it('PATCH: an unknown agent is a 404, a malformed body a 400', async () => {
    expect((await patch('ghost', { name: 'x' })).status).toBe(404)
    const res = await app.request('/api/v1/agents/ghost', { method: 'PATCH', headers: JSON_HEADERS, body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('without a target resolver every canonical level is accepted (the runtime clamps)', async () => {
    const bare = new Hono()
    createAgentRoutes(bare, registry)
    const res = await bare.request('/api/v1/agents', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id: 'x', name: 'X', model: 'claude-opus-4-6', effort: 'xhigh' }),
    })
    expect(res.status).toBe(201)
  })
})

describe('agent_definitions boot repair (E3)', () => {
  afterEach(() => testDb.cleanup())

  it('off-ladder effort values become NULL with one warning; valid rungs stay; a second run is a no-op', () => {
    const db = testDb.open()
    const now = new Date().toISOString()
    for (const [id, effort] of [['a', 'extreme'], ['b', 'xhigh'], ['c', null], ['d', 'auto'], ['e', 'MAX']] as const) {
      db.run(sql`INSERT INTO agent_definitions (id, name, effort, created_at, updated_at) VALUES (${id}, ${id}, ${effort}, ${now}, ${now})`)
    }
    const logger = { warn: vi.fn() }
    expect(clearOffLadderEffort(db, 'agent_definitions', logger)).toBe(3)
    const rows = Object.fromEntries((db.all(sql`SELECT id, effort FROM agent_definitions ORDER BY id`) as any[]).map((r) => [r.id, r.effort]))
    expect(rows).toEqual({ a: null, b: 'xhigh', c: null, d: null, e: null })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ table: 'agent_definitions', count: 3 }), expect.any(String))
    expect(clearOffLadderEffort(db, 'agent_definitions', logger)).toBe(0)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('the registry reads a value the repair has not seen yet as Auto (negative)', () => {
    const db = testDb.open()
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO agent_definitions (id, name, effort, created_at, updated_at) VALUES ('z', 'Z', 'turbo', ${now}, ${now})`)
    expect(createAgentRegistry(db).get('z')!.effort).toBeUndefined()
  })
})
