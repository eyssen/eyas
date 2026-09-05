// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { TicketSourcePort } from '../port-types.js'
import type { TicketContext } from '../types.js'

/**
 * Narrow structural view of the internal board's conversation lookup.
 * We intentionally don't import `ConversationService`/`ConversationWithMessages`
 * here — this keeps the adapter decoupled and defensive: `content` is typed
 * `unknown` because a message's persisted content is a plain string today,
 * but callers (or future message shapes) may hand us a ContentBlock[]-like
 * array instead. We stringify either shape safely below.
 */
export interface BoardConversationLookup {
  get(id: string): {
    id: string
    title: string | null
    messages: Array<{ role: string; content: unknown }>
  } | null
}

/** Best-effort extraction of readable text from a message's `content`. */
function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && typeof (block as any).text === 'string') {
          return (block as any).text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

/**
 * TicketSourcePort backed by the internal EYAS board (conversations).
 * This is the only built-in ticket source — no vendor/ERP-specific code.
 */
export function createBoardTicketSource(conversations: BoardConversationLookup): TicketSourcePort {
  return {
    async fetchTicket(source: string, ticketId: string): Promise<TicketContext> {
      const conv = conversations.get(ticketId)
      if (!conv) {
        throw new Error(`Conversation not found: ${ticketId}`)
      }
      const body = conv.messages
        .map((m) => stringifyContent(m.content))
        .filter(Boolean)
        .join('\n\n')
      return {
        // `source` is caller-supplied (routes validate it against TICKET_SOURCES
        // elsewhere); we pass it through verbatim rather than hardcoding.
        source: source as TicketContext['source'],
        id: conv.id,
        title: conv.title ?? 'Untitled ticket',
        body,
        raw: conv as unknown as Record<string, unknown>,
      }
    },
  }
}
