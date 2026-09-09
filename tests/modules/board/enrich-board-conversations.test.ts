import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { enrichBoardConversations } from '@modules/board/enrich-board-conversations'
import { createLocalBus } from '@core/bus/local-bus'

const testDb = createTestDb('enrich-board')
let db: ReturnType<typeof testDb.open>

beforeEach(() => {
  db = testDb.open()
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, is_closed, created_at) VALUES ('stg-open', NULL, 'Backlog', 0, 0, ${now})`)
  db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, is_closed, created_at) VALUES ('stg-done', NULL, 'Done', 1, 1, ${now})`)
  try {
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, agent_type, enabled, source, created_at, updated_at)
      VALUES ('ag-1', 'Jarvis', 'specialist', 'assistant', 1, 'seed', ${now}, ${now})`)
  } catch {
    /* schema may differ slightly */
  }
})

afterEach(() => {
  testDb.cleanup()
})

describe('enrichBoardConversations', () => {
  it('adds agent name and child progress', () => {
    const bus = createLocalBus()
    const svc = createConversationService(db, bus)
    const parent = svc.create({ userId: 'u1', title: 'Parent' })
    svc.update(parent.id, { agentId: 'ag-1', stageId: 'stg-open', projectId: 'general-general' })

    const child1 = svc.createSubConversation({
      title: 'Child 1',
      goalDescription: 'g',
      parentConversationId: parent.id,
    })
    const child2 = svc.createSubConversation({
      title: 'Child 2',
      goalDescription: 'g',
      parentConversationId: parent.id,
    })
    svc.update(child1.id, { status: 'archived' })
    svc.update(child2.id, { stageId: 'stg-done' })

    const refreshed = svc.listByProject('general-general', 'stg-open', 'u1')
    const enriched = enrichBoardConversations(db, refreshed)
    expect(enriched).toHaveLength(1)
    expect(enriched[0].agentName).toBe('Jarvis')
    expect(enriched[0].childCount).toBe(2)
    expect(enriched[0].childrenDone).toBe(2)
  })

  it('returns empty for empty input', () => {
    expect(enrichBoardConversations(db, [])).toEqual([])
  })

  it('attaches junction tag ids so the board can filter by tag inside a project', () => {
    const bus = createLocalBus()
    const svc = createConversationService(db, bus)
    const parent = svc.create({ userId: 'u1', title: 'Alpha card' })
    svc.update(parent.id, { stageId: 'stg-open', projectId: 'alpha' })

    const now = new Date().toISOString()
    db.run(sql`INSERT INTO tag_categories (id, name, color, sort_order, created_at)
      VALUES ('cat-area', 'area', '#8b949e', 0, ${now})`)
    db.run(sql`INSERT INTO tags (id, name, color, category_id, created_at)
      VALUES ('tag-area-alpha', 'alpha', '#8b949e', 'cat-area', ${now})`)
    db.run(sql`INSERT INTO conversation_tags (conversation_id, tag_id)
      VALUES (${parent.id}, 'tag-area-alpha')`)

    const refreshed = svc.listByProject('alpha', 'stg-open', 'u1')
    const enriched = enrichBoardConversations(db, refreshed)
    expect(enriched[0].tagIds).toEqual(['tag-area-alpha'])
    expect(enriched[0].tags).toEqual(['alpha'])
  })

  it('attaches the latest composition size, not the cumulative tokensUsed', () => {
    const bus = createLocalBus()
    const svc = createConversationService(db, bus)
    const parent = svc.create({ userId: 'u1', title: 'Grok card' })
    svc.update(parent.id, {
      stageId: 'stg-open',
      projectId: 'general-general',
      providerId: 'grok-cli',
      modelId: 'grok-cli-default',
    })
    svc.addRunCost(parent.id, { tokens: 166_255, costUsd: 0.42 })

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
      VALUES ('old', '2026-08-01T00:00:00.000Z', ${parent.id}, 500000, 999999)`)
    db.run(sql`INSERT INTO context_compositions
      (id, created_at, conversation_id, context_window, estimated_tokens)
      VALUES ('fresh', '2026-08-28T00:00:00.000Z', ${parent.id}, 500000, 50000)`)

    const refreshed = svc.listByProject('general-general', 'stg-open', 'u1')
    expect(refreshed[0].tokensUsed).toBe(166_255)

    const enriched = enrichBoardConversations(db, refreshed)
    expect(enriched[0].estimatedTokens).toBe(50_000)
    expect(enriched[0].contextWindow).toBe(500_000)
    // Lifetime total must not become the occupancy numerator.
    expect(enriched[0].estimatedTokens).not.toBe(enriched[0].tokensUsed)
  })

  it('falls back to the grok-cli window when no catalog row exists', () => {
    const bus = createLocalBus()
    const svc = createConversationService(db, bus)
    const parent = svc.create({ userId: 'u1', title: 'No composition' })
    svc.update(parent.id, {
      stageId: 'stg-open',
      projectId: 'general-general',
      providerId: 'grok-cli',
      modelId: 'grok-cli-default',
    })

    const refreshed = svc.listByProject('general-general', 'stg-open', 'u1')
    const enriched = enrichBoardConversations(db, refreshed)
    expect(enriched[0].estimatedTokens).toBeNull()
    expect(enriched[0].contextWindow).toBe(500_000)
  })

  it('does not let a stale grok-cli model_config shrink the window below 500k', () => {
    const bus = createLocalBus()
    const svc = createConversationService(db, bus)
    const parent = svc.create({ userId: 'u1', title: 'Stale catalog' })
    svc.update(parent.id, {
      stageId: 'stg-open',
      projectId: 'general-general',
      providerId: 'grok-cli',
      modelId: 'grok-cli-default',
    })
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, updated_at) VALUES ('grok-cli', 1, ${now})`)
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, updated_at)
      VALUES ('mc-1', 'grok-cli', 'grok-cli-default', 1, 'Grok', 256000, ${now})`)

    const refreshed = svc.listByProject('general-general', 'stg-open', 'u1')
    const enriched = enrichBoardConversations(db, refreshed)
    expect(enriched[0].contextWindow).toBe(500_000)
  })

  it('prefers model_config over the default window for API providers', () => {
    const bus = createLocalBus()
    const svc = createConversationService(db, bus)
    const parent = svc.create({ userId: 'u1', title: 'Catalog window' })
    svc.update(parent.id, {
      stageId: 'stg-open',
      projectId: 'general-general',
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
    })
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, updated_at) VALUES ('anthropic', 1, ${now})`)
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, updated_at)
      VALUES ('mc-1', 'anthropic', 'claude-opus-4-8', 1, 'Opus', 1000000, ${now})`)

    const refreshed = svc.listByProject('general-general', 'stg-open', 'u1')
    const enriched = enrichBoardConversations(db, refreshed)
    expect(enriched[0].contextWindow).toBe(1_000_000)
  })
})
