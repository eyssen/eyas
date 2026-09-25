// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F5 wiring: the model module's auxiliary service pins a CLI candidate to its
// tier's model only when the CLI's own runtime discovery offered that model
// (model_config metadata written by the reconcile); a seed row or a row the
// runtime stopped offering leaves the CLI pinned by provider only.

import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import type { ModuleContext } from '@core/types'
import type { AIProvider, ModelInfo } from '@modules/model/types'

const logger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger } }
const testDb = createTestDb('aux-runtime-verified-wiring')
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

const claudeCode: AIProvider = {
  id: 'claude-code',
  name: 'Claude Code CLI',
  supportsIsolatedCompletion: true,
  async listModels() { return [] },
  async complete() { throw new Error('not called') },
  async *stream() { throw new Error('not called') },
}

const row = (id: string, metadata?: Record<string, unknown>): ModelInfo => ({
  id, name: id, provider: 'claude-code', contextWindow: 200_000, maxOutputTokens: 64_000,
  supportsTools: true, supportsImages: true, supportsStreaming: true, ...(metadata ? { metadata } : {}),
})

async function setup(heartbeatModel: string) {
  const db = testDb.open()
  const { modelModule } = await import('@modules/model/index')
  const ctx = buildCtx(db)
  await modelModule.onRegister!(ctx)
  ctx.providerConfig.ensureProvider('claude-code')
  ctx.providerConfig.updateProvider('claude-code', { enabled: true })
  ctx.model.registerProvider(claudeCode)
  db.run(sql`UPDATE routing_tiers SET provider_id = 'claude-code', model_id = ${heartbeatModel}, enabled = 1 WHERE tier = 'heartbeat'`)
  return ctx
}

describe('model module — auxiliary calls pin a CLI only to a runtime-verified model', () => {
  it('a model the runtime discovery offered is pinned (positive)', async () => {
    const ctx = await setup('claude-code-haiku')
    ctx.providerConfig.reconcileDiscoveredModels('claude-code', [
      row('claude-code-haiku', { alias: 'haiku', realModelId: 'claude-haiku-4-5', discoveredAt: '2026-09-23T10:00:00.000Z' }),
    ])
    const resolution = ctx.auxiliaryModel!.resolve('title')
    expect(resolution).toMatchObject({ ok: true, candidates: [{ provider: 'claude-code', model: 'claude-code-haiku', route: 'tier' }] })
  })

  it('a seed row, or one a later discovery no longer offered, pins by provider only (negative)', async () => {
    const ctx = await setup('claude-code-haiku')
    ctx.providerConfig.upsertModels('claude-code', [row('claude-code-haiku', { alias: 'haiku' })])
    const seeded = ctx.auxiliaryModel!.resolve('title')
    expect(seeded.ok && seeded.candidates[0]).toEqual({ provider: 'claude-code', route: 'tier' })

    ctx.providerConfig.reconcileDiscoveredModels('claude-code', [
      row('claude-code-haiku', { alias: 'haiku', discoveredAt: '2026-09-22T10:00:00.000Z' }),
    ])
    ctx.providerConfig.reconcileDiscoveredModels('claude-code', [
      row('claude-code-sonnet', { alias: 'sonnet', discoveredAt: '2026-09-23T10:00:00.000Z' }),
    ])
    const dropped = ctx.auxiliaryModel!.resolve('title')
    expect(dropped.ok && dropped.candidates[0]).toEqual({ provider: 'claude-code', route: 'tier' })
  })
})
