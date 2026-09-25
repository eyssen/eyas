// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/run-end.ts
//
// The one run-end entry to the durable-fact pass (F1). Every way EYAS runs a
// model hands its finished exchange here: the interactive turn (after the
// sink delivered the reply), a background card, a delegated / specialist /
// pipeline / A2A run (executeAgent), a team member and a channel reply. This
// hands it on to ctx.memoryCapture (capture/index.ts), so every entry path
// meets the same gate, the same per-conversation cap and the same run row.
// No entry path keeps a capture call of its own.
//
// Type-only imports on purpose: the run paths import this file, and it must
// not pull the capture pipeline into their module graph.

import type { CaptureInput } from './index.js'

/** ctx.memoryCapture: the pipeline createMemoryCapture builds. */
export type MemoryCaptureFn = (input: CaptureInput) => Promise<void> | void

/**
 * Hand one finished exchange to the durable-fact pass. Fire-and-forget: the
 * run is over and nobody waits for the extraction. Never throws into the run.
 *
 * An exchange with no answer text is not handed on (no call, no run row): a
 * run that answered nothing gave the extractor nothing to read. Everything
 * else, a short instruction included, goes to the capture, whose gate records
 * the skip.
 */
export function captureRunEnd(capture: MemoryCaptureFn | null | undefined, input: CaptureInput): void {
  if (!capture) return
  if (!input.assistantMessage || !input.assistantMessage.trim()) return
  try {
    const pending = capture(input)
    if (pending && typeof (pending as Promise<void>).catch === 'function') {
      ;(pending as Promise<void>).catch(() => { /* a missing note, never a failed run */ })
    }
  } catch { /* a missing note, never a failed run */ }
}
