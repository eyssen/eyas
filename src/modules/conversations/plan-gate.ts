// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Plan } from '@modules/agent/planning.js'
import { buildPlanRubricSection } from '@modules/agent/plan-store.js'

/**
 * Interactive plan-mode parking lot. A turn with `plan: true` generates a
 * Plan, parks it here, and waits for a human decision. Accept + resume takes
 * the plan and injects it via `planToSystemSection`. Reject/skip drops it.
 *
 * In-memory on purpose: a restart while waiting just means the user re-sends.
 * The background runner already persists plans in `agent_plans` for critics.
 */

const pending = new Map<string, Plan>()

export function parkPlan(conversationId: string, plan: Plan): void {
  pending.set(conversationId, plan)
}

export function peekPlan(conversationId: string): Plan | null {
  return pending.get(conversationId) ?? null
}

export function takePlan(conversationId: string): Plan | null {
  const plan = pending.get(conversationId) ?? null
  if (plan) pending.delete(conversationId)
  return plan
}

export function dropPlan(conversationId: string): void {
  pending.delete(conversationId)
}

/** Same rubric the background runner injects — one shape, two callers. */
export function planToSystemSection(plan: Plan): string {
  return buildPlanRubricSection(plan)
}

export function resetPlanGateForTests(): void {
  pending.clear()
}
