// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The dead-skill detector PROPOSES; it never applies. Decision A2 of the
// phase-3 autonomy design makes every skill/prompt/routing change a proposal
// on the approval ladder, so the invariant these tests defend is narrow and
// absolute: runDeadSkillScan writes to autonomy_approvals and to NOTHING else,
// and the single code path that flips `skills.enabled` is
// applyDeadSkillApproval, reached only from an APPROVED decision.
//
// The approval queue here is the REAL autonomyPolicy over a real
// autonomy_approvals table — a hand-rolled fake would not exercise the pending
// check, which exists precisely because the queue's own enqueue dedup never
// fires for a scheduled scan (no argHash / conversationId / toolName).

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { runDeadSkillScan, applyDeadSkillApproval, SKILL_DISABLE_KIND, type DeadScanDeps } from '@modules/skills/dead-skill-detector'
import { DEFAULT_CLASSIFY_CONFIG } from '@modules/skills/classify-skill'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy'

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
  enabled?: boolean
  useCount?: number
  lastUsedAt?: string | null
  createdAt?: string
}) {
  db.run(sql`INSERT INTO skills (id, name, description, category, trigger_patterns, capabilities, content, source, enabled, use_count, last_used_at, created_at, updated_at)
    VALUES (${row.id}, ${row.name ?? row.id}, '', NULL, '[]', '[]', 'body', ${row.source ?? 'bundled'},
            ${row.enabled === false ? 0 : 1}, ${row.useCount ?? 0}, ${row.lastUsedAt ?? null},
            ${row.createdAt ?? daysAgo(400)}, ${daysAgo(0)})`)
}

const silentLogger = { info() {}, debug() {}, warn() {}, error() {} }

let db: ReturnType<typeof createMemoryDb>
let loader: ReturnType<typeof createSkillLoader>
let policy: ReturnType<typeof createAutonomyPolicy>
let created: { category: string; kind?: string; inputJson?: string; preview?: string; reason?: string }[]
let deps: DeadScanDeps

beforeEach(() => {
  db = createMemoryDb()
  createSkillsTables(db)
  createAutonomyTables(db)
  loader = createSkillLoader(db, silentLogger)
  policy = createAutonomyPolicy(db)
  created = []

  // One healthy skill (used two days ago) and one whose source file vanished.
  insertSkill(db, { id: 'healthy', useCount: 5, lastUsedAt: daysAgo(2) })
  insertSkill(db, { id: 'orphan-enabled' })

  deps = {
    db,
    loader,
    classifyConfig: DEFAULT_CLASSIFY_CONFIG,
    autonomyPolicy: {
      createApproval(input) {
        created.push(input)
        return policy.createApproval(input)
      },
    },
    logger: silentLogger,
    now: () => now,
    orphanIds: ['orphan-enabled'],
  }
})

describe('runDeadSkillScan — proposes, never applies', () => {
  it('enqueues one approval per candidate and applies nothing', () => {
    const r = runDeadSkillScan(deps)
    expect(r).toEqual({ proposed: 1, skipped: 0 })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ category: 'skill.adopt', kind: 'skill_disable' })
    expect(JSON.parse(created[0].inputJson!)).toEqual({ skillId: 'orphan-enabled', classification: 'orphan' })
    expect(loader.get('orphan-enabled')!.enabled).toBe(true) // NOT applied
  })

  it('leaves every skill row untouched — the scan writes only to the approval queue', () => {
    const before = db.all(sql`SELECT id, enabled, disabled_reason, disabled_at, disabled_by, updated_at FROM skills ORDER BY id`)
    runDeadSkillScan(deps)
    const after = db.all(sql`SELECT id, enabled, disabled_reason, disabled_at, disabled_by, updated_at FROM skills ORDER BY id`)
    expect(after).toEqual(before)
  })

  it('does not re-enqueue a candidate that already has a pending approval', () => {
    runDeadSkillScan(deps)
    const second = runDeadSkillScan(deps)
    expect(second).toEqual({ proposed: 0, skipped: 1 })
    expect(created).toHaveLength(1)
  })

  it('the pending check is per skill — an unrelated pending proposal does not block a new one', () => {
    runDeadSkillScan(deps)
    insertSkill(db, { id: 'shadowed-skill' })
    db.run(sql`INSERT INTO skill_shadowed_sources (skill_id, path, root, seen_at)
      VALUES ('shadowed-skill', 'other/shadowed-skill.md', 'config/skills', ${daysAgo(0)})`)

    const r = runDeadSkillScan(deps)
    expect(r).toEqual({ proposed: 1, skipped: 1 })
    expect(JSON.parse(created[1].inputJson!)).toEqual({ skillId: 'shadowed-skill', classification: 'shadowed' })
  })

  it('proposes nothing when no autonomy policy is available', () => {
    const r = runDeadSkillScan({ ...deps, autonomyPolicy: undefined })
    expect(r.proposed).toBe(0)
    expect(loader.get('orphan-enabled')!.enabled).toBe(true)
    expect(db.all(sql`SELECT id FROM autonomy_approvals`)).toHaveLength(0)
  })
})

describe('applyDeadSkillApproval — the only apply path', () => {
  it('applies only through setEnabled, and only on an approved decision', () => {
    runDeadSkillScan(deps)
    const id = (db.all(sql`SELECT id FROM autonomy_approvals`) as any[])[0].id

    expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'rejected' })).toBeNull()
    expect(loader.get('orphan-enabled')!.enabled).toBe(true)

    expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'approved' })).toBe('orphan-enabled')
    const s = loader.get('orphan-enabled')!
    expect(s.enabled).toBe(false)
    expect(s.disabledReason).toBe('orphan')
    expect(s.disabledBy).toBe('detector')
  })

  it('ignores approvals of a different kind', () => {
    db.run(sql`INSERT INTO autonomy_approvals (category, kind, status, input_json, requested_at)
      VALUES ('tool.exec', 'tool_call', 'approved', '{}', '2026-08-24')`)
    const id = (db.all(sql`SELECT id FROM autonomy_approvals ORDER BY id DESC LIMIT 1`) as any[])[0].id
    expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'approved' })).toBeNull()
  })

  it('ignores an approval id that does not exist, and one carrying no skillId', () => {
    expect(applyDeadSkillApproval({ db, loader }, { approvalId: 9999, status: 'approved' })).toBeNull()

    db.run(sql`INSERT INTO autonomy_approvals (category, kind, status, input_json, requested_at)
      VALUES ('skill.adopt', ${SKILL_DISABLE_KIND}, 'approved', '{"classification":"orphan"}', '2026-08-24')`)
    const id = (db.all(sql`SELECT id FROM autonomy_approvals ORDER BY id DESC LIMIT 1`) as any[])[0].id
    expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'approved' })).toBeNull()
    expect(loader.get('orphan-enabled')!.enabled).toBe(true)
  })

  it('re-proposes after a rejection — a rejected row is no longer pending', () => {
    runDeadSkillScan(deps)
    const id = (db.all(sql`SELECT id FROM autonomy_approvals`) as any[])[0].id
    policy.decide(Number(id), 'rejected', 'owner')

    expect(runDeadSkillScan(deps)).toEqual({ proposed: 1, skipped: 0 })
    expect(loader.get('orphan-enabled')!.enabled).toBe(true)
  })

  it('a redelivered approval event does not override an owner re-enable (BLOCKING 2 fix)', () => {
    runDeadSkillScan(deps)
    const id = (db.all(sql`SELECT id FROM autonomy_approvals`) as any[])[0].id

    // First delivery: applies the disable as normal.
    expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'approved' })).toBe('orphan-enabled')
    expect(loader.get('orphan-enabled')!.enabled).toBe(false)

    // Owner explicitly re-enables the skill after the fact.
    loader.setEnabled('orphan-enabled', true)
    expect(loader.get('orphan-enabled')!.enabled).toBe(true)

    // The bus redelivers the same already-actioned 'approved' event (e.g. a
    // restart/replay of undelivered events). It must be a no-op, not a
    // silent re-disable that overrides the owner's explicit decision.
    expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'approved' })).toBeNull()
    expect(loader.get('orphan-enabled')!.enabled).toBe(true)
  })

  it('ignores a row with genuinely malformed (unparseable) input_json, instead of throwing', () => {
    db.run(sql`INSERT INTO autonomy_approvals (category, kind, status, input_json, requested_at)
      VALUES ('skill.adopt', ${SKILL_DISABLE_KIND}, 'approved', '{not valid json', '2026-08-24')`)
    const id = (db.all(sql`SELECT id FROM autonomy_approvals ORDER BY id DESC LIMIT 1`) as any[])[0].id
    expect(() => applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'approved' })).not.toThrow()
    expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'approved' })).toBeNull()
  })
})
