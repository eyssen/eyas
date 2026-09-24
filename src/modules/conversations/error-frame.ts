// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The SSE error frame of the chat stream (G1 ErrorFrame). It carries the
// classification of the failure (src/shared/classify-model-error.ts): the
// kind and whether a retry could help, and — for a failure EYAS itself
// detected and can name, such as a CLI isolation check (code 'cliIsolation',
// params {provider, checks}) — the code and params the web localizes
// (conversations.errors.<code>). The raw provider text travels as `detail`,
// shown collapsed; it is never persisted as message content.

import { classifyModelError } from '@shared/classify-model-error.js'
import type { ErrorFrame } from '@shared/chat-stream.js'

export interface ChatErrorFrameOptions {
  /** The provider the failed turn ran on. */
  providerId?: string
  /** Whether the partial answer streamed before the failure was persisted. */
  partialSaved?: boolean
}

/** The raw text of a failure, or `fallback` when it carries none. */
export function errorDetail(err: unknown, fallback = 'Unknown error'): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return message || fallback
}

/** Build the error frame for a failed turn. */
export function chatErrorFrame(err: unknown, options: ChatErrorFrameOptions = {}): ErrorFrame {
  const classified = classifyModelError(err)
  return {
    type: 'error',
    kind: classified.kind,
    retryable: classified.retryable,
    ...(classified.code ? { code: classified.code } : {}),
    ...(classified.params ? { params: { ...classified.params } } : {}),
    ...(options.providerId ? { providerId: options.providerId } : {}),
    detail: errorDetail(err),
    partialSaved: options.partialSaved === true,
  }
}
