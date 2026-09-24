// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * I10 — a colleague hand-off starts the colleague.
 *
 * handoff_to_colleague writes the brief into the colleague's home thread as
 * its goal, parks the thread in 'waiting' and emits `eyas.board.task_assigned`
 * with `handoffFromConversationId`. The home thread has no board stage, so the
 * bot-executor (which scans stage-bound cards) never picks it up; this
 * subscriber runs it through the shared runner entry instead. The run is the
 * same supervised, autonomous background run a board card gets: the brief is
 * its goal and its recall query, and sensitive tools are gated by the
 * autonomy ladder.
 *
 * Only a thread still in 'waiting' is claimed. runConversation flips it to
 * 'working' before its first await, so a duplicate event (or a hand-off that
 * lands while the colleague is already running there) finds it taken; the
 * in-flight set covers the window before that write.
 */

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BusSubscription, EyasBus } from '@core/types'
import type { RunConversationEntry } from './run-deps.js'

/** A hand-off event. `task_assigned` without `handoffFromConversationId` is a board card (assign_task). */
const HandoffAssignedSchema = z.object({
  conversationId: z.string().min(1),
  handoffFromConversationId: z.string().min(1),
  agentId: z.string().min(1).optional(),
})

export interface HandoffRunDeps {
  bus: Pick<EyasBus, 'on'>
  db: any
  /** The shared runner entry (ctx.agents.runConversation), resolved per event. */
  runConversation: () => RunConversationEntry | undefined
  logger: {
    info(obj: unknown, msg?: string): void
    warn(obj: unknown, msg?: string): void
    error(obj: unknown, msg?: string): void
    debug?(obj: unknown, msg?: string): void
  }
}

export function wireHandoffRuns(deps: HandoffRunDeps): BusSubscription {
  const { bus, db, logger } = deps
  const inFlight = new Set<string>()

  return bus.on('eyas.board.task_assigned', async (data) => {
    const parsed = HandoffAssignedSchema.safeParse(data)
    if (!parsed.success) return
    const { conversationId, handoffFromConversationId, agentId } = parsed.data

    if (inFlight.has(conversationId)) return
    const row = (db.all(sql`SELECT status, agent_id FROM conversations WHERE id = ${conversationId}`) as Array<{ status: string; agent_id: string | null }>)[0]
    if (!row) return
    if (row.status !== 'waiting') {
      logger.debug?.({ conversationId, status: row.status }, 'Hand-off: the colleague thread is not waiting — no run started')
      return
    }
    // The event names the colleague the thread belongs to; anything else is
    // not this hand-off's thread.
    if (agentId && row.agent_id !== agentId) return

    const run = deps.runConversation()
    if (!run) {
      logger.warn({ conversationId }, 'Hand-off: the agent runner is not available — the colleague thread stays waiting')
      return
    }

    inFlight.add(conversationId)
    try {
      const result = await run(conversationId)
      if (result.ran) {
        logger.info({ conversationId, handoffFromConversationId, sessionId: result.sessionId, parked: result.parked ?? false }, 'Hand-off: colleague run finished')
      } else {
        logger.warn({ conversationId, handoffFromConversationId, reason: result.reason, error: result.error }, 'Hand-off: the colleague run did not start')
      }
    } catch (err) {
      logger.error({ err, conversationId }, 'Hand-off: the colleague run failed')
    } finally {
      inFlight.delete(conversationId)
    }
  })
}
