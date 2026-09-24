// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D3 wiring: the model module publishes the one binding resolver as
// ctx.modelBinding, reading registrations, the catalog, the tiers and the
// global "Allow Auto-routing" switch per call.

import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import { readAutoRoutingEnabled } from '@modules/model/routing/tier-store'
import type { ModuleContext } from '@core/types'
import type { AIProvider } from '@modules/model/types'

const logger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger } }
const testDb = createTestDb('model-binding-wiring')
afterEach(() => testDb.cleanup())

function buildCtx(db: any): ModuleContext {
  return {
    db,
    logger,
    http: new Hono(),
    setup: createSetupRegistry(db),
    secrets: { get: async () => null, set: async () => {}, delete: async () => false, list: async () => [], has: async () => false },
  } as unknown as ModuleContext
}

function fake(id: string): AIProvider {
  return { id, name: id, async listModels() { return [] }, async complete() { throw new Error('x') }, async *stream() { throw new Error('x') } }
}

describe('model module — ctx.modelBinding', () => {
  it('publishes the resolver; it reads providers registered after it was built (positive)', async () => {
    const db = testDb.open()
    const { modelModule } = await import('@modules/model/index')
    const ctx = buildCtx(db)
    await modelModule.onRegister!(ctx)
    expect(ctx.modelBinding).toBeDefined()
    // Nothing registered yet: no default.
    expect(ctx.modelBinding!.resolveDefault()).toBeNull()

    ctx.providerConfig.ensureProvider('grok-cli')
    ctx.providerConfig.updateProvider('grok-cli', { enabled: true })
    ctx.providerConfig.upsertModels('grok-cli', [{
      id: 'grok-cli-default', name: 'Grok', provider: 'grok-cli', contextWindow: 1, maxOutputTokens: 1,
      supportsTools: true, supportsImages: false, supportsStreaming: true,
    }])
    ctx.model.registerProvider(fake('grok-cli'))
    expect(ctx.modelBinding!.resolveDefault()).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default', source: 'default' })
    expect(ctx.modelBinding!.isSelectable({ providerId: 'grok-cli', modelId: 'grok-cli-default' })).toBe(true)
  })

  it('an Auto conversation keeps its pair while the global switch is off (negative)', async () => {
    const db = testDb.open()
    const { modelModule } = await import('@modules/model/index')
    const ctx = buildCtx(db)
    await modelModule.onRegister!(ctx)
    ctx.providerConfig.ensureProvider('grok-cli')
    ctx.providerConfig.updateProvider('grok-cli', { enabled: true })
    ctx.model.registerProvider(fake('grok-cli'))
    db.run(sql`UPDATE routing_budget SET auto_routing_enabled = 0 WHERE id = 'global'`)
    const binding = await ctx.modelBinding!.resolve({
      conversation: { mode: 'auto', providerId: 'grok-cli', modelId: 'grok-cli-default', agentId: null, parentConversationId: null },
      text: 'hi',
    })
    expect(binding).toMatchObject({ providerId: 'grok-cli', source: 'conversation', note: 'auto-routing-disabled' })
  })
})

describe('readAutoRoutingEnabled', () => {
  it('reads the stored switch; no row means on', () => {
    const db = testDb.open()
    db.run(sql`CREATE TABLE IF NOT EXISTS routing_budget (id TEXT PRIMARY KEY, auto_routing_enabled INTEGER NOT NULL DEFAULT 1)`)
    expect(readAutoRoutingEnabled(db)).toBe(true)
    db.run(sql`INSERT INTO routing_budget (id, auto_routing_enabled) VALUES ('global', 0)`)
    expect(readAutoRoutingEnabled(db)).toBe(false)
    db.run(sql`UPDATE routing_budget SET auto_routing_enabled = 1 WHERE id = 'global'`)
    expect(readAutoRoutingEnabled(db)).toBe(true)
  })

  it('an unreadable store reads as off — never starts triaging (negative)', () => {
    const broken = { all: () => { throw new Error('no such table') } }
    expect(readAutoRoutingEnabled(broken)).toBe(false)
  })
})
