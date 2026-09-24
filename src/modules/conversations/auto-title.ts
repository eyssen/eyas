// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * First-turn conversation title.
 *
 * New conversations are created with a null title and render as "Untitled" /
 * "Névtelen". After the first user request, if the title is still a
 * placeholder, we name the thread from that request: a deterministic snippet
 * immediately, optionally refined by the background model (fail-open).
 */

import type { AuxiliaryModelService } from '@modules/model/auxiliary.js'
import { fallbackTitleFromMessage, sanitizeGeneratedTitle } from '@shared/conversation-title.js'

export {
  fallbackTitleFromMessage,
  isUntitledTitle,
  planAutoTitle,
  sanitizeGeneratedTitle,
} from '@shared/conversation-title.js'

const TITLE_SYSTEM =
  'You write short conversation titles. Reply with ONLY the title: 3-8 words, ' +
  'no quotes, no trailing punctuation, same language as the user message.'

export interface GenerateConversationTitleOpts {
  /** The background model service; absent means the snippet is the title. */
  aux?: Pick<AuxiliaryModelService, 'completeText'>
  userMessage: string
  /** Attributes the title call to its conversation in traces. */
  conversationId?: string
}

/**
 * Background-model title, falling back to a truncated first message. The
 * 'title' purpose runs on its own routing tier only, never on the
 * conversation's (possibly expensive) model: with no eligible tier the
 * service answers none and no model is called.
 */
export async function generateConversationTitle(opts: GenerateConversationTitleOpts): Promise<string> {
  const fallback = fallbackTitleFromMessage(opts.userMessage)
  if (!fallback || !opts.aux) return fallback

  const raw = await opts.aux.completeText({
    purpose: 'title',
    system: TITLE_SYSTEM,
    user: opts.userMessage.slice(0, 800),
    maxTokens: 24,
    temperature: 0.2,
    ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
    fallback,
  })
  return sanitizeGeneratedTitle(raw, fallback)
}
