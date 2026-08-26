// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { ModelGateway, ModelRequest } from '@modules/model/types.js'
import { generateId } from '@shared/crypto.js'

/**
 * Interactive Planning — Phase 3E.
 *
 * Inspired by Devin. When a task looks complex enough to warrant up-front
 * deliberation, EYAS produces a structured Plan artifact (goals + steps +
 * risks + rollback) that a human (or PM agent) approves before the runner
 * starts touching real state.
 *
 * This module is deliberately small:
 *   - A Zod schema for Plan/PlanStep so any serialiser (DB, event-store,
 *     frontend) shares one truth.
 *   - A planning-specific complexity detector (the existing
 *     complexity-analyzer covers conversational heuristics).
 *   - A generator that asks the model for JSON-shaped plans and parses the
 *     response against the schema — never accepting free text.
 *   - Approval-state helpers tiny enough to read at a glance.
 *
 * Walking the plan — recording per-step progress and handing the current
 * step to the agent-runner — lives in the orchestrator and is out of scope
 * here. We only produce the artifact.
 */

// ─── Schemas ──────────────────────────────────────────────────────

export const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(''),
  dependsOn: z.array(z.string()).default([]),
  consumes: z.array(z.string()).default([]),
  produces: z.array(z.string()).default([]),
  successCriteria: z.string().default(''),
  status: z.enum(['pending', 'in_progress', 'done', 'skipped', 'failed']).default('pending'),
})

export const PlanRiskSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  mitigation: z.string().default(''),
})

export const PlanSchema = z.object({
  id: z.string(),
  taskId: z.string().optional(),
  originalRequest: z.string().min(1),
  goal: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1),
  risks: z.array(PlanRiskSchema).default([]),
  rollback: z.string().default(''),
  status: z.enum(['pending_approval', 'approved', 'rejected', 'in_progress', 'completed', 'failed']).default('pending_approval'),
  createdAt: z.number(),
  approvedAt: z.number().optional(),
  approvedBy: z.string().optional(),
  rejectedReason: z.string().optional(),
})

export type PlanStep = z.infer<typeof PlanStepSchema>
export type PlanRisk = z.infer<typeof PlanRiskSchema>
export type Plan = z.infer<typeof PlanSchema>

// ─── Complexity detector ──────────────────────────────────────────

/**
 * Lightweight heuristic — deliberately a *separate* signal from
 * complexity-analyzer.ts. This one scores whether a task is complex enough
 * that a written plan would pay its way; the other scores conversational
 * mode. They often agree but don't have to.
 */
export interface ComplexitySignals {
  score: number
  reasons: string[]
  recommendsPlan: boolean
}

export interface ComplexityDetectorOptions {
  /** Score at or above this threshold triggers plan generation. Default 0.5. */
  threshold?: number
}

const PLAN_WORTHY_VERBS = [
  'migrate', 'refactor', 'rewrite', 'redesign',
  'integrate', 'orchestrate', 'automate', 'implement',
  'replace', 'deprecate', 'roll out',
  'migrál', 'átír', 'újraír', 'tervez', 'megvalósít',
]

const MULTI_COMPONENT_HINTS = [
  'frontend', 'backend', 'database', 'api',
  'module', 'modul', 'service', 'szolgáltatás',
  'test', 'teszt', 'deploy', 'ci', 'cd',
]

const RISK_HINTS = [
  'production', 'prod', 'live', 'éles',
  'customer', 'ügyfél', 'data', 'adat', 'migration', 'migráció',
  'security', 'biztonság', 'auth', 'jogosultság',
]

export function detectComplexity(
  userMessage: string,
  opts: ComplexityDetectorOptions = {},
): ComplexitySignals {
  const threshold = opts.threshold ?? 0.5
  const msg = userMessage.toLowerCase()
  const reasons: string[] = []
  let signals = 0

  if (userMessage.length > 400) {
    signals++
    reasons.push('long request (>400 chars)')
  }
  if (PLAN_WORTHY_VERBS.some(v => msg.includes(v))) {
    signals++
    reasons.push('plan-worthy verb present')
  }
  if (MULTI_COMPONENT_HINTS.filter(h => msg.includes(h)).length >= 2) {
    signals++
    reasons.push('multiple component areas')
  }
  if (RISK_HINTS.some(h => msg.includes(h))) {
    signals++
    reasons.push('risk indicators (prod/data/security)')
  }
  if (/(\n[-*] |\n\d+\. )/.test(userMessage)) {
    signals++
    reasons.push('enumerated items in request')
  }

  const score = Math.min(1, signals / 5)
  return { score, reasons, recommendsPlan: score >= threshold }
}

// ─── Plan generator ───────────────────────────────────────────────

const PLAN_JSON_INSTRUCTIONS = [
  'You are a planning agent. Produce a JSON plan for the user task.',
  '',
  'Respond with ONLY a JSON object of the following shape (no prose, no markdown fences):',
  '{',
  '  "goal": string,',
  '  "steps": [{ "title": string, "description": string, "successCriteria": string, "dependsOn": string[] }],',
  '  "risks": [{ "description": string, "severity": "low"|"medium"|"high", "mitigation": string }],',
  '  "rollback": string',
  '}',
  '',
  'Rules:',
  '- Steps must be ordered so each step\u2019s dependsOn references earlier step titles.',
  '- Each successCriteria must be a falsifiable condition, not a vague goal.',
  '- If the task has no state changes, rollback may be "no state changes; nothing to undo".',
  '- At most 12 steps \u2014 if the task does not fit in 12, the first step MUST be "Break down into sub-plans".',
].join('\n')

export interface PlanGeneratorOptions {
  gateway: ModelGateway
  provider?: string
  model?: string
  /** Max attempts before giving up on invalid JSON output. Default 2. */
  maxAttempts?: number
}

export interface GeneratePlanInput {
  originalRequest: string
  taskId?: string
  additionalContext?: string
}

export interface GeneratePlanResult {
  plan?: Plan
  error?: { attempts: number; lastMessage: string }
}

export async function generatePlan(
  input: GeneratePlanInput,
  opts: PlanGeneratorOptions,
): Promise<GeneratePlanResult> {
  const maxAttempts = opts.maxAttempts ?? 2
  let lastMessage = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const req: ModelRequest = {
      provider: opts.provider,
      model: opts.model,
      system: PLAN_JSON_INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: input.additionalContext
            ? `Task:\n${input.originalRequest}\n\nContext:\n${input.additionalContext}`
            : `Task:\n${input.originalRequest}`,
        },
      ],
      // Low temperature \u2014 we want reproducible JSON, not creativity.
      temperature: 0.2,
    }

    let response
    try {
      response = await opts.gateway.complete(req)
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : String(err)
      continue
    }

    const text = response.content.find(b => b.type === 'text' && typeof (b as any).text === 'string')
    const raw = text ? (text as any).text as string : ''
    const parsed = tryParsePlanJson(raw)
    if (!parsed.ok) {
      lastMessage = parsed.reason
      continue
    }

    const now = Date.now()
    const planCandidate = {
      id: `plan-${generateId()}`,
      taskId: input.taskId,
      originalRequest: input.originalRequest,
      goal: parsed.value.goal,
      steps: parsed.value.steps.map((s: any, idx: number) => ({
        id: `step-${idx + 1}`,
        title: s.title,
        description: s.description ?? '',
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
        consumes: [],
        produces: [],
        successCriteria: s.successCriteria ?? '',
        status: 'pending' as const,
      })),
      risks: (parsed.value.risks ?? []).map((r: any, idx: number) => ({
        id: `risk-${idx + 1}`,
        description: r.description,
        severity: r.severity ?? 'medium',
        mitigation: r.mitigation ?? '',
      })),
      rollback: parsed.value.rollback ?? '',
      status: 'pending_approval' as const,
      createdAt: now,
    }

    const schemaCheck = PlanSchema.safeParse(planCandidate)
    if (!schemaCheck.success) {
      lastMessage = `schema validation failed: ${schemaCheck.error.message}`
      continue
    }
    return { plan: schemaCheck.data }
  }

  return { error: { attempts: maxAttempts, lastMessage } }
}

/**
 * Extract JSON from a model response. Models routinely wrap JSON in
 * ```json fences or prepend a sentence despite instructions. We strip the
 * common wrappings and parse once; if that fails the caller retries.
 */
function tryParsePlanJson(raw: string): { ok: true; value: any } | { ok: false; reason: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, reason: 'empty response' }

  const fenceMatch = /^```(?:json)?\s*\n([\s\S]*?)\n```$/m.exec(trimmed)
  const body = fenceMatch ? fenceMatch[1] : trimmed

  let candidate = body
  if (body[0] !== '{') {
    const firstBrace = body.indexOf('{')
    const lastBrace = body.lastIndexOf('}')
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return { ok: false, reason: 'no JSON object found in response' }
    }
    candidate = body.slice(firstBrace, lastBrace + 1)
  }

  try {
    const parsed = JSON.parse(candidate)
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, reason: 'parsed value is not an object' }
    }
    return { ok: true, value: parsed }
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${(err as Error).message}` }
  }
}

// ─── Approval transitions ─────────────────────────────────────────

/**
 * Apply an approval decision to a plan. Returns a NEW plan object — plans
 * are treated as immutable values; callers persist the updated copy.
 * Throws if the transition is invalid (e.g. approving a rejected plan).
 */
export function approvePlan(plan: Plan, approvedBy: string): Plan {
  if (plan.status !== 'pending_approval') {
    throw new Error(`cannot approve plan ${plan.id}: current status is ${plan.status}`)
  }
  return { ...plan, status: 'approved', approvedAt: Date.now(), approvedBy }
}

export function rejectPlan(plan: Plan, reason: string): Plan {
  if (plan.status !== 'pending_approval') {
    throw new Error(`cannot reject plan ${plan.id}: current status is ${plan.status}`)
  }
  return { ...plan, status: 'rejected', rejectedReason: reason }
}

export function markPlanInProgress(plan: Plan): Plan {
  if (plan.status !== 'approved') {
    throw new Error(`cannot start plan ${plan.id}: must be approved first (currently ${plan.status})`)
  }
  return { ...plan, status: 'in_progress' }
}

export function markStepStatus(
  plan: Plan,
  stepId: string,
  status: PlanStep['status'],
): Plan {
  const idx = plan.steps.findIndex(s => s.id === stepId)
  if (idx < 0) throw new Error(`step ${stepId} not found in plan ${plan.id}`)
  const newSteps = [...plan.steps]
  newSteps[idx] = { ...newSteps[idx], status }
  return { ...plan, steps: newSteps }
}
