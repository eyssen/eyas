// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L0 capture for background-run outputs. agent_events has no conversation
// column: the join is agent_events.session_id = agent_sessions.id →
// agent_sessions.conversation_id, and the actor is agent_sessions.agent_id
// (agent_events.actor is NULL on every live row — spike §2 #21(ii)). Only
// LlmResponse is captured; CriticVerdict and the rest are run bookkeeping.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { captureUnit } from '@modules/memory/v2/ingest-bridge.js'
import { resolveConversationScope } from '@modules/memory/v2/scope.js'

interface LlmResponseShape {
  content?: unknown
  stopReason?: unknown
  usage?: unknown
}

export function captureLlmResponse(
  db: EyasDb,
  sessionId: string,
  seq: number,
  ts: number,
  payload: Record<string, unknown>,
): void {
  try {
    const response = (payload as { response?: LlmResponseShape }).response
    const content = typeof response?.content === 'string' ? response.content : ''
    if (!content.trim()) return
    const session = db.all<{ conversation_id: string | null; agent_id: string | null }>(
      sql`SELECT conversation_id, agent_id FROM agent_sessions WHERE id = ${sessionId}`,
    )[0]
    if (!session?.conversation_id) return
    const scope = resolveConversationScope(db, session.conversation_id)
    captureUnit({
      id: generateId(),
      sourceType: 'assistant_message',
      actor: session.agent_id ?? scope.agentId ?? 'agent',
      conversationId: session.conversation_id,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      occurredAtMs: ts,
      content,
      // Model-authored text: 'derived', not 'owner'. Matches the addMessage
      // path, and keeps trust_tier = min(sources) meaningful downstream.
      trustTier: 'derived',
      meta: {
        origin: 'agent_events',
        sessionId,
        seq,
        usage: response?.usage ?? null,
        stopReason: response?.stopReason ?? null,
      },
    })
  } catch {
    /* the event is already persisted; capture is best-effort */
  }
}
