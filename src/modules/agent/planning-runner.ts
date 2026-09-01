// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModelGateway } from '@modules/model/types.js'
import {
  detectComplexity,
  generatePlan,
  type Plan,
  type ComplexityDetectorOptions,
} from './planning.js'

/**
 * Phase-3E planning wrapper. Composable layer that sits IN FRONT OF the
 * agent-runner without modifying it: complex tasks get a written plan,
 * the plan is approved (by a human or PM agent), and only then does the
 * runner start.
 *
 * Kept as a separate utility so that:
 *   - The runner's tight streaming loop stays simple; planning is a
 *     turn-zero concern and would clutter run() for the common case.
 *   - Tests can exercise the planning decision path without spinning up
 *     a real runner harness (mock gateway + toolExecutor, etc.).
 *   - Callers can opt in per-request: some agents always plan, some never,
 *     some only for red-tier tasks.
 */

export interface PlanningHookOptions extends ComplexityDetectorOptions {
  gateway: ModelGateway
  /**
   * Human-in-the-loop hook. Receives the generated plan and returns
   *  - true    → plan approved, proceed with execution
   *  - false   → plan rejected, abort
   *  - 'skip'  → treat the request as simple; skip planning entirely
   * Absent: fails closed (same policy as 3F). A plan is generated but no
   * one can approve it, so the task is refused.
   */
  onPlanApproval?: (plan: Plan) => Promise<boolean | 'skip'>
  /** Forwarded to generatePlan. */
  provider?: string
  model?: string
  maxGenerationAttempts?: number
}

export type PlanningDecision =
  | { kind: 'skipped'; reason: string }
  | { kind: 'approved'; plan: Plan }
  | { kind: 'rejected'; plan: Plan; reason: string }
  | { kind: 'failed'; reason: string }

/**
 * Decide whether a request needs a plan and, if so, produce + gate it.
 *
 * Returns a PlanningDecision. The caller ('kind: approved' → runner.run(),
 * anything else → don't invoke the runner) drives the actual execution.
 * We deliberately don't call the runner here — this keeps the wrapper
 * agnostic about which runner implementation the caller uses.
 */
export async function maybePlanTask(
  request: string,
  opts: PlanningHookOptions,
): Promise<PlanningDecision> {
  // Cheap heuristic first — avoids an LLM round-trip for obviously trivial
  // tasks. Threshold comes from PlanningHookOptions via ComplexityDetectorOptions.
  const complexity = detectComplexity(request, { threshold: opts.threshold })
  if (!complexity.recommendsPlan) {
    return { kind: 'skipped', reason: `complexity score ${complexity.score.toFixed(2)} below threshold` }
  }

  const result = await generatePlan(
    { originalRequest: request },
    {
      gateway: opts.gateway,
      provider: opts.provider,
      model: opts.model,
      maxAttempts: opts.maxGenerationAttempts,
    },
  )
  if (!result.plan) {
    return {
      kind: 'failed',
      reason: `plan generator failed after ${result.error?.attempts ?? '?'} attempts: ${result.error?.lastMessage ?? 'unknown'}`,
    }
  }

  if (!opts.onPlanApproval) {
    // Fail-closed: planning was triggered but no reviewer is wired. Surface
    // a typed failure instead of silently proceeding with an unreviewed plan.
    return {
      kind: 'rejected',
      plan: result.plan,
      reason: 'plan generated but no onPlanApproval handler configured — fail closed',
    }
  }

  let verdict: boolean | 'skip'
  try {
    verdict = await opts.onPlanApproval(result.plan)
  } catch (err: any) {
    return {
      kind: 'rejected',
      plan: result.plan,
      reason: `approval handler threw: ${err?.message ?? String(err)}`,
    }
  }

  if (verdict === 'skip') {
    // Reviewer decided the task is simpler than heuristic said.
    return { kind: 'skipped', reason: 'reviewer opted out of planning' }
  }
  if (verdict === true) {
    return { kind: 'approved', plan: result.plan }
  }
  return {
    kind: 'rejected',
    plan: result.plan,
    reason: 'reviewer rejected the plan',
  }
}
