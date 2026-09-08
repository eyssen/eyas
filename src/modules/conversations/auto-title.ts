// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * First-turn conversation title.
 *
 * New conversations are created with a null title and render as "Untitled" /
 * "Névtelen". After the first user request, if the title is still a
 * placeholder, we name the thread from that request: a deterministic snippet
 * immediately, optionally refined by a cheap-tier model (fail-open).
 */

import { runCheapModelPass, type CheapModelPassContext } from '@modules/model/cheap-pass.js'
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
  ctx: CheapModelPassContext & { decisionEngine?: unknown }
  userMessage: string
}

/**
 * Cheap-tier title, falling back to a truncated first message.
 * Skips the model entirely when no heartbeat-tier route is configured —
 * never bill the conversation's own (possibly expensive) model.
 */
export async function generateConversationTitle(opts: GenerateConversationTitleOpts): Promise<string> {
  const fallback = fallbackTitleFromMessage(opts.userMessage)
  if (!fallback) return ''

  let resolved: { provider: string; model: string } | null = null
  try {
    resolved = (opts.ctx as { decisionEngine?: { resolveForTier(tier: string): { provider: string; model: string } | null } })
      .decisionEngine?.resolveForTier('heartbeat') ?? null
  } catch {
    resolved = null
  }
  if (!resolved || !opts.ctx.model?.complete) return fallback

  const raw = await runCheapModelPass(opts.ctx, {
    system: TITLE_SYSTEM,
    user: opts.userMessage.slice(0, 800),
    maxTokens: 24,
    temperature: 0.2,
    fallback,
  })
  return sanitizeGeneratedTitle(raw, fallback)
}
