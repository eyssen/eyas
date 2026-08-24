// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { ModelGateway } from '@modules/model/types.js'

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

export function createRePlanner(gateway: ModelGateway) {
  return {
    async replan(
      originalGoal: string,
      completedPhase: PhaseResult,
      remainingTasks: PlanTask[],
      options?: { provider?: string; model?: string },
    ): Promise<RePlanResult> {
      const systemPrompt = `You are a project planner. Analyze the completed phase results against the original goal and remaining tasks. Determine if the plan needs adjustment.

Output JSON only:
{
  "tasksAdded": [{"id": "new-1", "title": "...", "agentId": "...", "phase": "..."}],
  "tasksRemoved": ["task-id-1"],
  "tasksModified": [{"id": "task-id-2", "changes": "..."}],
  "reasoning": "Why these changes are needed",
  "shouldContinue": true
}`

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

      try {
        // Do NOT hard-code a provider/model here. Only forward an explicit
        // provider/model when the caller supplies one; otherwise leave both
        // undefined so the gateway resolves its configured default. Previously
        // this hard-coded provider:'anthropic' + 'claude-haiku-4-5-20251001',
        // which made gateway.resolveProvider throw on any non-Anthropic
        // deployment — the catch below then swallowed the error and re-planning
        // silently no-op'd. (Same class of bug fixed in analyzeAndPropose.)
        const response = await gateway.complete({
          messages: [{ role: 'user', content: userMessage }],
          system: systemPrompt,
          ...(options?.provider ? { provider: options.provider } : {}),
          ...(options?.model ? { model: options.model } : {}),
          temperature: 0.2,
        })

        const text = response.content.find(b => b.type === 'text')?.text ?? ''
        // Extract JSON from response (may be wrapped in markdown code blocks)
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          return {
            tasksAdded: [],
            tasksRemoved: [],
            tasksModified: [],
            reasoning: 'Could not parse re-plan response',
            shouldContinue: true,
          }
        }

        const rePlanSchema = z.object({
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

        const parsed = rePlanSchema.safeParse(JSON.parse(jsonMatch[0]))
        if (!parsed.success) {
          return {
            tasksAdded: [],
            tasksRemoved: [],
            tasksModified: [],
            reasoning: `Re-plan response failed validation: ${parsed.error.message}`,
            shouldContinue: true,
          }
        }
        return parsed.data
      } catch {
        // If re-planning fails, continue with existing plan
        return {
          tasksAdded: [],
          tasksRemoved: [],
          tasksModified: [],
          reasoning: 'Re-planning failed, continuing with existing plan',
          shouldContinue: true,
        }
      }
    },
  }
}
