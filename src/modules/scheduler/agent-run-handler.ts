// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Built-in handler for kind=agent_run jobs (I10).
 *
 * A scheduled agent run is a real conversation run by the agent: the handler
 * creates (or, with conversationPolicy 'reuse', re-arms) a conversation owned
 * by the job's creator — the owner when an agent or the system created the
 * job — with the prompt as its goal, and runs it through the shared runner
 * entry (ctx.agents.runConversation). That is the same supervised, autonomous
 * background run a board card gets, with full EYAS memory: recall from the
 * goal, designs, documents, durable-memory capture and the critic.
 *
 * The job succeeds when the run ran; the conversation id is on the execution
 * row either way, so Recent executions links the run. A run that did not
 * start fails the job with its reason.
 *
 * Effort (E6): a job may carry an effort. Every run writes it onto the run
 * conversation (conversations.effort), so the runner's one effort loader
 * (conversations/effort-intent.ts) reads it as the conversation's own level;
 * a job without one ('auto' included) writes NULL there, and the run takes
 * the agent's effort — the same chain every other run resolves. The gateway
 * clamps the level to the model the run lands on.
 */

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Logger } from 'pino'
import { createOwnerUserIdResolver } from '@modules/auth/owner-lookup'
import type { EffortLevel } from '@modules/model/reasoning/ladder.js'
import { EffortSettingSchema } from '@modules/model/reasoning/schemas.js'
import { JobFailure, type JobHandler, type JobHandlerContext } from './types.js'

/** handlerConfig of an agent_run job; validated on create/update and again at run time. */
export const AgentRunConfigSchema = z.object({
  agentId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  /** 'new' (default): a fresh conversation per run; 'reuse': run in `conversationId` again. */
  conversationPolicy: z.enum(['new', 'reuse']).optional(),
  conversationId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  /** The run's effort: a ladder rung; 'auto', null or absent → the agent's effort (stored as NULL). */
  effort: EffortSettingSchema.nullable().optional()
    .transform((v): EffortLevel | null | undefined => (v === 'auto' ? null : v)),
})

export type AgentRunConfig = z.infer<typeof AgentRunConfigSchema>

/** Parses a stored/submitted handlerConfig (JSON string or object). */
export function parseAgentRunConfig(raw: unknown): { ok: true; config: AgentRunConfig } | { ok: false; error: string } {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { ok: false, error: 'handlerConfig is not valid JSON' }
    }
  }
  const parsed = AgentRunConfigSchema.safeParse(value ?? {})
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.') || 'handlerConfig'}: ${i.message}`).join('; '),
    }
  }
  return { ok: true, config: parsed.data }
}

/** What the handler reads from ctx.agents. */
export interface AgentRunAgents {
  registry: { get(id: string): { id: string; enabled: boolean } | null | undefined }
  runConversation(conversationId: string): Promise<{
    ran: boolean
    reason?: string
    error?: string
    sessionId?: string
    parked?: boolean
  }>
}

/** What the handler reads from ctx.conversations. */
export interface AgentRunConversations {
  create(input: { userId: string; title?: string; modelBinding?: 'inherit' }): { id: string }
  get(id: string): { id: string; userId: string; status: string } | null
  update(id: string, update: {
    agentId?: string | null
    goalDescription?: string | null
    mode?: string
    status?: string
    effort?: EffortLevel | null
  }): void
}

export interface AgentRunHandlerDeps {
  db: any
  logger: Pick<Logger, 'info' | 'warn'>
  getAgents: () => AgentRunAgents | undefined
  getConversations: () => AgentRunConversations | undefined
}

/** A conversation in one of these states has a run in progress. */
const BUSY_STATUSES = new Set(['working', 'waiting_approval'])

export function createAgentRunHandler(deps: AgentRunHandlerDeps): JobHandler {
  const { db, logger } = deps
  const ownerUserId = createOwnerUserIdResolver(db)

  const isUser = (id: string): boolean => {
    try {
      return (db.all(sql`SELECT id FROM users WHERE id = ${id} LIMIT 1`) as unknown[]).length > 0
    } catch {
      return false
    }
  }

  /** The job's creator when that is a user; an agent- or system-created job runs as the owner. */
  const resolveUserId = (job?: JobHandlerContext): string => {
    if (job?.createdBy && isUser(job.createdBy)) return job.createdBy
    try {
      return ownerUserId()
    } catch {
      throw new Error('owner_unavailable: no user can own the scheduled run — finish the setup wizard first')
    }
  }

  return async (rawConfig, job) => {
    const parsed = parseAgentRunConfig(rawConfig)
    if (!parsed.ok) throw new Error(`invalid_config: ${parsed.error}`)
    const config = parsed.config

    const agents = deps.getAgents()
    const conversations = deps.getConversations()
    if (!agents?.runConversation || !agents.registry || !conversations) {
      throw new Error('runner_unavailable: scheduled agent runs need the agent and conversations modules')
    }

    const agent = agents.registry.get(config.agentId)
    if (!agent || !agent.enabled) {
      throw new Error(`agent_unavailable: agent "${config.agentId}" does not exist or is disabled`)
    }

    const userId = resolveUserId(job)
    // The job decides the run's effort on every run, a reused conversation
    // included: no job effort writes NULL, so a level a previous run (or an
    // earlier version of the job) left there never outlives the job's Auto.
    const arm = {
      agentId: config.agentId,
      goalDescription: config.prompt,
      mode: 'autonomous',
      status: 'waiting',
      effort: config.effort ?? null,
    }

    let conversationId: string | undefined
    if (config.conversationPolicy === 'reuse' && config.conversationId) {
      const existing = conversations.get(config.conversationId)
      if (existing) {
        if (existing.userId !== userId) {
          throw new Error(`conversation_forbidden: conversation ${existing.id} does not belong to the job's user`)
        }
        if (BUSY_STATUSES.has(existing.status)) {
          throw new JobFailure(
            `conversation_busy: conversation ${existing.id} is still running`,
            { conversationId: existing.id, agentId: config.agentId, ran: false, reason: 'conversation_busy' },
          )
        }
        conversations.update(existing.id, arm)
        conversationId = existing.id
      } else {
        logger.warn({ jobId: job?.jobId, conversationId: config.conversationId }, 'agent_run: the conversation to reuse is gone — starting a new one')
      }
    }

    if (!conversationId) {
      const title = config.title ?? `Scheduled: ${config.prompt.slice(0, 60)}${config.prompt.length > 60 ? '…' : ''}`
      // 'inherit': the run follows the agent's model (else the install default).
      const created = conversations.create({ userId, title, modelBinding: 'inherit' })
      conversations.update(created.id, arm)
      conversationId = created.id
    }

    const result = await agents.runConversation(conversationId)
    const summary: Record<string, unknown> = {
      conversationId,
      agentId: config.agentId,
      ran: result.ran,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.sessionId ? { sessionId: result.sessionId } : {}),
      ...(result.parked ? { parked: true } : {}),
    }
    if (!result.ran) {
      const reason = result.reason ?? 'error'
      throw new JobFailure(`${reason}: ${result.error ?? 'the scheduled run did not start'}`, summary)
    }
    logger.info({ jobId: job?.jobId, conversationId, agentId: config.agentId, sessionId: result.sessionId }, 'agent_run: scheduled run finished')
    return summary
  }
}
