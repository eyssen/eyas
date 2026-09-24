// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The provider-neutral chat stream contract (G1): the vocabulary shared by
// the model layer, the chat route's SSE frames and the web UI, so every
// provider — API, Claude Code, Grok/Kimi over ACP — looks the same on screen.
//
//   - stop reasons, tool outcomes and turn outcomes
//   - canonical usage and where its cost came from
//   - generic notices (one mechanism instead of per-feature frames)
//   - the per-turn metadata persisted with an assistant message (TurnMeta)
//   - the SSE frame union the chat route sends and the web consumes
//
// Owners extend these in place (NoticeCodeSchema, TurnMetaSchema) instead of
// adding parallel frames. Relative imports only: the web imports this file.

import { z } from 'zod'
import { isModelErrorKind, type ModelErrorKind } from './classify-model-error.js'
import { EffortSettingSchema, EffortSourceSchema } from '../modules/model/reasoning/schemas.js'

// ─── Stop reasons ──────────────────────────────

/**
 * Why a single model call stopped. 'max_turns' is a CLI's own internal turn
 * budget running out; 'refusal' is a vendor safety stop. Budget stops are
 * outcomes, never errors.
 */
export const STOP_REASONS = ['end', 'tool_use', 'max_tokens', 'stop_sequence', 'max_turns', 'refusal'] as const
export type StopReason = typeof STOP_REASONS[number]
export const StopReasonSchema = z.enum(STOP_REASONS)

// ─── Tools ─────────────────────────────────────

/**
 * How one tool call ended. Only a tool_result settles a tool row, so a row is
 * never shown as succeeded before the tool actually ran.
 */
export const TOOL_OUTCOMES = ['success', 'error', 'denied', 'approval_required', 'skipped'] as const
export type ToolOutcome = typeof TOOL_OUTCOMES[number]
export const ToolOutcomeSchema = z.enum(TOOL_OUTCOMES)

/** Who executed the tool: EYAS's own executor, or the provider's runtime (a CLI-native tool). */
export type ToolExecutor = 'eyas' | 'provider'

// ─── Turn outcome ──────────────────────────────

/** How a whole chat turn ended — exactly one per turn, shown as one localized badge. */
export const TURN_OUTCOMES = ['completed', 'max_turns', 'max_tokens', 'refusal', 'tool_budget', 'cancelled', 'parked', 'failed'] as const
export type TurnOutcome = typeof TURN_OUTCOMES[number]
export const TurnOutcomeSchema = z.enum(TURN_OUTCOMES)

// ─── Usage & cost ──────────────────────────────

const TokenCount = z.number().int().nonnegative()

/**
 * Canonical usage (the wire/persisted form of model/types.ts ModelUsage):
 * inputTokens = UNCACHED prompt tokens; cache reads/writes are counted
 * separately; reasoningTokens is informational and already inside
 * outputTokens; reported:false means the provider gave no usage at all.
 */
export const ModelUsageSchema = z.object({
  inputTokens: TokenCount,
  outputTokens: TokenCount,
  cacheReadTokens: TokenCount.optional(),
  cacheCreationTokens: TokenCount.optional(),
  reasoningTokens: TokenCount.optional(),
  costUsd: z.number().nonnegative().finite().optional(),
  reported: z.boolean().optional(),
  promptTokensLastCall: TokenCount.optional(),
}).strict()

export type ModelUsageWire = z.infer<typeof ModelUsageSchema>

/**
 * Where a turn's cost figure comes from: the provider reported it, EYAS
 * estimated it from the token counts, or it is unknown (no usage reported —
 * shown as "not reported", never as $0).
 */
export const COST_SOURCES = ['provider', 'estimate', 'unknown'] as const
export type CostSource = typeof COST_SOURCES[number]
export const CostSourceSchema = z.enum(COST_SOURCES)

export function costSourceOf(usage: { costUsd?: number; reported?: boolean } | null | undefined): CostSource {
  if (!usage || usage.reported === false) return 'unknown'
  if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) return 'provider'
  return 'estimate'
}

// ─── Notices ───────────────────────────────────

/**
 * Generic, localized, non-fatal notices (conversations.notice.<code>). Owners
 * add their code here rather than inventing a new frame type.
 * cliSandboxUnavailable: a CLI's own tools run without the kernel file
 * sandbox this turn (security.cliSandbox 'auto', none on this host); params
 * provider, reason (cli-runtime/sandbox).
 * folderRefused: a stored folder of the conversation (or its project) was
 * left out of this run because a protection rule now refuses it — it is,
 * sits inside or contains EYAS's own data, another tool's storage or a notes
 * vault; params path, reason (a tools/working-directories FolderErrorCode).
 */
export const NoticeCodeSchema = z.enum(['contextCompacted', 'imagesNotVisible', 'cliSandboxUnavailable', 'folderRefused'])
export type NoticeCode = z.infer<typeof NoticeCodeSchema>

/** Interpolation values for a notice or coded error (the web t() vars shape). */
export type NoticeParams = Record<string, string | number>

const ParamKey = z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/)
export const NoticeParamsSchema = z.record(ParamKey, z.union([z.string().max(500), z.number().finite()]))
  .refine((p) => Object.keys(p).length <= 16, 'at most 16 params')

export const NoticeSchema = z.object({
  code: NoticeCodeSchema,
  params: NoticeParamsSchema.optional(),
}).strict()

export type Notice = z.infer<typeof NoticeSchema>

// ─── Binding & effort ──────────────────────────

/**
 * Which rule picked a turn's provider/model (model/binding.ts):
 * - request: a one-turn override sent with the message;
 * - conversation: the pair the conversation is fixed to;
 * - auto: Auto-routing (triage) chose it;
 * - agent: the colleague's own provider/model;
 * - parent: the pair stored on a sub-conversation (the delegating turn's);
 * - default: the install default (fixed on the conversation's first turn).
 */
export const BINDING_SOURCES = ['request', 'conversation', 'auto', 'agent', 'parent', 'default'] as const
export type BindingSource = typeof BINDING_SOURCES[number]

/**
 * Why a binding is not the one its mode asked for — shown with the turn, so a
 * fallback is never silent.
 */
export const BINDING_NOTES = ['auto-routing-disabled', 'auto-routing-unavailable', 'agent-binding-unavailable', 'stored-binding-unavailable'] as const
export type BindingNote = typeof BINDING_NOTES[number]

/** Which provider/model answered the turn, and which rule picked it. Filled by the binding resolver. */
export const TurnBindingSchema = z.object({
  providerId: z.string().min(1).max(200),
  modelId: z.string().min(1).max(300),
  source: z.enum(BINDING_SOURCES),
  /** The routing tier, only when Auto-routing picked the pair. */
  tier: z.string().min(1).max(64).optional(),
  note: z.enum(BINDING_NOTES).optional(),
}).strict()

export type TurnBinding = z.infer<typeof TurnBindingSchema>

/** The reasoning effort a turn asked for and the one the answering model actually ran with. */
export const TurnEffortSchema = z.object({
  requested: EffortSettingSchema,
  effective: EffortSettingSchema,
  source: EffortSourceSchema.optional(),
  clamped: z.boolean().optional(),
}).strict()

export type TurnEffort = z.infer<typeof TurnEffortSchema>

// ─── Turn metadata ─────────────────────────────

const ErrorKindSchema = z.custom<ModelErrorKind>(isModelErrorKind, { message: 'unknown model error kind' })
const ErrorCodeSchema = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/)
const Count = z.number().int().nonnegative()

/**
 * Per-turn metadata persisted with the assistant message
 * (conversation_messages.turn_meta). Strict: a field nobody declared here is
 * rejected, so unvalidated data is never persisted. Owners extend it in place.
 */
export const TurnMetaSchema = z.object({
  outcome: TurnOutcomeSchema,
  stopReason: StopReasonSchema,
  usage: ModelUsageSchema,
  costSource: CostSourceSchema,
  errorKind: ErrorKindSchema.optional(),
  errorCode: ErrorCodeSchema.optional(),
  steps: Count.optional(),
  toolCalls: Count.optional(),
  approvals: Count.optional(),
  binding: TurnBindingSchema.optional(),
  notices: z.array(NoticeSchema).max(50).optional(),
  effort: TurnEffortSchema.optional(),
}).strict()

export type TurnMeta = z.infer<typeof TurnMetaSchema>

// ─── SSE frames ────────────────────────────────

/** A tool row opened: the model asked for a tool (canonical name; the provider's own in rawName). */
export interface ToolUseFrame {
  type: 'tool_use'
  id: string
  name: string
  rawName?: string
  input?: Record<string, unknown>
}

/** A tool row settled — the ONLY frame that does. */
export interface ToolResultFrame {
  type: 'tool_result'
  toolUseId: string
  output?: string
  error?: string
  durationMs?: number
  outcome: ToolOutcome
  executedBy?: ToolExecutor
}

/** A tool call waits for a human decision (inline approval card). */
export interface ApprovalRequiredFrame {
  type: 'approval_required'
  toolUseId?: string
  toolName: string
  reason: string
  approvalId?: number
  riskTier?: 'green' | 'yellow' | 'red'
}

/**
 * A failed turn. `kind` is the classification (drives the generic localized
 * message and retry affordance), `code`/`params` a specific localized message
 * when EYAS knows one; `detail` is the raw provider text, shown collapsed.
 */
export interface ErrorFrame {
  type: 'error'
  kind: ModelErrorKind
  retryable: boolean
  code?: string
  params?: NoticeParams
  providerId?: string
  detail: string
  /** The partial answer streamed before the failure was persisted. */
  partialSaved: boolean
}

export type ChatStreamFrame =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | ToolUseFrame
  | ToolResultFrame
  | ApprovalRequiredFrame
  | { type: 'progress'; step: number; maxSteps?: number }
  | { type: 'notice'; code: NoticeCode; params?: NoticeParams }
  | { type: 'agent_start'; agentId: string | null; maxTurns: number; binding?: TurnBinding }
  | { type: 'turn_complete'; turn: number; tokensUsed?: number }
  | { type: 'done'; message: unknown; turnMeta: TurnMeta; conversation?: Record<string, unknown> }
  | ErrorFrame
  | { type: 'cancelled'; reason?: string }
  | { type: 'parked_for_approval'; approvalId: number; toolName: string }
  | { type: 'title'; title: string }
  | { type: 'skill_proposal'; proposal: { skillId: string; name: string; score: number; matchedPattern: string } }
  | { type: 'plan_proposal'; plan: Record<string, unknown> }
  | { type: 'god_started' }

export type ChatStreamFrameType = ChatStreamFrame['type']
