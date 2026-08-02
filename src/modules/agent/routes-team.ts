// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import { WS_TOPICS } from '@shared/ws-topics.js'
import { driveTeam, hasActiveTeamDriver, type TeamDriverDeps, type TeamOrchestrationSink } from './team-driver.js'
import type { TeamSessionService } from './team-session-service.js'
import type { createOrchestrator } from './orchestrator.js'

const WriteMemorySchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  // Default to 'agent' layer when omitted — callers are typically agents
  // writing their own findings; system-layer entries come from specific
  // orchestrator code paths that always set layer explicitly.
  layer: z.enum(['system', 'agent']).default('agent'),
  category: z.enum(['finding', 'decision', 'blocker', 'question', 'fact']).default('fact'),
  authorAgentId: z.string().optional(),
  visibility: z.string().optional(),
})

/** Minimal lookup a route needs to verify who owns a conversation. */
export interface ConversationOwnerLookup {
  get(id: string): { userId: string } | null | undefined
}

export function createTeamRoutes(
  app: Hono,
  teamSessions: TeamSessionService,
  orchestrator: ReturnType<typeof createOrchestrator>,
  conversations?: ConversationOwnerLookup,
  bus?: { emit(subject: string, data: unknown): void },
  broadcaster?: TeamOrchestrationSink,
  /**
   * Direct WS push. The `team:*` colon subjects emitted below are legacy bus
   * traffic with NO transport to the browser (the bus→WS bridge only maps the
   * `eyas.*` namespace, and colon subjects must not grow a mapping), so the
   * team panel and proposal card only update live because of these frames.
   */
  wsBroadcast?: (topic: string, message: unknown) => void,
  logger?: TeamDriverDeps['logger'],
) {
  // Routes are registered on the provided app instance without a prefix.
  // The caller is responsible for mounting this app under /api/v1 via
  // ctx.http.route('/api/v1', teamApi) as done in index.ts.
  const api = app

  // The execution loop lives in team-driver (F2 T10) so the approve route, the
  // resume route and the boot scan all drive a session the same way.
  const driverDeps: TeamDriverDeps = {
    teamSessions,
    orchestrator,
    bus,
    broadcaster,
    wsBroadcast,
    logger,
  }

  // A team session is always scoped to the conversation that proposed it.
  // Resolving ownership through that chain means a session/conversation id
  // alone (guessable, sequential, or enumerable) can never be used to read
  // or write another user's team data — without this, the D6 stamp made
  // team/propose and team-session memory writes into a cross-user write
  // primitive. Fails CLOSED (denies) if the conversations dependency is
  // ever missing, rather than silently skipping the check.
  const ownsConversation = (c: any, conversationId: string): boolean => {
    if (!conversations) return false
    const userId = c.get('userId') as string | undefined
    if (!userId) return false
    const conv = conversations.get(conversationId)
    return !!conv && conv.userId === userId
  }

  // Propose a team for a conversation
  api.post('/conversations/:id/team/propose', requirePermission('create', 'Conversation'), async (c) => {
    const conversationId = c.req.param('id')
    if (!ownsConversation(c, conversationId)) return c.json({ error: 'Conversation not found' }, 404)
    const { goalDescription, complexity } = await c.req.json()
    if (!goalDescription) return c.json({ error: 'goalDescription required' }, 400)

    const proposal = await orchestrator.analyzeAndPropose(goalDescription, complexity ?? 'moderate')
    const session = teamSessions.create(conversationId, {
      config: proposal.config,
      reasoning: proposal.reasoning,
      estimatedTokens: proposal.estimatedTokens,
      goalDescription,
    })

    // One renderable shape for the proposal card, shared by the bus emit and
    // the WS frame so a reload (REST) and a live push can't disagree.
    const proposedPayload = {
      session,
      proposal: {
        phases: proposal.config.phases,
        estimatedTokens: proposal.estimatedTokens,
        estimatedCostUsd: proposal.estimatedCostUsd,
        reasoning: proposal.reasoning,
        agentGaps: proposal.agentGaps,
      },
    }
    bus?.emit(`team:${session.id}:proposed`, { session, proposal })
    bus?.emit(`team:proposed:${conversationId}`, proposedPayload)
    wsBroadcast?.(WS_TOPICS.teamProposed(conversationId), { event: 'team:proposed', data: proposedPayload })
    return c.json({ session, proposal })
  })

  // Get a team session
  api.get('/team-sessions/:id', requirePermission('read', 'Conversation'), (c) => {
    const session = teamSessions.get(c.req.param('id'))
    if (!session || !ownsConversation(c, session.parentConversationId)) {
      return c.json({ error: 'Session not found' }, 404)
    }
    return c.json({ session })
  })

  // List team sessions for a conversation — ownership is checked directly
  // against the conversation itself (there's no session id to chain through).
  api.get('/conversations/:id/team-sessions', requirePermission('read', 'Conversation'), (c) => {
    const conversationId = c.req.param('id')
    if (!ownsConversation(c, conversationId)) return c.json({ error: 'Conversation not found' }, 404)
    const sessions = teamSessions.listByConversation(conversationId)
    return c.json({ sessions })
  })

  // Approve and start execution
  api.post('/team-sessions/:id/approve', requirePermission('update', 'Conversation'), async (c) => {
    const id = c.req.param('id')
    const session = teamSessions.get(id)
    if (!session || !ownsConversation(c, session.parentConversationId)) {
      return c.json({ error: 'Session not found' }, 404)
    }

    teamSessions.approve(id)

    // Start execution in background — fire and forget, events go to bus + WS.
    void driveTeam(id, driverDeps)

    return c.json({ status: 'running' })
  })

  // Reject proposal
  api.post('/team-sessions/:id/reject', requirePermission('update', 'Conversation'), (c) => {
    const id = c.req.param('id')
    const session = teamSessions.get(id)
    if (!session || !ownsConversation(c, session.parentConversationId)) {
      return c.json({ error: 'Session not found' }, 404)
    }
    teamSessions.reject(id)
    return c.json({ status: 'rejected' })
  })

  // Resume after checkpoint
  api.post('/team-sessions/:id/resume', requirePermission('update', 'Conversation'), (c) => {
    const id = c.req.param('id')
    const session = teamSessions.get(id)
    if (!session || !ownsConversation(c, session.parentConversationId)) {
      return c.json({ error: 'Session not found' }, 404)
    }

    // Resume now RUNS a session (it re-drives one nothing is driving), so what
    // it accepts has to be exactly what is waiting at a checkpoint: 'paused',
    // or 'running' with the gate already recorded — the window between the
    // checkpoint event and the driver's pause(), and where a process that died
    // at the gate is left. Anything else would either start a team the user
    // never approved ('proposing'/'awaiting_approval') or re-drive a finished
    // one; before the re-drive existed, both merely mislabelled the row.
    const awaitingCheckpoint =
      session.status === 'paused' ||
      (session.status === 'running' && session.phaseStatus === 'awaiting_checkpoint')
    if (!awaitingCheckpoint) {
      return c.json({ error: 'Session is not awaiting a checkpoint' }, 409)
    }

    // Fast path: the driver that paused is still alive here, so resolving its
    // checkpoint promise is all it takes.
    if (teamSessions.resume(id)) return c.json({ status: 'resumed' })

    // No resolver. Either the driver is live but has not reached pause() yet
    // (a same-process race — arm it so the imminent pause resolves at once),
    // or nothing is driving this session at all, which after a restart is the
    // normal case: re-drive it from the persisted cursor.
    if (hasActiveTeamDriver(id)) {
      teamSessions.armPendingResume(id)
      return c.json({ status: 'resumed' })
    }

    void driveTeam(id, driverDeps, teamSessions.getResumeState(id))
    return c.json({ status: 'resumed' })
  })

  // Write memory entry
  api.post('/team-sessions/:id/memory', requirePermission('update', 'Conversation'), async (c) => {
    const id = c.req.param('id')
    const session = teamSessions.get(id)
    // Ownership is chained through the session's parent conversation. Report
    // "Session not found" either way (rather than a separate 403) so the
    // response doesn't confirm that a foreign session id exists.
    if (!session || !ownsConversation(c, session.parentConversationId)) {
      return c.json({ error: 'Session not found' }, 404)
    }
    const rawBody = await c.req.json()
    const parseResult = WriteMemorySchema.safeParse(rawBody)
    if (!parseResult.success) return c.json({ error: 'Invalid memory entry', details: parseResult.error.flatten() }, 400)
    const entry = teamSessions.writeMemory(id, parseResult.data)
    bus?.emit(`team:${id}:memory_written`, { entry })
    wsBroadcast?.(WS_TOPICS.teamEvent(id), { event: 'team', data: { type: 'memory_written', entry } })
    return c.json({ entry }, 201)
  })

  // Read memory entries
  api.get('/team-sessions/:id/memory', requirePermission('read', 'Conversation'), (c) => {
    const id = c.req.param('id')
    const session = teamSessions.get(id)
    if (!session || !ownsConversation(c, session.parentConversationId)) {
      return c.json({ error: 'Session not found' }, 404)
    }
    const category = c.req.query('category')
    const key = c.req.query('key')
    const entries = teamSessions.readMemory(id, {
      category: category ?? undefined,
      key: key ?? undefined,
    })
    return c.json({ entries })
  })

}
