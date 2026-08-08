// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildSkillGenerationServices,
  createStubRegistry,
} from '../../../src/modules/skill-generation/index.js'
import { createABRunner, type ArmRunner } from '../../../src/modules/skill-generation/ab-runner.js'
import { createRollback } from '../../../src/modules/skill-generation/rollback.js'
import type { AgentTrace, SkillRegistryPort } from '../../../src/modules/skill-generation/types.js'

function traceOf(i: number): AgentTrace {
  return {
    sessionId: `s-${i}`,
    userGoal: `pattern-A run ${i}`,
    toolCalls: [
      { seq: 0, toolName: 'read', input: { path: '/a' }, success: true, durationMs: 5 },
      { seq: 1, toolName: 'grep', input: { pattern: 'x' }, success: true, durationMs: 5 },
      { seq: 2, toolName: 'write', input: { path: '/a' }, success: true, durationMs: 5 },
    ],
    outcome: 'success',
    turns: 3,
    costUsd: 0.01,
    startedAt: 0,
    endedAt: 1,
  }
}

function fixed(rate: number): ArmRunner {
  return {
    async runTrials({ taskIds, trialsPerTask }) {
      const out: Array<{ taskId: string; success: boolean }> = []
      const total = taskIds.length * trialsPerTask
      const target = Math.round(total * rate)
      let idx = 0
      for (const id of taskIds) {
        for (let i = 0; i < trialsPerTask; i++) {
          out.push({ taskId: id, success: idx < target })
          idx++
        }
      }
      return out
    },
  }
}

describe('integration: trace → candidate → generate → A/B → adopt', () => {
  let tmp: string
  let registry: SkillRegistryPort

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eyas-skillgen-int-'))
    registry = createStubRegistry()
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  })

  it('full happy path adopts a skill that improves the benchmark', async () => {
    const svc = buildSkillGenerationServices({ rootDir: tmp, registry })

    // 1. Extract
    const traces = Array.from({ length: 4 }, (_, i) => traceOf(i))
    const candidates = svc.extractor.extract(traces)
    expect(candidates).toHaveLength(1)
    const cand = candidates[0]!
    expect(cand.pattern.name).toBe('read-grep-write')

    // 2. Generate
    const gen = await svc.generator.generate(cand)
    const md = await readFile(gen.skillMdPath, 'utf-8')
    expect(md).toContain('name: "read-grep-write"')

    // 3. A/B
    const abRunner = createABRunner({
      baseline: fixed(0.5),
      candidate: fixed(0.9),
      listTaskIds: async () => ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'],
    })
    const result = await abRunner.runExperiment({
      candidateSkillId: gen.metadata.candidateId,
      benchmarkSubsetSize: 10,
      minTrialsPerArm: 20,
    })
    expect(result.recommendation).toBe('adopt')

    // 4. Adopt
    const decision = await svc.adopter.process(gen, result)
    expect(decision.action).toBe('adopted')
    expect(await registry.isRegistered(gen.slug)).toBe(true)
  })

  it('rollback fires when production regression exceeds threshold', async () => {
    const svc = buildSkillGenerationServices({ rootDir: tmp, registry })
    const traces = Array.from({ length: 3 }, (_, i) => traceOf(i))
    const [cand] = svc.extractor.extract(traces)
    const gen = await svc.generator.generate(cand!)
    // Pretend it was adopted
    await registry.register(gen)

    const rb = createRollback({ registry })
    const decision = await rb.checkAndRollback({
      slug: gen.slug,
      candidateSkillId: gen.metadata.candidateId,
      adoptionExperimentId: 'exp-1',
      baselineSuccessRate: 0.9,
      observedSuccesses: 15,
      observedN: 30,
    })
    expect(decision.rolledBack).toBe(true)
    expect(decision.trigger?.observedSuccessRate).toBeCloseTo(0.5, 6)
    expect(await registry.isRegistered(gen.slug)).toBe(false)
  })

  it('rollback defers when observation window is too small', async () => {
    const svc = buildSkillGenerationServices({ rootDir: tmp, registry })
    const traces = Array.from({ length: 3 }, (_, i) => traceOf(i))
    const [cand] = svc.extractor.extract(traces)
    const gen = await svc.generator.generate(cand!)
    await registry.register(gen)

    const rb = createRollback({ registry })
    const decision = await rb.checkAndRollback({
      slug: gen.slug,
      candidateSkillId: gen.metadata.candidateId,
      adoptionExperimentId: 'exp-1',
      baselineSuccessRate: 0.9,
      observedSuccesses: 1,
      observedN: 3,
    })
    expect(decision.rolledBack).toBe(false)
    expect(decision.reason).toContain('deferring')
  })

  it('rollback does not fire when regression is below threshold', async () => {
    const svc = buildSkillGenerationServices({ rootDir: tmp, registry })
    const traces = Array.from({ length: 3 }, (_, i) => traceOf(i))
    const [cand] = svc.extractor.extract(traces)
    const gen = await svc.generator.generate(cand!)
    await registry.register(gen)

    const rb = createRollback({ registry })
    const decision = await rb.checkAndRollback({
      slug: gen.slug,
      candidateSkillId: gen.metadata.candidateId,
      adoptionExperimentId: 'exp-1',
      baselineSuccessRate: 0.9,
      observedSuccesses: 26,
      observedN: 30, // 86.7% — only 3.3pp regression
    })
    expect(decision.rolledBack).toBe(false)
    expect(await registry.isRegistered(gen.slug)).toBe(true)
  })
})
