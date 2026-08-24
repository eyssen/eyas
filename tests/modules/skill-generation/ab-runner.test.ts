// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createABRunner, type ArmRunner, type TrialOutcome } from '../../../src/modules/skill-generation/ab-runner.js'

function fixedRunner(successRate: number): ArmRunner {
  return {
    async runTrials({ taskIds, trialsPerTask }) {
      const outcomes: TrialOutcome[] = []
      // Deterministic: emit floor(total * successRate) successes, rest failures.
      const total = taskIds.length * trialsPerTask
      const targetSuccesses = Math.round(total * successRate)
      let idx = 0
      for (const id of taskIds) {
        for (let i = 0; i < trialsPerTask; i++) {
          outcomes.push({ taskId: id, success: idx < targetSuccesses })
          idx++
        }
      }
      return outcomes
    },
  }
}

function listTasks(count: number) {
  return async () => Array.from({ length: count }, (_, i) => `t${i}`)
}

describe('createABRunner', () => {
  it('happy path: +20pp improvement over 10 tasks × 2 trials triggers adopt', async () => {
    const ab = createABRunner({
      baseline: fixedRunner(0.5),
      candidate: fixedRunner(0.9),
      listTaskIds: listTasks(10),
    })
    const r = await ab.runExperiment({
      candidateSkillId: 'sk-1',
      benchmarkSubsetSize: 10,
      minTrialsPerArm: 20, // 10 tasks × 2 trials/task
    })
    expect(r.tasksRun).toBe(10)
    expect(r.trialsPerArm).toBe(20)
    expect(r.candidateSuccessRate).toBeGreaterThan(r.baselineSuccessRate)
    expect(r.recommendation).toBe('adopt')
    expect(r.significantImprovement).toBe(true)
    expect(r.method).toBe('two-proportion-z')
  })

  it('rejects when candidate is worse than baseline', async () => {
    const ab = createABRunner({
      baseline: fixedRunner(0.9),
      candidate: fixedRunner(0.5),
      listTaskIds: listTasks(10),
    })
    const r = await ab.runExperiment({
      candidateSkillId: 'sk-2',
      benchmarkSubsetSize: 10,
      minTrialsPerArm: 20,
    })
    expect(r.candidateSuccessRate).toBeLessThan(r.baselineSuccessRate)
    expect(r.recommendation).toBe('reject')
    expect(r.significantImprovement).toBe(false)
  })

  it('returns more-data when improvement exists but sample is too small', async () => {
    const ab = createABRunner({
      baseline: fixedRunner(0.5),
      candidate: fixedRunner(0.6),
      listTaskIds: listTasks(3),
    })
    const r = await ab.runExperiment({
      candidateSkillId: 'sk-3',
      benchmarkSubsetSize: 3,
      minTrialsPerArm: 3,
    })
    // Small N → Fisher; delta too small for significance
    expect(r.method).toBe('fisher-exact')
    expect(['more-data', 'reject']).toContain(r.recommendation)
    expect(r.significantImprovement).toBe(false)
  })

  it('handles empty benchmark task list gracefully', async () => {
    const ab = createABRunner({
      baseline: fixedRunner(1),
      candidate: fixedRunner(1),
      listTaskIds: listTasks(0),
    })
    const r = await ab.runExperiment({ candidateSkillId: 'sk-4' })
    expect(r.tasksRun).toBe(0)
    expect(r.recommendation).toBe('more-data')
    expect(r.note).toContain('No benchmark tasks')
  })

  it('uses injected clock for deterministic durationMs', async () => {
    let t = 1_000
    const ab = createABRunner({
      baseline: fixedRunner(0.5),
      candidate: fixedRunner(0.9),
      listTaskIds: listTasks(5),
      now: () => {
        const v = t
        t += 250
        return v
      },
    })
    const r = await ab.runExperiment({
      candidateSkillId: 'sk-5',
      benchmarkSubsetSize: 5,
      minTrialsPerArm: 10,
    })
    // 2 calls to now() (start, end)
    expect(r.durationMs).toBe(250)
  })
})
