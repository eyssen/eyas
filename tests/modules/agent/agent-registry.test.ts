// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H4 — a colleague's model binding is provider+model. The registry stores the
// provider with the model (never a stale provider with a new model), and the
// boot that adds the column backfills legacy rows from the model catalog —
// only where exactly one provider lists the model id.

import { describe, it, expect, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { agentModule } from '@modules/agent/index'
import { backfillAgentProviders, createAgentRegistry } from '@modules/agent/agent-registry'
import { createMemoryDb, createTestDb } from '../../helpers/test-db'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

const NOW = '2026-01-01T00:00:00.000Z'

function catalog(db: any, rows: Array<[provider: string, model: string, enabled?: boolean]>) {
  for (const provider of new Set(rows.map(([p]) => p))) {
    db.run(sql`INSERT OR IGNORE INTO provider_config (id, enabled, updated_at) VALUES (${provider}, 1, ${NOW})`)
  }
  for (const [provider, model, enabled = true] of rows) {
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, updated_at)
      VALUES (${`${provider}:${model}`}, ${provider}, ${model}, ${enabled ? 1 : 0}, ${model}, ${NOW})`)
  }
}

function input(id: string, over: Record<string, unknown> = {}) {
  return {
    id, name: id, role: 'r', description: 'd', goal: 'g', backstory: 'b',
    systemPrompt: 's', capabilities: [], tools: [], constraints: [], ...over,
  }
}

describe('agent registry — provider+model (H4)', () => {
  const testDb = createTestDb('agent-registry-h4')
  afterEach(() => testDb.cleanup())

  it('(+) stores and reads the provider with the model', () => {
    const registry = createAgentRegistry(testDb.open())
    registry.create(input('a', { provider: 'grok-cli', model: 'grok-cli-default' }))
    expect(registry.get('a')).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
  })

  it('(−) a new model without a provider drops the old provider; clearing the model clears both', () => {
    const registry = createAgentRegistry(testDb.open())
    registry.create(input('a', { provider: 'grok-cli', model: 'grok-cli-default' }))
    registry.update('a', { model: 'claude-code-sonnet' })
    expect(registry.get('a')).toMatchObject({ provider: undefined, model: 'claude-code-sonnet' })
    registry.update('a', { provider: 'claude-code', model: 'claude-code-sonnet' })
    registry.update('a', { name: 'Renamed' })
    expect(registry.get('a')).toMatchObject({ name: 'Renamed', provider: 'claude-code', model: 'claude-code-sonnet' })
    registry.update('a', { model: null })
    expect(registry.get('a')).toMatchObject({ provider: undefined, model: undefined })
  })

  it('(+) backfill sets the provider for a model id exactly one provider lists', () => {
    const db = testDb.open()
    catalog(db, [['grok-cli', 'grok-cli-default'], ['openai', 'gpt-x', false]])
    const registry = createAgentRegistry(db)
    registry.create(input('a', { model: 'grok-cli-default' }))
    registry.create(input('b', { model: 'gpt-x' }))
    expect(backfillAgentProviders(db)).toBe(2)
    expect(registry.get('a')).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
    // A model switched off still belongs to its one provider.
    expect(registry.get('b')).toMatchObject({ provider: 'openai', model: 'gpt-x' })
  })

  it('(−) an ambiguous id, an unknown id and a tier alias stay provider-less (resolved at run time)', () => {
    const db = testDb.open()
    catalog(db, [['openrouter', 'shared-model'], ['kimi', 'shared-model']])
    const registry = createAgentRegistry(db)
    registry.create(input('amb', { model: 'shared-model' }))
    registry.create(input('unk', { model: 'ghost-model' }))
    registry.create(input('alias', { model: 'sonnet' }))
    registry.create(input('none'))
    expect(backfillAgentProviders(db)).toBe(0)
    for (const id of ['amb', 'unk', 'alias', 'none']) expect(registry.get(id)!.provider).toBeUndefined()
  })

  it('runs once, in the boot that adds the column, and never overrides a provider set later', async () => {
    const db = createMemoryDb()
    // A legacy install: agent_definitions without the provider column, and a catalog.
    db.run(sql`CREATE TABLE provider_config (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, settings TEXT DEFAULT '{}', is_default INTEGER NOT NULL DEFAULT 0, default_model TEXT, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE model_config (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, context_window INTEGER, max_output_tokens INTEGER, supports_tools INTEGER DEFAULT 1, supports_images INTEGER DEFAULT 1, supports_streaming INTEGER DEFAULT 1, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE agent_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, description TEXT, system_prompt TEXT, capabilities TEXT, tools TEXT, constraints TEXT, model TEXT, max_turns INTEGER, enabled INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'seed', avatar TEXT, tags TEXT, monthly_token_budget INTEGER DEFAULT 0, tokens_used_month INTEGER DEFAULT 0, budget_reset_at TEXT, config TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`INSERT INTO agent_definitions (id, name, model, created_at, updated_at) VALUES ('dev', 'Dev', 'grok-cli-default', ${NOW}, ${NOW})`)
    catalog(db, [['grok-cli', 'grok-cli-default']])

    const boot = async () => {
      const ctx: any = {
        db, bus: { emit: () => {}, on: () => {}, off: () => {} }, logger: silentLogger, model: {},
        permissions: { registerSubject: () => {} }, hasModule: () => false,
        http: { get: () => {}, post: () => {}, use: () => {} },
      }
      await agentModule.onRegister!(ctx)
      return ctx
    }
    const ctx = await boot()
    expect(ctx.agents.registry.get('dev')).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })

    // The user later points the colleague at a model several providers list
    // (provider-less); a second boot must not re-bind it.
    db.run(sql`UPDATE agent_definitions SET provider = NULL WHERE id = 'dev'`)
    await boot()
    expect((db.all(sql`SELECT provider FROM agent_definitions WHERE id = 'dev'`) as any[])[0].provider).toBeNull()
  })
})
