import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { loadConversationContext } from '@modules/conversations/context-occupancy'
import { createLocalBus } from '@core/bus/local-bus'

const testDb = createTestDb('context-occupancy')
let db: ReturnType<typeof testDb.open>

beforeEach(() => {
  db = testDb.open()
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, is_closed, created_at) VALUES ('stg-open', NULL, 'Backlog', 0, 0, ${now})`)
})

afterEach(() => {
  testDb.cleanup()
})

describe('loadConversationContext', () => {
  it('returns empty for empty input', () => {
    expect(loadConversationContext(db, []).size).toBe(0)
  })

  it('uses the latest composition size, not the cumulative tokensUsed', () => {
    const svc = createConversationService(db, createLocalBus())
    const conv = svc.create({ userId: 'u1', title: 'Grok card' })
    svc.update(conv.id, { providerId: 'grok-cli', modelId: 'grok-cli-default' })
    svc.addRunCost(conv.id, { tokens: 166_255, costUsd: 0.42 })

    db.run(sql`CREATE TABLE IF NOT EXISTS context_compositions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      conversation_id TEXT,
      entry_point TEXT NOT NULL DEFAULT 'conversation',
      context_window INTEGER NOT NULL DEFAULT 0,
      estimated_tokens INTEGER NOT NULL DEFAULT 0
    )`)
    db.run(sql`INSERT INTO context_compositions
      (id, created_at, conversation_id, context_window, estimated_tokens)
      VALUES ('old', '2026-08-01T00:00:00.000Z', ${conv.id}, 500000, 999999)`)
    db.run(sql`INSERT INTO context_compositions
      (id, created_at, conversation_id, context_window, estimated_tokens)
      VALUES ('fresh', '2026-08-28T00:00:00.000Z', ${conv.id}, 500000, 50000)`)

    const refreshed = svc.get(conv.id)!
    const ctx = loadConversationContext(db, [refreshed]).get(conv.id)!
    expect(ctx.estimatedTokens).toBe(50_000)
    expect(ctx.contextWindow).toBe(500_000)
    expect(ctx.estimatedTokens).not.toBe(refreshed.tokensUsed)
  })

  it('falls back to the grok-cli window when no composition or catalog exists', () => {
    const svc = createConversationService(db, createLocalBus())
    const conv = svc.create({ userId: 'u1', title: 'Empty' })
    svc.update(conv.id, { providerId: 'grok-cli', modelId: 'grok-cli-default' })
    const ctx = loadConversationContext(db, [svc.get(conv.id)!]).get(conv.id)!
    expect(ctx.estimatedTokens).toBeNull()
    expect(ctx.contextWindow).toBe(500_000)
  })

  it('does not let a stale grok-cli model_config shrink the window below 500k', () => {
    const svc = createConversationService(db, createLocalBus())
    const conv = svc.create({ userId: 'u1', title: 'Stale' })
    svc.update(conv.id, { providerId: 'grok-cli', modelId: 'grok-cli-default' })
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, updated_at) VALUES ('grok-cli', 1, ${now})`)
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, updated_at)
      VALUES ('mc-1', 'grok-cli', 'grok-cli-default', 1, 'Grok', 256000, ${now})`)

    const ctx = loadConversationContext(db, [svc.get(conv.id)!]).get(conv.id)!
    expect(ctx.contextWindow).toBe(500_000)
  })

  it('prefers model_config over the default window for API providers', () => {
    const svc = createConversationService(db, createLocalBus())
    const conv = svc.create({ userId: 'u1', title: 'Opus' })
    svc.update(conv.id, { providerId: 'anthropic', modelId: 'claude-opus-4-8' })
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, updated_at) VALUES ('anthropic', 1, ${now})`)
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, updated_at)
      VALUES ('mc-1', 'anthropic', 'claude-opus-4-8', 1, 'Opus', 1000000, ${now})`)

    const ctx = loadConversationContext(db, [svc.get(conv.id)!]).get(conv.id)!
    expect(ctx.contextWindow).toBe(1_000_000)
  })
})
