// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Canonical usage (ModelUsage) from the counts a backend reports. Every API
// adapter maps its own usage block onto the same meaning, so token counters
// and costs compare across providers:
// - inputTokens: UNCACHED prompt tokens; the cached share is never counted
//   twice (once as input and again as a cache read);
// - cacheReadTokens / cacheCreationTokens: separate, omitted when zero;
// - outputTokens: every generated token, reasoning included; reasoningTokens
//   is the informational part of it;
// - a response whose backend reported no usage at all is reported:false, with
//   placeholder zeros, so its cost reads as unknown and never as $0;
// - promptTokensLastCall (the context-occupancy numerator) only where the
//   adapter says the counts are one call's whole prompt (`wholePrompt`).

import type { ModelUsage } from './types.js'

/** A reported token count, or 0 for anything that is not a positive finite number. */
export function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** A backend payload (usage block, feedback, …) as a plain object, or null when there is none. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** The counts an adapter derived from its backend's usage block, already in canonical terms. */
export interface UsageCounts {
  /** Prompt tokens that were neither read from nor written to the cache. */
  uncachedInput: number
  /** Every generated token, reasoning included. */
  output: number
  cacheRead?: number
  cacheCreation?: number
  /** The reasoning share of `output`. */
  reasoning?: number
}

/** The usage of a response whose backend reported none: placeholder zeros, cost unknown. */
export function unreportedUsage(): ModelUsage {
  return { inputTokens: 0, outputTokens: 0, reported: false }
}

export interface ToModelUsageOptions {
  /**
   * The counts are ONE model call's and together cover its whole prompt:
   * uncached input + cache reads + cache writes is what the model read. Then
   * that sum is the call's promptTokensLastCall, the context-occupancy
   * numerator. Opt-in, because a wrong numerator paints the context bar
   * wrong: counts summed over an internal tool loop (a CLI's result) or a
   * prompt count that leaves out a reused prefix (Ollama's prompt_eval_count)
   * must never become one.
   */
  wholePrompt?: boolean
}

/** Canonical usage from derived counts; `null` means the backend reported no usage at all. */
export function toModelUsage(counts: UsageCounts | null, options: ToModelUsageOptions = {}): ModelUsage {
  if (!counts) return unreportedUsage()
  const inputTokens = tokenCount(counts.uncachedInput)
  const cacheRead = tokenCount(counts.cacheRead)
  const cacheCreation = tokenCount(counts.cacheCreation)
  const reasoning = tokenCount(counts.reasoning)
  const prompt = inputTokens + cacheRead + cacheCreation
  return {
    inputTokens,
    outputTokens: tokenCount(counts.output),
    ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheCreation ? { cacheCreationTokens: cacheCreation } : {}),
    ...(reasoning ? { reasoningTokens: reasoning } : {}),
    ...(options.wholePrompt && prompt > 0 ? { promptTokensLastCall: prompt } : {}),
  }
}
