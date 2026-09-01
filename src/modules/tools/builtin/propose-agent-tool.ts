// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { ToolImplementation, ToolContext } from '../types.js'
import type { EyasDb, EyasBus } from '@core/types'
import { generateId } from '@shared/crypto.js'

/**
 * propose_agent_creation — when the current team has no specialist fit for a
 * needed role, the coordinator calls this tool. The new agent is inserted
 * into agent_definitions with `enabled=0` and `source='proposal'` so the user
 * can review and approve it in the Agents settings page.
 *
 * A bus event (`agent.proposed`) is emitted so the frontend can surface the
 * proposal in real time.
 */
export function createProposeAgentTool(db: EyasDb, bus?: EyasBus): ToolImplementation[] {
  return [
    {
      name: 'propose_agent_creation',
      description: 'Propose the creation of a new specialist agent when no existing agent fits the needed role. The user must approve the proposal before the agent can be delegated to. Call this BEFORE trying to delegate to a specialty that does not yet exist.',
      category: 'agent',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short, human-readable agent name (e.g. "API Security Auditor")' },
          role: { type: 'string', description: 'One-line role description' },
          goal: { type: 'string', description: 'What this agent is meant to achieve across tasks' },
          backstory: { type: 'string', description: 'Short backstory giving the agent context and perspective' },
          systemPrompt: { type: 'string', description: 'Operating guidelines / system prompt for the agent' },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
            description: 'Capability tags (e.g. ["code-analysis", "security-audit"])',
          },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tool names the agent should be permitted to use',
          },
          tier: {
            type: 'string',
            enum: ['specialist', 'recommended'],
            description: 'Agent tier. "specialist" for narrow expertise, "recommended" for broadly useful helpers.',
          },
          agentType: { type: 'string', description: 'Free-form category (e.g. "reviewer", "analyst", "tester")' },
          reason: { type: 'string', description: 'Why this agent is needed for the current task — shown to the user' },
        },
        required: ['name', 'role', 'goal', 'reason'],
      },
      execute: async (input, ctx?: ToolContext) => {
        const id = generateId()
        const now = new Date().toISOString()

        const name = String(input.name)
        const role = String(input.role)
        const goal = String(input.goal)
        const backstory = String(input.backstory ?? '')
        const systemPrompt = String(input.systemPrompt ?? '')
        const capabilities = Array.isArray(input.capabilities) ? input.capabilities : []
        const tools = Array.isArray(input.tools) ? input.tools : []
        const tier = (input.tier === 'recommended' ? 'recommended' : 'specialist') as string
        const agentType = String(input.agentType ?? 'assistant')
        const reason = String(input.reason)

        // Dedupe: if an agent with the same name already exists, don't create
        // a new row. Instead, point the coordinator at the existing one so
        // they can (a) ask the user to approve the pending proposal, or
        // (b) delegate directly if the agent is already enabled.
        const existing = ((db as any).all(
          sql`SELECT id, enabled, source FROM agent_definitions
              WHERE LOWER(name) = LOWER(${name}) LIMIT 1`
        ) as any[])[0]
        if (existing) {
          if (existing.enabled) {
            return {
              ok: true,
              alreadyExists: true,
              agentId: existing.id,
              message: `Agent "${name}" already exists and is enabled (id ${existing.id}). Delegate to it directly instead of proposing a new one.`,
            }
          }
          return {
            ok: true,
            alreadyExists: true,
            pending: true,
            proposalId: existing.id,
            message: `A proposal for agent "${name}" already exists (id ${existing.id}). Ask the user to approve or reject it in Settings → Agents before proposing a new one.`,
          }
        }

        try {
          ;(db as any).run(
            sql`INSERT INTO agent_definitions
              (id, name, role, description, goal, backstory, system_prompt, capabilities, tools, constraints, model, max_turns, enabled, source, tier, agent_type, created_at, updated_at)
              VALUES (
                ${id}, ${name}, ${role}, ${reason}, ${goal}, ${backstory}, ${systemPrompt},
                ${JSON.stringify(capabilities)}, ${JSON.stringify(tools)},
                ${JSON.stringify([])}, ${''}, ${10},
                ${0}, ${'proposal'}, ${tier}, ${agentType},
                ${now}, ${now}
              )`
          )
        } catch (err: any) {
          return { error: `Failed to store proposal: ${err.message ?? err}` }
        }

        bus?.emit('agent.proposed', {
          id,
          name,
          role,
          reason,
          tier,
          proposedBy: ctx?.agentId ?? null,
          conversationId: ctx?.conversationId ?? null,
          createdAt: now,
        })

        return {
          ok: true,
          proposalId: id,
          message: `Agent proposal "${name}" saved. Ask the user to approve it in Settings → Agents before delegating.`,
        }
      },
    },
  ]
}
