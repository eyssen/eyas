// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Ensures channel turns always produce either a delivered reply or an explicit
// failure notice — never silent success with no outbound message.

export interface ReplyGuardResult {
  /** Text that should be sent (may be a fallback). */
  text: string
  usedFallback: boolean
}

/**
 * If the agent returned usable text, pass it through. Otherwise emit a clear
 * failure so the user is never left guessing.
 */
export function ensureChannelReply(
  replyText: string | null | undefined,
  opts?: { fallback?: string; allowSilent?: boolean },
): ReplyGuardResult | null {
  if (opts?.allowSilent) return null
  const trimmed = (replyText ?? '').trim()
  if (trimmed) return { text: trimmed, usedFallback: false }
  return {
    text: opts?.fallback
      ?? 'I finished processing but produced no reply. Please try again or check the dashboard.',
    usedFallback: true,
  }
}
