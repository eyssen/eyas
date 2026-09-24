// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasBus, ModuleContext } from '@core/types'
import type { StageService } from './services/stage-service.js'
import type { ProjectService } from './services/project-service.js'
import type { ConversationService } from '@modules/conversations/conversation-service'

/** Payload of `eyas.conversations.stage_changed` (emitted by conversationService.update). */
export interface StageChangedEvent {
  conversationId: string
  fromStageId: string | null
  toStageId: string | null
}

export interface StageAutomationDeps {
  stages: StageService
  projects: ProjectService
  conversations: ConversationService
  bus: EyasBus
  logger: ModuleContext['logger']
}

/**
 * Statuses whose card must not be touched: a run is already in flight, or the
 * card is out of play. Everything else (idle, waiting, ...) is armable.
 * 'waiting_approval' (D6) is a run paused pending an operator decision —
 * re-arming it here would fight with the park/unpark lifecycle (Task 5/6).
 */
const UNARMABLE_STATUSES = new Set(['working', 'waiting_approval', 'archived', 'deleted'])

/**
 * Modes that mean "no autonomous runner owns this card yet". The bot-executor
 * only claims 'managed' | 'autonomous', so a card left in either of these is
 * invisible to it. 'agent' is the legacy literal `createSubConversation` used
 * to write (D11) — kept here so a row that predates the one-time normalization
 * still gets promoted instead of sitting in the stage forever.
 */
const PROMOTABLE_MODES = new Set(['simple', 'agent'])

/**
 * Board→agent trigger: arms a card that enters a bot-capable stage so the
 * proactive-assistant's bot-executor can claim it.
 *
 * This is the producer half of a pair that was finished on both ends but never
 * connected — the executor polled for `status='waiting'` while nothing in the
 * system ever wrote that status, and board cards defaulted to mode 'simple',
 * which the executor's scan excludes.
 *
 * Arming deliberately never writes `stageId`, so the `stage_changed` event that
 * drives it can never be re-emitted by its own write (no recursion).
 */
export function createStageAutomation(deps: StageAutomationDeps) {
  const { stages, projects, conversations, bus, logger } = deps

  return {
    async handleStageChanged(evt: StageChangedEvent): Promise<void> {
      const conversationId = evt?.conversationId
      const toStageId = evt?.toStageId
      if (!conversationId || !toStageId) return

      const stage = stages.get(toStageId)
      if (!stage) return

      // A stage is bot-capable when a bot watches it OR it names the agent that
      // should own its cards. The auto-assignee-only case is deliberate (D11):
      // naming an agent on a stage IS the opt-in.
      if (!stage.botListen && !stage.autoAssigneeId) return

      const conv = conversations.get(conversationId)
      if (!conv) return
      if (UNARMABLE_STATUSES.has(conv.status)) {
        logger.debug?.(
          { conversationId, status: conv.status, stageId: stage.id },
          'Stage automation: card not armed — status is not armable',
        )
        return
      }

      // An agent the card already carries always wins: a human (or an earlier
      // assignment) chose it, and a stage default must never silently reroute
      // work to somebody else.
      const project = conv.projectId ? projects.get(conv.projectId) : null
      const agentId = conv.agentId ?? stage.autoAssigneeId ?? project?.defaultAgentId ?? null
      const goal = conv.goalDescription ?? conv.prompt ?? conv.title ?? null

      if (!agentId || !goal) {
        logger.warn(
          { conversationId, stageId: stage.id, hasAgent: !!agentId, hasGoal: !!goal },
          'Stage automation: card entered a bot stage but is not runnable (no agent or no goal) — left untouched',
        )
        return
      }

      const update: Parameters<ConversationService['update']>[1] = {}
      if (!conv.agentId) update.agentId = agentId
      if (!conv.goalDescription) update.goalDescription = goal
      if (PROMOTABLE_MODES.has(conv.mode)) update.mode = 'managed'
      if (conv.status !== 'waiting') update.status = 'waiting'

      // `update` may legitimately be empty (an already-armed card re-entering a
      // bot stage). Emit the signal anyway — the pickup kick is idempotent, and
      // a silent no-op here would strand a card whose earlier kick was lost.
      if (Object.keys(update).length > 0) conversations.update(conversationId, update)

      bus.emit('eyas.board.card_armed', {
        conversationId,
        targetId: conversationId,
        projectId: conv.projectId,
        stageId: stage.id,
        agentId,
        userId: conv.userId,
      })

      logger.info(
        { conversationId, stageId: stage.id, agentId },
        'Stage automation: card armed for autonomous pickup',
      )
    },
  }
}
