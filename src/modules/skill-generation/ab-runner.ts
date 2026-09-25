// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import { compareProportions } from './statistical-test.js'
import {
  DEFAULT_ADOPTION_THRESHOLDS,
  type ABRecommendation,
  type ABResult,
  type AdoptionThresholds,
} from './types.js'

/**
 * A/B runner — Phase 3J.
 *
 * Runs baseline and candidate agents on the same subset of benchmark tasks,
 * counts successes, and returns a statistical comparison plus adoption
 * recommendation.
 *
 * We do NOT import the full benchmark runner here — instead we accept a
 * narrow `ArmRunner` port. A thin wrapper over tests/benchmarks/runner/ can
 * be injected at call-time; the module itself stays standalone and testable.
 */

/** Outcome of a single trial. */
export interface TrialOutcome {
  taskId: string
  success: boolean
}

/** Executes all trials for one arm (baseline or candidate). */
export interface ArmRunner {
  /**
   * Run the arm over the given task IDs. May run each task multiple times
   * internally; the returned list is flat, one entry per trial.
   */
  runTrials(opts: { taskIds: string[]; trialsPerTask: number }): Promise<TrialOutcome[]>
}

export interface ABRunnerDeps {
  baseline: ArmRunner
  candidate: ArmRunner
  /**
   * Returns the pool of benchmark task IDs we can draw from. A caller that
   * wants to scope to a subset (category, tag, held-out, etc.) should filter
   * before passing here.
   */
  listTaskIds(): Promise<string[]>
  /** Clock injection for testability. */
  now?: () => number
  thresholds?: AdoptionThresholds
}

export interface ExperimentOptions {
  candidateSkillId: string
  benchmarkSubsetSize?: number // default 10
  minTrialsPerArm?: number // default 10
  /**
   * Informational only — actual concurrency is the responsibility of the
   * underlying ArmRunner. Stored so operators can see what was requested.
   */
  concurrency?: number
}

export interface ABRunner {
  runExperiment(opts: ExperimentOptions): Promise<ABResult>
}

function decide(
  baselineRate: number,
  candidateRate: number,
  pValue: number,
  trialsPerArm: number,
  thresholds: AdoptionThresholds,
): { recommendation: ABRecommendation; significant: boolean; note: string } {
  if (!Number.isFinite(pValue) || Number.isNaN(pValue)) {
    return {
      recommendation: 'more-data',
      significant: false,
      note: `Indeterminate p-value (trials per arm: ${trialsPerArm})`,
    }
  }
  const delta = candidateRate - baselineRate
  const significant = pValue < thresholds.alpha && delta >= thresholds.minImprovement
  if (significant) {
    return {
      recommendation: 'adopt',
      significant,
      note: `Candidate +${(delta * 100).toFixed(1)}pp, p=${pValue.toFixed(4)}`,
    }
  }
  // Distinguish "ran out of data" from "actively worse".
  if (trialsPerArm < thresholds.zTestMinN * 2 && delta > 0 && pValue >= thresholds.alpha) {
    return {
      recommendation: 'more-data',
      significant,
      note: `Positive delta ${(delta * 100).toFixed(1)}pp but p=${pValue.toFixed(
        4,
      )} ≥ α=${thresholds.alpha}; increase N`,
    }
  }
  return {
    recommendation: 'reject',
    significant,
    note: `Delta ${(delta * 100).toFixed(1)}pp, p=${pValue.toFixed(
      4,
    )} — does not meet ≥${(thresholds.minImprovement * 100).toFixed(0)}pp @ α=${thresholds.alpha}`,
  }
}

function countSuccesses(outcomes: TrialOutcome[]): { successes: number; trials: number } {
  let successes = 0
  for (const o of outcomes) if (o.success) successes++
  return { successes, trials: outcomes.length }
}

export function createABRunner(deps: ABRunnerDeps): ABRunner {
  const thresholds = deps.thresholds ?? DEFAULT_ADOPTION_THRESHOLDS
  const now = deps.now ?? Date.now

  return {
    async runExperiment(opts: ExperimentOptions): Promise<ABResult> {
      const startedAt = now()
      const subsetSize = Math.max(1, opts.benchmarkSubsetSize ?? 10)
      const minPerArm = Math.max(1, opts.minTrialsPerArm ?? 10)

      const allTaskIds = await deps.listTaskIds()
      if (allTaskIds.length === 0) {
        const endedAt = now()
        return {
          experimentId: generateId(),
          candidateSkillId: opts.candidateSkillId,
          baselineSuccessRate: 0,
          candidateSuccessRate: 0,
          pValue: NaN,
          significantImprovement: false,
          tasksRun: 0,
          trialsPerArm: 0,
          durationMs: endedAt - startedAt,
          recommendation: 'more-data',
          note: 'No benchmark tasks available',
          method: 'two-proportion-z',
        }
      }
      const taskIds = allTaskIds.slice(0, subsetSize)
      // Ensure every arm sees enough trials even if subsetSize < minPerArm.
      const trialsPerTask = Math.max(1, Math.ceil(minPerArm / taskIds.length))

      const [baselineOut, candidateOut] = await Promise.all([
        deps.baseline.runTrials({ taskIds, trialsPerTask }),
        deps.candidate.runTrials({ taskIds, trialsPerTask }),
      ])

      const baseline = countSuccesses(baselineOut)
      const candidate = countSuccesses(candidateOut)

      const baselineSuccessRate = baseline.trials === 0 ? 0 : baseline.successes / baseline.trials
      const candidateSuccessRate =
        candidate.trials === 0 ? 0 : candidate.successes / candidate.trials

      const stat = compareProportions(baseline, candidate, thresholds.zTestMinN)
      const trialsPerArm = Math.min(baseline.trials, candidate.trials)

      const { recommendation, significant, note } = decide(
        baselineSuccessRate,
        candidateSuccessRate,
        stat.pValue,
        trialsPerArm,
        thresholds,
      )

      const endedAt = now()
      return {
        experimentId: generateId(),
        candidateSkillId: opts.candidateSkillId,
        baselineSuccessRate: Number(baselineSuccessRate.toFixed(4)),
        candidateSuccessRate: Number(candidateSuccessRate.toFixed(4)),
        pValue: Number.isFinite(stat.pValue) ? Number(stat.pValue.toFixed(6)) : stat.pValue,
        significantImprovement: significant,
        tasksRun: taskIds.length,
        trialsPerArm,
        durationMs: endedAt - startedAt,
        recommendation,
        note,
        method: stat.method,
      }
    },
  }
}
