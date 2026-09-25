// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { runSkillScan, findOrphans, extensionRootId } from '@modules/skills/skill-inventory'
import { createMemoryDb } from '../../helpers/test-db'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

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
  dir = join(tmpdir(), `eyas-skills-orphan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  try { rmSync(dir, { recursive: true }) } catch {}
})

describe('orphan detection (guarded)', () => {
  // Negative case first: an incomplete scan must never trigger orphan detection,
  // or a single transient read error would make every file the scan never
  // reached look orphaned — a proposal to disable most of the inventory.
  it('does NOT run when the scan was incomplete', async () => {
    writeFileSync(join(dir, 'good.md'), '---\nname: Good\n---\nBody.')
    // A directory sharing the '.md' suffix is picked up by the recursive scan
    // like a file, but reading it fails deterministically (EISDIR) — this is
    // the same technique skill-loader.test.ts uses to force an incomplete scan.
    mkdirSync(join(dir, 'broken.md'))

    const result = await runSkillScan(db, loader, dir, 'config/skills')
    expect(result.complete).toBe(false)
    expect(result.orphans).toEqual([])
    expect(result.orphanDetectionSkipped).toBe(true)
  })

  it('finds a skill whose file disappeared', async () => {
    writeFileSync(join(dir, 'alpha.md'), '---\nid: alpha\nname: Alpha\n---\nBody alpha.')
    writeFileSync(join(dir, 'beta.md'), '---\nid: beta\nname: Beta\n---\nBody beta.')
    await runSkillScan(db, loader, dir, 'config/skills')

    // findOrphans compares ISO-string timestamps (ms resolution) — without this,
    // an in-memory scan can complete within the same millisecond as the first,
    // making last_seen_at tie scanStartedAt instead of falling strictly before it.
    await new Promise((r) => setTimeout(r, 5))
    await rm(join(dir, 'beta.md'))
    const result = await runSkillScan(db, loader, dir, 'config/skills')

    expect(result.complete).toBe(true)
    expect(result.orphanDetectionSkipped).toBe(false)
    expect(result.orphans).toEqual(['beta'])
  })

  it('never reports a user-created skill as orphaned', async () => {
    writeFileSync(join(dir, 'alpha.md'), '---\nid: alpha\nname: Alpha\n---\nBody alpha.')
    loader.create({ name: 'hand-made', content: 'x' })

    const result = await runSkillScan(db, loader, dir, 'config/skills')
    expect(result.orphans).not.toContain('hand-made')
  })

  // BLOCKING 1 (final review): core root ('config/skills', a bare literal)
  // and extension roots must never be able to collide. extensionRootId()
  // prefixes every extension root with 'ext:' so a core-root orphan sweep
  // can never pick up an extension-sourced row — even a contrived one whose
  // underlying directory string happens to equal the core root literal.
  it('never returns an extension-sourced skill from a core-root orphan sweep, even when the extension dir is contrived to resemble the core root', () => {
    const scanStartedAt = new Date().toISOString()
    const contrivedExtDir = 'config/skills' // pathological: resolves to the same literal as CORE_ROOT
    const extRoot = extensionRootId(contrivedExtDir)
    expect(extRoot).not.toBe('config/skills')

    // Stale on purpose — last_seen_at before scanStartedAt is exactly what
    // findOrphans treats as "vanished" for a matching root. If namespace
    // isolation ever broke, this row would show up as an orphan.
    const staleSeenAt = new Date(Date.parse(scanStartedAt) - 1000).toISOString()
    db.run(sql`INSERT INTO skills (id, name, content, source, source_path, source_root, last_seen_at, enabled, created_at, updated_at)
      VALUES ('ext-skill', 'Ext Skill', 'x', 'bundled', 'foo.md', ${extRoot}, ${staleSeenAt}, 1, ${staleSeenAt}, ${staleSeenAt})`)

    const orphans = findOrphans(db, 'config/skills', scanStartedAt)
    expect(orphans).not.toContain('ext-skill')
  })
})
