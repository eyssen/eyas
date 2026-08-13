// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 3 — live onStart wiring. The dormant module's onStart (previously a
// no-op — see index.ts's original comment "services are factory-built") is
// rewritten to: mount the HTTP routes, build the REAL skills registry ONLY
// when securityGate.autonomyPolicy is reachable (pairing it with the real
// approvalQueue — see real-adoption.test.ts for why that pairing is load-
// bearing), and register a scheduler scan loop that reads the sleep-time
// consolidator's mined `skill_candidates`, authors a SKILL.md, and enqueues
// it for owner approval — gated fire-time on the `skill.adopt` feature flag.
//
// These tests drive the REAL onStart (not a re-implementation), so a
// regression in the production wiring fails them.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'
import { createAutonomyFeatures } from '@modules/security-gate/autonomy-features.js'
import { skillGenerationModule } from '@modules/skill-generation/index.js'
import { createSkillLoader } from '@modules/skills/skill-loader.js'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }

// Mirrors the real DDL in src/modules/skills/index.ts's onRegister.
function createSkillsTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT,
    trigger_patterns TEXT, capabilities TEXT, version TEXT DEFAULT '1.0.0',
    content TEXT NOT NULL, skill_type TEXT NOT NULL DEFAULT 'knowledge',
    tool_config TEXT, integration_config TEXT, sources TEXT,
    source TEXT NOT NULL DEFAULT 'user', enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
}

// Mirrors the real DDL in src/modules/memory/schema.ts (skill_candidates) —
// created directly here so this test doesn't need to boot the whole memory
// module just to get one table.
function createMinedCandidatesTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS skill_candidates (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, slug TEXT NOT NULL,
    rationale TEXT NOT NULL, tool_call_count INTEGER NOT NULL,
    proposed_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    reviewed_at TEXT, reviewer_id TEXT
  )`)
}

function seedMinedCandidate(
  db: any,
  id = 'cand-1',
  slug = 'read-grep-write',
  status = 'pending',
  rationale = 'Observed 3x, avg 4 turns, 90% success',
) {
  db.run(sql`INSERT INTO skill_candidates (id, session_id, slug, rationale, tool_call_count, proposed_at, status)
    VALUES (${id}, 's-1', ${slug}, ${rationale}, 3, ${Date.now()}, ${status})`)
}

function fakeScheduler() {
  const handlers = new Map<string, () => Promise<unknown>>()
  const jobs: Array<{ handler: string }> = []
  return {
    registerHandler: (name: string, fn: () => Promise<unknown>) => { handlers.set(name, fn) },
    create: (job: { handler: string }) => { jobs.push(job) },
    list: () => jobs,
    has: (name: string) => handlers.has(name),
    run: (name: string) => handlers.get(name)!(),
  }
}

async function buildCtx(opts: { rootDir: string; withAutonomyPolicy?: boolean; logger?: any; model?: any }) {
  const db = createMemoryDb()
  createSkillsTable(db)
  createMinedCandidatesTable(db)
  const permissions = createPermissionRegistry()
  const scheduler = fakeScheduler()
  const logger = opts.logger ?? noopLogger

  const features = createAutonomyFeatures(db)
  let securityGate: any = { features }
  if (opts.withAutonomyPolicy !== false) {
    createAutonomyTables(db)
    const autonomyPolicy = createAutonomyPolicy(db, logger)
    autonomyPolicy.seedDefaults()
    securityGate = { autonomyPolicy, features }
  }

  const ctx: any = {
    db,
    http: new Hono(),
    logger,
    permissions,
    config: { skillGeneration: { rootDir: opts.rootDir } },
    securityGate,
    scheduler,
    model: opts.model,
    hasModule: (id: string) => id === 'scheduler' || id === 'memory',
  }
  return { ctx, db, scheduler }
}

describe('skill-generation onStart — live wiring (Task 3)', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eyas-skillgen-onstart-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  })

  it('(a) mounts the HTTP routes — a GET returns non-404', async () => {
    const { ctx } = await buildCtx({ rootDir: tmp })
    await skillGenerationModule.onRegister(ctx)
    await skillGenerationModule.onStart(ctx)

    const res = await ctx.http.request('/api/v1/skill-generation/candidates')
    expect(res.status).not.toBe(404)
  })

  it('(b) scan does NOT author while skill.adopt is OFF (default); authors + enqueues once ON; the real registry stays untouched until owner approval', async () => {
    const { ctx, db, scheduler } = await buildCtx({ rootDir: tmp })
    seedMinedCandidate(db)
    await skillGenerationModule.onRegister(ctx)
    await skillGenerationModule.onStart(ctx)

    expect(scheduler.has('skillGeneration.scan')).toBe(true)

    const off = (await scheduler.run('skillGeneration.scan')) as { authored: number; enqueued: number }
    expect(off).toEqual({ authored: 0, enqueued: 0 })
    expect((db as any).all(sql`SELECT * FROM generated_skills`)).toHaveLength(0)

    ctx.securityGate.features.setEnabled('skill.adopt', true, 'owner')
    const on = (await scheduler.run('skillGeneration.scan')) as { authored: number; enqueued: number }
    expect(on.authored).toBe(1)
    expect(on.enqueued).toBe(1)

    const rows = (db as any).all(sql`SELECT * FROM generated_skills`) as Array<{ id: string; slug: string; adoption_status: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.slug).toBe('read-grep-write')

    const loader = createSkillLoader(db, noopLogger)
    expect(loader.get(rows[0]!.slug)).toBeNull() // NOT registered yet — pending owner approval

    const pending = ctx.securityGate.autonomyPolicy.listApprovals('pending')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.category).toBe('skill.adopt')

    ctx.securityGate.autonomyPolicy.decide(pending[0]!.id, 'approved', 'owner')
    await new Promise((resolve) => setTimeout(resolve, 0)) // flush the async ApplyHandler

    expect(loader.get(rows[0]!.slug)).not.toBeNull()
    const updated = (db as any).all(sql`SELECT adoption_status FROM generated_skills WHERE id = ${rows[0]!.id}`) as Array<{ adoption_status: string }>
    expect(updated[0]!.adoption_status).toBe('adopted')
  })

  it('(b2) re-running the scan does not re-author an already-generated candidate', async () => {
    const { ctx, db, scheduler } = await buildCtx({ rootDir: tmp })
    seedMinedCandidate(db)
    await skillGenerationModule.onRegister(ctx)
    await skillGenerationModule.onStart(ctx)
    ctx.securityGate.features.setEnabled('skill.adopt', true, 'owner')

    await scheduler.run('skillGeneration.scan')
    const second = (await scheduler.run('skillGeneration.scan')) as { authored: number; enqueued: number }

    expect(second).toEqual({ authored: 0, enqueued: 0 })
    expect((db as any).all(sql`SELECT * FROM generated_skills`)).toHaveLength(1)
  })

  it('(c) WITHOUT autonomyPolicy, the live adopt path is never enabled — no scheduler handler exists, a warning is logged, routes still mount', async () => {
    const warn = vi.fn()
    const logger = { ...noopLogger, warn }
    const { ctx, scheduler } = await buildCtx({ rootDir: tmp, withAutonomyPolicy: false, logger })

    await skillGenerationModule.onRegister(ctx)
    await skillGenerationModule.onStart(ctx)

    expect(scheduler.has('skillGeneration.scan')).toBe(false)
    expect(warn).toHaveBeenCalled()

    const res = await ctx.http.request('/api/v1/skill-generation/candidates')
    expect(res.status).not.toBe(404)
  })

  it('(d) a candidate that fails to author does not abandon the rest of the scan batch', async () => {
    const warn = vi.fn()
    const logger = { ...noopLogger, warn }
    const { ctx, db, scheduler } = await buildCtx({ rootDir: tmp, logger })
    // A rationale embedding a newline fails SkillFrontmatterSchema's
    // singleLine check inside buildFrontmatter's throwing .parse() —
    // simulates a genuinely malformed mined row reaching the scan loop.
    seedMinedCandidate(db, 'cand-bad', 'bad-candidate', 'pending', 'line one\nline two')
    seedMinedCandidate(db, 'cand-good', 'good-candidate', 'pending')
    await skillGenerationModule.onRegister(ctx)
    await skillGenerationModule.onStart(ctx)
    ctx.securityGate.features.setEnabled('skill.adopt', true, 'owner')

    const result = (await scheduler.run('skillGeneration.scan')) as { authored: number; enqueued: number }

    expect(result).toEqual({ authored: 1, enqueued: 1 })
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: 'cand-bad' }),
      expect.stringContaining('skipped a candidate'),
    )
    const rows = (db as any).all(sql`SELECT slug FROM generated_skills`) as Array<{ slug: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.slug).toBe('good-candidate')
  })

  it('(e) a mined slug is sanitized before becoming a filesystem path — no path traversal survives', async () => {
    const { ctx, db, scheduler } = await buildCtx({ rootDir: tmp })
    seedMinedCandidate(db, 'cand-1', '../../etc/passwd')
    await skillGenerationModule.onRegister(ctx)
    await skillGenerationModule.onStart(ctx)
    ctx.securityGate.features.setEnabled('skill.adopt', true, 'owner')

    const result = (await scheduler.run('skillGeneration.scan')) as { authored: number; enqueued: number }
    expect(result.authored).toBe(1)

    const rows = (db as any).all(sql`SELECT slug FROM generated_skills`) as Array<{ slug: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.slug.length).toBeGreaterThan(0)
    expect(rows[0]!.slug).not.toMatch(/\.\.|\/|\\/)
  })

  it('(f) an empty mined slug falls back to a non-empty sanitized default', async () => {
    const { ctx, db, scheduler } = await buildCtx({ rootDir: tmp })
    seedMinedCandidate(db, 'cand-1', '')
    await skillGenerationModule.onRegister(ctx)
    await skillGenerationModule.onStart(ctx)
    ctx.securityGate.features.setEnabled('skill.adopt', true, 'owner')

    const result = (await scheduler.run('skillGeneration.scan')) as { authored: number; enqueued: number }
    expect(result.authored).toBe(1)

    const rows = (db as any).all(sql`SELECT slug FROM generated_skills`) as Array<{ slug: string }>
    expect(rows[0]!.slug).toBe('unnamed-skill')
  })

  it('(g) with a model gateway wired, the scan reaches live model-authoring', async () => {
    const completeSpy = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            name: 'model-authored-skill',
            description: 'A model-authored one-liner.',
            whenToInvoke: ['when doing the observed pattern'],
            body: '## When to invoke\n- x\n\n## Tools\n- x\n\n## Steps\n1. Do it.\n',
          }),
        },
      ],
    })
    const { ctx, db, scheduler } = await buildCtx({ rootDir: tmp, model: { complete: completeSpy } })
    seedMinedCandidate(db)
    await skillGenerationModule.onRegister(ctx)
    await skillGenerationModule.onStart(ctx)
    ctx.securityGate.features.setEnabled('skill.adopt', true, 'owner')

    const result = (await scheduler.run('skillGeneration.scan')) as { authored: number; enqueued: number }

    expect(result.authored).toBe(1)
    expect(completeSpy).toHaveBeenCalled()
    // The filesystem slug/path stays the deterministic candidate.pattern.name
    // regardless of what the model authored for frontmatter `name` — the
    // model's output only ever reaches file *content*, never the path.
    const rows = (db as any).all(sql`SELECT slug, skill_md_path FROM generated_skills`) as Array<{ slug: string; skill_md_path: string }>
    expect(rows[0]!.slug).toBe('read-grep-write')
    const content = await readFile(rows[0]!.skill_md_path, 'utf-8')
    expect(content).toContain('A model-authored one-liner.')
  })

  it('(h) with no model wired, the scan still succeeds via the deterministic renderer', async () => {
    const { ctx, db, scheduler } = await buildCtx({ rootDir: tmp })
    seedMinedCandidate(db)
    await skillGenerationModule.onRegister(ctx)
    await skillGenerationModule.onStart(ctx)
    ctx.securityGate.features.setEnabled('skill.adopt', true, 'owner')

    const result = (await scheduler.run('skillGeneration.scan')) as { authored: number; enqueued: number }

    expect(result.authored).toBe(1)
    const rows = (db as any).all(sql`SELECT slug FROM generated_skills`) as Array<{ slug: string }>
    expect(rows[0]!.slug).toBe('read-grep-write')
  })
})
