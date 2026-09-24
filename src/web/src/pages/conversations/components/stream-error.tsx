// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// THE ONLY renderer of a failed chat turn (G10). Every failure — an SSE error
// frame, a refused POST, a lost connection — reaches the user through this
// file, in the user's language, whatever the provider:
//
//   1. a failure EYAS can name carries a code: conversations.errors.<code>
//      with its params (cliIsolation, cliSignIn, cliSandboxUnavailable, the
//      model-binding codes, …). Owners add their leaf key to this same flat
//      family, in all six locales;
//   2. otherwise, or when the code has no text in this build, the kind's
//      generic message: conversations.errors.<kind> via KIND_KEY, an
//      exhaustive map, so a new ModelErrorKind cannot typecheck without one;
//   3. an unknown kind reads as conversations.errors.other.
//
// The raw provider text is never the message: it is shown collapsed under
// "Show details". A failed turn whose partial answer was stored says so.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import type { ModelErrorKind } from '../../../../../shared/classify-model-error'
import { providerName, useProviderDisplay } from '@/lib/provider-display'
import { t, tOr } from '../i18n'

/** The generic message of every failure kind (conversations.errors.<kind>). */
export const KIND_KEY: Record<ModelErrorKind, string> = {
  'auth': 'conversations.errors.auth',
  'rate-limit': 'conversations.errors.rateLimit',
  'overload': 'conversations.errors.overload',
  'timeout': 'conversations.errors.timeout',
  'network': 'conversations.errors.network',
  'aborted': 'conversations.errors.aborted',
  'invalid-request': 'conversations.errors.invalidRequest',
  'provider-run-error': 'conversations.errors.providerRunError',
  'isolation': 'conversations.errors.isolation',
  'other': 'conversations.errors.other',
}

/** One failure as the chat shows it: where it came from, how it was classified, and the raw text. */
export interface ChatErrorView {
  /** An SSE error frame, a refused POST (HTTP status), or a connection that broke off. */
  source: 'stream' | 'http' | 'connection'
  /** The classification (shared/classify-model-error.ts ModelErrorKind); unknown kinds read as 'other'. */
  kind?: string
  /** A failure EYAS can name: localized as conversations.errors.<code>. */
  code?: string
  params?: Record<string, string | number>
  /** The raw text (provider or server), shown collapsed — never as the message. */
  detail?: string
  /** The partial answer streamed before the failure was stored. */
  partialSaved?: boolean
  providerId?: string
  /** The HTTP status of a refused POST. */
  status?: number
}

/** Codes whose remedy is on the provider settings page. */
const PROVIDER_REMEDY_CODES = new Set(['cliIsolation', 'cliSignIn', 'cliSandboxUnavailable', 'model_binding_unavailable', 'no_model_configured'])

/** Keys of this family that are not failure codes (a code must never resolve to one). */
const RESERVED_CODES = new Set(['showDetails', 'hideDetails', 'partialSaved', 'connection', 'http', 'openSettings'])

/** A code usable as one flat key segment. */
const CODE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/

/** The generic message key of a kind; an unknown kind reads as 'other'. */
export function kindKey(kind: unknown): string {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KIND_KEY, kind)
    ? KIND_KEY[kind as ModelErrorKind]
    : KIND_KEY.other
}

function displayParams(params: ChatErrorView['params']): Record<string, string | number> {
  const out: Record<string, string | number> = { ...params }
  if (typeof out.provider === 'string') out.provider = providerName(out.provider)
  return out
}

/** cliIsolation names its failed checks, each localized (an unknown check id is shown as is). */
function cliIsolationText(params: ChatErrorView['params']): string {
  const provider = String(params?.provider ?? '')
  const ids = String(params?.checks ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  const checks = (ids.length > 0 ? ids : ['unverified'])
    .map((id) => tOr(`conversations.errors.cliIsolation.check.${id}`, id))
    .join(', ')
  return t('conversations.errors.cliIsolation', { provider: provider ? providerName(provider) : 'CLI', checks })
}

/** The code's localized text in this build, or null when it has none. */
function codeText(code: string | undefined, params: ChatErrorView['params']): string | null {
  if (!code || !CODE_RE.test(code) || RESERVED_CODES.has(code)) return null
  if (code === 'cliIsolation') return cliIsolationText(params)
  const text = tOr(`conversations.errors.${code}`, '', displayParams(params))
  return text.trim() ? text : null
}

/** The localized message of a failure: its code's text, else its kind's (or the HTTP/connection message). */
export function chatErrorText(error: ChatErrorView): string {
  const coded = codeText(error.code, error.params)
  if (coded) return coded
  if (error.source === 'connection') return t('conversations.errors.connection')
  if (error.source === 'http') return t('conversations.errors.http', { status: error.status ?? 0 })
  return t(kindKey(error.kind))
}

/** The parts of a coded error body (a refused POST/PATCH) the chat can localize. */
export interface CodedErrorBody {
  error?: unknown
  message?: unknown
  code?: unknown
  providerId?: unknown
  modelId?: unknown
  levels?: unknown
}

/** The stable code of a rung the target model does not accept (model/reasoning/validate.ts). */
const EFFORT_UNSUPPORTED = 'EFFORT_UNSUPPORTED'

/**
 * A refused request's body as a failure view: the binding codes
 * (model_binding_unavailable, no_model_configured,
 * binding_inherit_needs_agent) with the pair as params, and
 * EFFORT_UNSUPPORTED with the rungs the model accepts. The raw text is kept
 * as the collapsed detail.
 */
export function errorViewFromBody(body: CodedErrorBody | null | undefined, status: number | undefined, fallback: string): ChatErrorView {
  const detail = typeof body?.error === 'string' && body.error
    ? body.error
    : typeof body?.message === 'string' && body.message ? body.message : fallback
  const code = typeof body?.code === 'string' ? body.code : undefined
  const model = typeof body?.modelId === 'string' ? body.modelId : ''
  const base: ChatErrorView = { source: 'http', ...(status !== undefined ? { status } : {}), ...(detail ? { detail } : {}) }
  if (code === EFFORT_UNSUPPORTED) {
    const levels = Array.isArray(body?.levels) ? body.levels.filter((l): l is string => typeof l === 'string') : []
    return levels.length === 0
      ? { ...base, code: 'effortNoControl', params: { model } }
      : { ...base, code: 'effortUnsupported', params: { model, levels: levels.join(', ') } }
  }
  const params: Record<string, string> = {}
  if (typeof body?.providerId === 'string') params.provider = body.providerId
  if (model) params.model = model
  return { ...base, ...(code ? { code } : {}), ...(Object.keys(params).length > 0 ? { params } : {}) }
}

/**
 * One line for a refused request outside the transcript (a toast): the
 * code's localized text, else the server's own text.
 */
export function formatErrorBody(body: CodedErrorBody | null | undefined, fallback: string): string {
  const view = errorViewFromBody(body, undefined, fallback)
  return codeText(view.code, view.params) ?? view.detail ?? fallback
}

/** A failed turn in the transcript: the localized message, a remedy link, the partial-answer note and the raw detail, collapsed. */
export function StreamError({ error }: { error: ChatErrorView }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // Re-render once the provider catalog has loaded: the text names the provider.
  useProviderDisplay()
  const text = chatErrorText(error)
  const detail = error.detail?.trim() ?? ''
  const showDetail = detail.length > 0 && detail !== text
  const toProviders = (error.code !== undefined && PROVIDER_REMEDY_CODES.has(error.code)) || error.kind === 'auth' || error.kind === 'isolation'

  return (
    <div role="alert" className="space-y-1.5" data-testid="stream-error">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <span className="whitespace-pre-wrap">{text}</span>
      </div>
      {toProviders && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => navigate({ to: '/providers' })}
        >
          {t('conversations.errors.openSettings')}
        </button>
      )}
      {error.partialSaved && (
        <div className="text-xs text-muted-foreground" data-testid="stream-error-partial">
          {t('conversations.errors.partialSaved')}
        </div>
      )}
      {showDetail && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {open ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
            {t(open ? 'conversations.errors.hideDetails' : 'conversations.errors.showDetails')}
          </button>
          {open && (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-2 font-mono text-[11px] text-muted-foreground">
              {detail}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
