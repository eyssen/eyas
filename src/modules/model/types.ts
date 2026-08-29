import type { AssembledPrompt } from '../prompt-wizard/types.js'
import type { RoutingTier } from './routing/types.js'

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
}

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock

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

export interface ThinkingConfig {
  enabled: boolean
  budgetTokens?: number  // max tokens for thinking (Anthropic: budgetTokens, OpenAI: max_completion_tokens reasoning)
}

/**
 * Provider-agnostic reasoning-effort level. Mapped per provider:
 * claude-code → SDK Options.effort (+ adaptive thinking), anthropic →
 * output_config.effort on adaptive models / thinking budget on older ones,
 * openai → reasoning_effort (max→high). Providers without support ignore it.
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

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
   * F2 T5 — per-request approval sink for providers with an INTERNAL agentic
   * loop (Claude Code SDK, Grok ACP). Their permission bridge denies an
   * escalated call in-session; this callback hands the enqueued approval id
   * back to the runner so an autonomous supervised run can park on it after
   * the turn instead of losing the escalation. Not data: never serialize it.
   */
  onEscalatedApproval?: (approvalId: number, toolName?: string) => void
  /**
   * Task 10 — FK into context_compositions (observability module), the
   * context-inspector record of what actually reached the model on this
   * turn. Undefined when no recorder was wired or recording failed — an
   * observability gap, never a reason to fail the call.
   */
  compositionId?: string
}

export interface ModelRequest {
  provider?: string
  model?: string
  messages: ModelMessage[]
  system?: string
  tools?: ToolDefinition[]
  maxTokens?: number
  /** Per-agent agentic turn budget for providers with an internal loop (Claude Code SDK). */
  maxTurns?: number
  temperature?: number
  stopSequences?: string[]
  sessionId?: string | null  // Claude Code SDK session resume
  thinking?: ThinkingConfig
  effort?: EffortLevel
  orchestration?: OrchestrationMode
  /**
   * One-shot internal completion: no filesystem settings, no CLI-native
   * memory/config, no bridged tools — for extraction/reflection-class calls
   * whose judgment must not be contaminated by the CLI's own loaded context.
   *
   * Honoured by providers that advertise `supportsIsolatedCompletion`; ignored,
   * harmlessly, by every other provider (an API provider loads no context of
   * its own, so it is already isolated).
   *
   * Mutually exclusive with `sessionId`/resume — isolation wins: resuming would
   * restore the very context this flag exists to exclude.
   */
  isolated?: boolean
  /** Cancellation signal forwarded to the provider (e.g. Claude Code SDK interrupt). */
  signal?: AbortSignal
  /** Optional metadata for provider-specific features (e.g. MCP bridge context) */
  metadata?: ModelRequestMetadata
}

/**
 * F2 T9 — token + cost usage for a single provider call. `cacheReadTokens` /
 * `cacheCreationTokens` / `costUsd` are optional: only providers that expose
 * them (Anthropic-family APIs, the Claude Code SDK) fill them in — everyone
 * else's response carries just the base token counts, exactly as before.
 */
export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  /** Provider-reported authoritative cost (e.g. Claude Code SDK's total_cost_usd). */
  costUsd?: number
}

export interface ModelResponse {
  id: string
  provider: string
  model: string
  content: ContentBlock[]
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage: ModelUsage
  sessionId?: string | null  // Claude Code SDK session continuity
}

// ─── Streaming ─────────────────────────────────

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_input'; delta: string }
  // `id` and `status` are optional: nine providers emit this bare and stay
  // valid. A provider that KNOWS which call ended must say so — without the id
  // the UI cannot match an end to a start, and every tool row spins for ever.
  | { type: 'tool_use_end'; id?: string; status?: 'success' | 'error' }
  | { type: 'context_compact'; summary: string }
  | { type: 'done'; response: ModelResponse }
  | { type: 'error'; error: Error }

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

export interface AIProvider {
  id: string
  name: string
  /**
   * This provider can honour `ModelRequest.isolated` — run a completion with
   * none of its own loaded context. Only a provider with context to shed needs
   * to say so: absent means either "nothing to isolate" (an API provider) or
   * "cannot" (a CLI with no such switch). A caller that needs an uncontaminated
   * judgment selects on THIS, never on a provider id.
   */
  supportsIsolatedCompletion?: boolean
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
}

export interface ProviderListItem {
  id: string
  name: string
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  modelCount: number
  enabledModelCount: number
  health?: ProviderHealthInfo
}

export interface ProviderDetail {
  id: string
  name: string
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  models: ModelConfigItem[]
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
}

// ─── v2 Provider Protocol ─────────────────────
// Capabilities surface what each provider supports for cache-aware assembly.
// NormalizedRequest carries the v2 AssembledPrompt (prefix/suffix) so adapters
// can map it to provider-native cache markers, single system messages, etc.

export interface ProviderCapabilities {
  promptCache: 'explicit' | 'automatic' | 'none'
  promptCacheMinTokens?: number          // e.g. Gemini = 32_000
  toolCalling: 'native' | 'inline-fallback' | 'none'
  multiSystemMessages: boolean
  thinking: boolean
  effectiveContextWindow: number          // tokens
}

export interface NormalizedRequest {
  systemPrompt: AssembledPrompt
  messages: ModelMessage[]
  tools?: ToolDefinition[]
  thinking?: ThinkingConfig
  modelId: string
  metadata?: Record<string, unknown>
}

export interface ModelProvider {
  readonly id: string
  readonly capabilities: ProviderCapabilities
  send(request: NormalizedRequest): Promise<ModelResponse>
}
