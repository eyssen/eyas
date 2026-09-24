// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E3 — the one-time, idempotent boot migration of the legacy thinking
// columns into the effort ladder: a legacy thinking budget becomes the level
// it was chosen as, off-ladder effort values become Auto, and Deep rows keep
// their Deep → Max default.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { conversationsModule } from '@modules/conversations/index'
import { effortFromLegacyBudget, migrateLegacyThinkingToEffort } from '@modules/conversations/effort-migration'
import { createConversationService } from '@modules/conversations/conversation-service'

function quietLogger() {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error() {}, debug() {}, child() { return logger } }
  return logger
}

/** A database as an install from before the effort ladder has it (thinking + budget + a 4-value effort). */
function legacyDb() {
  const db = createMemoryDb()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT, orchestration TEXT)`)
  const now = new Date().toISOString()
  const rows: Array<[string, string, number | null, string | null, string | null]> = [
    // id, thinking, thinking_budget, effort, orchestration
    ['on-5000', 'on', 5000, null, null],
    ['on-7000', 'on', 7000, null, 'auto'],
    ['on-25000', 'on', 25000, null, 'solo'],
    ['on-100000', 'on', 100000, null, null],
    ['on-null', 'on', null, null, null],
    ['off', 'off', null, null, null],
    ['extreme', 'off', null, 'extreme', null],
    ['auto-string', 'off', null, 'auto', null],
    ['extreme-on', 'on', 25000, 'extreme', null],
    ['explicit', 'on', 100000, 'low', null],
    ['xhigh', 'off', null, 'xhigh', null],
    ['deep-null', 'off', null, null, 'deep'],
    ['deep-on', 'on', 5000, null, 'deep'],
  ]
  for (const [id, thinking, budget, effort, orchestration] of rows) {
    db.run(sql`INSERT INTO conversations (id, user_id, created_at, updated_at, thinking, thinking_budget, effort, orchestration)
      VALUES (${id}, 'u', ${now}, ${now}, ${thinking}, ${budget}, ${effort}, ${orchestration})`)
  }
  return db
}

function state(db: any): Record<string, { effort: string | null; thinking: string; budget: number | null }> {
  const rows = db.all(sql`SELECT id, effort, thinking, thinking_budget FROM conversations ORDER BY id`) as any[]
  return Object.fromEntries(rows.map((r) => [r.id, { effort: r.effort, thinking: r.thinking, budget: r.thinking_budget }]))
}

describe('effortFromLegacyBudget', () => {
  it('maps the legacy budget presets to their levels (positive)', () => {
    expect(effortFromLegacyBudget(5000)).toBe('low')
    expect(effortFromLegacyBudget(1024)).toBe('low')
    expect(effortFromLegacyBudget(10000)).toBe('medium')
    expect(effortFromLegacyBudget(25000)).toBe('high')
    expect(effortFromLegacyBudget(100000)).toBe('max')
  })

  it('a missing or non-finite budget is the old 10000 default: medium (negative)', () => {
    expect(effortFromLegacyBudget(null)).toBe('medium')
    expect(effortFromLegacyBudget(undefined)).toBe('medium')
    expect(effortFromLegacyBudget(Number.NaN)).toBe('medium')
  })
})

describe('legacy thinking → effort migration', () => {
  it('converts thinking budgets to levels and clears the legacy flag and budget (positive)', () => {
    const db = legacyDb()
    const result = migrateLegacyThinkingToEffort(db, quietLogger())
    const s = state(db)
    expect(s['on-5000']).toEqual({ effort: 'low', thinking: 'off', budget: null })
    expect(s['on-7000']).toEqual({ effort: 'medium', thinking: 'off', budget: null })
    expect(s['on-25000']).toEqual({ effort: 'high', thinking: 'off', budget: null })
    expect(s['on-100000']).toEqual({ effort: 'max', thinking: 'off', budget: null })
    expect(s['on-null']).toEqual({ effort: 'medium', thinking: 'off', budget: null })
    // An off-ladder effort is cleared first, so its legacy thinking intent survives.
    expect(s['extreme-on']).toEqual({ effort: 'high', thinking: 'off', budget: null })
    expect(result).toEqual({ cleared: 3, converted: 6 })
  })

  it('leaves rows without legacy thinking, and rows with a real level, as they are (negative)', () => {
    const db = legacyDb()
    migrateLegacyThinkingToEffort(db, quietLogger())
    const s = state(db)
    expect(s.off).toEqual({ effort: null, thinking: 'off', budget: null })
    expect(s.xhigh).toEqual({ effort: 'xhigh', thinking: 'off', budget: null })
    // An explicit level wins over the legacy budget: nothing to convert.
    expect(s.explicit.effort).toBe('low')
  })

  it("off-ladder values ('extreme', 'auto') become NULL (Auto) with one warning that carries the count", () => {
    const db = legacyDb()
    const logger = quietLogger()
    migrateLegacyThinkingToEffort(db, logger)
    const s = state(db)
    expect(s.extreme.effort).toBeNull()
    expect(s['auto-string'].effort).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ table: 'conversations', count: 3 }), expect.any(String))
  })

  it('Deep rows without an effort are untouched: Deep still defaults them to Max', () => {
    const db = legacyDb()
    migrateLegacyThinkingToEffort(db, quietLogger())
    const s = state(db)
    expect(s['deep-null']).toEqual({ effort: null, thinking: 'off', budget: null })
    expect(s['deep-on']).toEqual({ effort: null, thinking: 'on', budget: 5000 })
  })

  it('running it twice is a no-op', () => {
    const db = legacyDb()
    migrateLegacyThinkingToEffort(db, quietLogger())
    const once = state(db)
    const logger = quietLogger()
    const second = migrateLegacyThinkingToEffort(db, logger)
    expect(second).toEqual({ cleared: 0, converted: 0 })
    expect(state(db)).toEqual(once)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('runs in the module boot, and a second boot changes nothing', async () => {
    const db = legacyDb()
    const ctx = { db, logger: quietLogger(), bus: { emit() {}, on() {}, off() {} }, config: {} } as any
    await conversationsModule.onRegister!(ctx)
    const once = state(db)
    expect(once['on-5000'].effort).toBe('low')
    expect(once.extreme.effort).toBeNull()
    await conversationsModule.onRegister!(ctx)
    expect(state(db)).toEqual(once)
  })

  it('a table that is not there yet is reported, not thrown', () => {
    const db = createMemoryDb()
    const logger = quietLogger()
    expect(migrateLegacyThinkingToEffort(db, logger)).toEqual({ cleared: 0, converted: 0 })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('the service exposes the migrated effort and no legacy thinking fields', async () => {
    const db = legacyDb()
    await conversationsModule.onRegister!({ db, logger: quietLogger(), bus: { emit() {}, on() {}, off() {} }, config: {} } as any)
    const svc = createConversationService(db)
    const conv = svc.get('on-25000')!
    expect(conv.effort).toBe('high')
    expect(conv).not.toHaveProperty('thinking')
    expect(conv).not.toHaveProperty('thinkingBudget')
  })
})
