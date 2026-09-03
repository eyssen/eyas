// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import { argHash } from '@shared/arg-hash.js'
import { PlanSchema, type Plan } from './planning.js'
import type { CriticPlanStep } from './critic.js'

/**
 * F2 T7 (D8) — persistence for plan-as-rubric.
 *
 * A plan generated at the start of a complex background run is not an approval
 * artifact here (rubric-only mode: it is auto-approved, no UI gate). It is
 * kept because two later readers need it: the completeness critic, which
 * judges the transcript against each step's successCriteria, and a feedback
 * resume, which must REUSE the plan rather than pay to regenerate it.
 *
 * Every function is fail-open. A missing table or a corrupt row means "no
 * plan" — never a broken run: the plan is an aid to judging a run, and losing
 * it must not cost the run itself.
 */

export interface StoredPlan {
  id: string
  runId: string
  conversationId: string
  plan: Plan
  createdAt: string
}

/**
 * Identity of the goal a plan was written for. A conversation's
 * `goal_description` is editable, so the conversation id alone does NOT
 * identify a rubric: an edited goal must get a new plan, not the old one.
 * Whitespace-insensitive (an operator re-indenting a goal has not changed it);
 * anything else is a different goal.
 */
export function goalHash(goal: string): string {
  return argHash(goal.trim().replace(/\s+/g, ' '))
}

/** Create the agent_plans table (idempotent runtime DDL — no drizzle-kit). */
export function ensureAgentPlansSchema(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_plans (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    goal_hash TEXT,
    created_at TEXT NOT NULL
  )`)
  // Added after the table shipped in this wave — an install that already ran
  // the first version would otherwise fail every INSERT (and, being fail-open,
  // silently regenerate a plan on every run).
  try { db.run(sql.raw('ALTER TABLE agent_plans ADD COLUMN goal_hash TEXT')) } catch { /* already exists */ }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_plans_conv ON agent_plans(conversation_id, created_at)`)
}

/** Persist a plan for a run. Returns the row id, or null when the write failed. */
export function savePlan(
  db: any,
  input: { runId: string; conversationId: string; plan: Plan; goal: string; createdAt?: string },
): string | null {
  const id = `agent-plan-${generateId()}`
  const createdAt = input.createdAt ?? new Date().toISOString()
  try {
    db.run(sql`INSERT INTO agent_plans (id, run_id, conversation_id, plan_json, goal_hash, created_at)
      VALUES (${id}, ${input.runId}, ${input.conversationId}, ${JSON.stringify(input.plan)}, ${goalHash(input.goal)}, ${createdAt})`)
    return id
  } catch {
    return null
  }
}

/**
 * The most recent plan for a conversation, or null. `goal` is REQUIRED and
 * checked: a plan written for a different (since-edited) goal is not a rubric
 * for this run, and serving it would both misdirect the agent and judge it
 * against criteria it was never given. A row with no recorded goal (written
 * before this check existed) is likewise unusable.
 */
export function latestPlanForConversation(db: any, conversationId: string, goal: string): StoredPlan | null {
  let row: { id: string; run_id: string; conversation_id: string; plan_json: string; goal_hash: string | null; created_at: string } | undefined
  try {
    row = (db.all(sql`SELECT id, run_id, conversation_id, plan_json, goal_hash, created_at
      FROM agent_plans WHERE conversation_id = ${conversationId}
      ORDER BY created_at DESC, rowid DESC LIMIT 1`) as any[])[0]
  } catch {
    return null
  }
  if (!row) return null
  if (!row.goal_hash || row.goal_hash !== goalHash(goal)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(row.plan_json)
  } catch {
    return null
  }
  const check = PlanSchema.safeParse(parsed)
  if (!check.success) return null

  return {
    id: row.id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    plan: check.data,
    createdAt: row.created_at,
  }
}

/** The critic's rubric projection: what each step is, and what proves it done. */
export function planStepsForCritic(plan: Plan): CriticPlanStep[] {
  return plan.steps.map((s) => ({ title: s.title, successCriteria: s.successCriteria }))
}

/**
 * The run-facing half of the rubric: injected through the runner's existing
 * `reinjection` channel (same one the resume recap uses), so the agent knows
 * up front what it will be judged against. Empty for a step-less plan.
 */
export function buildPlanRubricSection(plan: Plan): string {
  if (plan.steps.length === 0) return ''
  const lines = plan.steps.map((s, i) =>
    `${i + 1}. ${s.title}${s.successCriteria ? `\n   Done when: ${s.successCriteria}` : ''}`)
  return [
    '## Plan for this task — you are measured against it',
    'Work through these steps. Before you finish, check every "Done when" line is actually true.',
    lines.join('\n'),
  ].join('\n\n')
}
