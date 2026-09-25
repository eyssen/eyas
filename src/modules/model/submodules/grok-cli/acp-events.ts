// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Zod parsers for what an ACP CLI (Grok, Kimi) sends: `session/update`
// notifications, the session/new response and session config options.
// The CLI is an untrusted process: everything is validated here before
// anything acts on it — the session-start tripwire reads tool_call events,
// the stream mapping turns them into StreamEvents, and the runner and the
// model probe read the model and effort options. Unknown update kinds pass
// through as { kind: 'other' } so a newer CLI never breaks a turn, and a
// malformed update is reported, never thrown.

import { z } from 'zod'

/** ACP tool call status. */
export const AcpToolStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed'])
export type AcpToolStatus = z.infer<typeof AcpToolStatusSchema>

/** One content block of a message/thought chunk; only text is read, other types are kept opaque. */
const ChunkContentSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
}).passthrough()

/** A tool call content item (content / diff / terminal …), kept opaque but typed by `type`. */
const ToolContentSchema = z.array(z.object({ type: z.string() }).passthrough())

const LocationSchema = z.object({
  path: z.string(),
  line: z.number().int().nonnegative().nullable().optional(),
}).passthrough()

const PlanEntrySchema = z.object({
  content: z.string(),
  status: z.string().optional(),
  priority: z.string().optional(),
}).passthrough()

const ToolCallId = z.string().min(1).max(512)

// ─── Session config options ────────────────────
//
// ACP `configOptions` (standard, not an x.ai extension): what a session can
// be switched to with session/set_config_option — the model, and on Grok the
// reasoning effort (id 'reasoning_effort', category 'thought_level'). They
// arrive in three places, all read by the one parser below: the session/new
// response, the set_config_option response (the complete updated list) and
// the config_option_update session/update (grok 1.0.41 fixture
// acp-config-options.json).

/** An option id, a category or a value: short, printable, never a flag. */
const ConfigToken = z.string().min(1).max(200)

const ConfigValueSchema = z.object({
  value: ConfigToken,
  name: z.string().max(300).nullable().optional(),
}).passthrough()

/** ACP select options: a flat list, or groups of lists. */
const ConfigGroupSchema = z.object({
  group: z.string().max(200).optional(),
  name: z.string().max(300).nullable().optional(),
  options: z.array(ConfigValueSchema).max(500),
}).passthrough()

const ConfigOptionSchema = z.object({
  id: ConfigToken,
  name: z.string().max(300).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  type: z.string().max(64).optional(),
  currentValue: ConfigToken,
  options: z.array(z.union([ConfigValueSchema, ConfigGroupSchema])).max(500).optional(),
}).passthrough()

/** One session config option, normalized: every selectable value in one flat list. */
export interface AcpConfigOption {
  id: string
  name?: string
  category?: string
  currentValue: string
  /** The values the option can be set to, in the CLI's order, groups flattened. */
  values: string[]
}

/** How many options one list may carry; a longer list is cut, never trusted whole. */
const MAX_CONFIG_OPTIONS = 64

/**
 * Parse an ACP configOptions list. Tolerant per option: an invalid entry is
 * dropped and the rest kept, so a newer CLI's extra option never hides the
 * model or effort option. Not an array → null (nothing reported).
 */
export function parseAcpConfigOptions(raw: unknown): AcpConfigOption[] | null {
  if (!Array.isArray(raw)) return null
  const out: AcpConfigOption[] = []
  for (const item of raw.slice(0, MAX_CONFIG_OPTIONS)) {
    const parsed = ConfigOptionSchema.safeParse(item)
    if (!parsed.success) continue
    const values: string[] = []
    for (const entry of parsed.data.options ?? []) {
      const list: Array<z.infer<typeof ConfigValueSchema>> = typeof (entry as { value?: unknown }).value === 'string'
        ? [entry as z.infer<typeof ConfigValueSchema>]
        : (entry as z.infer<typeof ConfigGroupSchema>).options
      for (const v of list) if (!values.includes(v.value)) values.push(v.value)
    }
    out.push({
      id: parsed.data.id,
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.category ? { category: parsed.data.category } : {}),
      currentValue: parsed.data.currentValue,
      values,
    })
  }
  return out
}

/** The option with this id, else the first one of this category. */
export function findAcpConfigOption(
  options: readonly AcpConfigOption[] | null | undefined,
  key: { id: string; category?: string },
): AcpConfigOption | undefined {
  if (!options) return undefined
  return options.find((o) => o.id === key.id) ?? (key.category ? options.find((o) => o.category === key.category) : undefined)
}

/** Every option's current value, by id: what the session runs with. */
export function acpConfigValues(options: readonly AcpConfigOption[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.id, o.currentValue]))
}

// ─── Session models (session/new) ──────────────

/** Grok's per-model hints in availableModels[]._meta (x.ai extension; read tolerantly). */
const ModelMetaSchema = z.object({
  totalContextTokens: z.number().int().positive().max(100_000_000).optional().catch(undefined),
  supportsReasoningEffort: z.boolean().optional().catch(undefined),
  reasoningEffort: ConfigToken.nullable().optional().catch(undefined),
  reasoningEfforts: z.array(z.object({
    value: ConfigToken,
    default: z.boolean().nullable().optional(),
  }).passthrough()).max(64).optional().catch(undefined),
}).passthrough()

const SessionModelSchema = z.object({
  modelId: ConfigToken,
  name: z.string().max(300).nullable().optional(),
  _meta: z.unknown().optional(),
}).passthrough()

/** One model the session can run, as session/new's `models` state lists it. */
export interface AcpSessionModel {
  modelId: string
  name?: string
  /** The model's context window as the CLI reports it (Grok _meta). */
  contextTokens?: number
  /** The model's default reasoning effort as the CLI reports it (Grok _meta). */
  defaultEffort?: string
  /** The reasoning efforts the CLI lists for the model (Grok _meta); absent: not reported. */
  efforts?: string[]
}

export interface AcpSessionModels {
  currentModelId?: string
  availableModels: AcpSessionModel[]
}

/** Parse session/new's `models` state (ACP, unstable). Tolerant per model; not an object → null. */
export function parseAcpSessionModels(raw: unknown): AcpSessionModels | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const state = raw as { currentModelId?: unknown; availableModels?: unknown }
  const models: AcpSessionModel[] = []
  for (const item of Array.isArray(state.availableModels) ? state.availableModels.slice(0, 500) : []) {
    const parsed = SessionModelSchema.safeParse(item)
    if (!parsed.success) continue
    const meta = ModelMetaSchema.safeParse(parsed.data._meta ?? {})
    const hints = meta.success ? meta.data : {}
    const listed = hints.reasoningEfforts?.map((e) => e.value)
    const flagged = hints.reasoningEfforts?.find((e) => e.default === true)?.value
    const defaultEffort = flagged ?? hints.reasoningEffort ?? undefined
    models.push({
      modelId: parsed.data.modelId,
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(hints.totalContextTokens ? { contextTokens: hints.totalContextTokens } : {}),
      ...(defaultEffort ? { defaultEffort } : {}),
      ...(listed && hints.supportsReasoningEffort !== false ? { efforts: listed } : {}),
      ...(hints.supportsReasoningEffort === false ? { efforts: [] } : {}),
    })
  }
  const current = typeof state.currentModelId === 'string' && ConfigToken.safeParse(state.currentModelId).success
    ? state.currentModelId
    : undefined
  return { ...(current ? { currentModelId: current } : {}), availableModels: models }
}

// ─── session/new ───────────────────────────────

/** A session/new response, read once: every part tolerant, so one bad part never hides another. */
export interface AcpSessionNew {
  sessionId?: string
  /** modes.currentModeId, when the CLI reports a permission mode (grok 1.0.40 reports none). */
  modeId?: string
  /** The session's config options (empty when the CLI reports none). */
  configOptions: AcpConfigOption[]
  models: AcpSessionModels | null
}

const SessionNewEnvelope = z.object({
  sessionId: z.string().min(1).max(512).optional().catch(undefined),
  // Never length-capped: a long mode name must still reach the isolation check.
  modes: z.object({ currentModeId: z.string().optional() }).passthrough().nullable().optional().catch(undefined),
  configOptions: z.unknown().optional(),
  models: z.unknown().optional(),
}).passthrough()

/** THE parser of a session/new response (the runner, the model probe and the isolation check read it). Never throws. */
export function parseAcpSessionNew(raw: unknown): AcpSessionNew {
  const parsed = SessionNewEnvelope.safeParse(raw)
  if (!parsed.success) return { configOptions: [], models: null }
  const { sessionId, modes, configOptions, models } = parsed.data
  const modeId = modes?.currentModeId
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(modeId ? { modeId } : {}),
    configOptions: parseAcpConfigOptions(configOptions) ?? [],
    models: parseAcpSessionModels(models),
  }
}

const UpdateSchemas = {
  agent_message_chunk: z.object({ content: ChunkContentSchema }),
  agent_thought_chunk: z.object({ content: ChunkContentSchema }),
  plan: z.object({ entries: z.array(PlanEntrySchema) }),
  tool_call: z.object({
    toolCallId: ToolCallId,
    title: z.string().optional(),
    kind: z.string().optional(),
    status: AcpToolStatusSchema.optional(),
    rawInput: z.unknown().optional(),
    content: ToolContentSchema.optional(),
    locations: z.array(LocationSchema).optional(),
  }),
  tool_call_update: z.object({
    toolCallId: ToolCallId,
    status: AcpToolStatusSchema.nullable().optional(),
    title: z.string().nullable().optional(),
    kind: z.string().nullable().optional(),
    rawInput: z.unknown().optional(),
    rawOutput: z.unknown().optional(),
    content: ToolContentSchema.nullable().optional(),
    // grok 1.0.40 sends the kind and the locations only here, in the first
    // update after the tool_call (A1 fs-call-trace fixture).
    locations: z.array(LocationSchema).nullable().optional(),
  }),
} as const

export type AcpPlanEntry = z.infer<typeof PlanEntrySchema>
export type AcpToolContent = z.infer<typeof ToolContentSchema>
export type AcpLocation = z.infer<typeof LocationSchema>

/** A validated session/update, normalized. `toolKind` is the ACP ToolKind (read, edit, execute, …). */
export type AcpSessionEvent =
  | { kind: 'agent_message_chunk'; text: string }
  | { kind: 'agent_thought_chunk'; text: string }
  | { kind: 'plan'; entries: AcpPlanEntry[] }
  | {
      kind: 'tool_call'
      toolCallId: string
      title?: string
      toolKind?: string
      status?: AcpToolStatus
      rawInput?: unknown
      content?: AcpToolContent
      locations?: AcpLocation[]
    }
  | {
      kind: 'tool_call_update'
      toolCallId: string
      status?: AcpToolStatus
      title?: string
      toolKind?: string
      rawInput?: unknown
      rawOutput?: unknown
      content?: AcpToolContent
      locations?: AcpLocation[]
    }
  /** The session's config options changed (the complete list, as set_config_option returns it). */
  | { kind: 'config_option_update'; configOptions: AcpConfigOption[] }
  | { kind: 'other'; sessionUpdate: string }

export type AcpParseResult =
  | { ok: true; sessionId?: string; event: AcpSessionEvent }
  | { ok: false; error: string }

const ParamsSchema = z.object({
  sessionId: z.string().min(1).max(512).optional(),
  update: z.object({ sessionUpdate: z.string().min(1).max(128) }).passthrough(),
}).passthrough()

function issueText(error: z.ZodError): string {
  return error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

/** Drop keys whose value is undefined or null, so optional fields stay absent. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)) as T
}

/** Parse the params of one `session/update` notification. Never throws. */
export function parseAcpSessionUpdate(params: unknown): AcpParseResult {
  try {
    const envelope = ParamsSchema.safeParse(params)
    if (!envelope.success) return { ok: false, error: issueText(envelope.error) }
    const { sessionId, update } = envelope.data
    const session = sessionId ? { sessionId } : {}
    const kind = update.sessionUpdate

    switch (kind) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const parsed = UpdateSchemas[kind].safeParse(update)
        if (!parsed.success) return { ok: false, error: issueText(parsed.error) }
        const content = parsed.data.content
        return { ok: true, ...session, event: { kind, text: content.type === 'text' ? content.text ?? '' : '' } }
      }
      case 'plan': {
        const parsed = UpdateSchemas.plan.safeParse(update)
        if (!parsed.success) return { ok: false, error: issueText(parsed.error) }
        return { ok: true, ...session, event: { kind, entries: parsed.data.entries } }
      }
      case 'tool_call': {
        const parsed = UpdateSchemas.tool_call.safeParse(update)
        if (!parsed.success) return { ok: false, error: issueText(parsed.error) }
        const { kind: toolKind, ...rest } = parsed.data
        return { ok: true, ...session, event: compact({ kind, ...rest, toolKind }) as AcpSessionEvent }
      }
      case 'tool_call_update': {
        const parsed = UpdateSchemas.tool_call_update.safeParse(update)
        if (!parsed.success) return { ok: false, error: issueText(parsed.error) }
        const { kind: toolKind, ...rest } = parsed.data
        return { ok: true, ...session, event: compact({ kind, ...rest, toolKind }) as AcpSessionEvent }
      }
      case 'config_option_update': {
        const configOptions = parseAcpConfigOptions((update as { configOptions?: unknown }).configOptions)
        if (!configOptions) return { ok: false, error: 'configOptions: expected an array' }
        return { ok: true, ...session, event: { kind, configOptions } }
      }
      default:
        return { ok: true, ...session, event: { kind: 'other', sessionUpdate: kind } }
    }
  } catch (err) {
    // Zod does not throw from safeParse; this guards exotic inputs (e.g. a
    // throwing getter) so a hostile CLI can never crash the turn from here.
    return { ok: false, error: err instanceof Error ? err.message : 'unparseable session/update' }
  }
}
