// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L0 capture for chat messages, at the persistence layer (spec §6). Every
// addMessage call site — interactive routes, executeAgent, the orchestrator,
// God Mode's winner promotion, channel adapters — lands here, so the God
// Mode branch that returns before the old post-turn capture is covered
// structurally. Best-effort: nothing in here may change what addMessage
// returns.

import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { captureUnit, type RawSourceType } from '@modules/memory/v2/ingest-bridge.js'
import { resolveConversationScope } from '@modules/memory/v2/scope.js'
import type { ConversationMessage } from './conversation-service.js'

function sourceTypeOf(role: string): RawSourceType | null {
  if (role === 'user') return 'user_message'
  if (role === 'assistant') return 'assistant_message'
  return null
}

export function captureConversationMessage(db: EyasDb, message: ConversationMessage): void {
  try {
    const sourceType = sourceTypeOf(message.role)
    if (!sourceType) return
    if (!message.content || !message.content.trim()) return
    const scope = resolveConversationScope(db, message.conversationId)
    const actor = sourceType === 'user_message'
      ? (scope.userId ?? 'user')
      : (scope.agentId ?? message.provider ?? 'assistant')
    const occurredAtMs = Date.parse(message.createdAt)
    captureUnit({
      id: generateId(),
      sourceType,
      actor,
      conversationId: message.conversationId,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now(),
      content: message.content,
      // The owner's own words are 'owner'; the model's are 'derived'. A gist
      // takes trust_tier = min(sources) (spec §5), so a fact extracted from an
      // assistant turn that echoed injected text must not inherit the maximum.
      trustTier: sourceType === 'user_message' ? 'owner' : 'derived',
      meta: {
        origin: 'conversation_messages',
        messageId: message.id,
        attachments: message.attachmentIds,
        model: message.model,
        provider: message.provider,
        godMode: scope.godMode,
      },
    })
  } catch {
    /* capture is best-effort; the message is already stored */
  }
}
