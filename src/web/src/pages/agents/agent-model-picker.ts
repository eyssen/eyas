// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A colleague's model on the agent editor: a provider+model pair (H4), or
// empty — the colleague then runs on the conversation's own model (the
// delegating turn's, or the default fixed on first use). The select value
// encodes both ids; a legacy row that stored only a model id (the backfill
// could not tell its provider) keeps an empty provider half.

import { decodeModelPair, encodeModelPair, modelPairLabel } from '@/lib/model-pair'
import { providerName } from '@/lib/provider-display'
import type { SearchableSelectOption } from '@/components/ui/searchable-select'

/** An enabled model of an enabled provider (GET /model/models). */
export interface AgentPickerModel {
  id: string
  name?: string | null
  provider: string
}

/** The picker value of a stored colleague: its pair, a legacy bare model, or '' (the conversation's own model). */
export function agentModelValue(agent: { provider?: string | null; model?: string | null } | null | undefined): string {
  if (!agent?.model) return ''
  return encodeModelPair(agent.provider ?? '', agent.model)
}

/** How a picker value reads: "Provider / model", or the bare model id of a legacy row. */
export function agentModelLabel(value: string): string {
  const pair = decodeModelPair(value)
  if (!pair) return value
  return pair.providerId ? modelPairLabel(pair.providerId, pair.modelId) : pair.modelId
}

/**
 * The options: the conversation's own model, then every enabled model grouped
 * by provider, then the stored choice when the catalog does not list it (so
 * the select shows what is saved).
 */
export function agentModelOptions(models: readonly AgentPickerModel[], value: string, ownModelLabel: string): SearchableSelectOption[] {
  const options: SearchableSelectOption[] = [{ value: '', label: ownModelLabel }]
  for (const m of models) {
    if (!m?.provider || !m.id) continue
    options.push({ value: encodeModelPair(m.provider, m.id), label: m.name || m.id, group: providerName(m.provider) })
  }
  if (value && !options.some((o) => o.value === value)) {
    options.push({ value, label: agentModelLabel(value) })
  }
  return options
}

/**
 * The saved pair's label when it is not an enabled model of an active
 * provider (the warning under the picker), else null. Only a pair is judged:
 * a legacy bare model id or tier alias is bound at run time. Nothing is
 * judged before the catalog has loaded.
 */
export function agentModelUnavailable(value: string, models: readonly AgentPickerModel[] | null | undefined): string | null {
  if (!value || !models) return null
  const pair = decodeModelPair(value)
  if (!pair?.providerId) return null
  const listed = models.some((m) => m.provider === pair.providerId && m.id === pair.modelId)
  return listed ? null : modelPairLabel(pair.providerId, pair.modelId)
}

/**
 * The provider/model fields a save sends: undefined when the choice did not
 * change (a name or prompt edit never fails on a model that has since been
 * switched off), both null to clear it, else the pair (a legacy bare model
 * keeps a null provider — the server looks its owner up).
 */
export function agentModelWrite(value: string, initial: string): { provider: string | null; model: string | null } | undefined {
  if (value === initial) return undefined
  if (!value) return { provider: null, model: null }
  const pair = decodeModelPair(value)
  if (!pair) return undefined
  return { provider: pair.providerId || null, model: pair.modelId }
}
