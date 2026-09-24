// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Zod schemas for everything reasoning-effort that crosses a trust boundary:
// stored/submitted effort settings, the ONE discovered-reasoning shape that
// every provider discovery emits and model_config.metadata.reasoning stores,
// the capability record, and the versioned static overlay file.
//
// Relative imports only: the web reaches this file through the @shared alias.

import { z } from 'zod'
import { EFFORT_LADDER, EFFORT_SOURCES, ladderIndex, type EffortSource } from './ladder.js'

// ─── Effort values ─────────────────────────────

export const EffortLevelSchema = z.enum(EFFORT_LADDER)

/** A stored or submitted effort: a ladder rung or 'auto'. Nothing else. */
export const EffortSettingSchema = z.enum(['auto', ...EFFORT_LADDER] as const)

export const EffortSourceSchema = z.enum(EFFORT_SOURCES as [EffortSource, ...EffortSource[]])

export const EffortIntentSchema = z.object({
  level: EffortSettingSchema,
  source: EffortSourceSchema,
}).strict()

// ─── Dates ─────────────────────────────────────

const IsoDateTimeSchema = z.string().datetime({ offset: true })

/** A calendar date, YYYY-MM-DD, that actually exists. */
const IsoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  }, 'not a real calendar date')

// ─── Discovery ─────────────────────────────────

/**
 * THE single shape of runtime-discovered reasoning facts. Every provider
 * discovery (Claude Code supportedModels, Anthropic Models API, Grok/Kimi ACP,
 * CLI model caches, catalog APIs) emits exactly this, and
 * model_config.metadata.reasoning stores exactly this. Discovery is the truth
 * for `levels` (the runtime binary decides what it accepts); the overlay
 * supplies what discovery never exposes.
 *
 * Unknown keys are stripped rather than rejected, so a row written by a newer
 * EYAS still reads.
 */
export const DiscoveredReasoningSchema = z.object({
  source: z.enum(['sdk', 'models-api', 'acp', 'cli-cache', 'catalog-api']),
  param: z.enum(['effort', 'budget', 'toggle', 'none']),
  levels: z.array(EffortLevelSchema).max(32),
  defaultLevel: EffortLevelSchema.nullable().optional(),
  adaptiveThinking: z.boolean().optional(),
  /**
   * Whether the runtime can be asked to stream the model's thinking (Claude
   * Code's --thinking-display). false: it cannot, so a model that hides its
   * thinking unless asked (overlay displayParam) stays hidden there. Absent:
   * the runtime was not asked, and the overlay stands.
   */
  thinkingDisplay: z.boolean().optional(),
  runtime: z.string().min(1).max(64).optional(),
  discoveredAt: IsoDateTimeSchema,
})

export type DiscoveredReasoning = z.infer<typeof DiscoveredReasoningSchema>

// ─── Capability ────────────────────────────────

const TokenCountSchema = z.number().int().nonnegative()

const ReasoningBudgetSchema = z.object({
  min: TokenCountSchema,
  max: z.number().int().positive().optional(),
  perLevel: z.record(EffortLevelSchema, TokenCountSchema).optional(),
}).strict()

/** The static part of a capability — what an overlay row declares. */
const CapabilityCoreShape = {
  kind: z.enum(['effort', 'budget', 'toggle', 'none', 'unknown']),
  levels: z.array(EffortLevelSchema).max(EFFORT_LADDER.length),
  defaultLevel: EffortLevelSchema.nullable(),
  canDisable: z.boolean(),
  thinking: z.enum(['always-on', 'default-on', 'default-off', 'n/a']),
  thinkingParam: z.enum(['adaptive', 'budget', 'none']),
  budget: ReasoningBudgetSchema.optional(),
  clampMap: z.record(EffortLevelSchema, EffortLevelSchema).optional(),
  samplingLocked: z.boolean(),
  reasoningVisible: z.enum(['summary', 'hidden']),
  displayParam: z.boolean(),
}

type CapabilityCore = z.infer<z.ZodObject<typeof CapabilityCoreShape>>

/** Invariants every capability record must hold, overlay or merged. */
function checkCapability(cap: CapabilityCore, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })

  for (let i = 1; i < cap.levels.length; i++) {
    if (ladderIndex(cap.levels[i]) <= ladderIndex(cap.levels[i - 1])) {
      issue(['levels'], 'levels must be unique and ascending on the ladder')
      break
    }
  }
  if (cap.defaultLevel !== null && !cap.levels.includes(cap.defaultLevel)) {
    issue(['defaultLevel'], 'defaultLevel must be one of levels')
  }
  if (cap.canDisable !== cap.levels.includes('none')) {
    issue(['canDisable'], "canDisable must be true exactly when levels include 'none'")
  }
  if ((cap.kind === 'none' || cap.kind === 'unknown') && cap.levels.length > 0) {
    issue(['levels'], `a '${cap.kind}' capability has no levels`)
  }
  if (cap.kind === 'toggle' && cap.levels.some((l) => l !== 'none' && l !== 'high')) {
    issue(['levels'], "a toggle uses only 'none' (off) and 'high' (on)")
  }
  if (cap.kind === 'budget' && cap.thinkingParam !== 'budget') {
    issue(['thinkingParam'], "a 'budget' capability uses the budget thinking parameter")
  }
  if (cap.thinkingParam === 'budget' && !cap.budget) {
    issue(['budget'], 'a budget thinking parameter needs a budget range')
  }
  if (cap.budget && cap.budget.max !== undefined && cap.budget.min >= cap.budget.max) {
    issue(['budget'], 'budget.min must be below budget.max')
  }
  for (const [from, to] of Object.entries(cap.clampMap ?? {})) {
    if (to && !cap.levels.includes(to)) issue(['clampMap', from], 'a clamp target must be a supported level')
    if (cap.levels.includes(from as never)) issue(['clampMap', from], 'only unsupported levels can be clamped')
  }
}

/** What an overlay row declares: the capability without its derived provenance fields. */
export const OverlayCapabilitySchema = z.object(CapabilityCoreShape).strict().superRefine(checkCapability)

/** A complete, effective capability record (registry output / API output). */
export const ReasoningCapabilitySchema = z.object({
  ...CapabilityCoreShape,
  source: z.enum(['discovered', 'overlay', 'merged', 'unknown']),
  overlayRowId: z.string().min(1).optional(),
  verified: IsoDateSchema.optional(),
  runtime: z.string().min(1).max(64).optional(),
}).strict().superRefine(checkCapability)

// ─── Overlay file ──────────────────────────────

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i')
    return true
  } catch {
    return false
  }
}

export const OverlayRowSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/, 'lowercase id').max(64),
  match: z.object({
    /** Provider ids the row applies to; absent = every provider. */
    providers: z.array(z.string().min(1)).min(1).optional(),
    /** Case-insensitive regex tested against the real model id (then the EYAS model id). */
    model: z.string().min(1).max(300).refine(compiles, 'model must be a valid regular expression'),
  }).strict(),
  capability: OverlayCapabilitySchema,
  /**
   * 'server': the provider's endpoint accepts its whole generic ladder for
   * every reasoning-capable model and clamps to the upstream model itself
   * (OpenRouter's unified reasoning.effort). Its discovery therefore proves
   * only that a control exists, and this row's levels — the upstream
   * family's own — win over the discovered generic ladder, so the effort
   * select and the requested-vs-effective outcome show what the upstream
   * model really runs at. Absent: discovery is the truth for the levels.
   */
  clampPolicy: z.literal('server').optional(),
  /** Where the facts come from (documentation URL or SDK file reference). */
  source: z.string().min(1).max(600),
  verified: IsoDateSchema,
  evidence: z.enum(['verified-docs', 'verified-sdk']),
}).strict()

export const OverlayFileSchema = z.object({
  version: z.number().int().positive(),
  updated: IsoDateSchema,
  rows: z.array(OverlayRowSchema).min(1),
}).strict().superRefine((file, ctx) => {
  const seen = new Set<string>()
  file.rows.forEach((row, i) => {
    if (seen.has(row.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rows', i, 'id'], message: `duplicate row id ${row.id}` })
    seen.add(row.id)
  })
})

export type OverlayRow = z.infer<typeof OverlayRowSchema>
export type OverlayFile = z.infer<typeof OverlayFileSchema>
