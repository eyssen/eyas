// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import type {
  AdoptionEvent,
  AdoptionThresholds,
  RollbackTrigger,
  SkillRegistryPort,
} from './types.js'
import { DEFAULT_ADOPTION_THRESHOLDS } from './types.js'

/**
 * Rollback — Phase 3J (stub).
 *
 * If a newly-adopted skill regresses in production (observed success rate
 * drops below the baseline by ≥ thresholds.minImprovement), auto-disable it.
 *
 * This is a *stub* because the production monitoring loop — which tails
 * event-store outcomes and feeds them into `checkAndRollback` — is wired up
 * in a later phase. The interface here is stable so the loop plugs in cleanly.
 *
 * Monitoring loop (planned, see TODO in README):
 *   1. Subscribe to ToolResult events for invocations that include the skill
 *      tag in their telemetry metadata.
 *   2. Maintain a rolling window of the last N (default 30) outcomes per
 *      adopted skill.
 *   3. Once N is reached, call `checkAndRollback` with the observed rate.
 *   4. If rollback fires, the adopter's registry is called to unregister,
 *      and an adoption_event row with action='rolled-back' is written.
 *
 * TODO(phase-3K): wire the monitoring loop to event-store + audit.
 */

export interface RollbackDeps {
  registry: SkillRegistryPort
  thresholds?: AdoptionThresholds
  now?: () => number
}

export interface RollbackDecision {
  rolledBack: boolean
  trigger?: RollbackTrigger
  event?: AdoptionEvent
  reason: string
}

export interface RollbackCheckInput {
  slug: string
  candidateSkillId: string
  /** Experiment that adopted this skill. */
  adoptionExperimentId: string
  /** Baseline success rate captured at adoption time. */
  baselineSuccessRate: number
  /** Successes observed in production window. */
  observedSuccesses: number
  /** Total observations in production window. */
  observedN: number
  /** Minimum N before a decision is allowed. Default: 10. */
  minObservedN?: number
}

export function createRollback(deps: RollbackDeps) {
  const thresholds = deps.thresholds ?? DEFAULT_ADOPTION_THRESHOLDS
  const now = deps.now ?? Date.now

  return {
    /**
     * Decide whether the observed production performance warrants rolling
     * back a previously-adopted skill. If so, unregister through the port
     * and return a RollbackTrigger + event record.
     */
    async checkAndRollback(input: RollbackCheckInput): Promise<RollbackDecision> {
      const minObservedN = input.minObservedN ?? thresholds.zTestMinN
      if (input.observedN < minObservedN) {
        return {
          rolledBack: false,
          reason: `Only ${input.observedN} observations (< min ${minObservedN}); deferring`,
        }
      }
      const observedRate = input.observedSuccesses / input.observedN
      const regression = input.baselineSuccessRate - observedRate

      if (regression < thresholds.minImprovement) {
        return {
          rolledBack: false,
          reason: `Regression ${(regression * 100).toFixed(1)}pp < threshold ${(
            thresholds.minImprovement * 100
          ).toFixed(0)}pp`,
        }
      }

      const ts = now()
      const isRegistered = await deps.registry.isRegistered(input.slug)
      if (!isRegistered) {
        return {
          rolledBack: false,
          reason: `Skill ${input.slug} is not currently registered; nothing to roll back`,
        }
      }

      await deps.registry.unregister(input.slug)

      const trigger: RollbackTrigger = {
        candidateSkillId: input.candidateSkillId,
        baselineSuccessRate: input.baselineSuccessRate,
        observedSuccessRate: observedRate,
        observedN: input.observedN,
        reason: `Success rate dropped ${(regression * 100).toFixed(1)}pp below baseline`,
        detectedAt: ts,
      }
      const event: AdoptionEvent = {
        id: generateId(),
        candidateSkillId: input.candidateSkillId,
        experimentId: input.adoptionExperimentId,
        action: 'rejected', // we don't have a dedicated 'rolled-back' action in AdoptionEvent enum; using 'rejected' per schema with reason note
        timestamp: ts,
        reason: `rolled-back: ${trigger.reason}`,
      }
      return { rolledBack: true, trigger, event, reason: trigger.reason }
    },
  }
}

export type Rollback = ReturnType<typeof createRollback>
