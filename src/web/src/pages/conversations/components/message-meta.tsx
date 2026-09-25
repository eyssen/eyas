// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The line under an assistant reply (G10), the same for every provider, read
// from the reply's stored turn metadata (conversation_messages.turn_meta):
//
//   - who answered — "Provider · model", the rule that picked it (H3/H5);
//   - the effort the turn ran with (E4's chip);
//   - how the turn ended — one badge, hidden when it simply completed: turn
//     limit, output limit, declined by the model, tool budget, stopped,
//     failed, waiting for approval. The partial answer is kept either way;
//   - tokens in/out and the cost with where it came from; a provider that
//     reported no usage reads "not reported", never $0;
//   - approvals the turn asked for, linking to the approval queue.
//
// A failed turn's badge names how it failed (its stored error kind, through
// the same generic messages stream-error.tsx uses). Nothing here trusts the
// stored shape: every field is read defensively, and an old reply without
// turn metadata shows only who answered it.

import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Ban, CircleSlash, Hourglass, OctagonX, ShieldAlert, Wrench } from 'lucide-react'
import type { CostSource, TurnOutcome } from '../../../../../shared/chat-stream'
import { formatRunCost } from '@/stores/run-tree-store'
import { turnBindingOf } from '../model-picker'
import { t } from '../i18n'
import { AnsweredBy } from './answered-by'
import { kindKey } from './stream-error'
import { TurnEffortChip } from './turn-effort-chip'

/** The badge of every outcome but 'completed' (which shows none). */
export const OUTCOME_KEY: Record<Exclude<TurnOutcome, 'completed'>, string> = {
  max_turns: 'conversations.outcome.maxTurns',
  max_tokens: 'conversations.outcome.maxTokens',
  refusal: 'conversations.outcome.refusal',
  tool_budget: 'conversations.outcome.toolBudget',
  cancelled: 'conversations.outcome.cancelled',
  parked: 'conversations.outcome.parked',
  failed: 'conversations.outcome.failed',
}

const OUTCOME_ICON: Record<Exclude<TurnOutcome, 'completed'>, typeof Ban> = {
  max_turns: Hourglass,
  max_tokens: CircleSlash,
  refusal: Ban,
  tool_budget: Wrench,
  cancelled: OctagonX,
  parked: ShieldAlert,
  failed: AlertTriangle,
}

/** Warning-toned outcomes stopped on a limit or a decision; 'failed' is an error; 'cancelled' is the user's own stop. */
const OUTCOME_TONE: Record<Exclude<TurnOutcome, 'completed'>, string> = {
  max_turns: 'border-warning/40 text-warning',
  max_tokens: 'border-warning/40 text-warning',
  refusal: 'border-warning/40 text-warning',
  tool_budget: 'border-warning/40 text-warning',
  parked: 'border-warning/40 text-warning',
  failed: 'border-destructive/40 text-destructive',
  cancelled: 'border-border text-muted-foreground',
}

export interface TurnUsageView {
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  costSource: CostSource
}

/** What the reply's metadata says about the turn, validated field by field. */
export interface TurnMetaView {
  outcome: TurnOutcome | null
  usage: TurnUsageView | null
  approvals: number
  /** How a failed turn failed (the ModelErrorKind stored with it), when it did. */
  errorKind: string | null
}

function count(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function isOutcomeWithBadge(value: unknown): value is Exclude<TurnOutcome, 'completed'> {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OUTCOME_KEY, value)
}

/** Read a stored turn_meta; absent or malformed fields come back empty. */
export function turnMetaView(turnMeta: unknown): TurnMetaView {
  const meta = turnMeta && typeof turnMeta === 'object' ? turnMeta as Record<string, unknown> : {}
  const outcome = meta.outcome === 'completed' || isOutcomeWithBadge(meta.outcome) ? meta.outcome as TurnOutcome : null
  let usage: TurnUsageView | null = null
  const raw = meta.usage && typeof meta.usage === 'object' ? meta.usage as Record<string, unknown> : null
  if (raw) {
    const source: CostSource = raw.reported === false || meta.costSource === 'unknown'
      ? 'unknown'
      : meta.costSource === 'provider' ? 'provider' : 'estimate'
    const cost = typeof raw.costUsd === 'number' && Number.isFinite(raw.costUsd) && raw.costUsd >= 0 ? raw.costUsd : null
    usage = {
      // The whole prompt: the uncached part plus what the cache served or stored.
      inputTokens: count(raw.inputTokens) + count(raw.cacheReadTokens) + count(raw.cacheCreationTokens),
      outputTokens: count(raw.outputTokens),
      costUsd: source === 'unknown' ? null : cost,
      costSource: source,
    }
  }
  const errorKind = typeof meta.errorKind === 'string' && meta.errorKind ? meta.errorKind : null
  return { outcome, usage, approvals: count(meta.approvals), errorKind }
}

/** The usage chip's text and tooltip. A turn without reported usage never shows a price. */
export function usageCaption(usage: TurnUsageView): { text: string; title: string } {
  if (usage.costSource === 'unknown') {
    return { text: t('conversations.usage.notReported'), title: t('conversations.usage.costUnknown') }
  }
  const tokens = t('conversations.usage.tokens', {
    input: usage.inputTokens.toLocaleString(),
    output: usage.outputTokens.toLocaleString(),
  })
  if (usage.costUsd === null) return { text: tokens, title: t('conversations.usage.costUnknown') }
  const cost = formatRunCost(usage.costUsd)
  return usage.costSource === 'provider'
    ? { text: `${tokens} · ${cost}`, title: t('conversations.usage.costProvider') }
    : { text: `${tokens} · ~${cost}`, title: t('conversations.usage.costEstimate') }
}

export function MessageMeta({ provider, model, turnMeta }: {
  provider: string | null | undefined
  model: string | null | undefined
  turnMeta: unknown
}) {
  const navigate = useNavigate()
  const view = turnMetaView(turnMeta)
  const outcome = isOutcomeWithBadge(view.outcome) ? view.outcome : null
  const usage = view.usage ? usageCaption(view.usage) : null
  const OutcomeIcon = outcome ? OUTCOME_ICON[outcome] : null

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2" data-testid="message-meta">
      <div className="min-w-0">
        <AnsweredBy provider={provider} model={model} binding={turnBindingOf(turnMeta)} />
      </div>
      <TurnEffortChip turnMeta={turnMeta} />
      {outcome && OutcomeIcon && (
        <span
          className={`mt-1.5 inline-flex flex-shrink-0 items-center gap-1 rounded border px-1.5 text-[10px] ${OUTCOME_TONE[outcome]}`}
          title={outcome === 'failed' && view.errorKind
            ? `${t(kindKey(view.errorKind))} ${t('conversations.outcome.partialKept')}`
            : t('conversations.outcome.partialKept')}
          data-testid="turn-outcome"
          data-outcome={outcome}
        >
          <OutcomeIcon className="h-3 w-3" aria-hidden />
          {t(OUTCOME_KEY[outcome])}
        </span>
      )}
      {usage && (
        <span className="mt-1.5 flex-shrink-0 text-[10px] tabular-nums text-muted-foreground" title={usage.title} data-testid="turn-usage">
          {usage.text}
        </span>
      )}
      {view.approvals > 0 && (
        <button
          type="button"
          className="mt-1.5 inline-flex flex-shrink-0 items-center gap-1 text-[10px] text-warning hover:underline"
          onClick={() => navigate({ to: '/autonomy' })}
          title={t('conversations.approval.openQueue')}
          data-testid="turn-approvals"
        >
          <ShieldAlert className="h-3 w-3" aria-hidden />
          {t('conversations.approval.count', { count: view.approvals })}
        </button>
      )}
    </div>
  )
}
