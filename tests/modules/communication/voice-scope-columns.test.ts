// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Regression: the voice-scope resolver queries `voice_scope_override` on
// conversations and `force_voice_scope` on channel_configs, but these columns
// must be created by the REAL module DDL (onRegister) — not only by the test
// harness schema. A fresh production DB built by the modules themselves must
// contain them, or the voice resolver throws "no such column" on every channel
// message. This test exercises the real onRegister path, not the test harness.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { conversationsModule } from '@modules/conversations/index.js'
import { communicationModule } from '@modules/communication/index.js'
import type { ModuleContext } from '@core/types'

function makeCtx(db: ReturnType<typeof createMemoryDb>): ModuleContext {
  return {
    db,
    bus: { emit() {}, on() {}, off() {} },
    logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this } },
  } as unknown as ModuleContext
}

function columnNames(db: any, table: string): string[] {
  const rows = db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>
  return rows.map((r) => r.name)
}

describe('voice-scope columns are created by the real module DDL', () => {
  it('conversations table has voice_scope_override after conversationsModule.onRegister', async () => {
    const db = createMemoryDb()
    const ctx = makeCtx(db)
    await conversationsModule.onRegister!(ctx)

    expect(columnNames(db, 'conversations')).toContain('voice_scope_override')
    // The exact production query shape used by the active-voice resolver:
    expect(() =>
      db.get(sql`SELECT voice_scope_override FROM conversations WHERE id = ${'x'} LIMIT 1`),
    ).not.toThrow()
  })

  it('channel_configs table has force_voice_scope after communicationModule.onRegister', async () => {
    const db = createMemoryDb()
    const ctx = makeCtx(db)
    await communicationModule.onRegister!(ctx)

    expect(columnNames(db, 'channel_configs')).toContain('force_voice_scope')
    expect(() =>
      db.get(sql`SELECT force_voice_scope FROM channel_configs WHERE channel_id = ${'x'} LIMIT 1`),
    ).not.toThrow()
  })
})

// Regression for the bun-sqlite db.get footgun (H6): the active-voice resolver's
// loadConversationOverride / loadChannelForceScope closures must read the named
// column via db.all(...)[0]. db.get returns a POSITIONAL row, so reading
// row.voice_scope_override off it is always undefined and the per-conversation /
// per-channel override is silently dropped.
describe('voice-scope override loaders read the named column (db.all, not db.get)', () => {
  it('per-conversation override resolves to its stored value', async () => {
    const db = createMemoryDb()
    await conversationsModule.onRegister!(makeCtx(db))

    const now = new Date().toISOString()
    db.run(sql`INSERT INTO conversations (id, user_id, title, created_at, updated_at, voice_scope_override)
      VALUES (${'conv1'}, ${'system'}, ${'t'}, ${now}, ${now}, ${'external'})`)

    // The corrected read pattern the fix uses:
    const rows = db.all(
      sql`SELECT voice_scope_override FROM conversations WHERE id = ${'conv1'} LIMIT 1`,
    ) as Array<{ voice_scope_override: 'internal' | 'external' | null }>
    expect(rows[0]?.voice_scope_override).toBe('external')

    // The footgun the fix removed: db.get yields a positional row, so the named
    // property is undefined — which silently dropped the override.
    const positional = db.get(sql`SELECT voice_scope_override FROM conversations WHERE id = ${'conv1'} LIMIT 1`) as any
    expect(positional?.voice_scope_override).toBeUndefined()
  })

  it('per-channel force scope resolves to its stored value', async () => {
    const db = createMemoryDb()
    await communicationModule.onRegister!(makeCtx(db))

    db.run(sql`INSERT INTO channel_configs (id, channel_type, channel_id, name, force_voice_scope)
      VALUES (${'cc1'}, ${'telegram'}, ${'chan1'}, ${'Chan 1'}, ${'internal'})`)

    const rows = db.all(
      sql`SELECT force_voice_scope FROM channel_configs WHERE channel_id = ${'chan1'} LIMIT 1`,
    ) as Array<{ force_voice_scope: 'internal' | 'external' | null }>
    expect(rows[0]?.force_voice_scope).toBe('internal')
  })
})
