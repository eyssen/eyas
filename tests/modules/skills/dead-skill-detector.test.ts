// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { buildInventory, type InventoryRow } from '@modules/skills/skill-inventory'
import { findDeadCandidates } from '@modules/skills/dead-skill-detector'
import { DEFAULT_CLASSIFY_CONFIG } from '@modules/skills/classify-skill'

function createSkillsTables(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    trigger_patterns TEXT,
    capabilities TEXT,
    version TEXT DEFAULT '1.0.0',
    content TEXT NOT NULL,
    skill_type TEXT NOT NULL DEFAULT 'knowledge',
    tool_config TEXT,
    integration_config TEXT,
    sources TEXT,
    source TEXT NOT NULL DEFAULT 'user',
    source_path TEXT,
    source_root TEXT,
    last_seen_at TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    disabled_reason TEXT,
    disabled_at TEXT,
    disabled_by TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS skill_shadowed_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT NOT NULL,
    path TEXT NOT NULL,
    root TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    UNIQUE(skill_id, path, root)
  )`)
}

const now = new Date('2026-08-24T00:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()

function insertSkill(db: any, row: {
  id: string
  name?: string
  source?: string
  category?: string
  enabled?: boolean
  useCount?: number
  lastUsedAt?: string | null
  createdAt?: string
}) {
  db.run(sql`INSERT INTO skills (id, name, description, category, trigger_patterns, capabilities, content, source, enabled, use_count, last_used_at, created_at, updated_at)
    VALUES (${row.id}, ${row.name ?? row.id}, '', ${row.category ?? null}, '[]', '[]', 'body', ${row.source ?? 'bundled'},
            ${row.enabled === false ? 0 : 1}, ${row.useCount ?? 0}, ${row.lastUsedAt ?? null},
            ${row.createdAt ?? daysAgo(400)}, ${daysAgo(0)})`)
}

let db: ReturnType<typeof createMemoryDb>

beforeEach(() => {
  db = createMemoryDb()
  createSkillsTables(db)
})

describe('findDeadCandidates', () => {
  it('returns only enabled skills the policy proposes disabling', () => {
    insertSkill(db, { id: 'healthy', useCount: 5, lastUsedAt: daysAgo(2), createdAt: daysAgo(400) })
    insertSkill(db, { id: 'orphan-enabled', enabled: true, createdAt: daysAgo(400) })
    insertSkill(db, { id: 'orphan-disabled', enabled: false, createdAt: daysAgo(400) })

    const out = findDeadCandidates(db, DEFAULT_CLASSIFY_CONFIG, now, ['orphan-enabled', 'orphan-disabled'])
    expect(out.map((r) => r.id)).toEqual(['orphan-enabled'])
    expect(out[0]).toMatchObject({ category: 'orphan', proposeDisable: true })
  })
})

describe('buildInventory', () => {
  it('joins shadowed sources onto the inventory row', () => {
    insertSkill(db, { id: 'websocket-patterns' })
    db.run(sql`INSERT INTO skill_shadowed_sources (skill_id, path, root, seen_at)
      VALUES ('websocket-patterns', 'web/realtime/websocket-patterns.md', 'config/skills', ${daysAgo(0)})`)

    const inv = buildInventory(db)
    const row = inv.find((r: InventoryRow) => r.id === 'websocket-patterns')!
    expect(row.shadowedSources).toEqual([{ path: 'web/realtime/websocket-patterns.md', root: 'config/skills' }])
  })

  it('reports zero shadowed sources as an empty array, not null', () => {
    insertSkill(db, { id: 'alpha' })
    const row = buildInventory(db).find((r: InventoryRow) => r.id === 'alpha')!
    expect(row.shadowedSources).toEqual([])
  })
})
