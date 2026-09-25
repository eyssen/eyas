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
import type { Conversation, ConversationService } from './conversation-service.js'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import type { ModelPair } from '@modules/model/binding.js'
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
  /**
   * The model the parent conversation's next turn runs on (the binding
   * resolver's resolveStatic: its fixed pair, its colleague's, the default it
   * will fix). Null when none can serve it. Absent: no default target.
   */
  effectiveBindingOf?: (conversation: Conversation) => ModelPair | null,
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
      // Optional override: the UI may pass an explicit target; otherwise the
      // model the parent conversation actually runs on (its effective
      // binding, not its raw row — which is empty until the first turn and
      // says nothing about a colleague's model).
      let effective: ModelPair | null = null
      try {
        effective = effectiveBindingOf?.(parent) ?? null
      } catch {
        effective = null
      }
      const targetProviderId =
        typeof body.targetProviderId === 'string' && body.targetProviderId.trim()
          ? body.targetProviderId.trim()
          : effective?.providerId ?? null
      const targetModelId =
        typeof body.targetModelId === 'string' && body.targetModelId.trim()
          ? body.targetModelId.trim()
          : effective?.modelId ?? null

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
        // The coach runs on the dedicated `prompt_enhancer` routing tier when
        // one is configured — a single place (Settings → Routing) to pick the
        // coach model — else on the parent's effective model.
        const engine = getDecisionEngine?.()
        const tierPick = engine?.resolveForTier('prompt_enhancer')
        const coach: ModelPair | null = tierPick?.provider && tierPick?.model
          ? { providerId: tierPick.provider, modelId: tierPick.model }
          : effective
        sub = chatService.createSubConversation({
          title: 'Prompt Enhancer',
          goalDescription: 'prompt-enhancer',
          parentConversationId: parentId,
          binding: coach,
        })
        // Persist the enhancer system prompt on the sub-conversation so the
        // PromptAssembler picks it up on every message turn.
        chatService.update(sub.id, { prompt: enhancerSystemPrompt })

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
            // A seed EYAS composed around the draft: its key: value lines must
            // never become owner-trust facts.
            author: 'system',
            entryPath: 'prompt_enhancer',
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
