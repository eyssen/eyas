// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The privacy ingress check of the chat route. A NEW user message that
// carries a block-class value (an IBAN, a card number, … — whatever the
// policy sets to 'block') and is bound for a remote model is refused before
// anything is stored: no message row, no L0 capture, no triage, no title, no
// model call. The sender may re-send it with those values masked
// (`privacy: 'mask'`), and then the masked text is what is stored and sent.
//
// This is the ONLY place 'block' stops anything. Everything else — history,
// memory, tool results, embeddings — is masked on the way out by the gateway
// egress filter and never blocks.

import { z } from 'zod'
import type { EgressHostSource, InboundVerdict, Locality } from '@modules/privacy/service.js'
import type { PrivacyInboundEvent } from '@modules/privacy/errors.js'

/** The optional `privacy` field of POST /conversations/:id/messages. */
export const MessagePrivacySchema = z.enum(['mask']).optional()
export type MessagePrivacyMode = z.infer<typeof MessagePrivacySchema>

/** The part of the PrivacyService the ingress check needs. */
export interface InboundPrivacyCheck {
  checkInbound(text: string, opts: { localities: readonly Locality[] }): InboundVerdict
}

/**
 * What the chat route needs from the privacy module (read per message: the
 * privacy module may start after conversations). Absent: no ingress check.
 */
export interface ChatInboundPrivacy {
  service: InboundPrivacyCheck & {
    /** Where a provider sends prompts: 'local' (loopback / policy local hosts) or 'remote'. */
    localityOf(provider: EgressHostSource | null | undefined): Locality
  }
  /** Bus emit for eyas.privacy.inbound_refused / inbound_masked (types and identity only). */
  emit?(event: string, payload: PrivacyInboundEvent): void
}

export type PreflightResult =
  | {
      ok: true
      /** The text to store and send: unchanged, or masked when the sender asked for it. */
      text: string
      /** The block-class types masked on the sender's request (empty when nothing was masked). */
      maskedTypes: string[]
    }
  | {
      ok: false
      types: string[]
      /** The text as 'mask' would store it (only block-class values replaced). */
      maskedText: string
    }

/**
 * Checks one new user message. `localities` are the destinations the message
 * goes to (one model, or every God Mode participant); an empty list means
 * unknown and counts as remote. A missing privacy service lets everything
 * through unchanged.
 */
export function preflightUserText(input: {
  privacy: InboundPrivacyCheck | null | undefined
  text: string
  localities: readonly Locality[]
  mode?: MessagePrivacyMode
}): PreflightResult {
  const { privacy, text, localities, mode } = input
  if (!privacy || typeof text !== 'string' || !text) return { ok: true, text, maskedTypes: [] }
  const verdict = privacy.checkInbound(text, { localities })
  if (mode === 'mask') {
    // The sender chose masking: exactly the block-class values are replaced,
    // whatever the destination, so what is stored is what the card promised.
    return verdict.types.length > 0
      ? { ok: true, text: verdict.maskedText, maskedTypes: verdict.types }
      : { ok: true, text, maskedTypes: [] }
  }
  if (verdict.blocked) return { ok: false, types: verdict.types, maskedText: verdict.maskedText }
  return { ok: true, text, maskedTypes: [] }
}
