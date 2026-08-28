// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Scoped Prompt Coach — creates a hidden coach conversation for writing
 * durable project / project-type / agent system prompts.
 *
 * Sessions hang under a per-user archived hub so they never clutter the
 * main conversation list (same idea as prompt-enhancer sub-conversations).
 */

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { ConversationService } from './conversation-service.js'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import {
  buildScopedCoachSystemPrompt,
  coachGoalDescription,
  coachSessionTitle,
  isPromptCoachScope,
  type PromptCoachContext,
  type PromptCoachScope,
} from './prompt-profiles/scope-profiles.js'

const HUB_GOAL = 'prompt-coach-hub'
const HUB_TITLE = 'Prompt Coach'

function ensureCoachHub(chatService: ConversationService, userId: string) {
  const roots = chatService.list(userId)
  const existing = roots.find((c) => c.goalDescription === HUB_GOAL)
  if (existing) return existing

  const hub = chatService.create({ userId, title: HUB_TITLE })
  chatService.update(hub.id, {
    goalDescription: HUB_GOAL,
    status: 'archived',
    title: HUB_TITLE,
  })
  return chatService.get(hub.id) ?? { ...hub, goalDescription: HUB_GOAL, status: 'archived' }
}

function seedUserMessage(scope: PromptCoachScope, draft: string, context: PromptCoachContext): string {
  const scopeLabel =
    scope === 'project'
      ? 'project operating brief'
      : scope === 'project-type'
        ? 'project-type default brief'
        : 'agent system prompt'

  const ctxLines: string[] = []
  for (const [k, v] of Object.entries(context as Record<string, unknown>)) {
    if (v == null || v === '') continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      ctxLines.push(`${k}: ${v.join(', ')}`)
    } else {
      ctxLines.push(`${k}: ${String(v)}`)
    }
  }
  const ctxBlock = ctxLines.length > 0 ? `\nContext:\n${ctxLines.map((l) => `- ${l}`).join('\n')}` : ''

  if (draft.trim()) {
    return `Help me refine this ${scopeLabel} draft:${ctxBlock}\n\n${draft.trim()}`
  }
  return `Help me write a strong ${scopeLabel} from scratch.${ctxBlock}\n\nPlease ask one focused question if needed, then propose a full draft.`
}

export function registerPromptCoachRoute(
  app: Hono,
  chatService: ConversationService,
  getDecisionEngine?: () => DecisionEngine | undefined,
) {
  app.post(
    '/api/v1/prompt-coach',
    requirePermission('create', 'Conversation'),
    async (c: any) => {
      const userId = c.get('userId') as string | undefined
      if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

      const body = await c.req.json().catch(() => ({}))
      if (!isPromptCoachScope(body.scope)) {
        throw new HTTPException(400, {
          message: 'scope must be one of: project, project-type, agent-system',
        })
      }
      const scope: PromptCoachScope = body.scope
      const draft = typeof body.draft === 'string' ? body.draft : ''
      const context: PromptCoachContext =
        body.context && typeof body.context === 'object' && !Array.isArray(body.context)
          ? (body.context as PromptCoachContext)
          : {}

      const coachSystemPrompt = buildScopedCoachSystemPrompt(scope, context)
      const goal = coachGoalDescription(scope)
      const hub = ensureCoachHub(chatService, userId)

      // Always start a fresh coach session for the current draft/context.
      // Complete any previous open session of the same scope under the hub.
      for (const child of chatService.getChildren(hub.id)) {
        if (
          child.goalDescription === goal &&
          child.status !== 'completed' &&
          child.status !== 'failed' &&
          child.status !== 'deleted'
        ) {
          chatService.update(child.id, { status: 'completed' })
        }
      }

      const session = chatService.createSubConversation({
        title: coachSessionTitle(scope),
        goalDescription: goal,
        parentConversationId: hub.id,
      })
      chatService.update(session.id, { prompt: coachSystemPrompt })

      const engine = getDecisionEngine?.()
      const tierPick = engine?.resolveForTier('prompt_enhancer')
      if (tierPick?.provider && tierPick?.model) {
        chatService.update(session.id, {
          providerId: tierPick.provider,
          modelId: tierPick.model,
        })
      }

      chatService.addMessage(session.id, {
        role: 'user',
        content: seedUserMessage(scope, draft, context),
      })

      return c.json(
        {
          id: session.id,
          scope,
          seededDraft: true,
          title: session.title,
        },
        201,
      )
    },
  )
}
