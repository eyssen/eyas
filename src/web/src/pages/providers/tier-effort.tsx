// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A routing tier's default effort (E5): applies to a call routed to the tier
// when the conversation or colleague sets none, clamped by the gateway to
// the tier's model. The select lists only the rungs that model offers — its
// capability comes with GET /model/models — and when the tier's model
// changes, a rung the new model does not offer is clamped visibly before the
// PUT (the server validates the pair). The embedding tier has no effort.

import { t } from '@/i18n'
import { EffortSelect } from '@/components/effort-select'
import {
  adjustEffortForOptions,
  effortFromSelect,
  effortOptionsFor,
  unknownEffortOptions,
  type EffortLevel,
  type EffortOptions,
  type EffortSetting,
} from '@/lib/effort-options'
import type { ReasoningCapability } from '../../../../modules/model/reasoning/capability'

/** A catalog model as GET /model/models lists it, with its effective reasoning capability. */
export interface TierModelInfo {
  id: string
  name: string
  provider: string
  reasoning?: ReasoningCapability
}

/** The tier fields an update reads and sends. */
export interface TierRow {
  tier: string
  providerId: string
  modelId: string
  fallbackProviderId: string | null
  fallbackModelId: string | null
  description: string
  enabled: boolean
  effort?: EffortLevel | null
}

/** Tiers whose calls take no reasoning effort. */
const NO_EFFORT_TIERS: ReadonlySet<string> = new Set(['embedding'])

export function tierHasEffort(tier: string): boolean {
  return !NO_EFFORT_TIERS.has(tier)
}

/**
 * The effort options of a tier's model, from the catalog. Null while the
 * catalog loads or when the tier has no model; a model the catalog does not
 * list (switched off, not refreshed) offers Auto only.
 */
export function tierEffortOptions(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  models: readonly TierModelInfo[] | null | undefined,
): EffortOptions | null {
  if (!models || !providerId || !modelId) return null
  const model = models.find((m) => m.provider === providerId && m.id === modelId)
  if (!model?.reasoning) return { ...unknownEffortOptions(modelId), mode: 'pinned', target: { providerId, modelId, name: model?.name || modelId } }
  return effortOptionsFor(model.reasoning, { providerId, modelId, name: model.name || modelId })
}

/**
 * The PUT body of one tier change, and the rung that was clamped for the
 * tier's new model (shown next to the select). A provider change picks the
 * provider's first model, as the tier cards always did.
 */
export function tierUpdate(
  current: TierRow,
  field: string,
  value: string,
  models: readonly TierModelInfo[] | null | undefined,
): { body: TierRow & { effort: EffortLevel | null }; adjusted?: { from: EffortLevel; to: EffortSetting } } {
  const firstModelOf = (providerId: string) => (models ?? []).find((m) => m.provider === providerId)?.id
  const body: TierRow & { effort: EffortLevel | null } = { ...current, effort: current.effort ?? null }
  if (field === 'effort') {
    body.effort = effortFromSelect(value)
    return { body }
  }
  ;(body as unknown as Record<string, unknown>)[field] = value || null
  if (field === 'providerId' && value) {
    const first = firstModelOf(value)
    if (first) body.modelId = first
  }
  if (field === 'fallbackProviderId' && value) {
    const first = firstModelOf(value)
    if (first) body.fallbackModelId = first
  }
  const primaryChanged = body.providerId !== current.providerId || body.modelId !== current.modelId
  if (!primaryChanged || !tierHasEffort(current.tier)) return { body }
  const { effort, adjusted } = adjustEffortForOptions(body.effort, tierEffortOptions(body.providerId, body.modelId, models))
  body.effort = effort
  return adjusted ? { body, adjusted } : { body }
}

export function TierEffortField({ tier, models, notice, onChange }: {
  tier: TierRow
  models: readonly TierModelInfo[] | null | undefined
  /** The "adjusted from … to …" line after a model change clamped the rung. */
  notice?: string | null
  onChange: (value: string) => void
}) {
  if (!tierHasEffort(tier.tier)) return null
  return (
    <div className="space-y-1 mt-3" data-testid={`tier-effort-${tier.tier}`}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('common.effort.label')}</span>
      <EffortSelect
        variant="form"
        value={tier.effort ?? null}
        options={tierEffortOptions(tier.providerId, tier.modelId, models)}
        hint={t('common.effort.tierHint')}
        onChange={(level) => onChange(level ?? 'auto')}
      />
      {notice && <p className="text-[11px] text-muted-foreground" role="status">{notice}</p>}
    </div>
  )
}
