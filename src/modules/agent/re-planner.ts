// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { AuxiliaryModelService, AuxResult } from '@modules/model/auxiliary.js'

export interface PhaseResult {
  phaseName: string
  agentResults: {
    agentId: string
    conversationId: string
    status: 'completed' | 'failed'
    summary: string
    tokensUsed: number
    /** F2 T9 — this member's own run cost (already summed into the team's totalCostUsd). */
    costUsd: number
    /**
     * F2 T5/T10 — the member stopped on an approval escalation. Its status
     * stays 'failed' (it did NOT deliver a result, which is what the re-planner
     * must see), but it is EXTERNALLY owned: the approval-resume flow owns its
     * continuation, so a re-drive must never re-run it.
     */
    parked?: boolean
  }[]
}

export interface PlanTask {
  id: string
  title: string
  agentId: string
  phase: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'removed'
}

export interface RePlanResult {
  tasksAdded: PlanTask[]
  tasksRemoved: string[]
  tasksModified: { id: string; changes: string }[]
  reasoning: string
  shouldContinue: boolean
}

/** No adjustment: the team keeps its current plan. */
function keepPlan(reasoning: string): RePlanResult {
  return { tasksAdded: [], tasksRemoved: [], tasksModified: [], reasoning, shouldContinue: true }
}

const RePlanSchema = z.object({
  tasksAdded: z.array(z.object({
    id: z.string(),
    title: z.string(),
    agentId: z.string(),
    phase: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'removed']).default('pending'),
  })).default([]),
  tasksRemoved: z.array(z.string()).default([]),
  tasksModified: z.array(z.object({
    id: z.string(),
    changes: z.string(),
  })).default([]),
  reasoning: z.string().default(''),
  shouldContinue: z.boolean().default(true),
})

const RE_PLAN_SYSTEM = `You are a project planner. Analyze the completed phase results against the original goal and remaining tasks. Determine if the plan needs adjustment.

Output JSON only:
{
  "tasksAdded": [{"id": "new-1", "title": "...", "agentId": "...", "phase": "..."}],
  "tasksRemoved": ["task-id-1"],
  "tasksModified": [{"id": "task-id-2", "changes": "..."}],
  "reasoning": "Why these changes are needed",
  "shouldContinue": true
}`

/**
 * Re-plans a team between phases through the background model service
 * (purpose 're_planner'): one isolated, tool-less call on the planning tiers.
 * The service is read per call (a lazy getter), so a service published after
 * this was built is still used. Never throws: no eligible model, a failed
 * call or an unusable answer keeps the current plan.
 */
export function createRePlanner(getAux: () => Pick<AuxiliaryModelService, 'complete'> | undefined) {
  return {
    async replan(
      originalGoal: string,
      completedPhase: PhaseResult,
      remainingTasks: PlanTask[],
      attribution?: { conversationId?: string },
    ): Promise<RePlanResult> {
      const userMessage = `## Original Goal
${originalGoal}

## Completed Phase: ${completedPhase.phaseName}
${completedPhase.agentResults
  .map(r => `- Agent ${r.agentId}: ${r.status} — ${r.summary} (${r.tokensUsed} tokens)`)
  .join('\n')}

## Remaining Tasks
${remainingTasks
  .map(t => `- [${t.id}] ${t.title} (agent: ${t.agentId}, phase: ${t.phase}, status: ${t.status})`)
  .join('\n')}

## Question
Based on the completed phase results, should the remaining tasks be adjusted? If so, what changes?`

      const aux = getAux()
      if (!aux) return keepPlan('No eligible background model; continuing with the existing plan')

      let result: AuxResult
      try {
        result = await aux.complete({
          purpose: 're_planner',
          system: RE_PLAN_SYSTEM,
          user: userMessage,
          temperature: 0.2,
          ...(attribution?.conversationId ? { conversationId: attribution.conversationId } : {}),
        })
      } catch {
        // The service never throws; an injected stand-in might.
        return keepPlan('Re-planning failed, continuing with existing plan')
      }
      if (!result.ok) {
        switch (result.reason) {
          case 'budget_stop':
            return keepPlan('Model budget exhausted; continuing with the existing plan')
          case 'error':
          case 'empty':
            return keepPlan('Re-planning failed, continuing with existing plan')
          default:
            return keepPlan('No eligible background model; continuing with the existing plan')
        }
      }

      // The JSON may be wrapped in markdown fences or prose.
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return keepPlan('Could not parse re-plan response')
      let raw: unknown
      try {
        raw = JSON.parse(jsonMatch[0])
      } catch {
        return keepPlan('Could not parse re-plan response')
      }
      const parsed = RePlanSchema.safeParse(raw)
      if (!parsed.success) return keepPlan(`Re-plan response failed validation: ${parsed.error.message}`)
      return parsed.data
    },
  }
}
