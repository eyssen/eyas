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
  /**
   * A CLI run stopped because its process isolation failed a check
   * (cli-runtime CliIsolationError). Terminal: a retry or a failover would
   * only run the same unisolated binary again.
   */
  | 'isolation'
  | 'other'

/**
 * Every kind as a runtime value. A Record, not an array, so a kind added to
 * the union above fails compilation until it is listed here too — persisted
 * kinds (turn meta, error frames) are validated against this set.
 */
const MODEL_ERROR_KIND_SET: Record<ModelErrorKind, true> = {
  'auth': true,
  'rate-limit': true,
  'overload': true,
  'timeout': true,
  'network': true,
  'aborted': true,
  'invalid-request': true,
  'provider-run-error': true,
  'isolation': true,
  'other': true,
}

export const MODEL_ERROR_KINDS = Object.keys(MODEL_ERROR_KIND_SET) as ModelErrorKind[]

export function isModelErrorKind(value: unknown): value is ModelErrorKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MODEL_ERROR_KIND_SET, value)
}

/** Values interpolated into a coded error's localized message (the web t() vars shape). */
export type ModelErrorParams = Record<string, string | number>

export interface ModelErrorClassification {
  kind: ModelErrorKind
  /** True exactly for {rate-limit, overload, timeout, network}. */
  retryable: boolean
  /** HTTP status, when the error carried one. */
  status?: number
  /**
   * Stable, localizable failure code from a CodedModelError (e.g.
   * 'cliSignIn'); the UI renders conversations.errors.<code>, falling back to
   * the kind. Absent for every uncoded error.
   */
  code?: string
  /** Values for the coded message, passed through verbatim. */
  params?: ModelErrorParams
}

/**
 * A model-call failure EYAS itself detected and can name: an isolation check
 * that failed, a CLI that is not signed in, a binding that cannot be served.
 * `kind` drives retry/park decisions like any other failure; `code` + `params`
 * let the UI show one localized, specific message instead of raw English
 * provider text. Recognised by classifyModelError directly or as a `cause`.
 */
export class CodedModelError extends Error {
  readonly kind: ModelErrorKind
  readonly code: string
  readonly params?: ModelErrorParams

  constructor(kind: ModelErrorKind, code: string, params?: ModelErrorParams, options?: { message?: string; cause?: unknown }) {
    super(options?.message ?? `${kind}: ${code}`)
    this.name = 'CodedModelError'
    this.kind = kind
    this.code = code
    if (params) this.params = { ...params }
    // Set by hand: the two-argument Error constructor is not in every lib
    // this file is type-checked against (the web targets ES2020).
    if (options?.cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, writable: true, configurable: true })
    }
  }
}

const MAX_CAUSE_DEPTH = 5

/** The CodedModelError itself, or the nearest one in its `cause` chain. */
function findCodedError(e: unknown): CodedModelError | null {
  let current: unknown = e
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current; depth++) {
    if (current instanceof CodedModelError) return current
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined
  }
  return null
}

/**
 * What a failed run still produced. No `done` event is emitted for a failed
 * run (the throw is the transport), so whatever makes it recoverable — the
 * answer so far — has to travel on the error itself. (A turn-limit stop is not
 * a failure: it ends in `done` with stopReason 'max_turns'.) There is no
 * provider session to resume: EYAS replays the conversation from its own
 * store.
 */
export interface ProviderRunErrorDetails {
  partialText?: string
  /** What the failed run spent; costUsd when the provider billed it itself (Claude Code). */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
}

/**
 * A provider run that finished without producing an answer — e.g. the Claude
 * Code SDK ending with `subtype: 'error_during_execution'`. Terminal: the model
 * did respond, it just did not finish the job, so an identical retry would
 * burn the same budget again. Budget stops (the CLI's turn limit) are not
 * errors: they end in `done` with their stop reason.
 */
export class ProviderRunError extends Error {
  readonly subtype: string
  readonly partialText?: string
  readonly usage?: { inputTokens: number; outputTokens: number; costUsd?: number }

  constructor(subtype: string, details?: ProviderRunErrorDetails) {
    super(`Provider run ended with subtype: ${subtype}`)
    this.name = 'ProviderRunError'
    this.subtype = subtype
    this.partialText = details?.partialText
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
  const coded = findCodedError(e)
  if (coded) {
    return { ...classify(coded.kind), code: coded.code, ...(coded.params ? { params: { ...coded.params } } : {}) }
  }
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
