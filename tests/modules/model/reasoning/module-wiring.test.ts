// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The model module adds model_config.metadata and wires ONE reasoning
// registry that reads discovered reasoning from that column.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import type { ModuleContext } from '@core/types'

const warnings: unknown[] = []
const logger = {
  info() {}, error() {}, debug() {}, trace() {}, fatal() {},
  warn(...args: unknown[]) { warnings.push(args) },
  child() { return logger },
} as any

let db: any
beforeEach(() => {
  db = createTestDb('model-reasoning-wiring').open()
  warnings.length = 0
})

function buildCtx(): ModuleContext {
  return {
    db,
    logger,
    http: new Hono(),
    setup: createSetupRegistry(db),
    secrets: { get: async () => null, set: async () => {}, delete: async () => false, list: async () => [], has: async () => false },
  } as unknown as ModuleContext
}

function columns(): string[] {
  return (db.all(sql`PRAGMA table_info(model_config)`) as Array<{ name: string }>).map((c) => c.name)
}

describe('model module — metadata column + reasoning registry', () => {
  it('adds model_config.metadata idempotently', async () => {
    const { modelModule } = await import('@modules/model/index')
    await modelModule.onRegister(buildCtx())
    expect(columns()).toContain('metadata')
    // A second boot (column already there) must not fail.
    await expect(modelModule.onRegister(buildCtx())).resolves.toBeUndefined()
    expect(columns().filter((c) => c === 'metadata')).toHaveLength(1)
  })

  it('exposes ctx.reasoningRegistry reading discovered reasoning from the model row', async () => {
    const { modelModule } = await import('@modules/model/index')
    const ctx = buildCtx()
    await modelModule.onRegister(ctx)
    ctx.providerConfig.ensureProvider('anthropic')
    ctx.providerConfig.upsertModels('anthropic', [
      { id: 'claude-opus-4-8', name: 'Opus', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 64000, supportsTools: true, supportsImages: true, supportsStreaming: true },
    ])
    const registry = ctx.reasoningRegistry!
    expect(registry.get('anthropic', 'claude-opus-4-8').source).toBe('overlay')

    const reasoning = { source: 'models-api', param: 'effort', levels: ['low', 'medium', 'high'], discoveredAt: '2026-09-22T12:00:00Z' }
    db.run(sql`UPDATE model_config SET metadata = ${JSON.stringify({ reasoning })} WHERE id = 'anthropic:claude-opus-4-8'`)
    registry.invalidate('anthropic')
    const merged = registry.get('anthropic', 'claude-opus-4-8')
    expect(merged.source).toBe('merged')
    expect(merged.levels).toEqual(['none', 'low', 'medium', 'high'])
  })

  // E3 — a lookup by the EYAS pair alone (the gateway, write-time effort
  // validation) matches the concrete model the row names.
  it('resolves an alias through the row realModelId when the caller passes none', async () => {
    const { modelModule } = await import('@modules/model/index')
    const ctx = buildCtx()
    await modelModule.onRegister(ctx)
    ctx.providerConfig.ensureProvider('claude-code')
    ctx.providerConfig.upsertModels('claude-code', [
      { id: 'claude-code-opus', name: 'Opus', provider: 'claude-code', contextWindow: 200000, maxOutputTokens: 64000, supportsTools: true, supportsImages: true, supportsStreaming: true },
    ])
    const registry = ctx.reasoningRegistry!
    expect(registry.get('claude-code', 'claude-code-opus').kind).toBe('unknown')

    db.run(sql`UPDATE model_config SET metadata = ${JSON.stringify({ realModelId: 'claude-opus-4-6' })} WHERE id = 'claude-code:claude-code-opus'`)
    registry.invalidate('claude-code')
    const c = registry.get('claude-code', 'claude-code-opus')
    expect(c.overlayRowId).toBe('anthropic-opus-sonnet-4-6')
    expect(c.levels).not.toContain('xhigh')
  })

  it('a corrupt metadata cell degrades to the overlay with a warning', async () => {
    const { modelModule } = await import('@modules/model/index')
    const ctx = buildCtx()
    await modelModule.onRegister(ctx)
    ctx.providerConfig.ensureProvider('anthropic')
    ctx.providerConfig.upsertModels('anthropic', [
      { id: 'claude-opus-4-8', name: 'Opus', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 64000, supportsTools: true, supportsImages: true, supportsStreaming: true },
    ])
    db.run(sql`UPDATE model_config SET metadata = '{broken' WHERE id = 'anthropic:claude-opus-4-8'`)
    expect(ctx.reasoningRegistry!.get('anthropic', 'claude-opus-4-8').source).toBe('overlay')
    expect(warnings.length).toBeGreaterThan(0)
  })
})
