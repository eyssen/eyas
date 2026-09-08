// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/capture-gate.ts
//
// When to spend a model call. Deliberately NOT a keyword list.
//
// A lexical gate — "correction words", "preference words" — would fire unevenly
// across the six languages this product ships, and this project has already
// paid twice for exactly that class of bug (JS `\b` is defined on ASCII word
// characters, so `\bűrlap` never matches "Űrlapelemek"; Hungarian plurals
// lengthen the stem vowel, so "minta" is not a prefix of "minták"). It would
// also be guessing at meaning, which is the model's half of this design.
//
// What is left is one length check, which needs no language knowledge at all.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export interface CaptureConfig {
  enabled: boolean
  minUserChars: number
  maxPerConversation: number
  maxInputChars: number
}

export type GateReason = 'ok' | 'disabled' | 'too-short' | 'cap-reached'
export interface GateVerdict { run: boolean; reason: GateReason }

export interface GateInput {
  config: CaptureConfig
  userMessage: string
  alreadyExtracted: number
}

export function shouldExtract({ config, userMessage, alreadyExtracted }: GateInput): GateVerdict {
  if (!config.enabled) return { run: false, reason: 'disabled' }
  if (alreadyExtracted >= config.maxPerConversation) return { run: false, reason: 'cap-reached' }
  // [...str] counts code points, not UTF-16 units and not bytes: an accented
  // message must gate identically to an ASCII one of the same length.
  if ([...userMessage.trim()].length < config.minUserChars) return { run: false, reason: 'too-short' }
  return { run: true, reason: 'ok' }
}

/**
 * How many extractions this conversation has already SPENT.
 *
 * `maxPerConversation` is a model-spend guard, so only runs that actually spent
 * a model call count against it: a completed run (`skipped_reason IS NULL`), an
 * `unparsable` one (the call was made, the reply was unusable), a
 * `rejected-shape` one (the call was made, every note failed the schema), and
 * an `error` one (the call may well have been made — the failure could equally
 * be the model or the vault write that follows it, and a run that fails
 * repeatedly is exactly what a runaway guard is for). A `too-short` or `cap-reached` row
 * never reached the model and must not consume the budget — counting those
 * meant twenty short acknowledgements ("ok", "mehet", "igen") exhausted the cap
 * without a single call, and the next fact-rich turn was refused.
 *
 * Every row is still WRITTEN, skips included: the measurement is the point.
 * This only changes what the budget is spent on.
 */
export function countExtractions(db: EyasDb, conversationId: string): number {
  try {
    const row = (db.all(sql`SELECT COUNT(*) AS n FROM memory_capture_runs
      WHERE conversation_id = ${conversationId}
        AND (skipped_reason IS NULL OR skipped_reason IN ('unparsable', 'error', 'rejected-shape'))`) as Array<{ n: number }>)[0]
    return Number(row?.n ?? 0)
  } catch {
    // No table yet is the same as no extractions.
    return 0
  }
}
