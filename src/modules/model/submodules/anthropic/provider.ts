// Part of eYssen. See LICENSE file for full copyright and licensing details.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent } from '../../types.js'
import { toAnthropicMessages, toAnthropicTools, fromAnthropicResponse, consumeAnthropicStream, applyAnthropicReasoning } from './adapter.js'
import { withResolvedModel } from '../../helpers.js'
import { EFFORT_LADDER, sortEffortLevels } from '../../reasoning/ladder.js'
import { FALLBACK_OUTPUT_TOKENS } from '../../reasoning/resolve.js'
import type { DiscoveredReasoning } from '../../reasoning/schemas.js'

/**
 * The built-in catalog: what a fresh install lists when the Models API cannot
 * be reached (manifest.ts discovers the real list first). Current models only,
 * verified 2026-09-22 against the claude-api reference (models.md: ids,
 * context window, max output). Reasoning facts are not listed here — they
 * come from the capability registry (Models API discovery + overlay.json).
 */
export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-fable-5', name: 'Claude Fable 5', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-opus-5', name: 'Claude Opus 5', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
]

/** The provider id; thinking blocks this provider produced replay only to it. */
const PROVIDER_ID = 'anthropic'

/**
 * The model a request without one goes to. A request that names no model has
 * no capability record (effort resolves to Auto), so this stays a model that
 * accepts every plain parameter, temperature included.
 */
const DEFAULT_MODEL = 'claude-sonnet-4-6'

/** Discovery is a single cheap list call: fail fast instead of holding a load. */
const DISCOVERY_REQUEST = { timeout: 10_000, maxRetries: 0 } as const

/** A sanity bound on pagination (a well-behaved endpoint ends far below it). */
const MAX_DISCOVERED_MODELS = 500

/** Context window assumed for a listed model that names none (and is not in the catalog). */
const FALLBACK_CONTEXT_WINDOW = 200_000

// ─── Models API discovery ────────────────────────────────────────────────────

const SupportSchema = z.object({ supported: z.boolean() }).passthrough()
const OptionalSupport = SupportSchema.nullable().optional()

/**
 * One GET /v1/models entry — only the fields EYAS reads, parsed tolerantly:
 * unknown fields pass, a missing capability reads as "not reported", and an
 * entry without a usable id is skipped.
 */
const ModelsApiEntrySchema = z.object({
  id: z.string().min(1).max(300),
  display_name: z.string().min(1).max(300).nullable().optional(),
  max_input_tokens: z.number().int().positive().nullable().optional(),
  max_tokens: z.number().int().positive().nullable().optional(),
  capabilities: z.object({
    image_input: OptionalSupport,
    effort: z.object({
      supported: z.boolean(),
      low: OptionalSupport,
      medium: OptionalSupport,
      high: OptionalSupport,
      xhigh: OptionalSupport,
      max: OptionalSupport,
    }).passthrough().nullable().optional(),
    thinking: z.object({
      supported: z.boolean(),
      types: z.object({
        adaptive: OptionalSupport,
        enabled: OptionalSupport,
      }).passthrough().nullable().optional(),
    }).passthrough().nullable().optional(),
  }).passthrough().nullable().optional(),
}).passthrough()

type ModelsApiEntry = z.infer<typeof ModelsApiEntrySchema>

/** The capabilities.effort keys, which are exactly the ladder rungs the Messages API accepts. */
const EFFORT_CAPABILITY_KEYS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** Every rung that asks for reasoning: a budget model can express each of them as a budget. */
const BUDGET_LEVELS = EFFORT_LADDER.filter((level) => level !== 'none')

/**
 * The discovered reasoning facts of one Models API entry, in THE discovery
 * shape the capability registry reads (model_config.metadata.reasoning):
 *   - effort supported → param 'effort' with exactly the levels the API
 *     marks supported, and whether adaptive thinking is available;
 *   - otherwise budget thinking ({type:'enabled'}) supported → param 'budget'
 *     (every rung maps to a budget; the overlay supplies the budget range);
 *   - both reported unsupported → param 'none';
 *   - anything less definite → null, so the overlay alone decides.
 * The API never reports the default level, always-on thinking, can-disable
 * or sampling locks; those stay overlay facts.
 */
export function reasoningFromModelCapabilities(capabilities: ModelsApiEntry['capabilities'], discoveredAt: string): DiscoveredReasoning | null {
  if (!capabilities) return null
  const { effort, thinking } = capabilities
  const types = thinking?.types
  const adaptiveThinking = types?.adaptive ? { adaptiveThinking: types.adaptive.supported } : {}

  if (effort?.supported) {
    const levels = sortEffortLevels(EFFORT_CAPABILITY_KEYS.filter((key) => effort[key]?.supported === true))
    if (levels.length > 0) return { source: 'models-api', param: 'effort', levels, ...adaptiveThinking, discoveredAt }
  }
  if (thinking?.supported && types?.enabled?.supported === true) {
    return { source: 'models-api', param: 'budget', levels: [...BUDGET_LEVELS], ...adaptiveThinking, discoveredAt }
  }
  if (effort?.supported === false && thinking?.supported === false) {
    return { source: 'models-api', param: 'none', levels: [], discoveredAt }
  }
  return null
}

/**
 * One Models API entry as a catalog row: max_input_tokens is the context
 * window and max_tokens the output cap (the catalog seed, then conservative
 * defaults, for a value the API leaves out). Null for an entry that does not
 * parse.
 */
export function anthropicModelFromApi(raw: unknown, discoveredAt: string): ModelInfo | null {
  const parsed = ModelsApiEntrySchema.safeParse(raw)
  if (!parsed.success) return null
  const entry = parsed.data
  const seed = ANTHROPIC_MODELS.find((m) => m.id === entry.id)
  const reasoning = reasoningFromModelCapabilities(entry.capabilities, discoveredAt)
  const imageInput = entry.capabilities?.image_input
  return {
    id: entry.id,
    name: entry.display_name ?? seed?.name ?? entry.id,
    provider: PROVIDER_ID,
    contextWindow: entry.max_input_tokens ?? seed?.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
    maxOutputTokens: entry.max_tokens ?? seed?.maxOutputTokens ?? FALLBACK_OUTPUT_TOKENS,
    supportsTools: true,
    supportsImages: imageInput ? imageInput.supported : (seed?.supportsImages ?? true),
    supportsStreaming: true,
    metadata: { discoveredAt, ...(reasoning ? { reasoning } : {}) },
  }
}

// ─── Prompt caching ──────────────────────────────────────────────────────────

/**
 * A cache breakpoint with the API's default 5-minute TTL — the rate the cost
 * table prices cache writes at (1.25x input). Every request that shares the
 * prefix and starts within 5 minutes of the last one refreshes it.
 */
const EPHEMERAL_CACHE = Object.freeze({ type: 'ephemeral' } as const)

/** The content block types a cache breakpoint may sit on (never thinking / redacted_thinking). */
const CACHEABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(['text', 'image', 'document', 'tool_use', 'tool_result'])

/** One Messages API message as toAnthropicMessages builds it. */
type WireMessage = { role: string; content: string | Array<Record<string, unknown>> }

/**
 * Whether a user message starts a turn. A user message that only returns tool
 * results continues the turn of the message it answers.
 */
function startsTurn(message: WireMessage): boolean {
  if (message.role !== 'user') return false
  return typeof message.content === 'string' || message.content.some((block) => block.type !== 'tool_result')
}

/**
 * `message` with a cache breakpoint on its last block that can carry one (a
 * string content becomes the single text block it stands for — the same
 * bytes to the cache), or null when no block can. The block is copied, never
 * changed in place.
 */
function withBreakpoint(message: WireMessage): WireMessage | null {
  if (typeof message.content === 'string') {
    return message.content.trim() ? { ...message, content: [{ type: 'text', text: message.content, cache_control: EPHEMERAL_CACHE }] } : null
  }
  for (let i = message.content.length - 1; i >= 0; i--) {
    const block = message.content[i]!
    if (!CACHEABLE_BLOCK_TYPES.has(String(block.type))) continue
    if (block.type === 'text' && !(typeof block.text === 'string' && block.text.trim())) continue
    const content = [...message.content]
    content[i] = { ...block, cache_control: EPHEMERAL_CACHE }
    return { ...message, content }
  }
  return null
}

/**
 * Prompt caching on a Messages API request of the Anthropic API (this provider
 * only). A read can only land where an earlier request wrote a breakpoint, so
 * the breakpoints sit where the prompt stops changing:
 *   - the system prompt. It is turn-stable: the clock and the recalled memory
 *     ride on the current user message (the turn block), not in it. Every
 *     later turn and tool iteration reads tools + system back, even when the
 *     rest of the prompt changed;
 *   - the end of the history before the current turn (the last cacheable
 *     block before the user message that started it). The turn block leaves
 *     that user message once the turn is over, so nothing after this point is
 *     byte-stable across turns; up to it, the next turn reads the whole
 *     earlier conversation back;
 *   - on a request that offers tools, top-level automatic caching, which the
 *     API places on the last cacheable block, so each tool iteration within
 *     the turn reads the previous request back. A request without tools is
 *     answered in one call, so a breakpoint after its last message would only
 *     pay the write premium on content nothing reads again (a long one-off
 *     input to an auxiliary call, say).
 * At most three of the API's four breakpoints, all with the default 5-minute
 * TTL. A prefix below the model's minimum cacheable length silently stays
 * uncached (no error). Anthropic-compatible endpoints get none of this: a
 * third-party endpoint may reject the parameter (anthropic-compat/provider.ts).
 */
export function applyAnthropicPromptCaching(
  params: { system?: unknown; messages: WireMessage[]; tools?: unknown[]; cache_control?: unknown },
  system: string | undefined,
): void {
  // The API rejects a breakpoint on a text block without visible text; a
  // whitespace-only system prompt goes as before, a plain string.
  if (system?.trim()) params.system = [{ type: 'text', text: system, cache_control: EPHEMERAL_CACHE }]
  else if (system) params.system = system

  const messages = params.messages
  let turnStart = messages.length - 1
  while (turnStart >= 0 && !startsTurn(messages[turnStart]!)) turnStart--
  for (let i = turnStart - 1; i >= 0; i--) {
    const marked = withBreakpoint(messages[i]!)
    if (!marked) continue
    params.messages = messages.map((message, index) => (index === i ? marked : message))
    break
  }

  if (params.tools?.length) params.cache_control = EPHEMERAL_CACHE
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function createAnthropicProvider(apiKey: string): AIProvider {
  const client = new Anthropic({ apiKey })

  return {
    id: PROVIDER_ID,
    name: 'Anthropic Claude API',

    async listModels() {
      return ANTHROPIC_MODELS
    },

    /**
     * The models this key can use, from the Models API (GET /v1/models — no
     * model call, no cost), with per-model context window, output cap and
     * reasoning capabilities. Throws when the list cannot be read; the caller
     * keeps what it has.
     */
    async fetchModels() {
      const discoveredAt = new Date().toISOString()
      const models: ModelInfo[] = []
      for await (const entry of client.models.list({ limit: 100 }, DISCOVERY_REQUEST)) {
        const info = anthropicModelFromApi(entry, discoveredAt)
        if (info) models.push(info)
        if (models.length >= MAX_DISCOVERED_MODELS) break
      }
      return models
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const model = request.model || DEFAULT_MODEL
      const params: any = {
        model,
        max_tokens: request.maxTokens || 4096,
        messages: toAnthropicMessages(request.messages, PROVIDER_ID),
      }
      if (request.tools?.length) params.tools = toAnthropicTools(request.tools)
      applyAnthropicPromptCaching(params, request.system)
      if (request.stopSequences?.length) params.stop_sequences = request.stopSequences
      if (request.temperature !== undefined) params.temperature = request.temperature
      // The gateway's effort plan for this model (drops sampling where the model forbids it).
      applyAnthropicReasoning(params, request.effortPlan)

      // Forward the caller's cancellation signal so an operator/RunSupervisor
      // cancel aborts the in-flight HTTP request instead of billing the full
      // response — the run must not keep streaming after cancellation.
      const response = await client.messages.create(params, { signal: request.signal })
      // `model` stays the id EYAS asked for; the API's own model field is
      // what answered.
      return withResolvedModel(fromAnthropicResponse(response, { providerId: PROVIDER_ID, model }), model, (response as any).model)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const model = request.model || DEFAULT_MODEL
      const params: any = {
        model,
        max_tokens: request.maxTokens || 4096,
        messages: toAnthropicMessages(request.messages, PROVIDER_ID),
        stream: true,
      }
      if (request.tools?.length) params.tools = toAnthropicTools(request.tools)
      applyAnthropicPromptCaching(params, request.system)
      if (request.stopSequences?.length) params.stop_sequences = request.stopSequences
      if (request.temperature !== undefined) params.temperature = request.temperature
      // The gateway's effort plan for this model (drops sampling where the model forbids it).
      applyAnthropicReasoning(params, request.effortPlan)

      const stream = await client.messages.create(params, { signal: request.signal }) as any
      yield* consumeAnthropicStream(stream, { providerId: PROVIDER_ID, model })
    },
  }
}
