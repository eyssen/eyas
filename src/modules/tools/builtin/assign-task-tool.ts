// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { EyasBus } from '@core/types'
import type { ToolImplementation, ToolContext } from '../types.js'
import type { AgentRegistry } from '@modules/agent/agent-registry.js'

/**
 * Assignment chain cap, mirroring the delegation service's `maxDepth`: an
 * ancestry of this length already means five nested hand-offs, and anything
 * deeper is a coordinator looping rather than decomposing (D11).
 */
const MAX_ASSIGNMENT_DEPTH = 5

const assignTaskSchema = z.object({
  agentId: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  goalDescription: z.string().min(1).max(20_000),
  stageId: z.string().min(1).max(200).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueDate: z.string().min(1).max(64).optional(),
})

export interface AssignTaskToolDeps {
  /** Resolves `ctx.conversations` (lazy — the module may not have started yet). */
  getConversations: () => any
  /** Resolves `ctx.board?.stages` (lazy, same reason). */
  getStages: () => any
  /** Agent directory used to validate the target. */
  registry?: AgentRegistry
  bus?: EyasBus
}

interface StageRow {
  id: string
  name: string
  botListen: boolean
  autoAssigneeId: string | null
  sortOrder: number
}

/** A stage picks cards up when a bot watches it or it names an owning agent. */
const isBotCapable = (s: StageRow) => s.botListen || !!s.autoAssigneeId

export function createAssignTaskTool(deps: AssignTaskToolDeps): ToolImplementation[] {
  return [
    {
      name: 'assign_task',
      description:
        'Hand a task to another agent ASYNCHRONOUSLY. Creates a task card owned by that agent, parked in a stage its bot watches, and returns immediately — the target agent runs it in the background. Poll get_conversation_status with the returned conversationId for progress. Use delegate_to_agent instead when you need the result inline before continuing.',
      category: 'agent',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'ID of the agent to assign the task to (from the agent directory — the id field, not the name)' },
          title: { type: 'string', description: 'Short task title shown on the board card' },
          goalDescription: { type: 'string', description: 'What the assigned agent must accomplish, with the context it needs' },
          stageId: { type: 'string', description: 'Stage to park the card in (optional — defaults to the first bot-capable stage)' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Card priority (optional)' },
          dueDate: { type: 'string', description: 'ISO date the task is due (optional)' },
        },
        required: ['agentId', 'title', 'goalDescription'],
      },
      validator: assignTaskSchema,
      execute: async (rawInput: Record<string, unknown>, ctx?: ToolContext) => {
        const input = rawInput as z.infer<typeof assignTaskSchema>
        const conversations = deps.getConversations()
        const stages = deps.getStages()
        if (!conversations || !stages) {
          return { error: 'Board or conversations module not ready yet — try again shortly' }
        }

        const parentConversationId = ctx?.conversationId ?? ''
        if (!parentConversationId) {
          return { error: 'No conversation context — cannot assign a task' }
        }

        // Target validation first: a slug instead of an agent id is the most
        // common coordinator mistake, and creating the card before noticing
        // would leave an orphaned, unrunnable task on the board.
        if (deps.registry) {
          const def = deps.registry.get(input.agentId)
          if (!def) {
            return {
              error: `Agent id "${input.agentId}" not found. Use one of the enabled agent IDs below (copy the id field, not the name/slug).`,
              availableAgents: deps.registry.list({ enabled: true }).map(a => ({ id: a.id, name: a.name, tier: a.tier })),
            }
          }
          if (!def.enabled) {
            return {
              error: `Agent "${def.name}" (${input.agentId}) is not enabled. If it is a pending proposal, ask the user to approve it in Settings → Agents before assigning work to it.`,
            }
          }
        }

        const globalStages = (stages.listGlobal() ?? []) as StageRow[]
        const botCapable = globalStages.filter(isBotCapable)
        const describe = (list: StageRow[]) => list.map(s => ({ id: s.id, name: s.name }))

        let stage: StageRow | undefined
        if (input.stageId) {
          stage = (stages.get(input.stageId) ?? undefined) as StageRow | undefined
          if (!stage) {
            return { error: `Stage not found: ${input.stageId}`, botCapableStages: describe(botCapable) }
          }
          if (!isBotCapable(stage)) {
            return {
              error: `Stage "${stage.name}" is not watched by any agent — a card parked there is never picked up. Use one of the bot-capable stages below, or omit stageId.`,
              botCapableStages: describe(botCapable),
            }
          }
        } else {
          stage = [...botCapable].sort((a, b) => a.sortOrder - b.sortOrder)[0]
          if (!stage) {
            return {
              error: 'No bot-capable stage is configured on this board, so an assigned task would never be picked up. Ask the user to enable "Bot" or set an auto-assignee on a stage in Settings → Projects → Stages.',
            }
          }
        }

        // Depth cap — mirrors delegation. The ancestry includes the parent
        // itself, so a chain already this long means five nested hand-offs.
        const ancestry = conversations.getAncestry(parentConversationId) ?? []
        if (ancestry.length >= MAX_ASSIGNMENT_DEPTH) {
          return {
            error: `Assignment depth limit reached (${MAX_ASSIGNMENT_DEPTH}). This task is already ${ancestry.length} hand-offs deep — do the work here or report back instead of assigning further.`,
          }
        }

        try {
          const child = conversations.createSubConversation({
            title: input.title,
            goalDescription: input.goalDescription,
            parentConversationId,
            agentId: input.agentId,
            // The bot-executor is the intended runner — park the card claimable.
            initialStatus: 'waiting',
          })

          conversations.update(child.id, {
            stageId: stage.id,
            ...(input.priority ? { priority: input.priority } : {}),
            ...(input.dueDate ? { dueDate: input.dueDate } : {}),
          })

          deps.bus?.emit('eyas.board.task_assigned', {
            conversationId: child.id,
            targetId: child.id,
            projectId: child.projectId ?? null,
            stageId: stage.id,
            agentId: input.agentId,
            assignedByAgentId: ctx?.agentId ?? null,
            userId: child.userId,
          })

          return {
            assigned: true,
            conversationId: child.id,
            taskId: child.taskId,
            stageId: stage.id,
            note: `Handed to ${input.agentId} and parked in "${stage.name}". This is asynchronous — it runs in the background. Check progress with get_conversation_status on ${child.id}; use delegate_to_agent instead when you need the result before you continue.`,
          }
        } catch (err: any) {
          // In-band so the coordinator can recover (retry, pick another agent)
          // rather than failing the whole turn.
          return { error: `Assignment failed: ${err?.message ?? String(err)}` }
        }
      },
    },
  ]
}
