// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Pure helpers for the context inspector's 'Memory delivered' row (I12): the
// same record on every provider — who the prompt was sized for, what recall
// put in the turn block (or why it was withheld), how many memory drill-down
// calls the turn made out of its cap, and how an ACP CLI got the system
// prompt. The server returns the stored record; these helpers pick what the
// row shows and which localized label says it.

/** Why a turn block carried no recall (prompt-wizard/types.ts RecallWithheld). */
export type RecallWithheld = 'external' | 'no-budget' | 'unavailable' | 'failed'

/** How the system prompt reached an ACP CLI's model (model/types.ts SystemPromptDelivery). */
export type SystemPromptChannel = 'meta-verified' | 'meta-unverified' | 'prompt'

/** GET /observability/compositions/:id → composition.delivery */
export interface CompositionDelivery {
  turnId: string
  /** Null when no assembler ran (the record then carries the prompt channel only). */
  profile: {
    providerId: string | null
    modelId: string | null
    contextWindow: number
    resolved: boolean
    windowSource: string
    supportsTools: boolean
    drillDown: boolean
    toolAddressing: string
  } | null
  budgetTotalTokens: number | null
  recall: {
    ids: string[]
    hits: number
    retrieved: number
    expanded: number
    chars: number
    budgetChars: number
    tokens: number
    budgetTokens: number
    withheld: RecallWithheld | null
  } | null
  systemPromptChannel: SystemPromptChannel | null
}

/** GET /observability/compositions/:id → composition.drillDown */
export interface DrillDownSummary {
  /** Calls of the turn that read memory; null when the rows carry no ordinal. */
  calls: number | null
  reads: number
  limit: number
}

const KEY = 'conversations.compositionPanel.memory'

const WITHHELD_KEYS: Record<RecallWithheld, string> = {
  external: `${KEY}.withheldReason.external`,
  'no-budget': `${KEY}.withheldReason.noBudget`,
  unavailable: `${KEY}.withheldReason.unavailable`,
  failed: `${KEY}.withheldReason.failed`,
}

const CHANNEL_KEYS: Record<SystemPromptChannel, string> = {
  'meta-verified': `${KEY}.channel.metaVerified`,
  'meta-unverified': `${KEY}.channel.metaUnverified`,
  prompt: `${KEY}.channel.prompt`,
}

export type WindowView =
  | { kind: 'known'; model: string; window: number }
  | { kind: 'unknown'; model: string }

export type RecallView =
  | { kind: 'delivered'; hits: number; expanded: number; tokens: number; budgetTokens: number }
  | { kind: 'none' }
  | { kind: 'withheld'; reasonKey: string }

export type DrillView =
  | { kind: 'used'; calls: number; reads: number; limit: number }
  | { kind: 'reads'; reads: number; limit: number }
  | { kind: 'unavailable' }

/** What the 'Memory delivered' row shows; each part null when there is nothing to say. */
export interface MemoryDeliveryView {
  window: WindowView | null
  recall: RecallView | null
  drill: DrillView | null
  /** i18n key of the prompt channel's label; null for a provider that takes a system prompt natively. */
  channelKey: string | null
}

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/**
 * The row's content, or null when the composition has no delivery record
 * (recorded before it existed, or no prompt was assembled) — the panel then
 * shows no row rather than a guess.
 */
export function memoryDeliveryView(
  delivery: CompositionDelivery | null | undefined,
  drillDown: DrillDownSummary | null | undefined,
  fallbackModel?: string | null,
): MemoryDeliveryView | null {
  if (!delivery) return null
  const profile = delivery.profile
  const model = profile?.modelId || profile?.providerId || fallbackModel || '—'

  const window: WindowView | null = profile
    ? profile.resolved && count(profile.contextWindow) > 0
      ? { kind: 'known', model, window: count(profile.contextWindow) }
      : { kind: 'unknown', model }
    : null

  const r = delivery.recall
  let recall: RecallView | null = null
  if (r) {
    if (r.withheld && WITHHELD_KEYS[r.withheld]) recall = { kind: 'withheld', reasonKey: WITHHELD_KEYS[r.withheld] }
    else if (count(r.hits) === 0) recall = { kind: 'none' }
    else recall = { kind: 'delivered', hits: count(r.hits), expanded: count(r.expanded), tokens: count(r.tokens), budgetTokens: count(r.budgetTokens) }
  }

  let drill: DrillView | null = null
  if (profile && !profile.drillDown) drill = { kind: 'unavailable' }
  else if (profile && drillDown) {
    drill = drillDown.calls == null
      ? { kind: 'reads', reads: count(drillDown.reads), limit: count(drillDown.limit) }
      : { kind: 'used', calls: count(drillDown.calls), reads: count(drillDown.reads), limit: count(drillDown.limit) }
  }

  const channel = delivery.systemPromptChannel
  const channelKey = channel && CHANNEL_KEYS[channel] ? CHANNEL_KEYS[channel] : null

  return { window, recall, drill, channelKey }
}
