// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// ONE taxonomy for model-call failures (D9). Providers always THROW on failure;
// this decides what the gateway is allowed to do about it. Only transient
// conditions are retryable — retrying a 401, a caller-abort or a malformed
// request just burns budget on a call that can never succeed.
//
// Auth / rate-limit / overload detection is delegated to classify-auth-error so
// the reauth healer and the gateway can never disagree about what an auth
// failure is; this module only adds the buckets the healer never needed.

import { classifyAuthError } from './classify-auth-error.js'

export type ModelErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'overload'
  | 'timeout'
  | 'network'
  | 'aborted'
  | 'invalid-request'
  | 'provider-run-error'
  | 'other'

export interface ModelErrorClassification {
  kind: ModelErrorKind
  /** True exactly for {rate-limit, overload, timeout, network}. */
  retryable: boolean
  /** HTTP status, when the error carried one. */
  status?: number
}

/**
 * What a failed run still produced. A max-turns run is a budget outcome rather
 * than a crash: no `done` event is emitted for it (the throw is the transport),
 * so whatever makes it recoverable — the answer so far and the resumable
 * provider session — has to travel on the error itself.
 */
export interface ProviderRunErrorDetails {
  partialText?: string
  sessionId?: string | null
  usage?: { inputTokens: number; outputTokens: number }
}

/**
 * A provider run that finished without producing an answer — e.g. the Claude
 * Code SDK ending with `subtype: 'error_max_turns'`. Terminal: the model did
 * respond, it just did not finish the job, so an identical retry would burn the
 * same budget again.
 */
export class ProviderRunError extends Error {
  readonly subtype: string
  readonly partialText?: string
  readonly sessionId?: string | null
  readonly usage?: { inputTokens: number; outputTokens: number }

  constructor(subtype: string, details?: ProviderRunErrorDetails) {
    super(`Provider run ended with subtype: ${subtype}`)
    this.name = 'ProviderRunError'
    this.subtype = subtype
    this.partialText = details?.partialText
    this.sessionId = details?.sessionId
    this.usage = details?.usage
  }
}

/** F2 T8 — the kinds the auto-retry scheduler is allowed to reschedule. */
export const RETRYABLE_MODEL_ERROR_KINDS: readonly ModelErrorKind[] = [
  'rate-limit', 'overload', 'timeout', 'network',
]

const RETRYABLE_KINDS: ReadonlySet<ModelErrorKind> = new Set<ModelErrorKind>(RETRYABLE_MODEL_ERROR_KINDS)

const TIMEOUT_RE = /timed out|timeout|etimedout|esockettimedout/
const NETWORK_RE = /fetch failed|econnreset|econnrefused|enotfound|eai_again|epipe|ehostunreach|enetunreach|socket hang up|network error/
const ABORT_RE = /abort/

/** Everything the error carries that is worth pattern-matching, lowercased. */
function errorText(e: unknown): string {
  if (typeof e === 'string') return e.toLowerCase()
  if (!e || typeof e !== 'object') return ''
  const err = e as Record<string, unknown>
  const parts: unknown[] = [err.name, err.message, err.code]
  const cause = err.cause
  if (cause && typeof cause === 'object') {
    parts.push((cause as Record<string, unknown>).message, (cause as Record<string, unknown>).code)
  } else if (typeof cause === 'string') {
    parts.push(cause)
  }
  return parts.filter((p): p is string => typeof p === 'string').join(' ').toLowerCase()
}

function classify(kind: ModelErrorKind, status?: number): ModelErrorClassification {
  return { kind, retryable: RETRYABLE_KINDS.has(kind), ...(status !== undefined ? { status } : {}) }
}

/** Statuses classify-auth-error deliberately lumps into 'other'. */
function fromStatus(status: number): ModelErrorClassification {
  if (status === 408 || status === 504) return classify('timeout', status)
  if (status === 503) return classify('overload', status)
  if (status >= 400 && status < 500) return classify('invalid-request', status)
  return classify('other', status)
}

export function classifyModelError(e: unknown): ModelErrorClassification {
  if (e instanceof ProviderRunError) return classify('provider-run-error')

  const text = errorText(e)
  const { name, code } = (e && typeof e === 'object' ? e : {}) as { name?: unknown; code?: unknown }

  // A provider timeout is often implemented with an AbortController, so it
  // arrives wearing an abort name — the message is what separates "the caller
  // cancelled" (terminal) from "the provider took too long" (retryable).
  if (name === 'TimeoutError') return classify('timeout')
  if (name === 'AbortError' || code === 'ABORT_ERR') {
    return TIMEOUT_RE.test(text) ? classify('timeout') : classify('aborted')
  }

  const auth = classifyAuthError(e)
  if (auth.kind === 'auth') return classify('auth', auth.status)
  if (auth.kind === 'rate-limit') return classify('rate-limit', auth.status)
  if (auth.kind === 'overload') return classify('overload', auth.status)
  if (auth.status !== undefined) return fromStatus(auth.status)

  if (TIMEOUT_RE.test(text)) return classify('timeout')
  if (NETWORK_RE.test(text)) return classify('network')
  if (ABORT_RE.test(text)) return classify('aborted')
  return classify('other')
}

/** Convenience for call sites that only need the retry verdict. */
export function isRetryableModelError(e: unknown): boolean {
  return classifyModelError(e).retryable
}

/**
 * F2 T8 — the retry verdict for an already-persisted `error_kind` STRING
 * (agent_sessions.error_kind), not a live Error. Used by the auto-retry
 * scheduler, which only ever sees the column's value. A kind outside the
 * taxonomy (e.g. 'approval_loop', 'restart' — both their own class, not a
 * model failure) is simply not in the set, so this returns false for them.
 */
export function isRetryableErrorKind(kind: string | null | undefined): boolean {
  return !!kind && RETRYABLE_KINDS.has(kind as ModelErrorKind)
}
