// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { wins } from '@modules/skills/skill-inventory'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createMemoryDb } from '../../helpers/test-db'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('precedence ladder', () => {
  const core = (path: string) => ({ source: 'bundled', root: 'config/skills', path })

  it('is deterministic for the live websocket-patterns collision', () => {
    const a = core('api/websocket-patterns.md')
    const b = core('web/realtime/websocket-patterns.md')
    // lexicographic tie-break within one root: 'api/...' < 'web/...'
    expect(wins(a, b)).toBe(true)
    expect(wins(b, a)).toBe(false)
  })

  it('is deterministic for the live slack-integration collision', () => {
    const a = core('communication/messaging/slack-integration.md')
    const b = core('integrations/slack.md')
    expect(wins(a, b)).toBe(true)
    expect(wins(b, a)).toBe(false)
  })

  it('ranks user above generated above extension above core', () => {
    expect(wins({ source: 'user', root: 'db', path: 'z' }, core('a'))).toBe(true)
    expect(wins({ source: 'generated', root: 'db', path: 'z' }, core('a'))).toBe(true)
    expect(wins(core('a'), { source: 'user', root: 'db', path: 'z' })).toBe(false)
  })

  it('is antisymmetric — no pair where both win', () => {
    const pairs = [[core('a'), core('b')], [{ source: 'user', root: 'db', path: 'x' }, core('a')]]
    for (const [x, y] of pairs) expect(wins(x, y) && wins(y, x)).toBe(false)
  })
})

// The two real collisions in config/skills today: both files define the same
// skill `name`, so the loader derives the same id from either one. These tests
// drive the actual upsert branch in skill-loader.ts (not just wins() in
// isolation) to prove the ladder is what decides the winner, the loser is
// recorded in skill_shadowed_sources, and repeated scans stay stable.
describe('loader collision integration', () => {
  const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

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

  let db: ReturnType<typeof createMemoryDb>
  let loader: ReturnType<typeof createSkillLoader>
  let dir: string

  beforeEach(() => {
    db = createMemoryDb()
    createSkillsTables(db)
    loader = createSkillLoader(db, mockLogger)
    dir = join(tmpdir(), `eyas-skills-collision-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(dir, 'api'), { recursive: true })
    mkdirSync(join(dir, 'web/realtime'), { recursive: true })
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true }) } catch {}
  })

  function writeCollisionFixtures() {
    writeFileSync(join(dir, 'api/websocket-patterns.md'), '---\nname: websocket-patterns\ndescription: api version\n---\nAPI body.')
    writeFileSync(join(dir, 'web/realtime/websocket-patterns.md'), '---\nname: websocket-patterns\ndescription: web version\n---\nWeb body.')
  }

  it('resolves the real websocket-patterns collision deterministically and records the shadowed loser', async () => {
    writeCollisionFixtures()

    const scan = await loader.loadFromDirectory(dir, 'config/skills')
    expect(scan.shadowed).toBe(1)

    const winner = loader.get('websocket-patterns')
    expect(winner!.description).toBe('api version') // 'api/...' < 'web/realtime/...'

    const shadowedRows = db.all(sql`SELECT skill_id, path, root FROM skill_shadowed_sources`) as any[]
    expect(shadowedRows).toEqual([
      { skill_id: 'websocket-patterns', path: 'web/realtime/websocket-patterns.md', root: 'config/skills' },
    ])
  })

  it('produces identical skill rows when the same colliding directory is scanned twice', async () => {
    writeCollisionFixtures()

    await loader.loadFromDirectory(dir, 'config/skills')
    const firstRow = (db.all(sql`SELECT source_path, source_root, content, description FROM skills WHERE id = 'websocket-patterns'`) as any[])[0]
    const firstShadowed = db.all(sql`SELECT skill_id, path, root FROM skill_shadowed_sources`) as any[]

    await loader.loadFromDirectory(dir, 'config/skills')
    const secondRow = (db.all(sql`SELECT source_path, source_root, content, description FROM skills WHERE id = 'websocket-patterns'`) as any[])[0]
    const secondShadowed = db.all(sql`SELECT skill_id, path, root FROM skill_shadowed_sources`) as any[]

    expect(secondRow).toEqual(firstRow)
    expect(secondShadowed).toEqual(firstShadowed)
    expect((db.all(sql`SELECT id FROM skills`) as any[]).length).toBe(1)
  })
})
