// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/assemble-system.ts
//
// THE assemble-and-flatten helper. Every system-prompt entry point in EYAS
// goes through this function, so that whatever the assembler learns to inject
// (a project brand, a design reference) reaches all of them at once instead of
// only the four that happened to call buildForPrimary directly.
//
// It never throws. A missing assembler, a missing agent and a failing
// assembler all return an empty system with `entryPoint: 'unassembled'` and a
// populated `assemblerError`, so the caller can record the failure rather than
// have it vanish into a bare catch. A missing agent or a failed assembly still
// gets the turn block (assembler.buildTurnOnly): no system prompt is no
// reason to answer without the clock and the recalled memory.
//
// The per-message turn block (clock + recalled memory) comes back as `turn`,
// separate from `system`: it rides on the current user message of the copy a
// provider is sent (attachTurnContext) — never on the stored message. Every
// entry path carries it: the agent runner attaches it once before its loop
// (AgentRunOptions.turn, or systemPrompt.turn), and the chat route's no-runner
// fallback attaches it itself. OpenCode tasks get the same recall block as
// their `system` field (opencode/developer-agent.ts).

import type { ContentBlock, ModelMessage } from '@modules/model/types.js'
import type { AssembledPrompt, ContextSection, PromptDelivery } from './types.js'
import type { DeliveryTarget } from './delivery-profile.js'
import { estimateTokens } from './token-budget.js'

/** Frame of the per-message turn block (assembler.ts builds it, attachTurnContext places it). */
export const TURN_CONTEXT_TAG = 'turn-context'

export interface AssemblerLike {
  buildForPrimary(opts: {
    agentId: string
    agentName: string
    conversationId: string | null
    projectId: string | null
    channelContext: unknown
    target?: DeliveryTarget
    turnText?: string | null
    audience?: 'owner' | 'external'
    turnId?: string | null
  }): Promise<AssembledPrompt>
  /** The turn block alone (assembler.ts). Absent: an unassembled prompt carries no turn. */
  buildTurnOnly?(opts: {
    conversationId: string | null
    target?: DeliveryTarget
    turnText?: string | null
    audience?: 'owner' | 'external'
    turnId?: string | null
  }): Promise<{ turn: string; sections: ContextSection[]; delivery: PromptDelivery }>
}

export interface AssembleSystemArgs {
  assembler?: AssemblerLike
  agentId: string | null
  conversationId: string | null
  projectId: string | null
  channelContext?: unknown
  /** Used when agentId is null — e.g. the conversation has no bound agent. */
  fallbackAgentId?: () => string | null
  /** The provider/model that will answer (BuildOptions.target). */
  target?: DeliveryTarget
  /** The current message, for recall's query (BuildOptions.turnText). */
  turnText?: string | null
  /** 'external' withholds recalled owner memory (BuildOptions.audience). */
  audience?: 'owner' | 'external'
  /** The turn's id for the memory access log (BuildOptions.turnId). */
  turnId?: string | null
}

export interface AssembledSystem {
  system: string
  sections: ContextSection[]
  entryPoint: 'assembled' | 'unassembled'
  assemblerError?: string
  /** Who the prompt was sized for (assembled only); the agent runner reads its profile. */
  delivery?: PromptDelivery
  /** The per-message turn block (assembled only); attach it with attachTurnContext. */
  turn?: string
}

/**
 * The delivery facts a context composition records: the window the prompt
 * was sized for, the section-cap total it was built under, and the delivery
 * record itself (the profile, what recall delivered and its turn id —
 * context-recorder.ts stores it as delivery_json and takes the recall's turn
 * id as the composition id). One helper so every entry path records the same
 * fields. An unresolved profile's window is the resolver's placeholder
 * default, not the model's: it is left out, so context occupancy never takes
 * it for the model's window.
 */
export function deliveryRecordFields(delivery: PromptDelivery | null | undefined): {
  contextWindow?: number
  budgetTotalTokens?: number
  delivery?: PromptDelivery
} {
  if (!delivery) return {}
  return {
    ...(delivery.profile.resolved ? { contextWindow: delivery.profile.contextWindow } : {}),
    budgetTotalTokens: delivery.budgetTotalTokens,
    delivery,
  }
}

/** Build a ContextSection for text that did not come from the assembler. */
export function rawSection(key: string, content: string): ContextSection {
  return {
    zone: 'append',
    key,
    content,
    chars: content.length,
    estimatedTokens: estimateTokens(content),
    truncated: false,
    droppedChars: 0,
  }
}

/**
 * Compose an AssembledPrompt into the single system string providers take.
 * The turn block is NOT part of it — it rides on the user message.
 */
export function flattenAssembled(a: AssembledPrompt): string {
  return [a.prefix, a.suffix, ...a.reminders].filter((s) => s.trim()).join('\n\n')
}

/**
 * EYAS's own frames that a sender must never be able to open: the turn block
 * and the recalled-memory fence inside it. A `<` followed by one of these, in
 * the text EYAS attaches the turn to, gets a zero-width space after it, so a
 * sender cannot hand the model a look-alike "added by EYAS" frame. Limited to
 * these tags on purpose: owner text (pasted XML, code) keeps every other tag.
 */
const FORGEABLE_FRAME_RE = new RegExp(`<(/?)((?:${TURN_CONTEXT_TAG}|eyas-memory-item|eyas-memory)\\b)`, 'gi')
const ZWSP = '\u200B'

/** The text with every EYAS frame tag defanged (idempotent). */
export function defangEyasFrames(text: string): string {
  return text.replace(FORGEABLE_FRAME_RE, `<${ZWSP}$1$2`)
}

function defangBlocks(blocks: readonly ContentBlock[]): ContentBlock[] {
  return blocks.map((b) => {
    const text = b?.type === 'text' ? (b as { text?: unknown }).text : undefined
    if (typeof text !== 'string') return b
    const clean = defangEyasFrames(text)
    return clean === text ? b : ({ ...b, text: clean } as ContentBlock)
  })
}

/**
 * Attach the turn block to the message list a provider is sent:
 *   - last message from the user, string content → the block, a blank line,
 *     then the user's text;
 *   - last message from the user, content blocks → a text block with the turn
 *     first (after any tool_result blocks, which must lead a user message);
 *   - otherwise (no messages, or the assistant spoke last) → a new user
 *     message holding the block.
 * Always attached — never skipped because the text already "looks like" a
 * frame: the content is the sender's, so it decides nothing. Callers attach
 * once per run on a history that holds no EYAS frame (a checkpoint keeps it
 * without one, stripTurnContext). The sender's text in that message has its
 * EYAS frame tags defanged, so a forged `<turn-context>`/`<eyas-memory>` never
 * reaches the model as one. Returns a new array and new message objects; the
 * caller's messages — and so the stored conversation — are never modified.
 * An empty turn returns the input unchanged.
 */
export function attachTurnContext(messages: readonly ModelMessage[], turn: string | null | undefined): ModelMessage[] {
  const block = (turn ?? '').trim()
  if (!block) return [...messages]
  const out = [...messages]
  const last = out[out.length - 1]
  if (!last || last.role !== 'user') {
    out.push({ role: 'user', content: block })
    return out
  }
  if (typeof last.content === 'string') {
    const text = defangEyasFrames(last.content)
    out[out.length - 1] = { ...last, content: text ? `${block}\n\n${text}` : block }
    return out
  }
  const blocks = defangBlocks(last.content)
  let at = 0
  blocks.forEach((b, i) => {
    if (b?.type === 'tool_result') at = i + 1
  })
  out[out.length - 1] = {
    ...last,
    content: [...blocks.slice(0, at), { type: 'text', text: block }, ...blocks.slice(at)],
  }
  return out
}

/**
 * The inverse of attachTurnContext for the block it attached: a user message
 * loses exactly that block (a message that held nothing else is dropped). A
 * checkpoint keeps the history this way, so a resumed run gets a fresh clock
 * and fresh recall instead of replaying the stale ones. Only the given block
 * is removed — never text that merely looks like a frame, which is the
 * sender's and stays. Returns the input array when nothing carried the block.
 */
export function stripTurnContext(messages: readonly ModelMessage[], turn: string | null | undefined): ModelMessage[] {
  const block = (turn ?? '').trim()
  if (!block) return messages as ModelMessage[]
  const prefix = `${block}\n\n`
  let changed = false
  const out: ModelMessage[] = []
  for (const message of messages) {
    if (message.role !== 'user') {
      out.push(message)
      continue
    }
    if (typeof message.content === 'string') {
      if (message.content === block) {
        changed = true
        continue
      }
      if (message.content.startsWith(prefix)) {
        changed = true
        out.push({ ...message, content: message.content.slice(prefix.length) })
        continue
      }
      out.push(message)
      continue
    }
    const blocks = message.content
    const kept = blocks.filter((b) => !(b?.type === 'text' && (b as { text?: unknown }).text === block))
    if (kept.length === blocks.length) {
      out.push(message)
      continue
    }
    changed = true
    if (kept.length > 0) out.push({ ...message, content: kept })
  }
  return changed ? out : (messages as ModelMessage[])
}

/**
 * An unassembled result that still carries the turn block when the assembler
 * can build one. Never throws: a turn that cannot be built is left out.
 */
async function unassembled(args: AssembleSystemArgs, assemblerError: string): Promise<AssembledSystem> {
  const base: AssembledSystem = { system: '', sections: [], entryPoint: 'unassembled', assemblerError }
  const buildTurnOnly = args.assembler?.buildTurnOnly
  if (!buildTurnOnly) return base
  try {
    const t = await buildTurnOnly.call(args.assembler, {
      conversationId: args.conversationId,
      ...(args.target ? { target: args.target } : {}),
      ...(args.turnText != null ? { turnText: args.turnText } : {}),
      ...(args.audience ? { audience: args.audience } : {}),
      ...(args.turnId ? { turnId: args.turnId } : {}),
    })
    return { ...base, sections: t.sections, delivery: t.delivery, ...(t.turn ? { turn: t.turn } : {}) }
  } catch {
    return base
  }
}

export async function assembleSystemPrompt(args: AssembleSystemArgs): Promise<AssembledSystem> {
  if (!args.assembler) {
    return { system: '', sections: [], entryPoint: 'unassembled', assemblerError: 'no assembler available' }
  }
  let agentId: string | null
  try {
    // Resolving the agent id happens INSIDE a try on purpose: fallbackAgentId
    // is a caller-supplied lookup that can hit the database, and a throw from
    // it must degrade like any other assembly failure rather than escape.
    agentId = args.agentId ?? args.fallbackAgentId?.() ?? null
  } catch (err) {
    return unassembled(args, err instanceof Error ? err.message : String(err))
  }
  if (!agentId) return unassembled(args, 'no agent resolved')
  try {
    const built = await args.assembler.buildForPrimary({
      agentId,
      agentName: agentId, // buildForPrimary does not read agentName; the id is a safe label
      conversationId: args.conversationId,
      projectId: args.projectId,
      channelContext: args.channelContext ?? null,
      ...(args.target ? { target: args.target } : {}),
      ...(args.turnText != null ? { turnText: args.turnText } : {}),
      ...(args.audience ? { audience: args.audience } : {}),
      ...(args.turnId ? { turnId: args.turnId } : {}),
    })
    return {
      system: flattenAssembled(built),
      sections: built.sections,
      entryPoint: 'assembled',
      ...(built.delivery ? { delivery: built.delivery } : {}),
      ...(built.turn ? { turn: built.turn } : {}),
    }
  } catch (err) {
    return unassembled(args, err instanceof Error ? err.message : String(err))
  }
}
