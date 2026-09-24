import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'

const testDb = createTestDb('provider-config')
let db: ReturnType<typeof testDb.open>

beforeEach(() => { db = testDb.open() })
afterEach(() => testDb.cleanup())

describe('provider_config table', () => {
  it('creates provider_config row', () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('anthropic', 1, '{}', ${now})`)
    const rows = db.all(sql`SELECT * FROM provider_config WHERE id = 'anthropic'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('anthropic')
    expect(rows[0].enabled).toBe(1)
  })

  it('enforces primary key uniqueness', () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('openai', 1, '{}', ${now})`)
    expect(() => {
      db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('openai', 1, '{}', ${now})`)
    }).toThrow()
  })
})

describe('model_config table', () => {
  it('creates model_config row with FK to provider_config', () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('anthropic', 1, '{}', ${now})`)
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, max_output_tokens, supports_tools, supports_images, supports_streaming, updated_at) VALUES ('anthropic:claude-sonnet-4-5', 'anthropic', 'claude-sonnet-4-5-20250514', 1, 'Claude Sonnet 4.5', 200000, 16000, 1, 1, 1, ${now})`)
    const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = 'anthropic'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].model_id).toBe('claude-sonnet-4-5-20250514')
  })

  it('can disable a model', () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('openai', 1, '{}', ${now})`)
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, max_output_tokens, supports_tools, supports_images, supports_streaming, updated_at) VALUES ('openai:gpt-4o', 'openai', 'gpt-4o', 1, 'GPT-4o', 128000, 16384, 1, 1, 1, ${now})`)
    db.run(sql`UPDATE model_config SET enabled = 0 WHERE id = 'openai:gpt-4o'`)
    const rows = db.all(sql`SELECT enabled FROM model_config WHERE id = 'openai:gpt-4o'`) as any[]
    expect(rows[0].enabled).toBe(0)
  })
})
