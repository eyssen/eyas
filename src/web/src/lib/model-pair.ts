// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A provider+model pair as one select value, and how a pair is named in the
// UI. A model is identified by BOTH ids (model/binding.ts): the same model id
// can be listed by two providers, and a model id may itself contain ':' or
// '/' (ollama tags, openrouter slugs), so the two are joined with a control
// character neither id ever holds. Provider names come from the one display
// source (provider-display.ts), never from a map here.

import { providerName } from './provider-display'

export interface ModelPairValue {
  providerId: string
  modelId: string
}

const SEPARATOR = '\u001f'

/** One select value for a provider+model pair. */
export function encodeModelPair(providerId: string, modelId: string): string {
  return `${providerId}${SEPARATOR}${modelId}`
}

/** The pair a select value names, or null when the value is not an encoded pair. */
export function decodeModelPair(value: string): ModelPairValue | null {
  const at = value.indexOf(SEPARATOR)
  if (at < 0) return null
  const providerId = value.slice(0, at)
  const modelId = value.slice(at + SEPARATOR.length)
  return modelId ? { providerId, modelId } : null
}

/**
 * The model-assignment body: { agentId: {providerId, modelId} } — a model is
 * always named with its provider, so an id two providers list is never
 * ambiguous. Agents with no model chosen (or a value that is not an encoded
 * pair) are left out. Shared by the setup wizard and the Settings card.
 */
export function assignmentsBody(values: Record<string, string>): Record<string, ModelPairValue> {
  const out: Record<string, ModelPairValue> = {}
  for (const [agentId, value] of Object.entries(values)) {
    const pair = value ? decodeModelPair(value) : null
    if (pair?.providerId) out[agentId] = { providerId: pair.providerId, modelId: pair.modelId }
  }
  return out
}

/** One select option per provider+model: the same model id under two providers stays two options. */
export interface ModelPairOption {
  value: string
  name: string
  provider: string
}

export function modelPairOptions(providers: ReadonlyArray<{ id: string; models: ReadonlyArray<{ id: string; name?: string | null }> }>): ModelPairOption[] {
  return providers.flatMap((p) =>
    p.models.map((m) => ({ value: encodeModelPair(p.id, m.id), name: m.name || m.id, provider: p.id })))
}

/** The select value of a proposed assignment, or '' when there is no complete pair. */
export function proposedPairValue(proposal: { proposedProviderId?: string | null; proposedModelId?: string | null }): string {
  return proposal.proposedProviderId && proposal.proposedModelId
    ? encodeModelPair(proposal.proposedProviderId, proposal.proposedModelId)
    : ''
}

/** The last path segment of a model id (openrouter 'vendor/model' → 'model'). */
export function shortModelName(modelId: string): string {
  return modelId.split('/').pop() || modelId
}

/** "Provider / model" — how a pair is named in a label or a tooltip (the provider id until the catalog has loaded). */
export function modelPairLabel(providerId: string, modelId: string | null | undefined): string {
  const provider = providerName(providerId)
  return modelId ? `${provider} / ${shortModelName(modelId)}` : provider
}
