// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdopter } from '../../../src/modules/skill-generation/adopter.js'
import { createStubRegistry } from '../../../src/modules/skill-generation/index.js'
import type { ABResult, GeneratedSkill } from '../../../src/modules/skill-generation/types.js'

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

describe('createAdopter', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eyas-adopt-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  })

  it('adopts when recommendation=adopt and registry registers the slug', async () => {
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry })
    const skill = await buildFakeSkill(tmp)
    const decision = await adopter.process(skill, buildResult())
    expect(decision.action).toBe('adopted')
    expect(decision.registeredSlug).toBe(skill.slug)
    expect(await registry.isRegistered(skill.slug)).toBe(true)
    expect(decision.event.action).toBe('adopted')
  })

  it('is idempotent: second adopt call returns noop-already-adopted', async () => {
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry })
    const skill = await buildFakeSkill(tmp)
    await adopter.process(skill, buildResult())
    const second = await adopter.process(skill, buildResult())
    expect(second.action).toBe('noop-already-adopted')
  })

  it('rejects without deleting files by default (archive mode)', async () => {
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry })
    const skill = await buildFakeSkill(tmp, 'rejecty')
    const decision = await adopter.process(
      skill,
      buildResult({ recommendation: 'reject', significantImprovement: false, note: 'bad' }),
    )
    expect(decision.action).toBe('rejected')
    // Files still present
    await expect(readFile(skill.skillMdPath, 'utf-8')).resolves.toContain('name')
    expect(await registry.isRegistered(skill.slug)).toBe(false)
  })

  it('deletes files when deleteOnReject=true', async () => {
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry, deleteOnReject: true })
    const skill = await buildFakeSkill(tmp, 'reject-hard')
    await adopter.process(
      skill,
      buildResult({ recommendation: 'reject', significantImprovement: false, note: 'bad' }),
    )
    await expect(readFile(skill.skillMdPath, 'utf-8')).rejects.toThrow()
  })

  it('queues more-data without side effects', async () => {
    const registry = createStubRegistry()
    const adopter = createAdopter({ registry })
    const skill = await buildFakeSkill(tmp, 'more-data')
    const decision = await adopter.process(
      skill,
      buildResult({ recommendation: 'more-data', significantImprovement: false, note: 'need more' }),
    )
    expect(decision.action).toBe('queued-more-data')
    expect(await registry.isRegistered(skill.slug)).toBe(false)
  })
})
