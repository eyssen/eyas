import type { RoutingTier } from './routing/types.js'
import type { NoticeCode, NoticeParams, StopReason, ToolExecutor, ToolOutcome } from '@shared/chat-stream.js'
import type { ReasoningCapability } from './reasoning/capability.js'
import type { EffortIntent, EffortLevel } from './reasoning/ladder.js'
import type { EffortOutcome, EffortPlan } from './reasoning/resolve.js'
import type { AuxPurpose, AuxRoute } from './auxiliary.js'
import type { FileSandboxInfo } from './cli-runtime/sandbox/types.js'
import type { ProviderKind } from './provider-display.js'

export type { StopReason } from '@shared/chat-stream.js'
/** The canonical reasoning-effort ladder rung (reasoning/ladder.ts is the single definition). */
export type { EffortLevel }
/** Effort intent (request), plan (gateway → provider) and outcome (response): reasoning/ladder.ts + resolve.ts. */
export type { EffortIntent, EffortPlan, EffortOutcome }

// ─── Content Blocks ────────────────────────────

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    mediaType: string
    data: string
  }
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
  /**
   * Opaque provider replay token that must travel back with this call in the
   * next request of the same tool loop (Gemini's part-level thoughtSignature).
   * Other adapters ignore it.
   */
  signature?: string
}

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
}

/**
 * The wire dialect a ThinkingBlock came from — the only dialect it may be
 * replayed to. 'anthropic' covers the Anthropic API and every
 * Anthropic-compatible endpoint (thinking + signature, redacted_thinking).
 * 'openai-reasoning-content' is the reasoning text an OpenAI-compatible
 * backend returns (reasoning_content / reasoning); only the Kimi dialect sends
 * it back. 'openrouter-reasoning-details' is OpenRouter's reasoning_details
 * list (kept in `raw`), sent back unmodified by the OpenRouter dialect
 * (openai/adapter.ts OpenAIDialect).
 */
export type ThinkingOrigin = 'anthropic' | 'openai-reasoning-content' | 'openrouter-reasoning-details'

/**
 * The model's reasoning from one response, kept so it can travel back
 * unchanged in the next request of the SAME tool loop (the Anthropic API
 * rejects or degrades a tool continuation whose thinking was dropped).
 *
 * Transient: never stored with the conversation, replayed byte-unchanged only
 * to the provider and dialect that produced it (every other adapter skips it),
 * and stripped from a checkpoint-seeded resume (helpers.ts stripThinkingBlocks)
 * because the resumed prefix differs and a replayed block would be rejected.
 */
export interface ThinkingBlock {
  type: 'thinking'
  /** The reasoning text as returned ('' when the backend omits it, and for a redacted block). */
  thinking: string
  /** Opaque continuity token of the block (Anthropic signature), replayed exactly as received. */
  signature?: string
  /** Set for an Anthropic redacted_thinking block: its encrypted payload, replayed as redacted_thinking. */
  redactedData?: string
  origin: ThinkingOrigin
  /** The EYAS provider id that produced the block (AIProvider.id). */
  providerId: string
  /** The EYAS model id the block was produced for. */
  modelId: string
  /** The dialect's own block, for dialects whose replay shape is not modelled above. */
  raw?: unknown
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock

// ─── Messages ──────────────────────────────────

export type ModelRole = 'user' | 'assistant'

export interface ModelMessage {
  role: ModelRole
  content: string | ContentBlock[]
}

// ─── Tools ─────────────────────────────────────

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

// ─── Request / Response ────────────────────────

/**
 * Per-conversation orchestration mode. 'solo' disables provider-native
 * subagent fan-out (claude-code Task/agents); 'deep' encourages aggressive
 * decomposition (fan-out directive + effort default max); 'auto' leaves the
 * model to decide with everything available.
 */
export type OrchestrationMode = 'solo' | 'auto' | 'deep'

/**
 * Construction-site provenance for a model request — the F0 R4 signal that
 * decides interactive vs. autonomous classification (see isAutonomousRequest
 * in permission-bridge.ts). Every call site that builds a ModelRequest /
 * AgentRunOptions should label its origin so an unlabeled run is never
 * silently treated as human-attended.
 */
export type RequestOrigin = 'interactive' | 'scheduled' | 'channel' | 'pipeline' | 'team' | 'delegation'

export interface ModelRequestMetadata {
  conversationId?: string
  userId?: string
  agentId?: string
  teamSessionId?: string
  origin?: RequestOrigin
  /** Explicit autonomy override — see isAutonomousRequest for precedence rules. */
  autonomous?: boolean
  /**
   * Routing tier this call was auto-routed to. Present ONLY on decision-engine
   * routed requests — its presence is what permits the gateway to fail over to
   * the tier's configured fallback provider (D10). A provider the user pinned
   * by hand carries no tier and is never answered by a different provider.
   */
  tier?: RoutingTier
  /** Background call purpose, set by the auxiliary model service (auxiliary.ts). */
  purpose?: AuxPurpose
  /** Which rung of the auxiliary ladder chose the provider. */
  auxRoute?: AuxRoute
  /**
   * F2 T5 — the supervised run (agent_sessions.id) this request belongs to.
   * Providers with an INTERNAL agentic loop stamp it onto the approvals their
   * permission bridge enqueues, which is what makes a CLI-path escalation
   * resumable at all: unpark() takes a run id, and the re-park cap counts
   * approvals by run lineage. Also the attribution key for Task 9's costs.
   */
  runId?: string
  /** Primary coding workspace (conversation working directory). */
  workingDirectory?: string
  /**
   * Every conversation folder, primary first. CLI providers take their cwd
   * from these through cli-runtime resolveCliCwd, which skips a folder that no
   * longer passes validation.
   */
  workingDirectories?: string[]
  /**
   * F2 T5 — per-request approval sink for providers with an INTERNAL agentic
   * loop (Claude Code SDK, Grok ACP). Their permission bridge denies an
   * escalated call in-session; this callback hands the enqueued approval id
   * back to the runner so an autonomous supervised run can park on it after
   * the turn instead of losing the escalation. Not data: never serialize it.
   */
  onEscalatedApproval?: (approvalId: number, toolName?: string) => void
  /**
   * A resumed run's do-not-repeat ledger (toolLedgerKey entries of the
   * destructive calls its predecessors already executed), forwarded by the
   * agent runner. Providers with an internal agentic loop hand it to their
   * permission bridge, which refuses a repeat before the CLI runs it. Not
   * data: never serialize it.
   */
  idempotencyLedger?: ReadonlySet<string>
  /**
   * Task 10 — FK into context_compositions (observability module), the
   * context-inspector record of what actually reached the model on this
   * turn. Undefined when no recorder was wired or recording failed — an
   * observability gap, never a reason to fail the call.
   */
  compositionId?: string
  /**
   * The conversation's project, when it has one. Bound server-side to the
   * CLI-MCP bridge secret of the turn (cli-mcp/bridge-routes.ts), so bridged
   * tools resolve project scope without trusting the CLI. Stamped by the
   * agent runner (I2).
   */
  projectId?: string | null
  /**
   * One id per answer turn (I2: the compositionId when present). Bound to the
   * CLI-MCP bridge secret and carried into every bridged ToolContext.
   */
  turnId?: string
  /**
   * The turn's effective provider+model (model/binding.ts), stamped by the
   * agent runner. A CLI provider runs EYAS tools through its bridge, so the
   * bridge carries it into every bridged ToolContext: a sub-conversation a
   * bridged run_specialist creates stores it, exactly as on the native loop.
   */
  modelBinding?: { providerId: string; modelId: string }
}

export interface ModelRequest {
  provider?: string
  model?: string
  /**
   * The whole conversation, replayed from EYAS's own store on every call.
   * This is the only continuity: no provider keeps or resumes a session of
   * its own, and there is no provider session id on requests or responses.
   */
  messages: ModelMessage[]
  system?: string
  tools?: ToolDefinition[]
  /**
   * Output cap of one model call. A CLI provider (Claude Code, Grok, Kimi)
   * takes no output limit from EYAS, so it enforces this only on an isolated
   * completion: past maxTokens × 4 characters of answer it stops the CLI and
   * answers with stopReason 'max_tokens' (model/cli-output-cap.ts). A CLI turn
   * with tools is a whole loop of model calls and is not capped by it.
   */
  maxTokens?: number
  /** Per-agent agentic turn budget for providers with an internal loop (Claude Code SDK). */
  maxTurns?: number
  /**
   * The resolved context window of the target model (model/model-window.ts),
   * set by the agent runner from the turn's delivery profile. A provider that
   * sizes its own context per request (Ollama num_ctx) caps at it; every
   * other provider ignores it.
   */
  contextWindow?: number
  temperature?: number
  stopSequences?: string[]
  /**
   * The requested reasoning effort and the rung of the precedence chain that
   * supplied it (reasoning/intent.ts pickEffortIntent). Absent: the routing
   * tier's default applies (auto-routed calls), else the model's own default.
   * An intent, never a wire value: the gateway resolves it per attempt,
   * against the model that attempt goes to, into `effortPlan`.
   */
  effort?: EffortIntent
  /**
   * What the provider sends for reasoning (reasoning/resolve.ts). Set by the
   * gateway ONLY, per attempt and after routing, failover and the egress
   * slot; a caller-supplied value is discarded. Providers read it, never
   * `effort`.
   */
  effortPlan?: EffortPlan
  orchestration?: OrchestrationMode
  /**
   * One-shot internal completion: no filesystem settings, no CLI-native
   * memory/config, no bridged tools — for extraction/reflection-class calls
   * whose judgment must not be contaminated by the CLI's own loaded context.
   *
   * Honoured by providers that advertise `supportsIsolatedCompletion`; ignored,
   * harmlessly, by every other provider (an API provider loads no context of
   * its own, so it is already isolated).
   */
  isolated?: boolean
  /** Cancellation signal forwarded to the provider (e.g. Claude Code SDK interrupt). */
  signal?: AbortSignal
  /** Optional metadata for provider-specific features (e.g. MCP bridge context) */
  metadata?: ModelRequestMetadata
}

/**
 * Canonical token + cost usage for one provider call — the same meaning for
 * every provider, so counters and costs are comparable across them (the wire
 * form is ModelUsageSchema in @shared/chat-stream). Providers map onto it; a
 * field a provider cannot supply stays absent rather than being guessed.
 */
export interface ModelUsage {
  /** UNCACHED prompt tokens. Cache reads/writes are never folded in (no double count). */
  inputTokens: number
  /** All generated tokens, reasoning tokens included. */
  outputTokens: number
  /** Prompt tokens served from the provider's cache. */
  cacheReadTokens?: number
  /** Prompt tokens written to the provider's cache. */
  cacheCreationTokens?: number
  /** Informational: the part of outputTokens spent on reasoning. */
  reasoningTokens?: number
  /** Provider-reported authoritative cost (e.g. Claude Code SDK's total_cost_usd). */
  costUsd?: number
  /** false: the provider reported no usage at all (the counts are placeholders, cost is unknown). */
  reported?: boolean
  /**
   * The full prompt size (uncached + cached) of the LAST model call in this
   * response — the context-occupancy numerator. Summed usage over an internal
   * tool loop cannot serve as one.
   */
  promptTokensLastCall?: number
}

/**
 * How the EYAS system prompt reached an ACP CLI's model on one turn
 * (grok-cli/acp-system-prompt.ts):
 * - 'meta-verified': the CLI used EYAS's prompt as its system prompt, proven
 *   from the CLI's own session record after the turn;
 * - 'prompt': it travelled fenced inside the message (always for Kimi; for
 *   Grok while the override is unproven, or after it failed);
 * - 'meta-unverified': sent as the override but not proven this turn (Grok
 *   switches to 'prompt' for later turns when the model answered without it).
 */
export type SystemPromptDelivery = 'meta-verified' | 'meta-unverified' | 'prompt'

export interface ModelResponse {
  id: string
  provider: string
  model: string
  content: ContentBlock[]
  stopReason: StopReason
  usage: ModelUsage
  /**
   * The concrete upstream model that answered, as the backend reported it
   * (the API response's model field, Gemini's modelVersion, …). `model` stays
   * the EYAS id, so pricing and labels are stable. Absent when the backend
   * names no model.
   */
  resolvedModelId?: string
  /** Context window the runtime itself reported for the model that answered (wins over catalog values). */
  contextWindow?: number
  /**
   * ACP CLIs only, on a turn with a system prompt: how it reached the model.
   * Absent for providers that take a system prompt natively. Recorded on the
   * turn's context composition (observability/context-recorder.ts observe →
   * delivery_json.systemPromptChannel) and shown in the context inspector.
   */
  systemPromptChannel?: SystemPromptDelivery
  /**
   * Requested vs effective reasoning effort of this call. The gateway sets it
   * on complete() and on the stream's 'done' response (reasoning/outcome.ts
   * mergeEffortOutcome); a provider contributes only a runtime-confirmed
   * effective level, through readbackOutcome().
   */
  effortOutcome?: EffortOutcome
}

// ─── Streaming ─────────────────────────────────

/**
 * The provider-neutral stream contract (G1). Every provider maps its backend
 * onto exactly these events:
 * - a tool row opens with tool_use_start (canonical name, provider name in
 *   rawName) and settles ONLY on tool_result — after the tool actually ran;
 * - a tool waiting on a human is approval_required;
 * - step marks an internal agentic step of a provider with its own loop;
 * - notice carries a generic, localized, non-fatal notice;
 * - done carries the response (with its StopReason and canonical usage).
 */
export type ContractStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use_start'; id: string; name: string; rawName?: string; input?: Record<string, unknown> }
  | { type: 'tool_use_input'; delta: string }
  | {
      type: 'tool_result'
      toolUseId: string
      content: string
      isError: boolean
      durationMs: number
      outcome?: ToolOutcome
      executedBy?: ToolExecutor
    }
  | { type: 'approval_required'; toolUseId?: string; toolName: string; reason: string; approvalId?: number; riskTier?: 'green' | 'yellow' | 'red' }
  | { type: 'step'; n: number }
  | { type: 'notice'; code: NoticeCode; params?: NoticeParams }
  | { type: 'done'; response: ModelResponse }
  | { type: 'error'; error: Error }

/**
 * What a provider or the gateway yields: exactly the contract. A tool row is
 * settled only by tool_result (the pre-execution tool_use_end is gone) and a
 * compaction is notice{code:'contextCompacted'} (context_compact is gone).
 */
export type StreamEvent = ContractStreamEvent

// ─── Embedding ────────────────────────────────

export interface EmbedRequest {
  provider?: string
  model?: string
  texts: string[]
}

export interface EmbedResponse {
  provider: string
  model: string
  embeddings: number[][]
  dimensions: number
}

// ─── Provider ──────────────────────────────────

export interface ModelInfo {
  id: string
  name: string
  provider: string
  contextWindow: number
  maxOutputTokens: number
  supportsTools: boolean
  supportsImages: boolean
  supportsStreaming: boolean
  metadata?: Record<string, unknown>
}

/**
 * How a model on this provider must address an EYAS tool. EYAS tool names are
 * canonical (`memory_search`); a CLI that reaches them over the EYAS MCP
 * server sees them under another name, and a bare canonical name can resolve
 * to the CLI's OWN tool of the same name (Grok's native memory_search).
 * Rendered by tool-addressing.ts (renderToolRef / toolAddressingNote).
 *   native      — the EYAS executor runs the tool; the canonical name is exact.
 *   mcp-prefix  — the host lists MCP tools as `<prefix><name>` (Claude Code).
 *   meta-tool   — MCP tools are not in the function list; the model calls
 *                 `use_tool` with tool_name `eyas__<name>` (Grok CLI).
 *   mcp-server  — the host's naming is unverified; name the server only (Kimi).
 */
export type ToolAddressing =
  | { kind: 'native' }
  | { kind: 'mcp-prefix'; prefix: string }
  | { kind: 'meta-tool'; via: 'use_tool'; qualify: 'eyas__' }
  | { kind: 'mcp-server'; server: 'eyas' }

export interface AIProvider {
  id: string
  name: string
  /**
   * The isolated-completion contract. true promises that a request with
   * `isolated: true` runs with no tools, one turn, output bounded by
   * maxTokens, no provider-native memory or config read or written, no
   * session persisted to host stores, and never resumes one. Only a provider
   * with context to shed says so: absent means "nothing to isolate" for an
   * API provider and "cannot" for a CLI. Eligibility for background work and
   * for an isolated failover hop is binding.ts canRunIsolated, which reads
   * THIS, never a provider id.
   */
  supportsIsolatedCompletion?: boolean
  /**
   * The host this provider sends prompts to, read from its configured base
   * URL (e.g. 'localhost' for a default Ollama, 'gpu.lan' for a remote one).
   * The locality fact privacy decides on — never the provider id. undefined
   * means unknown, or a CLI whose traffic EYAS cannot see: always treated as
   * remote.
   */
  egressHost?(): string | undefined
  /**
   * How prompts must name EYAS tools for this provider's model. Absent means
   * 'native' (the EYAS executor runs tools under their canonical names).
   * Read through toolAddressingOf(), never by provider id.
   */
  toolAddressing?: ToolAddressing
  listModels(): Promise<ModelInfo[]>
  complete(request: ModelRequest): Promise<ModelResponse>
  stream(request: ModelRequest): AsyncIterable<StreamEvent>
  fetchModels?(): Promise<ModelInfo[]>
  embed?(request: EmbedRequest): Promise<EmbedResponse>
}

// ─── Gateway ───────────────────────────────────

export interface ModelGateway {
  registerProvider(provider: AIProvider): void
  unregisterProvider(id: string): void
  getProvider(id: string): AIProvider | undefined
  listProviders(): AIProvider[]
  listAllModels(): Promise<ModelInfo[]>
  complete(request: ModelRequest): Promise<ModelResponse>
  stream(request: ModelRequest): AsyncIterable<StreamEvent>
  embed(request: EmbedRequest): Promise<EmbedResponse>
}

// ─── Enhanced Provider Types ──────────────────

export interface ProviderHealthInfo {
  status: 'healthy' | 'auth_error'
  message?: string
  lastErrorAt?: string
  /** 'cliSignIn': the CLI's EYAS home is not signed in (localized by the UI). */
  code?: 'cliSignIn'
}

export interface ProviderListItem {
  id: string
  /** The product name (provider-display.ts) — the web's only source for it. */
  name: string
  /** How the provider runs (provider-display.ts): host CLI, local server or hosted API. */
  kind: ProviderKind
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  modelCount: number
  enabledModelCount: number
  health?: ProviderHealthInfo
  /** CLI providers only: the kernel file sandbox for the CLI's own tools (cli-runtime/sandbox). */
  fileSandbox?: FileSandboxInfo
}

export interface ProviderDetail {
  id: string
  name: string
  kind: ProviderKind
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  models: ModelConfigItem[]
  /** CLI providers only: the kernel file sandbox for the CLI's own tools. */
  fileSandbox?: FileSandboxInfo
}

export interface ModelConfigItem {
  id: string
  modelId: string
  name: string
  enabled: boolean
  contextWindow: number | null
  maxOutputTokens: number | null
  supportsTools: boolean
  supportsImages: boolean
  supportsStreaming: boolean
  /** The concrete model this row runs, when discovery named it (model_config.metadata.realModelId). */
  realModelId?: string
  /** True when the last successful discovery no longer offered this model (metadata.missingSince). */
  missing?: boolean
  /** Effective reasoning capability (API output only, never stored — see reasoning/registry.ts). */
  reasoning?: ReasoningCapability
  /** Informational only: the reasoning setting the local runtime keeps for itself (metadata.runtimeReasoning). */
  runtimeReasoning?: RuntimeReasoningInfo
}

/**
 * A reasoning setting a local runtime controls itself and EYAS never sends
 * (LM Studio: capabilities.reasoning of GET /api/v1/models). Shown so the
 * operator knows what runs; it never feeds the effort resolver.
 */
export interface RuntimeReasoningInfo {
  /** The runtime's own option names (e.g. 'off', 'on', 'low', 'high'). */
  options: string[]
  /** The option the runtime uses by default; null when it reports none. */
  default: string | null
}
