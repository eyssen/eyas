// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A chat message refused by the privacy ingress check. The server answers the
// send with HTTP 422 {code: 'privacy_blocked', types, maskedContent} before
// any stream starts and before anything is stored. This turns that body into
// what the composer card needs; anything else is not a privacy refusal.

export const PRIVACY_BLOCKED_CODE = 'privacy_blocked'

/** Type slugs are short identifiers; anything else in the body is ignored. */
const TYPE_SLUG = /^[a-z0-9_-]{1,64}$/i

export interface PrivacyRefusalView {
  /** The block-class PII types found (built-in type ids or custom pattern slugs). */
  types: string[]
  /** The message as it would be stored with those values masked; null when the server sent none. */
  maskedContent: string | null
}

/** The refusal in a failed send's response, or null when the failure is anything else. */
export function parsePrivacyRefusal(status: number, body: unknown): PrivacyRefusalView | null {
  if (status !== 422 || !body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.code !== PRIVACY_BLOCKED_CODE) return null
  const types = Array.isArray(b.types)
    ? [...new Set(b.types.filter((t): t is string => typeof t === 'string' && TYPE_SLUG.test(t)))]
    : []
  return {
    types,
    maskedContent: typeof b.maskedContent === 'string' ? b.maskedContent : null,
  }
}

/** A refused message waiting on the sender: send it masked, edit it, or drop it. */
export interface PrivacyProposal {
  conversationId: string
  content: string
  attachmentIds: string[]
  plan: boolean
  types: string[]
  maskedContent: string | null
}
