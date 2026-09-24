// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// What every effort select shows (E5): the rungs the target model accepts
// (the effort-options endpoints), an Auto entry that says what Auto means
// there, a stored rung the model does not offer as "level → effective", and
// the per-turn chip. The clamp preview is the backend's own clamp
// (model/reasoning/clamp.ts, imported as-is), so what the UI predicts is
// what the gateway sends.
//
// Pure: labels come through the shared common.effort.* keys.

import { t } from '@/i18n'
import { clampEffort } from '../../../modules/model/reasoning/clamp'
import {
  EFFORT_SOURCES,
  isEffortLevel,
  type EffortIntent,
  type EffortLevel,
  type EffortSetting,
  type EffortSource,
} from '../../../modules/model/reasoning/ladder'
import type { ReasoningKind } from '../../../modules/model/reasoning/capability'
import type {
  ConversationEffortOptions,
  EffortOptions,
  EffortOptionsTarget,
} from '../../../modules/model/reasoning/options'

export type { ConversationEffortOptions, EffortOptions, EffortOptionsTarget, EffortIntent, EffortLevel, EffortSetting, EffortSource }
export { effortOptionsFor, unknownEffortOptions } from '../../../modules/model/reasoning/options'

/** The select value of Auto (stored as NULL). */
export const EFFORT_AUTO = 'auto'

/** A rung's label; an on/off model reads Off / On instead of None / High. */
export function effortLevelLabel(level: EffortSetting, kind?: ReasoningKind): string {
  if (level === 'auto') return t('common.effort.auto')
  if (kind === 'toggle') {
    if (level === 'none') return t('common.effort.toggle.off')
    if (level === 'high') return t('common.effort.toggle.on')
  }
  return t(`common.effort.level.${level}`)
}

/** Who set an effort: the conversation, Deep, the colleague, the delegating conversation, … */
export function effortSourceLabel(source: EffortSource): string {
  return t(`common.effort.source.${source}`)
}

/** The model the options are for, by name (null in auto mode). */
function targetName(options: EffortOptions | null | undefined): string | null {
  return options?.target?.name || options?.target?.modelId || null
}

/**
 * The Auto entry: what Auto resolves to here — an inherited level and who set
 * it ("Auto · Max (Deep)"), else the model's own default when it is known.
 */
export function effortAutoLabel(options: EffortOptions | null | undefined, inherited?: EffortIntent | null): string {
  const kind = options?.kind
  // The inherited level as the model will run it; on a model without
  // reasoning control it means nothing, so the plain Auto label applies.
  const level = inherited && inherited.level !== 'auto' ? effortPreview(inherited.level, options) : 'auto'
  if (inherited && level !== 'auto') {
    return t('common.effort.autoInherits', {
      level: effortLevelLabel(level, kind),
      source: effortSourceLabel(inherited.source),
    })
  }
  if (!options || options.mode !== 'pinned' || options.levels.length === 0) return t('common.effort.auto')
  if (options.defaultLevel) return t('common.effort.autoModelDefault', { level: effortLevelLabel(options.defaultLevel, kind) })
  return t('common.effort.autoUnknownDefault')
}

/**
 * The level the gateway will send for `level` on the options' model — the
 * backend clamp itself. Auto mode picks the model per message, so nothing
 * is predicted there (the level is what is asked for).
 */
export function effortPreview(level: EffortSetting, options: EffortOptions | null | undefined): EffortSetting {
  if (!options || options.mode === 'auto') return level
  return clampEffort(level, { kind: options.kind, levels: options.levels, clampMap: options.clampMap }).effective
}

export interface EffortSelectEntry {
  value: string
  label: string
}

/**
 * The select's entries: Auto first, then only the rungs the model accepts.
 * A stored rung the model does not offer stays visible as "level → effective"
 * (a model change never rewrites a stored effort silently).
 */
export function effortSelectEntries(
  value: EffortLevel | null,
  options: EffortOptions | null | undefined,
  inherited?: EffortIntent | null,
): EffortSelectEntry[] {
  const kind = options?.kind
  const entries: EffortSelectEntry[] = [{ value: EFFORT_AUTO, label: effortAutoLabel(options, inherited) }]
  const levels = options?.levels ?? []
  for (const level of levels) entries.push({ value: level, label: effortLevelLabel(level, kind) })
  if (value && !levels.includes(value)) {
    const effective = effortPreview(value, options)
    const model = targetName(options)
    entries.push({
      value,
      label: options && model && options.mode !== 'auto' && effective !== value
        ? t('common.effort.unsupportedCurrent', {
          level: effortLevelLabel(value),
          effective: effortLevelLabel(effective, kind),
          model,
        })
        : effortLevelLabel(value),
    })
  }
  return entries
}

/** The hints under (or on) a select: why only Auto is offered, auto-routing, hidden reasoning. */
export function effortHints(options: EffortOptions | null | undefined): string[] {
  if (!options) return []
  const model = targetName(options) ?? ''
  const hints: string[] = []
  if (options.mode === 'auto') hints.push(t('common.effort.autoRouted'))
  else if (options.kind === 'unknown' || options.mode === 'unknown') hints.push(t('common.effort.unknownModel', { model }))
  else if (options.levels.length === 0) hints.push(t('common.effort.noControl', { model }))
  if (options.levels.length > 0 && options.reasoningVisible === 'hidden' && options.mode === 'pinned') {
    hints.push(t('common.effort.reasoningHidden'))
  }
  return hints
}

/** The value a select change stores: the rung, or null for Auto. */
export function effortFromSelect(value: string): EffortLevel | null {
  return isEffortLevel(value) ? value : null
}

/**
 * A stored rung after the target model changed (agent editor, tier rows):
 * a rung the new model does not accept is clamped visibly before the save —
 * the pair is validated on save. Auto, auto mode (any rung is clamped per
 * turn) and a model EYAS has no facts about (the gateway resolves it to Auto
 * and keeps the intent) stay as they are.
 */
export function adjustEffortForOptions(
  effort: EffortLevel | null,
  options: EffortOptions | null | undefined,
): { effort: EffortLevel | null; adjusted?: { from: EffortLevel; to: EffortSetting } } {
  if (!effort || !options || options.mode === 'auto' || options.kind === 'unknown' || options.mode === 'unknown') return { effort }
  if (options.levels.includes(effort)) return { effort }
  const effective = effortPreview(effort, options)
  const next = isEffortLevel(effective) ? effective : null
  return { effort: next, adjusted: { from: effort, to: next ?? 'auto' } }
}

/**
 * Whether loaded options are the ones for this model — a select that just
 * switched model still holds the previous model's options for one render.
 * No model → the Auto tier union; a bare model id (no provider) → any
 * model answer (the server resolved the id).
 */
export function effortOptionsMatch(
  options: EffortOptions | null | undefined,
  model: { providerId?: string | null; modelId?: string | null } | null | undefined,
): boolean {
  if (!options) return false
  if (!model?.modelId) return options.mode === 'auto'
  if (options.mode === 'auto') return false
  if (!model.providerId) return true
  return options.target?.providerId === model.providerId && options.target?.modelId === model.modelId
}

/** The inline notice of an adjusted rung ("Effort adjusted from Extra high to High …"). */
export function effortAdjustedText(adjusted: { from: EffortLevel; to: EffortSetting }, kind?: ReasoningKind): string {
  return t('common.effort.adjusted', { from: effortLevelLabel(adjusted.from), to: effortLevelLabel(adjusted.to, kind) })
}

// ─── Per-turn chip ───────────────────────────────

/** A reply's recorded effort (TurnMeta.effort). */
export interface TurnEffortView {
  requested: EffortSetting
  effective: EffortSetting
  source?: EffortSource
  clamped?: boolean
}

function isSetting(value: unknown): value is EffortSetting {
  return value === 'auto' || isEffortLevel(value)
}

/** The effort a stored reply's turn metadata records, when it has a well-formed one. */
export function turnEffortOf(turnMeta: unknown): TurnEffortView | null {
  const effort = (turnMeta as { effort?: unknown } | null | undefined)?.effort
  if (!effort || typeof effort !== 'object') return null
  const e = effort as Record<string, unknown>
  if (!isSetting(e.requested) || !isSetting(e.effective)) return null
  return {
    requested: e.requested,
    effective: e.effective,
    ...(typeof e.source === 'string' && (EFFORT_SOURCES as readonly string[]).includes(e.source) ? { source: e.source as EffortSource } : {}),
    ...(typeof e.clamped === 'boolean' ? { clamped: e.clamped } : {}),
  }
}

/**
 * The chip under a reply: the effort it ran with ("Effort: High"), or the
 * adjustment ("Effort: Extra high → High"); the tooltip names who set it.
 * Nothing when the turn asked for nothing and nothing was sent.
 */
export function turnEffortCaption(effort: TurnEffortView | null | undefined): { text: string; title: string } | null {
  if (!effort) return null
  if (effort.requested === 'auto' && effort.effective === 'auto') return null
  const clamped = effort.clamped ?? effort.requested !== effort.effective
  const text = clamped && effort.requested !== 'auto'
    ? t('common.effort.turnClamped', { requested: effortLevelLabel(effort.requested), effective: effortLevelLabel(effort.effective) })
    : t('common.effort.turnChip', { level: effortLevelLabel(effort.effective) })
  const lines = [text]
  if (effort.source) lines.push(t('common.effort.turnSource', { source: effortSourceLabel(effort.source) }))
  return { text, title: lines.join('\n') }
}
