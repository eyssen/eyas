// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Prompt Enhancer — creates a sub-conversation pre-seeded with a system prompt
 * that instructs the assistant to act as a model-aware prompt-refinement coach.
 *
 * The UI opens this sub-conversation in a dialog; when the user is satisfied,
 * the dialog's "Apply" button inserts the last assistant suggestion into the
 * parent conversation's input.
 */

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { ConversationService } from './conversation-service.js'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import {
  buildEnhancerSystemPrompt,
  isPromptTaskType,
  resolvePromptProfile,
  type PromptTaskType,
} from './prompt-profiles/index.js'

export function registerPromptEnhancerRoute(
  app: Hono,
  chatService: ConversationService,
  getDecisionEngine?: () => DecisionEngine | undefined,
) {
  app.post(
    '/api/v1/conversations/:id/prompt-enhancer',
    requirePermission('create', 'Conversation'),
    async (c: any) => {
      const userId = c.get('userId') as string | undefined
      if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

      const parentId = c.req.param('id')
      const parent = chatService.get(parentId)
      if (!parent || parent.userId !== userId) {
        throw new HTTPException(404, { message: 'Parent conversation not found' })
      }

      const body = await c.req.json().catch(() => ({}))
      const draft = typeof body.draft === 'string' ? body.draft.trim() : ''
      const taskType: PromptTaskType | null = isPromptTaskType(body.taskType) ? body.taskType : null
      // Optional override: UI may pass an explicit target; otherwise use parent routing.
      const targetProviderId =
        typeof body.targetProviderId === 'string' && body.targetProviderId.trim()
          ? body.targetProviderId.trim()
          : parent.providerId
      const targetModelId =
        typeof body.targetModelId === 'string' && body.targetModelId.trim()
          ? body.targetModelId.trim()
          : parent.modelId

      const profile = resolvePromptProfile({
        providerId: targetProviderId,
        modelId: targetModelId,
      })
      const enhancerSystemPrompt = buildEnhancerSystemPrompt({
        providerId: targetProviderId,
        modelId: targetModelId,
        taskType,
      })

      // Reuse an existing enhancer sub-conversation for this parent if one is
      // already open — avoids spawning a new dialog every time the button is
      // clicked mid-session. Otherwise create a fresh sub.
      // When task type or target model changes, still reuse but refresh the
      // system prompt so the next turn uses the updated coach instructions.
      const existing = chatService
        .getChildren(parentId)
        .find(
          (child) =>
            child.goalDescription === 'prompt-enhancer' &&
            child.status !== 'completed' &&
            child.status !== 'failed',
        )

      let sub
      let created = false
      if (existing) {
        sub = existing
        chatService.update(sub.id, { prompt: enhancerSystemPrompt })
      } else {
        created = true
        sub = chatService.createSubConversation({
          title: 'Prompt Enhancer',
          goalDescription: 'prompt-enhancer',
          parentConversationId: parentId,
        })
        // Persist the enhancer system prompt on the sub-conversation so the
        // PromptAssembler picks it up on every message turn.
        chatService.update(sub.id, { prompt: enhancerSystemPrompt })

        // Apply the dedicated `prompt_enhancer` routing tier if configured —
        // gives the user a single place (Settings → Routing) to pick which
        // model acts as the coach, rather than per-message auto-routing.
        const engine = getDecisionEngine?.()
        const tierPick = engine?.resolveForTier('prompt_enhancer')
        if (tierPick?.provider && tierPick?.model) {
          chatService.update(sub.id, { providerId: tierPick.provider, modelId: tierPick.model })
        }

        // Seed with the user's current draft if provided — kicks off the
        // refinement loop automatically on dialog open.
        if (draft.length > 0) {
          const taskLine = taskType ? `\nFeladattípus: ${taskType}` : ''
          const targetLine =
            targetProviderId || targetModelId
              ? `\nCélmodell: ${[targetProviderId, targetModelId].filter(Boolean).join(' / ')} (${profile.displayName})`
              : `\nCélmodell: nem rögzített — ${profile.displayName} családi alapértelmezés`
          chatService.addMessage(sub.id, {
            role: 'user',
            content: `Szeretnék finomítani ezen a prompt-piszkozaton:${targetLine}${taskLine}\n\n${draft}`,
          })
        }
      }

      return c.json(
        {
          id: sub.id,
          taskId: sub.taskId,
          title: sub.title,
          seededDraft: created && draft.length > 0,
          target: {
            providerId: targetProviderId,
            modelId: targetModelId,
            family: profile.family,
            displayName: profile.displayName,
          },
          taskType,
        },
        created ? 201 : 200,
      )
    },
  )
}
