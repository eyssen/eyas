// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The reasoning capability registry: ONE place that answers "what does this
// model accept on the effort ladder?". It merges two sources:
//   - discovery (model_config.metadata.reasoning, written by provider
//     discovery) — the truth for `levels`, because the runtime decides what it
//     accepts (D5);
//   - the versioned static overlay (overlay.json) — the facts discovery never
//     exposes: vendor default, always-on/can-disable, budget range, sampling
//     lock, thinking display.
// A model with neither resolves to UNKNOWN_CAPABILITY, and effort for it
// resolves to Auto: EYAS never sends a guessed reasoning parameter.
//
// Overlay rows match a model id exactly (their anchored regex). A fetched id
// no row matches may still inherit its family's row by ONE documented prefix
// rule (releaseStems below): the id is the family id followed only by
// release stamps — a date snapshot (-2026-03-17, -20260801, -0709), a
// '-latest' alias or a context-size marker ([1m]). Those name a snapshot or
// alias of the SAME model, so the family's facts hold for it. Nothing else is
// stripped: a variant segment (-mini, -pro, -codex, -chat, -preview, -fast,
// …) often names a different model with a different ladder, so such an id
// stays unknown until a row names it. An id whose stem matches no row is an
// unknown family and stays Auto-only. Inheritance never crosses providers:
// a row still applies only to the providers it lists.

import type { Logger } from 'pino'
import bundledOverlay from './overlay.json'
import { UNKNOWN_CAPABILITY, type ReasoningCapability, type ReasoningKind, type ThinkingParam } from './capability.js'
import { sortEffortLevels, type EffortLevel } from './ladder.js'
import {
  DiscoveredReasoningSchema,
  OverlayFileSchema,
  type DiscoveredReasoning,
  type OverlayFile,
  type OverlayRow,
} from './schemas.js'

type RegistryLogger = Pick<Logger, 'info' | 'warn'>

export interface ReasoningRegistryOptions {
  /** A parsed overlay; defaults to the bundled overlay.json. */
  overlay?: OverlayFile
  /**
   * Discovered reasoning for one model row (model_config.metadata.reasoning),
   * or null when nothing was discovered. The value is validated here, so a
   * corrupt row degrades to the overlay instead of failing the lookup.
   */
  getDiscovered: (providerId: string, modelId: string) => unknown
  /**
   * The concrete upstream model behind an EYAS model id (model_config
   * metadata.realModelId), consulted when a caller passes none — so every
   * consumer that only knows the pair (gateway, write-time validation, the
   * UI) matches the same overlay row.
   */
  getRealModelId?: (providerId: string, modelId: string) => string | null | undefined
  logger?: RegistryLogger
}

export interface ReasoningRegistry {
  /**
   * The effective capability of one model. `realModelId` is the concrete
   * upstream model behind an EYAS alias (e.g. claude-code-opus → claude-opus-4-8);
   * overlay rows match it first, then the EYAS model id. Omitted: the
   * registry's own getRealModelId lookup supplies it.
   */
  get(providerId: string, modelId: string, realModelId?: string): ReasoningCapability
  /** Drop memoized records (one provider's, or all) after discovery or a models refresh. */
  invalidate(providerId?: string): void
  readonly overlayVersion: number
}

/** Parse the bundled overlay. Throws on an invalid file — the overlay tests keep it valid. */
export function loadBundledOverlay(): OverlayFile {
  return OverlayFileSchema.parse(bundledOverlay)
}

interface CompiledRow {
  row: OverlayRow
  pattern: RegExp
}

/**
 * One trailing release stamp: a date snapshot (-YYYY-MM-DD, -YYYYMMDD, or a
 * -MMDD with a real month and day), the '-latest' alias, or a context-size
 * marker such as '[1m]'. Deliberately narrow — see the header.
 */
const RELEASE_STAMP = /(?:-20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])|-20\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|-(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|-latest|\[\d+[km]\])$/i

/**
 * The family stems of a model id under the prefix rule, longest first: the
 * id with one trailing release stamp removed, then two, and so on. Empty
 * when the id ends in no release stamp (an exact row or nothing).
 */
export function releaseStems(modelId: string): string[] {
  const stems: string[] = []
  let current = modelId
  for (;;) {
    const stamp = RELEASE_STAMP.exec(current)
    if (!stamp || stamp.index === 0) break
    current = current.slice(0, stamp.index)
    stems.push(current)
  }
  return stems
}

const KIND_FROM_PARAM: Record<DiscoveredReasoning['param'], ReasoningKind> = {
  effort: 'effort',
  budget: 'budget',
  toggle: 'toggle',
  none: 'none',
}

function fromOverlay(row: OverlayRow): ReasoningCapability {
  return {
    ...row.capability,
    levels: [...row.capability.levels],
    source: 'overlay',
    overlayRowId: row.id,
    verified: row.verified,
  }
}

/**
 * A model only discovery knows about. Facts discovery never exposes stay at
 * their safe values (thinking 'n/a', sampling unlocked, reasoning hidden). A
 * budget model is not drivable without the overlay's budget range, so it
 * resolves to 'none' (no control) rather than a guessed budget.
 */
function fromDiscovery(d: DiscoveredReasoning): ReasoningCapability {
  const discoveredKind = KIND_FROM_PARAM[d.param]
  let levels: EffortLevel[] = discoveredKind === 'none' || discoveredKind === 'budget' ? [] : sortEffortLevels(d.levels)
  if (discoveredKind === 'toggle') levels = levels.filter((l) => l === 'none' || l === 'high')
  const kind: ReasoningKind = levels.length === 0 ? 'none' : discoveredKind
  const thinkingParam: ThinkingParam = kind === 'effort' && d.adaptiveThinking ? 'adaptive' : 'none'
  return {
    kind,
    levels,
    defaultLevel: d.defaultLevel && levels.includes(d.defaultLevel) ? d.defaultLevel : null,
    canDisable: levels.includes('none'),
    thinking: 'n/a',
    thinkingParam,
    samplingLocked: false,
    reasoningVisible: 'hidden',
    displayParam: false,
    source: 'discovered',
    ...(d.runtime ? { runtime: d.runtime } : {}),
  }
}

/**
 * Discovered levels over the overlay row. Discovery decides which rungs the
 * runtime accepts; whether reasoning can be switched off ('none') is an
 * overlay fact, except for a discovered toggle, where the runtime's own
 * off-variant is the truth. A clampPolicy 'server' row is the exception: its
 * endpoint's discovered ladder is generic, so the row's levels win.
 */
function merge(row: OverlayRow, d: DiscoveredReasoning): ReasoningCapability {
  const base = fromOverlay(row)
  const runtime = d.runtime ? { runtime: d.runtime } : {}
  const onLevels = d.param === 'none' ? [] : sortEffortLevels(d.levels).filter((l) => l !== 'none')
  if (onLevels.length === 0) {
    // The runtime reports no reasoning control for this model: nothing to send.
    const { clampMap: _noLevelsToClamp, ...rest } = base
    return { ...rest, kind: 'none', levels: [], defaultLevel: null, canDisable: false, source: 'merged', ...runtime }
  }
  // The endpoint clamps server-side to the upstream model, and its discovered
  // ladder is generic: the row's upstream-family ladder is the truth.
  if (row.clampPolicy === 'server') return { ...base, source: 'merged', ...runtime }
  // The row says the wire EYAS uses has no reasoning parameter for this model
  // (e.g. LM Studio's chat endpoint): nothing discovered can make one appear.
  if (base.kind === 'none') return { ...base, source: 'merged', ...runtime }

  const disable = d.param === 'toggle' ? d.levels.includes('none') : base.canDisable
  let levels: EffortLevel[] = disable ? ['none', ...onLevels] : onLevels
  if (base.kind === 'toggle') levels = levels.filter((l) => l === 'none' || l === 'high')

  const wanted = d.defaultLevel !== undefined ? d.defaultLevel : base.defaultLevel
  const defaultLevel = wanted !== null && levels.includes(wanted)
    ? wanted
    : base.defaultLevel !== null && levels.includes(base.defaultLevel) ? base.defaultLevel : null

  let thinkingParam = base.thinkingParam
  if (d.adaptiveThinking === true && base.thinkingParam === 'none') thinkingParam = 'adaptive'
  // The runtime says adaptive thinking is unavailable: the only other Claude
  // thinking mode is a budget, which needs the overlay's budget range.
  if (d.adaptiveThinking === false && base.thinkingParam === 'adaptive') thinkingParam = base.budget ? 'budget' : 'none'

  const clampEntries = Object.entries(base.clampMap ?? {})
    .filter(([from, to]) => to && levels.includes(to) && !levels.includes(from as EffortLevel))
  const merged: ReasoningCapability = {
    ...base,
    levels,
    defaultLevel,
    canDisable: levels.includes('none'),
    thinkingParam,
    source: 'merged',
    ...runtime,
  }
  if (clampEntries.length > 0) merged.clampMap = Object.fromEntries(clampEntries)
  else delete merged.clampMap
  return merged
}

/**
 * A runtime that cannot be asked for a thinking display (discovered
 * thinkingDisplay false, e.g. a Claude Code older than the display flag)
 * leaves a model that hides its thinking unless asked with hidden reasoning
 * there: no display is planned, and the effort UI says the text stays hidden.
 */
function applyRuntimeDisplay(capability: ReasoningCapability, d: DiscoveredReasoning): ReasoningCapability {
  if (d.thinkingDisplay !== false || !capability.displayParam) return capability
  return { ...capability, displayParam: false, reasoningVisible: 'hidden' }
}

export function createReasoningRegistry(options: ReasoningRegistryOptions): ReasoningRegistry {
  const overlay = options.overlay ?? loadBundledOverlay()
  const logger = options.logger
  const rows: CompiledRow[] = overlay.rows.map((row) => ({ row, pattern: new RegExp(row.match.model, 'i') }))
  const memo = new Map<string, ReasoningCapability>()

  logger?.info({ overlayVersion: overlay.version, overlayUpdated: overlay.updated, rows: rows.length }, 'reasoning: capability overlay loaded')

  function matchRow(providerId: string, candidates: string[]): OverlayRow | null {
    for (const id of candidates) {
      for (const { row, pattern } of rows) {
        if (row.match.providers && !row.match.providers.includes(providerId)) continue
        if (pattern.test(id)) return row
      }
    }
    return null
  }

  function readDiscovered(providerId: string, modelId: string): DiscoveredReasoning | null {
    let raw: unknown
    try {
      raw = options.getDiscovered(providerId, modelId)
    } catch (err) {
      logger?.warn({ err, providerId, modelId }, 'reasoning: discovered capability lookup failed; using the overlay')
      return null
    }
    if (raw === null || raw === undefined) return null
    const parsed = DiscoveredReasoningSchema.safeParse(raw)
    if (!parsed.success) {
      logger?.warn({ providerId, modelId, issues: parsed.error.issues.slice(0, 5) }, 'reasoning: ignoring invalid discovered capability')
      return null
    }
    return parsed.data
  }

  function lookupRealModelId(providerId: string, modelId: string): string | undefined {
    if (!options.getRealModelId) return undefined
    try {
      const id = options.getRealModelId(providerId, modelId)
      return typeof id === 'string' && id.length > 0 ? id : undefined
    } catch (err) {
      logger?.warn({ err, providerId, modelId }, 'reasoning: concrete model lookup failed; matching on the EYAS model id')
      return undefined
    }
  }

  function resolve(providerId: string, modelId: string, realModelId?: string): ReasoningCapability {
    const candidates = [realModelId, modelId].filter((v, i, all): v is string => !!v && all.indexOf(v) === i)
    // An exact row first (every candidate), then the family row by the prefix rule.
    const row = matchRow(providerId, candidates) ?? matchRow(providerId, candidates.flatMap(releaseStems))
    const discovered = readDiscovered(providerId, modelId)
    if (row && discovered) return applyRuntimeDisplay(merge(row, discovered), discovered)
    if (row) return fromOverlay(row)
    if (discovered) return fromDiscovery(discovered)
    return { ...UNKNOWN_CAPABILITY, levels: [] }
  }

  return {
    overlayVersion: overlay.version,

    get(providerId, modelId, realModelId) {
      const concrete = realModelId ?? lookupRealModelId(providerId, modelId)
      const key = `${providerId}\u0000${modelId}\u0000${concrete ?? ''}`
      const hit = memo.get(key)
      if (hit) return hit
      const capability = resolve(providerId, modelId, concrete)
      memo.set(key, capability)
      return capability
    },

    invalidate(providerId) {
      if (providerId === undefined) {
        memo.clear()
        return
      }
      const prefix = `${providerId}\u0000`
      for (const key of [...memo.keys()]) if (key.startsWith(prefix)) memo.delete(key)
    },
  }
}
