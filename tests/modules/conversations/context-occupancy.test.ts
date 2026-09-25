import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { emptyConversationContext, loadConversationContext } from '@modules/conversations/context-occupancy'
import { createContextTables } from '@modules/observability/context-schema'
import { createContextRecorder } from '@modules/observability/context-recorder'
import { PROVIDER_WINDOW, DEFAULT_WINDOW } from '@modules/model/model-window'
import { createLocalBus } from '@core/bus/local-bus'

const testDb = createTestDb('context-occupancy')
let db: ReturnType<typeof testDb.open>

beforeEach(() => {
  db = testDb.open()
  createContextTables(db as any)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, is_closed, created_at) VALUES ('stg-open', NULL, 'Backlog', 0, 0, ${now})`)
})

afterEach(() => {
  testDb.cleanup()
})

function catalogWindow(providerId: string, modelId: string, window: number) {
  const now = new Date().toISOString()
  db.run(sql`INSERT OR IGNORE INTO provider_config (id, enabled, settings, is_default, default_model, updated_at) VALUES (${providerId}, 1, '{}', 0, NULL, ${now})`)
  db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, updated_at)
    VALUES (${`${providerId}:${modelId}`}, ${providerId}, ${modelId}, 1, ${modelId}, ${window}, ${now})`)
}

interface CompositionRow {
  id: string
  at: string
  provider?: string | null
  model?: string | null
  estimated: number
  history?: number | null
  observedPrompt?: number | null
  window?: number
  observedWindow?: number | null
}

function composition(conversationId: string, c: CompositionRow) {
  db.run(sql`INSERT INTO context_compositions
    (id, created_at, conversation_id, entry_point, provider, model, context_window, estimated_tokens,
     history_estimated_tokens, observed_prompt_tokens, observed_context_window)
    VALUES (${c.id}, ${c.at}, ${conversationId}, 'conversation', ${c.provider ?? null}, ${c.model ?? null},
            ${c.window ?? 0}, ${c.estimated}, ${c.history ?? null}, ${c.observedPrompt ?? null}, ${c.observedWindow ?? null})`)
}

function conversation(providerId: string | null, modelId: string | null) {
  const svc = createConversationService(db, createLocalBus())
  const conv = svc.create({ userId: 'u1', title: 'Occupancy' })
  if (providerId) svc.update(conv.id, { providerId, modelId: modelId ?? undefined })
  return { svc, conv: svc.get(conv.id)! }
}

describe('loadConversationContext', () => {
  it('returns empty for empty input', () => {
    expect(loadConversationContext(db, []).size).toBe(0)
  })

  it('uses the latest composition, never the cumulative tokensUsed', () => {
    const { svc, conv } = conversation('grok-cli', 'grok-cli-default')
    svc.addRunCost(conv.id, { tokens: 166_255, costUsd: 0.42 })
    composition(conv.id, { id: 'old', at: '2026-08-01T00:00:00.000Z', provider: 'grok-cli', model: 'grok-cli-default', estimated: 999_999, window: 500_000 })
    composition(conv.id, { id: 'fresh', at: '2026-08-28T00:00:00.000Z', provider: 'grok-cli', model: 'grok-cli-default', estimated: 50_000, window: 500_000 })

    const refreshed = svc.get(conv.id)!
    const ctx = loadConversationContext(db, [refreshed]).get(conv.id)!
    expect(ctx).toEqual({ estimatedTokens: 50_000, contextWindow: 500_000, measured: false })
    expect(ctx.estimatedTokens).not.toBe(refreshed.tokensUsed)
  })

  // ── Window ───────────────────────────────────────────────────────────

  it('(+) a CLI model with a 1M catalog row uses 1M, not the 200k provider default', () => {
    catalogWindow('claude-code', 'claude-code-opus-1m', 1_000_000)
    const { conv } = conversation('claude-code', 'claude-code-opus-1m')
    expect(loadConversationContext(db, [conv]).get(conv.id)!.contextWindow).toBe(1_000_000)
    expect(PROVIDER_WINDOW['claude-code']).toBe(200_000)
  })

  it('(+) a runtime-reported window beats the catalog and the window resolved at record', () => {
    catalogWindow('claude-code', 'claude-code-opus', 1_000_000)
    const { conv } = conversation('claude-code', 'claude-code-opus')
    composition(conv.id, { id: 'c1', at: '2026-09-01T00:00:00.000Z', provider: 'claude-code', model: 'claude-code-opus', estimated: 3_000, window: 1_000_000, observedWindow: 200_000 })
    expect(loadConversationContext(db, [conv]).get(conv.id)!.contextWindow).toBe(200_000)
  })

  it('(+) the window resolved at record beats the catalog when nothing was observed', () => {
    catalogWindow('openai', 'gpt-x', 128_000)
    const { conv } = conversation('openai', 'gpt-x')
    composition(conv.id, { id: 'c1', at: '2026-09-01T00:00:00.000Z', provider: 'openai', model: 'gpt-x', estimated: 3_000, window: 400_000 })
    expect(loadConversationContext(db, [conv]).get(conv.id)!.contextWindow).toBe(400_000)
  })

  it('(−) windows recorded for another model are ignored once the conversation switched', () => {
    catalogWindow('openai', 'gpt-small', 32_000)
    const { conv } = conversation('openai', 'gpt-small')
    composition(conv.id, { id: 'c1', at: '2026-09-01T00:00:00.000Z', provider: 'claude-code', model: 'claude-code-opus', estimated: 3_000, window: 200_000, observedWindow: 200_000 })
    expect(loadConversationContext(db, [conv]).get(conv.id)!.contextWindow).toBe(32_000)
  })

  it('(−) an unknown model falls back to PROVIDER_WINDOW, and an unknown provider to the default', () => {
    const { conv: grok } = conversation('grok-cli', 'grok-unlisted')
    const { conv: other } = conversation('openai', 'nope')
    const ctx = loadConversationContext(db, [grok, other])
    expect(ctx.get(grok.id)).toEqual({ estimatedTokens: null, contextWindow: PROVIDER_WINDOW['grok-cli'], measured: false })
    expect(ctx.get(other.id)!.contextWindow).toBe(DEFAULT_WINDOW)
  })

  it('(+) a conversation with no stored pair is sized for the pair its latest composition ran on', () => {
    catalogWindow('openai', 'gpt-small', 32_000)
    const { conv } = conversation(null, null)
    composition(conv.id, { id: 'c1', at: '2026-09-01T00:00:00.000Z', provider: 'openai', model: 'gpt-small', estimated: 1_000 })
    expect(loadConversationContext(db, [conv]).get(conv.id)!.contextWindow).toBe(32_000)
  })

  // ── Numerator ────────────────────────────────────────────────────────

  it('(+) observed prompt tokens are the numerator, with measured=true', () => {
    const { conv } = conversation('anthropic', 'claude-sonnet')
    composition(conv.id, { id: 'c1', at: '2026-09-01T00:00:00.000Z', provider: 'anthropic', model: 'claude-sonnet', estimated: 3_000, history: 9_000, observedPrompt: 15_400 })
    expect(loadConversationContext(db, [conv]).get(conv.id)).toMatchObject({ estimatedTokens: 15_400, measured: true })
  })

  it('(−) with no observation: the section estimate plus the history estimate, measured=false', () => {
    const { conv } = conversation('anthropic', 'claude-sonnet')
    composition(conv.id, { id: 'c1', at: '2026-09-01T00:00:00.000Z', provider: 'anthropic', model: 'claude-sonnet', estimated: 3_000, history: 9_000 })
    expect(loadConversationContext(db, [conv]).get(conv.id)).toMatchObject({ estimatedTokens: 12_000, measured: false })
  })

  it('(−) a composition from before the history column counts its sections only', () => {
    const { conv } = conversation('anthropic', 'claude-sonnet')
    composition(conv.id, { id: 'c1', at: '2026-09-01T00:00:00.000Z', provider: 'anthropic', model: 'claude-sonnet', estimated: 3_000 })
    expect(loadConversationContext(db, [conv]).get(conv.id)).toMatchObject({ estimatedTokens: 3_000, measured: false })
  })

  it('(+) end to end: record with history, observe, and the conversation reads the measured size', () => {
    const recorder = createContextRecorder(db, { debug() {} })
    const { conv } = conversation('claude-code', 'claude-code-sonnet')
    const id = recorder.record({
      sections: [{ zone: 'prefix', key: 'core-identity', content: 'x'.repeat(400), chars: 400, estimatedTokens: 100, truncated: false, droppedChars: 0 }],
      entryPoint: 'conversation', conversationId: conv.id, provider: 'claude-code', model: 'claude-code-sonnet',
      contextWindow: 200_000, historyEstimatedTokens: 900,
    })
    expect(loadConversationContext(db, [conv]).get(conv.id)).toEqual({ estimatedTokens: 1_000, contextWindow: 200_000, measured: false })
    recorder.observe!(id, { promptTokens: 1_450, contextWindow: 1_000_000 })
    expect(loadConversationContext(db, [conv]).get(conv.id)).toEqual({ estimatedTokens: 1_450, contextWindow: 1_000_000, measured: true })
  })

  it('(−) without the composition table (observability off) there is no reading, only the window', () => {
    db.run(sql`DROP TABLE context_compositions`)
    const { conv } = conversation('grok-cli', 'grok-cli-default')
    expect(loadConversationContext(db, [conv]).get(conv.id)).toEqual({ estimatedTokens: null, contextWindow: PROVIDER_WINDOW['grok-cli'], measured: false })
  })
})

describe('emptyConversationContext', () => {
  it('no reading, the pair\'s known window', () => {
    expect(emptyConversationContext({ providerId: 'kimi-cli', modelId: null })).toEqual({ estimatedTokens: null, contextWindow: PROVIDER_WINDOW['kimi-cli'], measured: false })
    expect(emptyConversationContext({}).contextWindow).toBe(DEFAULT_WINDOW)
  })
})

describe('attachConversationContext — effective binding (D3)', () => {
  it('sizes the window for the pair the conversation effectively runs on, keeping the stored fields', () => {
    catalogWindow('openai', 'gpt-small', 32_000)
    const svc = createConversationService(db, createLocalBus())
    const conv = svc.create({ userId: 'u1', title: 'Agent-bound' })
    const out = svc.withContext(svc.get(conv.id)!, { providerId: 'openai', modelId: 'gpt-small' })
    expect(out.contextWindow).toBe(32_000)
    expect(out.measured).toBe(false)
    expect(out.providerId).toBeNull()
  })

  it('without a target it keeps using the stored pair (negative)', () => {
    catalogWindow('openai', 'gpt-small', 32_000)
    const svc = createConversationService(db, createLocalBus())
    const conv = svc.create({ userId: 'u1', title: 'Grok', providerId: 'grok-cli', modelId: 'grok-cli-default' })
    expect(svc.withContext(svc.get(conv.id)!).contextWindow).toBe(500_000)
    expect(svc.withContext(svc.get(conv.id)!, null).contextWindow).toBe(500_000)
  })
})
