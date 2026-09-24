// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L0 capture for chat messages, at the persistence layer (spec §6). Every
// addMessage call site — interactive routes, executeAgent, the orchestrator,
// God Mode's winner promotion, channel adapters — lands here, so the God
// Mode branch that returns before the old post-turn capture is covered
// structurally. Best-effort: nothing in here may change what addMessage
// returns.
//
// Trust comes from the AUTHOR, never from the role (spec §5, W8). A role
// 'user' row is not necessarily the owner's words: a delegation task, a
// handoff brief and a prompt-coach seed are composed by an agent or by EYAS,
// and a channel message is a third party's. A fact takes trust = min(sources),
// so a role-based 'owner' let any of those mint owner-trust facts.
//
// Background and team runs never store their instruction as a message (the
// goal travels only in the model call), so captureInstruction records it
// directly, once per distinct instruction.

import { createHash } from 'node:crypto'
import type { EyasDb } from '@core/types'
import { generateId, generateIdAt } from '@shared/crypto'
import {
  captureUnit,
  type CaptureAuthor,
  type CaptureEntryPath,
  type RawSourceType,
  type TrustTier,
} from '@modules/memory/v2/ingest-bridge.js'
import { resolveConversationScope, type ConversationScope } from '@modules/memory/v2/scope.js'
import type { ConversationMessage } from './conversation-service.js'

/** Who wrote the message and how it arrived; neither is stored on the message row. */
export interface MessageProvenance {
  author?: CaptureAuthor
  entryPath?: CaptureEntryPath
}

function sourceTypeOf(role: string): RawSourceType | null {
  if (role === 'user') return 'user_message'
  if (role === 'assistant') return 'assistant_message'
  return null
}

/**
 * The trust tier of a captured chat message.
 *  - assistant → derived (model-authored);
 *  - user + owner → owner (only the interactive routes say so);
 *  - user + agent / system → derived (delegation, handoff, seeds, goals);
 *  - user + peer → peer (channel and A2A senders);
 *  - user without an author → derived. 'derived' has a 1.0 recall
 *    multiplier, so a human path that forgot to say 'owner' costs nothing,
 *    while a laundering path that forgot to say 'agent' would.
 */
export function trustForMessage(role: string, author?: CaptureAuthor): TrustTier {
  if (role !== 'user') return 'derived'
  if (author === 'owner') return 'owner'
  if (author === 'peer') return 'peer'
  return 'derived'
}

/** L0 actor of a user-role text: the owner's user id, else the kind of author. */
function userActor(scope: ConversationScope, author: CaptureAuthor | undefined): string {
  if (author === 'owner') return scope.userId ?? 'owner'
  return author ?? 'unattributed'
}

export function captureConversationMessage(
  db: EyasDb,
  message: ConversationMessage,
  provenance: MessageProvenance = {},
): void {
  try {
    const sourceType = sourceTypeOf(message.role)
    if (!sourceType) return
    if (!message.content || !message.content.trim()) return
    const scope = resolveConversationScope(db, message.conversationId)
    const actor = sourceType === 'user_message'
      ? userActor(scope, provenance.author)
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
      trustTier: trustForMessage(message.role, provenance.author),
      meta: {
        origin: 'conversation_messages',
        messageId: message.id,
        attachments: message.attachmentIds,
        // The pair stored on the row; the answering routes store the pair
        // that actually answered (model/binding.ts answeredBy).
        model: message.model,
        provider: message.provider,
        agentId: scope.agentId,
        entryPath: provenance.entryPath ?? null,
        author: provenance.author ?? null,
        godMode: scope.godMode,
      },
    })
  } catch {
    /* capture is best-effort; the message is already stored */
  }
}

export interface InstructionCapture {
  conversationId: string
  /** The instruction the run was started with (a card's goal, a team member's brief). */
  text: string
  author: CaptureAuthor
  entryPath: CaptureEntryPath
  /** The run (agent_sessions id) that received it; provenance only. */
  sessionId?: string | null
}

/**
 * Deterministic L0 id of one instruction: the same text on the same entry
 * path of the same conversation is one row, however often the run is retried
 * or resumed. The ULID's time part is 0 on purpose — a retry must not change
 * it — and occurred_at carries the real capture time.
 */
export function instructionCaptureId(input: Pick<InstructionCapture, 'conversationId' | 'entryPath' | 'text'>): string {
  const seed = createHash('sha256')
    .update(`instruction\u0000${input.conversationId}\u0000${input.entryPath}\u0000${input.text}`)
    .digest()
  return generateIdAt(0, new Uint8Array(seed.subarray(0, 10)))
}

/**
 * Record the instruction of a run that stores no user message: a background
 * card's goal (conversation-runner) or a team member's brief (orchestrator).
 * Captured as a user_message with the author's trust, so the facts it yields
 * are never the owner's. Best-effort, like every capture hook.
 */
export function captureInstruction(db: EyasDb, input: InstructionCapture): void {
  try {
    const text = typeof input.text === 'string' ? input.text : ''
    if (!text.trim()) return
    const scope = resolveConversationScope(db, input.conversationId)
    captureUnit({
      id: instructionCaptureId({ conversationId: input.conversationId, entryPath: input.entryPath, text }),
      sourceType: 'user_message',
      actor: userActor(scope, input.author),
      conversationId: input.conversationId,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      occurredAtMs: Date.now(),
      content: text,
      trustTier: trustForMessage('user', input.author),
      meta: {
        origin: 'instruction',
        agentId: scope.agentId,
        entryPath: input.entryPath,
        author: input.author,
        sessionId: input.sessionId ?? null,
      },
    })
  } catch {
    /* capture is best-effort; the run goes ahead either way */
  }
}
