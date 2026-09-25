// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 2 (real adoption) — the previous phase (gated-adopt.test.ts, Task 9)
// proved the gate works against createStubRegistry(). This file proves the
// same gate holds against the REAL registry adapter (real-registry.ts): an
// approved skill actually lands in the real `skills` table, readable via
// skill-loader, and — critically — that pairing is not automatic: a real
// registry without a real approvalQueue registers immediately (the adopter's
// ungated fallback), which is exactly why onStart (Task 3) must only ever
// build the real registry alongside a real approvalQueue.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'
import { createAdopter, createSkillAdoptApplyHandler, createRealSkillRegistry } from '@modules/skill-generation/index.js'
import { createSkillLoader } from '@modules/skills/skill-loader.js'
import type { ABResult, GeneratedSkill } from '@modules/skill-generation/types.js'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any

// Mirrors the real DDL in src/modules/skills/index.ts's onRegister.
function createSkillsTable(db: any) {
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
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
}

async function buildFakeSkill(tmp: string, slug = 'some-generated-skill'): Promise<GeneratedSkill> {
  const directory = join(tmp, slug)
  await mkdir(directory, { recursive: true })
  const skillMdPath = join(directory, 'SKILL.md')
  const metadataPath = join(directory, 'metadata.json')
  const content = [
    '---',
    'name: "Some Generated Skill"',
    'description: "Does a thing, generated from an observed pattern."',
    'license: MIT',
    'version: "0.1.0"',
    'whenToInvoke:',
    '  - "do the thing"',
    'tools: []',
    '---',
    '',
    '# Some Generated Skill',
    '',
  ].join('\n')
  await writeFile(skillMdPath, content, 'utf-8')
  await writeFile(metadataPath, '{}', 'utf-8')
  return {
    slug,
    directory,
    skillMdPath,
    metadataPath,
    skillMdContent: content,
    metadata: {
      version: '0.1.0',
      candidateId: 'cand-1',
      adoptionStatus: 'pending-experiment',
      createdAt: 1,
      updatedAt: 1,
    },
  }
}

function buildResult(partial: Partial<ABResult> = {}): ABResult {
  return {
    experimentId: 'exp-1',
    candidateSkillId: 'sk-1',
    baselineSuccessRate: 0.5,
    candidateSuccessRate: 0.8,
    pValue: 0.01,
    significantImprovement: true,
    tasksRun: 10,
    trialsPerArm: 20,
    durationMs: 100,
    recommendation: 'adopt',
    note: 'ok',
    method: 'two-proportion-z',
    ...partial,
  }
}

describe('createRealSkillRegistry', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eyas-real-registry-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  })

  it('register() writes the skill into the real skills table, readable via skill-loader', async () => {
    const db = createMemoryDb()
    createSkillsTable(db)
    const registry = createRealSkillRegistry({ db, logger: noopLogger })
    const skill = await buildFakeSkill(tmp)

    expect(await registry.isRegistered(skill.slug)).toBe(false)
    await registry.register(skill)
    expect(await registry.isRegistered(skill.slug)).toBe(true)

    const loader = createSkillLoader(db, noopLogger)
    const stored = loader.get(skill.slug)
    expect(stored).not.toBeNull()
    expect(stored!.name).toBe('Some Generated Skill')
    expect(stored!.description).toBe('Does a thing, generated from an observed pattern.')
    expect(stored!.source).toBe('generated')
    expect(stored!.enabled).toBe(true)
    expect(loader.list().some((s) => s.id === skill.slug)).toBe(true)
  })

  it('register() is a safe no-op when the slug is already present', async () => {
    const db = createMemoryDb()
    createSkillsTable(db)
    const registry = createRealSkillRegistry({ db, logger: noopLogger })
    const skill = await buildFakeSkill(tmp, 'dup-skill')

    await registry.register(skill)
    await expect(registry.register(skill)).resolves.toBeUndefined()

    const loader = createSkillLoader(db, noopLogger)
    expect(loader.list().filter((s) => s.id === skill.slug)).toHaveLength(1)
  })

  it('falls back to slug as name when SKILL.md frontmatter fails to parse', async () => {
    const db = createMemoryDb()
    createSkillsTable(db)
    const registry = createRealSkillRegistry({ db, logger: noopLogger })
    const skill = await buildFakeSkill(tmp, 'no-frontmatter-skill')
    skill.skillMdContent = 'not frontmatter at all'

    await registry.register(skill)

    const loader = createSkillLoader(db, noopLogger)
    expect(loader.get(skill.slug)?.name).toBe(skill.slug)
  })

  it('unregister() removes only generated rows, never bundled/user ones', async () => {
    const db = createMemoryDb()
    createSkillsTable(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO skills (id, name, content, source, enabled, created_at, updated_at)
      VALUES ('user-skill', 'User skill', 'body', 'user', 1, ${now}, ${now})`)
    const registry = createRealSkillRegistry({ db, logger: noopLogger })
    const skill = await buildFakeSkill(tmp, 'to-unregister')
    await registry.register(skill)

    await registry.unregister(skill.slug)
    await registry.unregister('user-skill') // no-op — not source='generated'

    const loader = createSkillLoader(db, noopLogger)
    expect(loader.get(skill.slug)).toBeNull()
    expect(loader.get('user-skill')).not.toBeNull()
  })
})

describe('gated real adoption (adopter + real approvalQueue + real registry)', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eyas-real-adoption-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  })

  function freshPolicy(db: any) {
    createAutonomyTables(db)
    return createAutonomyPolicy(db, noopLogger)
  }

  it('an "adopt" recommendation is enqueued (category skill.adopt) and NOT registered', async () => {
    const db = createMemoryDb()
    createSkillsTable(db)
    const policy = freshPolicy(db)
    const registry = createRealSkillRegistry({ db, logger: noopLogger })
    const adopter = createAdopter({ registry, approvalQueue: policy })
    const skill = await buildFakeSkill(tmp)

    const decision = await adopter.process(skill, buildResult())

    expect(decision.action).toBe('pending-approval')
    expect(await registry.isRegistered(skill.slug)).toBe(false)
    const pending = policy.listApprovals('pending')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.category).toBe('skill.adopt')
    expect(pending[0]!.inputJson).toContain(skill.slug)
  })

  it('owner approval runs the deferred registry.register() into the real store', async () => {
    const db = createMemoryDb()
    createSkillsTable(db)
    const policy = freshPolicy(db)
    const registry = createRealSkillRegistry({ db, logger: noopLogger })
    const adopter = createAdopter({ registry, approvalQueue: policy })
    policy.registerApplyHandler('skill.adopt', createSkillAdoptApplyHandler({ registry }))

    const skill = await buildFakeSkill(tmp, 'apply-on-approval-skill')
    await adopter.process(skill, buildResult())
    const id = policy.listApprovals('pending')[0]!.id

    policy.decide(id, 'approved', 'owner')
    // The handler is async (registry.register is a Promise) — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await registry.isRegistered(skill.slug)).toBe(true)
    const loader = createSkillLoader(db, noopLogger)
    expect(loader.get(skill.slug)?.source).toBe('generated')
  })

  it('rejecting the queued adoption never registers the skill', async () => {
    const db = createMemoryDb()
    createSkillsTable(db)
    const policy = freshPolicy(db)
    const registry = createRealSkillRegistry({ db, logger: noopLogger })
    const adopter = createAdopter({ registry, approvalQueue: policy })
    policy.registerApplyHandler('skill.adopt', createSkillAdoptApplyHandler({ registry }))

    const skill = await buildFakeSkill(tmp, 'rejected-skill')
    await adopter.process(skill, buildResult())
    const id = policy.listApprovals('pending')[0]!.id

    policy.decide(id, 'rejected', 'owner')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await registry.isRegistered(skill.slug)).toBe(false)
  })

  it('WITHOUT an approvalQueue, the real registry registers immediately — the exact reason onStart must never build one without the other', async () => {
    const db = createMemoryDb()
    createSkillsTable(db)
    const registry = createRealSkillRegistry({ db, logger: noopLogger })
    const adopter = createAdopter({ registry }) // no approvalQueue — ungated fallback
    const skill = await buildFakeSkill(tmp, 'ungated-skill')

    const decision = await adopter.process(skill, buildResult())

    expect(decision.action).toBe('adopted')
    expect(await registry.isRegistered(skill.slug)).toBe(true)
  })
})
