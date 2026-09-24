// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The one outcome of the privacy INGRESS check: a NEW interactive user
// message (chat, God Mode, a channel) that carries a block-class value bound
// for a remote model is refused before anything is stored. It travels as a
// typed outcome — an HTTP 422 on the chat route, a localized notice on a
// channel — and never as a stream error frame: no turn ever starts for it.
// The detected values themselves are never part of it.

/** The stable code the chat route, the web client and the channel row share. */
export const PRIVACY_BLOCKED_CODE = 'privacy_blocked' as const

/** Bus event: a new message was refused (no values; the audit module persists it). */
export const PRIVACY_INBOUND_REFUSED_EVENT = 'eyas.privacy.inbound_refused'

/** Bus event: the sender chose to send a refused message with its values masked. */
export const PRIVACY_INBOUND_MASKED_EVENT = 'eyas.privacy.inbound_masked'

/** Where a checked message came from: the chat composer or a channel's source id (telegram, slack, …). */
export type InboundSource = 'chat' | (string & {})

export interface PrivacyRefusal {
  code: typeof PRIVACY_BLOCKED_CODE
  /** The block-class PII types found, in order of first appearance. */
  types: string[]
}

export function privacyRefusal(types: readonly string[]): PrivacyRefusal {
  return { code: PRIVACY_BLOCKED_CODE, types: [...types] }
}

/**
 * The 422 body of a refused chat message. `maskedContent` is the message with
 * only the block-class values replaced by their placeholders — what "send with
 * these values masked" would store — so the client can show that instead of
 * the raw text. It is returned only to the sender who typed it.
 */
export function privacyRefusalBody(refusal: PrivacyRefusal, maskedContent: string): {
  error: typeof PRIVACY_BLOCKED_CODE
  code: typeof PRIVACY_BLOCKED_CODE
  message: string
  types: string[]
  maskedContent: string
} {
  return {
    error: PRIVACY_BLOCKED_CODE,
    code: PRIVACY_BLOCKED_CODE,
    message: `Message not sent: it contains values the privacy policy blocks (${refusal.types.join(', ')}). Nothing was stored.`,
    types: refusal.types,
    maskedContent,
  }
}

/** The payload of PRIVACY_INBOUND_REFUSED_EVENT / PRIVACY_INBOUND_MASKED_EVENT — types and identity only. */
export interface PrivacyInboundEvent {
  /** The audit entry's target: the conversation, when the message had one. */
  targetId: string | null
  conversationId: string | null
  source: InboundSource
  types: string[]
  userId?: string
  /** Chat: the message was bound for a God Mode race. */
  godMode?: boolean
  /** Channel: the channel_inbound_events row the refusal was recorded on. */
  inboundEventId?: number
}
