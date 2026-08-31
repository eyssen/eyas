// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 9 (gated apply) — skill adoption. createAdopter's 'adopt' path
// registers a model-authored skill into the running system, so it must be
// owner-gated the same way as forge: when an approvalQueue is supplied, an
// 'adopt' recommendation is ENQUEUED (category 'skill.adopt') instead of
// registered immediately, and the real registry.register() only runs once
// the owner approves. (Today no caller wires skill-generation's HTTP routes
// into the running system — see skill-generation/index.ts — so this gate is
// forward-looking: whichever task wires them MUST supply approvalQueue.)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'
import { createAdopter, createSkillAdoptApplyHandler, createStubRegistry } from '@modules/skill-generation/index.js'
import type { ABResult, GeneratedSkill } from '@modules/skill-generation/types.js'

async function buildFakeSkill(tmp: string, slug = 'some-skill'): Promise<GeneratedSkill> {
  const directory = join(tmp, slug)
  await mkdir(directory, { recursive: true })
  const skillMdPath = join(directory, 'SKILL.md')
  const metadataPath = join(directory, 'metadata.json')
  await writeFile(skillMdPath, '---\nname: "x"\n---\n', 'utf-8')
  await writeFile(metadataPath, '{}', 'utf-8')
  return {
    slug,
    directory,
    skillMdPath,
    metadataPath,
    skillMdContent: '---\nname: "x"\n---\n',
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

function freshPolicy() {
  const db = createMemoryDb()
  createAutonomyTables(db)
  return createAutonomyPolicy(db)
}

describe('Skill-generation — gated adopt (Task 9)', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eyas-gated-adopt-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  })

  it('(a) an "adopt" recommendation is enqueued (category skill.adopt) and NOT registered', async () => {
    const policy = freshPolicy()
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry, approvalQueue: policy })
    const skill = await buildFakeSkill(tmp)

    const decision = await adopter.process(skill, buildResult())

    expect(decision.action).toBe('pending-approval')
    expect(await registry.isRegistered(skill.slug)).toBe(false)
    const pending = policy.listApprovals('pending')
    expect(pending).toHaveLength(1)
    expect(pending[0].category).toBe('skill.adopt')
  })

  it('(b) owner approval runs the deferred registry.register()', async () => {
    const policy = freshPolicy()
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry, approvalQueue: policy })
    policy.registerApplyHandler('skill.adopt', createSkillAdoptApplyHandler({ registry }))

    const skill = await buildFakeSkill(tmp)
    await adopter.process(skill, buildResult())
    const id = policy.listApprovals('pending')[0]!.id

    policy.decide(id, 'approved', 'owner')
    // The handler is async (registry.register is a Promise) — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await registry.isRegistered(skill.slug)).toBe(true)
  })

  it('rejecting the queued adoption never registers the skill', async () => {
    const policy = freshPolicy()
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry, approvalQueue: policy })
    policy.registerApplyHandler('skill.adopt', createSkillAdoptApplyHandler({ registry }))

    const skill = await buildFakeSkill(tmp)
    await adopter.process(skill, buildResult())
    const id = policy.listApprovals('pending')[0]!.id

    policy.decide(id, 'rejected', 'owner')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await registry.isRegistered(skill.slug)).toBe(false)
  })

  it('without an approvalQueue, adoption stays synchronous (back-compat default — no live caller wires this yet)', async () => {
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry })
    const skill = await buildFakeSkill(tmp)

    const decision = await adopter.process(skill, buildResult())

    expect(decision.action).toBe('adopted')
    expect(await registry.isRegistered(skill.slug)).toBe(true)
  })

  it('reject/more-data recommendations are never gated — they are not applies', async () => {
    const policy = freshPolicy()
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry, approvalQueue: policy })
    const skill = await buildFakeSkill(tmp, 'rejecty')

    const decision = await adopter.process(skill, buildResult({ recommendation: 'reject', note: 'bad' }))

    expect(decision.action).toBe('rejected')
    expect(policy.listApprovals('pending')).toHaveLength(0)
  })

  // Autonomy approvals dispatch apply-on-approval handlers by CATEGORY, not
  // `kind` (autonomy-policy.ts's decide()). skills/dead-skill-detector.ts
  // enqueues its `skill_disable` proposals under this SAME 'skill.adopt'
  // category (see its own file header), so this handler must treat a
  // foreign payload shape as "not mine" rather than crash on it.
  it('ignores a skill_disable payload sharing the skill.adopt category, instead of throwing', async () => {
    const db = createMemoryDb()
    createAutonomyTables(db)
    const errors: unknown[] = []
    const policy = createAutonomyPolicy(db, { error: (...a: unknown[]) => errors.push(a), warn: () => {} } as any)
    const registry = createStubRegistry()
    policy.registerApplyHandler('skill.adopt', createSkillAdoptApplyHandler({ registry }))

    const id = policy.createApproval({
      category: 'skill.adopt',
      kind: 'skill_disable',
      inputJson: JSON.stringify({ skillId: 'some-other-skill', classification: 'orphan' }),
    })
    policy.decide(id, 'approved', 'owner')
    // The handler is async — flush microtasks so a rejected promise (if any) resolves.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errors).toHaveLength(0) // no "apply-on-approval handler rejected" log
    expect(await registry.isRegistered('some-other-skill')).toBe(false)
  })

  it('createSkillAdoptApplyHandler resolves quietly for a skill_disable payload called directly', async () => {
    const registry = createStubRegistry()
    const handler = createSkillAdoptApplyHandler({ registry })
    await expect(
      handler({ inputJson: JSON.stringify({ skillId: 'x', classification: 'dormant' }) }),
    ).resolves.toBeUndefined()
  })
})
