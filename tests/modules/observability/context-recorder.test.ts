// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createContextTables } from '@modules/observability/context-schema'
import { createContextRecorder } from '@modules/observability/context-recorder'
import type { ContextSection } from '@modules/prompt-wizard/types'

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any

function section(over: Partial<ContextSection> = {}): ContextSection {
  return {
    zone: 'prefix', key: 'core-identity', content: 'body', chars: 4,
    estimatedTokens: 1, truncated: false, droppedChars: 0, ...over,
  }
}

describe('createContextRecorder', () => {
  let db: any, recorder: any
  beforeEach(() => {
    db = drizzle(new Database(':memory:'))
    createContextTables(db)
    db.run(sql`CREATE TABLE skills (id TEXT PRIMARY KEY, use_count INTEGER DEFAULT 0, last_used_at TEXT)`)
    db.run(sql`CREATE TABLE skill_usage_daily (day TEXT, skill_id TEXT, injected_count INTEGER DEFAULT 0, PRIMARY KEY (day, skill_id))`)
    recorder = createContextRecorder(db, logger)
  })

  it('writes one composition and one row per section, in order', () => {
    const id = recorder.record({
      sections: [section(), section({ key: 'runtime', zone: 'suffix' })],
      entryPoint: 'conversation', conversationId: 'c1',
    })
    expect(id).toBeTruthy()
    const comp = (db.all(sql`SELECT * FROM context_compositions`) as any[])[0]
    expect(comp).toMatchObject({ entry_point: 'conversation', conversation_id: 'c1', section_count: 2 })
    const rows = db.all(sql`SELECT ord, section_key FROM context_sections ORDER BY ord`) as any[]
    expect(rows).toEqual([{ ord: 0, section_key: 'core-identity' }, { ord: 1, section_key: 'runtime' }])
  })

  it('sums estimated tokens onto the composition', () => {
    recorder.record({ sections: [section({ estimatedTokens: 10 }), section({ estimatedTokens: 5 })], entryPoint: 'conversation' })
    const comp = (db.all(sql`SELECT estimated_tokens FROM context_compositions`) as any[])[0]
    expect(comp.estimated_tokens).toBe(15)
  })

  it('updates the daily rollup', () => {
    recorder.record({ sections: [section({ estimatedTokens: 7, truncated: true, droppedChars: 20 })], entryPoint: 'conversation' })
    recorder.record({ sections: [section({ estimatedTokens: 3 })], entryPoint: 'conversation' })
    const r = (db.all(sql`SELECT * FROM context_section_daily WHERE section_key = 'core-identity'`) as any[])[0]
    expect(r).toMatchObject({ count: 2, sum_tokens: 10, max_tokens: 7, truncated_count: 1, sum_dropped_chars: 20 })
  })

  it('bumps skill counters for injected skills only', () => {
    db.run(sql`INSERT INTO skills (id, use_count) VALUES ('s1', 0)`)
    recorder.record({
      sections: [
        section({ key: 'available-skills' }),            // listing — NOT usage
        section({ zone: 'append', key: 'skill', sourceRef: 's1' }),
      ],
      entryPoint: 'conversation',
    })
    const s = (db.all(sql`SELECT use_count, last_used_at FROM skills WHERE id = 's1'`) as any[])[0]
    expect(s.use_count).toBe(1)
    expect(s.last_used_at).toBeTruthy()
    const usage = db.all(sql`SELECT * FROM skill_usage_daily`) as any[]
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ skill_id: 's1', injected_count: 1 })
  })

  it('records the composition even when skills / skill_usage_daily are absent (own try/catch)', () => {
    const bareDb = drizzle(new Database(':memory:'))
    createContextTables(bareDb)
    // Deliberately NOT creating `skills` / `skill_usage_daily` — those are
    // created by a later task's migration. A database that has not migrated
    // yet must still get its composition + section rows recorded.
    const bareRecorder = createContextRecorder(bareDb, logger)
    const id = bareRecorder.record({
      sections: [section({ zone: 'append', key: 'skill', sourceRef: 's1' })],
      entryPoint: 'conversation',
    })
    expect(id).toBeTruthy()
    const comp = (bareDb.all(sql`SELECT * FROM context_compositions`) as any[])[0]
    expect(comp).toMatchObject({ section_count: 1 })
    const rows = bareDb.all(sql`SELECT section_key FROM context_sections`) as any[]
    expect(rows).toEqual([{ section_key: 'skill' }])
  })

  it('fails open and returns null when the write throws', () => {
    const broken = { run() { throw new Error('db gone') }, all() { throw new Error('db gone') } } as any
    expect(createContextRecorder(broken, logger).record({ sections: [section()], entryPoint: 'conversation' })).toBeNull()
  })
})
