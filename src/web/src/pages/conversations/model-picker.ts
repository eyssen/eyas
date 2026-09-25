// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The conversation's model picker (top bar), as data: which choices it
// offers, which one is selected, what the trigger reads and what the tooltip
// says about the pair the next turn answers with (GET /conversations/:id →
// effectiveBinding, model/binding.ts). The component only renders this.
//
// Choices (D3):
// - a fixed model — every enabled model, grouped by provider. The default an
//   agentless conversation has not fixed yet reads "Default model — fixed on
//   the first message"; a model the user picks is theirs: unavailable later,
//   the turn fails instead of answering with another model;
// - Auto-routing — a model per message; offered only while the global
//   "Allow Auto-routing" switch is on;
// - Colleague default — only for a colleague's conversation or a
//   sub-conversation: the colleague's model, else the delegating turn's.
//
// Provider names come from the shared catalog (lib/provider-display.ts); the
// component holds useProviderDisplay() so they refresh once it has loaded.

import { t, tOr } from './i18n'
import { decodeModelPair, encodeModelPair, modelPairLabel, shortModelName } from '@/lib/model-pair'
import { providerName } from '@/lib/provider-display'

/** The pair a conversation's next turn runs on and why (GET effectiveBinding). */
export interface EffectiveBindingView {
  providerId: string
  modelId: string
  source?: string
  tier?: string
  note?: string
  materialize?: boolean
  /** The model's catalog Vision flag: false = it cannot see images; null/absent = not known. */
  supportsImages?: boolean | null
}

/** Which provider/model answered a turn and which rule picked it (agent_start.binding, turnMeta.binding). */
export interface TurnBindingView {
  providerId: string
  modelId: string
  source?: string
  tier?: string
  note?: string
}

/** An enabled model of an enabled provider (GET /model/models). */
export interface PickerModel {
  id: string
  name?: string | null
  provider: string
}

export interface ModelPickerInput {
  modelBinding?: string | null
  providerId: string | null
  modelId: string | null
  agentId: string | null
  parentConversationId?: string | null
  effectiveBinding?: EffectiveBindingView | null
  bindingError?: string | null
  /** The global "Allow Auto-routing" switch (GET autoRoutingEnabled). Unknown counts as on. */
  autoRoutingEnabled?: boolean | null
  models: readonly PickerModel[]
}

export const PICKER_AUTO = 'auto'
export const PICKER_INHERIT = 'inherit'
/** The not-yet-fixed default of an agentless conversation: shown, never picked. */
export const PICKER_PENDING = 'pending'

export interface PickerOption {
  value: string
  label: string
  group?: string
  disabled?: boolean
  title?: string
}

export type PickerTone = 'normal' | 'warning' | 'error'

export interface ModelPickerView {
  /** The selected option's value. */
  value: string
  /** What the closed picker reads. */
  display: string
  options: PickerOption[]
  /** The tooltip: the pair the next turn answers with, why, and any fallback or error. */
  title: string
  tone: PickerTone
}

/** A PATCH /conversations/:id body that switches the binding. */
export type BindingPatch =
  | { modelBinding: 'auto' }
  | { modelBinding: 'inherit' }
  | { modelBinding: 'pinned'; providerId: string; modelId: string }

function modeOf(input: Pick<ModelPickerInput, 'modelBinding' | 'agentId' | 'parentConversationId'>): 'pinned' | 'auto' | 'inherit' {
  if (input.modelBinding === 'auto' || input.modelBinding === 'inherit' || input.modelBinding === 'pinned') return input.modelBinding
  return input.agentId || input.parentConversationId ? 'inherit' : 'pinned'
}

/** Why a turn runs on its pair, in words (the tooltip's and the caption's second half). */
export function bindingSourceText(binding: Pick<TurnBindingView, 'source'> & { materialize?: boolean }): string {
  switch (binding.source) {
    case 'auto': return t('conversations.topBar.sourceAuto')
    case 'agent': return t('conversations.topBar.sourceAgent')
    case 'parent': return t('conversations.topBar.sourceParent')
    case 'default': return binding.materialize ? t('conversations.topBar.sourcePendingDefault') : t('conversations.topBar.sourceDefault')
    default: return t('conversations.topBar.sourceConversation')
  }
}

/** The line that explains a fallback (a binding note), or null when the pair is the one asked for. */
function noteText(note: string | undefined, stored: string | null): string | null {
  switch (note) {
    case 'stored-binding-unavailable':
      return stored ? t('conversations.topBar.bindingFallback', { stored }) : t('conversations.topBar.sourceStoredFallback')
    case 'agent-binding-unavailable': return t('conversations.topBar.sourceAgentFallback')
    case 'auto-routing-disabled': return t('conversations.topBar.sourceAutoOff')
    case 'auto-routing-unavailable': return t('conversations.topBar.sourceAutoUnavailable')
    default: return null
  }
}

function errorText(code: string, stored: { providerId: string; modelId: string } | null): string {
  // The unavailable-model text names the pair; without one it would show raw placeholders.
  if (code === 'model_binding_unavailable' && !stored) return t('conversations.topBar.noModel')
  const params: Record<string, string> = {}
  if (stored) {
    params.provider = providerName(stored.providerId)
    params.model = stored.modelId
  }
  return tOr(`conversations.errors.${code}`, t('conversations.topBar.noModel'), params)
}

export function modelPickerView(input: ModelPickerInput): ModelPickerView {
  const mode = modeOf(input)
  const stored = input.providerId && input.modelId ? { providerId: input.providerId, modelId: input.modelId } : null
  const storedValue = stored ? encodeModelPair(stored.providerId, stored.modelId) : null
  const eb = input.effectiveBinding ?? null
  const effective = eb?.providerId ? modelPairLabel(eb.providerId, eb.modelId) : null
  const colleague = Boolean(input.agentId || input.parentConversationId)
  const autoOn = input.autoRoutingEnabled !== false

  const inheritLabel = mode === 'inherit' && effective
    ? t('conversations.topBar.modelInheritWith', { model: effective })
    : t('conversations.topBar.modelInherit')
  const pendingLabel = input.bindingError === 'no_model_configured'
    ? t('conversations.topBar.noModel')
    : t('conversations.topBar.modelPendingDefault')

  const options: PickerOption[] = []
  if (colleague || mode === 'inherit') {
    options.push({ value: PICKER_INHERIT, label: inheritLabel })
  }
  options.push({
    value: PICKER_AUTO,
    label: t('conversations.topBar.modelAuto'),
    ...(autoOn ? {} : { disabled: true, title: t('conversations.topBar.modelAutoOff') }),
  })
  if (mode === 'pinned' && !stored) {
    options.push({ value: PICKER_PENDING, label: pendingLabel, disabled: true })
  }

  // Fixed models, one group per provider in catalog order. The fixed pair of
  // this conversation stays listed (disabled) when the catalog no longer
  // offers it, so the picker shows what it is fixed to.
  const byProvider = new Map<string, PickerOption[]>()
  for (const m of input.models) {
    if (!m?.provider || !m.id) continue
    const group = t('conversations.topBar.modelPinnedGroup', { provider: providerName(m.provider) })
    const list = byProvider.get(m.provider) ?? []
    list.push({ value: encodeModelPair(m.provider, m.id), label: m.name || m.id, group })
    byProvider.set(m.provider, list)
  }
  if (mode === 'pinned' && stored && storedValue) {
    const listed = byProvider.get(stored.providerId)?.some((o) => o.value === storedValue) ?? false
    if (!listed) {
      const list = byProvider.get(stored.providerId) ?? []
      list.push({
        value: storedValue,
        label: shortModelName(stored.modelId),
        group: t('conversations.topBar.modelPinnedGroup', { provider: providerName(stored.providerId) }),
        disabled: true,
        title: errorText('model_binding_unavailable', stored),
      })
      byProvider.set(stored.providerId, list)
    }
  }
  for (const list of byProvider.values()) options.push(...list)

  const value = mode === 'auto' ? PICKER_AUTO
    : mode === 'inherit' ? PICKER_INHERIT
      : storedValue ?? PICKER_PENDING
  const display = mode === 'auto' ? t('conversations.topBar.modelAuto')
    : mode === 'inherit' ? inheritLabel
      : stored ? modelPairLabel(stored.providerId, stored.modelId) : pendingLabel

  // The tooltip: an error first (nothing answers), else the fallback that
  // applies, then the pair that answers and why.
  if (input.bindingError) {
    return { value, display, options, title: errorText(input.bindingError, stored), tone: 'error' }
  }
  const lines: string[] = []
  const note = noteText(eb?.note, stored ? modelPairLabel(stored.providerId, stored.modelId) : null)
  if (note) lines.push(note)
  if (eb && effective) lines.push(t('conversations.topBar.answeringWith', { model: effective, source: bindingSourceText(eb) }))
  return { value, display, options, title: lines.join('\n'), tone: note ? 'warning' : 'normal' }
}

/**
 * The PATCH a picked option sends, or null when nothing changes (the current
 * choice, the pending default, an unknown value).
 */
export function bindingPatchFor(value: string, current: string): BindingPatch | null {
  if (value === current) return null
  if (value === PICKER_AUTO) return { modelBinding: 'auto' }
  if (value === PICKER_INHERIT) return { modelBinding: 'inherit' }
  const pair = decodeModelPair(value)
  return pair ? { modelBinding: 'pinned', providerId: pair.providerId, modelId: pair.modelId } : null
}

/**
 * The per-reply "answered by" caption: visible text and its tooltip. Null
 * when the reply names no provider. The rule that picked the pair (the
 * turn's binding) is added only when that pair is the one that answered — a
 * failover to another model answers with its own name alone.
 */
export function answeredByCaption(
  provider: string | null | undefined,
  model: string | null | undefined,
  binding?: TurnBindingView | null,
): { text: string; title: string } | null {
  if (!provider) return null
  const name = providerName(provider)
  const text = model ? `${name} · ${shortModelName(model)}` : name
  const lines = [t('conversations.messages.answeredBy', { provider: name, model: model ?? '—' })]
  if (binding && binding.providerId === provider && (!model || binding.modelId === model)) {
    if (binding.source) lines.push(bindingSourceText(binding))
    const note = noteText(binding.note, null)
    if (note) lines.push(note)
  }
  return { text, title: lines.join('\n') }
}

/** The binding a stored reply's turn metadata records (turnMeta.binding), when it has a well-formed one. */
export function turnBindingOf(turnMeta: unknown): TurnBindingView | null {
  const binding = (turnMeta as { binding?: unknown } | null | undefined)?.binding
  if (!binding || typeof binding !== 'object') return null
  const b = binding as Record<string, unknown>
  if (typeof b.providerId !== 'string' || !b.providerId || typeof b.modelId !== 'string' || !b.modelId) return null
  return {
    providerId: b.providerId,
    modelId: b.modelId,
    ...(typeof b.source === 'string' ? { source: b.source } : {}),
    ...(typeof b.tier === 'string' ? { tier: b.tier } : {}),
    ...(typeof b.note === 'string' ? { note: b.note } : {}),
  }
}
