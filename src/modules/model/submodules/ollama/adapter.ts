// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  ModelInfo,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelUsage,
  ContractStreamEvent,
  ContentBlock,
  ToolDefinition,
} from '../../types.js'
import { z } from 'zod'
import { contentToText, resolvedModelField, stripThinkingBlocks, withResolvedModel } from '../../helpers.js'
import { normalizeStopReason } from '../../stop-reason.js'
import { tokenCount, toModelUsage } from '../../usage.js'
import { isEffortLevel, sortEffortLevels, type EffortLevel } from '../../reasoning/ladder.js'
import type { DiscoveredReasoning } from '../../reasoning/schemas.js'
import type { EffortPlan } from '../../reasoning/resolve.js'

// ─── Ollama API types ───────────────────────────

interface OllamaModel {
  name: string
  size: number
  details: {
    parameter_size?: string
    family?: string
    quantization_level?: string
  }
}

interface OllamaChatMessage {
  role: string
  content: string
  /** A thinking model's reasoning trace, separate from the answer in `content`. */
  thinking?: string
  images?: string[]
  /** On a role:'tool' message: the function whose result this is (Ollama links results by name, in call order). */
  tool_name?: string
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> }
  }>
}

interface OllamaChatResponse {
  model: string
  message: OllamaChatMessage
  done: boolean
  /** Why generation ended ('stop', 'length', …) — present on the final (done) chunk. */
  done_reason?: string
  total_duration?: number
  prompt_eval_count?: number
  eval_count?: number
}

interface OllamaEmbedResponse {
  embeddings: number[][]
}

/** One accepted `think` value as /api/show reports it: a named level or an on/off boolean. */
const OllamaThinkValueSchema = z.union([z.string().min(1).max(32), z.boolean()])

/**
 * The part of /api/show EYAS reads: the model's declared capabilities
 * (Ollama ≥0.6; 'thinking' since 0.9) and, on newer servers, its thinking
 * control — the `think` values it accepts and the one it uses by default.
 */
export const OllamaShowSchema = z.object({
  capabilities: z.array(z.string().max(64)).max(64).optional(),
  thinking: z.object({
    values: z.array(OllamaThinkValueSchema).max(32).optional(),
    default: OllamaThinkValueSchema.nullish(),
  }).passthrough().nullish(),
}).passthrough()

export type OllamaShow = z.infer<typeof OllamaShowSchema>

/** /api/show calls in flight at once during discovery (a local server; keep it gentle). */
const SHOW_CONCURRENCY = 4

// ─── Context size (num_ctx) ─────────────────────

/** Ollama's context window when a request sets no num_ctx (docs/faq: 4096). */
export const OLLAMA_DEFAULT_NUM_CTX = 4096
/** Room kept for the reply when the request sets no maxTokens. */
const OLLAMA_REPLY_RESERVE = 1024
const CHARS_PER_TOKEN = 4

/**
 * num_ctx for one request, or undefined to leave Ollama's default alone.
 * Set only when the request (estimated at 4 chars per token) plus its reply
 * no longer fits the default: then the next power of two — a few stable sizes,
 * so Ollama does not reload the model for every request — capped at the
 * model's resolved window. Without a resolved window nothing is set.
 */
export function ollamaNumCtx(
  messages: OllamaChatMessage[],
  tools: unknown[] | undefined,
  maxTokens: number | undefined,
  contextWindow: number | undefined,
): number | undefined {
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow)) return undefined
  if (contextWindow <= OLLAMA_DEFAULT_NUM_CTX) return undefined
  let chars = 0
  for (const m of messages) {
    chars += m.content.length
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length
  }
  if (tools?.length) chars += JSON.stringify(tools).length
  const needed = Math.ceil(chars / CHARS_PER_TOKEN) + (maxTokens && maxTokens > 0 ? maxTokens : OLLAMA_REPLY_RESERVE)
  if (needed <= OLLAMA_DEFAULT_NUM_CTX) return undefined
  return Math.min(Math.floor(contextWindow), nextPow2(needed))
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

// ─── Message conversion ─────────────────────────

export function toOllamaMessages(history: ModelMessage[], system?: string): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = []
  if (system) result.push({ role: 'system', content: system })

  // Another dialect's reasoning (an Anthropic thinking block after a
  // failover) never reaches this wire, not even as text.
  const messages = stripThinkingBlocks(history)

  // A tool_result names only the call id; Ollama's tool message carries the
  // function name instead (its wire format has no call ids).
  const callNames = new Map<string, string>()
  for (const msg of messages) {
    if (typeof msg.content === 'string') continue
    for (const block of msg.content) {
      if (block.type === 'tool_use') callNames.set(block.id, block.name)
    }
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    // Extract images (base64 only) for Ollama's images array
    const images: string[] = []
    for (const block of msg.content) {
      if (block.type === 'image' && block.source.type === 'base64') {
        images.push(block.source.data)
      }
    }

    // Tool results become user messages with the result text
    const toolResults = msg.content.filter(b => b.type === 'tool_result')
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        if (tr.type === 'tool_result') {
          const toolName = callNames.get(tr.toolUseId)
          result.push({ role: 'tool', content: tr.content, ...(toolName ? { tool_name: toolName } : {}) })
        }
      }
      continue
    }

    // Tool use blocks become assistant messages with tool_calls
    const toolUses = msg.content.filter(b => b.type === 'tool_use')
    if (toolUses.length > 0) {
      const text = contentToText(msg.content)
      const ollamaMsg: OllamaChatMessage = {
        role: msg.role,
        content: text || '',
        tool_calls: toolUses
          .filter((tu): tu is Extract<ContentBlock, { type: 'tool_use' }> => tu.type === 'tool_use')
          .map(tu => ({
            function: { name: tu.name, arguments: tu.input },
          })),
      }
      result.push(ollamaMsg)
      continue
    }

    const text = contentToText(msg.content)
    const ollamaMsg: OllamaChatMessage = { role: msg.role, content: text }
    if (images.length > 0) ollamaMsg.images = images
    result.push(ollamaMsg)
  }

  return result
}

export function toOllamaTools(tools: ToolDefinition[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

// ─── Response mapping ───────────────────────────

/**
 * The final chunk's counts as canonical usage. prompt_eval_count counts only
 * the prompt tokens Ollama actually evaluated (a prefix reused from its KV
 * cache is not in it), so it already is the uncached input. A server that
 * sends neither count reports nothing: reported:false.
 */
export function fromOllamaUsage(raw: Pick<OllamaChatResponse, 'prompt_eval_count' | 'eval_count'> | undefined): ModelUsage {
  const promptEval = raw?.prompt_eval_count
  const evalCount = raw?.eval_count
  if (typeof promptEval !== 'number' && typeof evalCount !== 'number') return toModelUsage(null)
  return toModelUsage({ uncachedInput: tokenCount(promptEval), output: tokenCount(evalCount) })
}

export function fromOllamaResponse(raw: OllamaChatResponse, providerId: string): ModelResponse {
  const content: ContentBlock[] = []

  if (raw.message.content) {
    content.push({ type: 'text', text: raw.message.content })
  }
  if (raw.message.tool_calls) {
    for (const tc of raw.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: tc.function.name,
        input: tc.function.arguments as Record<string, unknown>,
      })
    }
  }

  return {
    id: `ollama-${Date.now()}`,
    provider: providerId,
    model: raw.model,
    content,
    stopReason: normalizeStopReason('ollama', raw.done_reason, content),
    usage: fromOllamaUsage(raw),
  }
}

// ─── Reasoning: /api/show discovery and the `think` field ───
// No model list lives here. Whether a model thinks, and which `think` values
// it takes, is its capability record (reasoning/registry.ts: /api/show
// discovery merged over the versioned overlay, where gpt-oss takes named
// levels only), which the gateway resolved into request.effortPlan for the
// model this attempt goes to. This adapter only translates that plan.

/**
 * The discovered reasoning facts of one /api/show answer, in THE discovery
 * shape the capability registry reads (model_config.metadata.reasoning), or
 * null when the answer proves nothing EYAS can use (no capabilities list: an
 * older server or a failed call) — the model then stays unknown and no
 * `think` is ever sent for it.
 *   - 'thinking' not among the capabilities → param 'none': Ollama rejects a
 *     truthy `think` for such a model;
 *   - thinking values with named levels → param 'effort' on those rungs,
 *     plus 'none' when `false` is accepted;
 *   - only on/off values → a toggle ('none' = false, 'high' = true);
 *   - 'thinking' without a values list (servers that predate the thinking
 *     object) → the documented on/off toggle, on by default.
 */
export function ollamaReasoningFromShow(show: OllamaShow | undefined, discoveredAt: string): DiscoveredReasoning | null {
  if (!show?.capabilities) return null
  if (!show.capabilities.includes('thinking')) return { source: 'models-api', param: 'none', levels: [], discoveredAt }

  const values = show.thinking?.values
  const reportedDefault = show.thinking?.default
  if (!values || values.length === 0) {
    const defaultLevel: EffortLevel = reportedDefault === false ? 'none' : 'high'
    return { source: 'models-api', param: 'toggle', levels: ['none', 'high'], defaultLevel, discoveredAt }
  }

  const canOff = values.includes(false)
  const canOn = values.includes(true)
  // Ollama switches thinking off with `false`, never with a level name.
  const named = sortEffortLevels(values.filter((v): v is string => typeof v === 'string')).filter((l) => l !== 'none')
  if (named.length > 0) {
    const levels: EffortLevel[] = canOff ? ['none', ...named] : named
    const defaultLevel = typeof reportedDefault === 'string' && isEffortLevel(reportedDefault) && levels.includes(reportedDefault)
      ? reportedDefault
      : reportedDefault === false && canOff ? 'none' : null
    return { source: 'models-api', param: 'effort', levels, defaultLevel, discoveredAt }
  }
  if (canOn || canOff) {
    const levels: EffortLevel[] = [...(canOff ? ['none' as const] : []), ...(canOn ? ['high' as const] : [])]
    const defaultLevel = reportedDefault === true && canOn ? 'high' : reportedDefault === false && canOff ? 'none' : null
    return { source: 'models-api', param: 'toggle', levels, defaultLevel, discoveredAt }
  }
  // Only names EYAS has no rung for: nothing it could send.
  return null
}

/**
 * The `think` value for one plan, or undefined to send none:
 *   - no reasoning control (a model without the 'thinking' capability, or
 *     one whose /api/show failed) → nothing: a truthy `think` makes Ollama
 *     reject the request, and nothing is ever guessed;
 *   - 'auto' → nothing (the model's own default: a thinking model thinks);
 *   - 'none' → false, only where the record says it can be switched off;
 *   - a rung on an on/off model → true;
 *   - a rung on a level model (gpt-oss) → the level name.
 */
export function ollamaThink(plan: EffortPlan | undefined): boolean | EffortLevel | undefined {
  if (!plan) return undefined
  const capability = plan.capability
  if (capability.kind !== 'effort' && capability.kind !== 'toggle') return undefined
  const level = plan.level
  // Defensive: the gateway clamps to the record before planning.
  if (level === 'auto' || !capability.levels.includes(level)) return undefined
  if (level === 'none') return capability.canDisable ? false : undefined
  return capability.kind === 'toggle' ? true : level
}

/** Run `fn` over `items`, at most `limit` at a time, keeping the order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// ─── Adapter factory ────────────────────────────

export function createOllamaAdapter(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '')

  /** The local models (/api/tags). Throws when the server answers with an error. */
  async function tags(): Promise<OllamaModel[]> {
    const res = await fetch(`${base}/api/tags`)
    if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`)
    const data = (await res.json()) as { models?: OllamaModel[] }
    return data.models || []
  }

  /**
   * /api/show for one model, parsed. Undefined when the call fails or the
   * answer does not parse: that model's facts stay unknown, never guessed.
   */
  async function show(model: string): Promise<OllamaShow | undefined> {
    try {
      const res = await fetch(`${base}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return undefined
      const parsed = OllamaShowSchema.safeParse(await res.json())
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  function toModelInfo(m: OllamaModel, extra: { supportsTools?: boolean; metadata?: Record<string, unknown> } = {}): ModelInfo {
    const sizeB = parseParamSize(m.details?.parameter_size || '')
    return {
      id: m.name,
      name: m.name,
      provider: 'ollama',
      contextWindow: estimateContextWindow(sizeB),
      maxOutputTokens: estimateMaxOutput(sizeB),
      // An older Ollama that reports no capabilities is not a reason to take a model's tools away.
      supportsTools: extra.supportsTools ?? true,
      supportsImages: isVisionModel(m.name),
      supportsStreaming: true,
      ...(extra.metadata ? { metadata: extra.metadata } : {}),
    }
  }

  return {
    /** Ping Ollama to check availability */
    async ping(): Promise<boolean> {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3000)
        const res = await fetch(`${base}/api/tags`, { signal: controller.signal })
        clearTimeout(timeout)
        return res.ok
      } catch {
        return false
      }
    },

    /**
     * The locally available models, from /api/tags alone: cheap enough for
     * the gateway's model resolution and every listing. Per-model facts come
     * from fetchModelsWithCapabilities().
     */
    async listModels(): Promise<ModelInfo[]> {
      return (await tags()).map((m) => toModelInfo(m))
    },

    /**
     * Discovery: /api/tags, then POST /api/show per model for its declared
     * capabilities — tool calling (supportsTools) and thinking
     * (metadata.reasoning, see ollamaReasoningFromShow). A model whose
     * /api/show fails keeps its tools and gets no reasoning facts.
     */
    async fetchModelsWithCapabilities(): Promise<ModelInfo[]> {
      const models = await tags()
      const shows = await mapLimit(models, SHOW_CONCURRENCY, (m) => show(m.name))
      const discoveredAt = new Date().toISOString()
      return models.map((m, i) => {
        const facts = shows[i]
        const reasoning = ollamaReasoningFromShow(facts, discoveredAt)
        return toModelInfo(m, {
          ...(facts?.capabilities ? { supportsTools: facts.capabilities.includes('tools') } : {}),
          metadata: { discoveredAt, ...(reasoning ? { reasoning } : {}) },
        })
      })
    },

    /** Non-streaming chat completion */
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const body: any = {
        model: request.model || 'llama3.2',
        messages: toOllamaMessages(request.messages, request.system),
        stream: false,
      }
      if (request.tools?.length) body.tools = toOllamaTools(request.tools)
      applyOllamaOptions(body, request)

      // Stop aborts the in-flight generation (the fetch rejects with an abort).
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      })
      if (!res.ok) throw new Error(`Ollama /api/chat failed: ${res.status}`)
      const raw = (await res.json()) as OllamaChatResponse
      // `model` stays the id EYAS asked for; Ollama's model field is what answered.
      return withResolvedModel(fromOllamaResponse(raw, 'ollama'), body.model, raw.model)
    },

    /** Streaming chat completion */
    async *stream(request: ModelRequest): AsyncIterable<ContractStreamEvent> {
      const body: any = {
        model: request.model || 'llama3.2',
        messages: toOllamaMessages(request.messages, request.system),
        stream: true,
      }
      if (request.tools?.length) body.tools = toOllamaTools(request.tools)
      applyOllamaOptions(body, request)

      const signal = request.signal
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      })
      if (!res.ok) throw new Error(`Ollama /api/chat stream failed: ${res.status}`)

      const contentBlocks: ContentBlock[] = []
      let currentText = ''
      const model = request.model || 'llama3.2'
      // The model Ollama reports answering (any chunk's model field).
      let reportedModel: unknown
      // The final (done) chunk carries the counts and the done_reason.
      let finalChunk: OllamaChatResponse | undefined

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // Stop cancels the reader, so a pending read returns at once and the
      // local generation is torn down instead of running to completion.
      const onAbort = () => { reader.cancel().catch(() => {}) }
      signal?.addEventListener('abort', onAbort, { once: true })
      let finished = false

      try {
        while (true) {
          if (signal?.aborted) throw ollamaAbortError(signal)
          const { done, value } = await reader.read()
          // A cancelled read reports done: that is the Stop, not the answer's end.
          if (signal?.aborted) throw ollamaAbortError(signal)
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            const chunk = JSON.parse(line) as OllamaChatResponse
            if (chunk.model) reportedModel = chunk.model

            // The reasoning trace streams in its own field, before the
            // answer: a thinking event, never part of the answer text.
            if (chunk.message?.thinking) {
              yield { type: 'thinking', text: chunk.message.thinking }
            }

            if (chunk.message?.content) {
              currentText += chunk.message.content
              yield { type: 'text', text: chunk.message.content }
            }

            if (chunk.message?.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                const id = `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                // The row settles on the runner's tool_result, after the call ran.
                yield { type: 'tool_use_start', id, name: tc.function.name }
                yield { type: 'tool_use_input', delta: JSON.stringify(tc.function.arguments) }
                contentBlocks.push({
                  type: 'tool_use',
                  id,
                  name: tc.function.name,
                  input: tc.function.arguments as Record<string, unknown>,
                })
              }
            }

            if (chunk.done) finalChunk = chunk
          }
        }
        finished = true
      } finally {
        signal?.removeEventListener('abort', onAbort)
        // A consumer that stopped early (or a failed parse) must not leave
        // the HTTP stream — and the local generation — running.
        if (!finished) reader.cancel().catch(() => {})
      }

      if (currentText) contentBlocks.push({ type: 'text', text: currentText })

      yield {
        type: 'done',
        response: {
          id: `ollama-${Date.now()}`,
          provider: 'ollama',
          model,
          ...resolvedModelField(reportedModel),
          content: contentBlocks,
          stopReason: normalizeStopReason('ollama', finalChunk?.done_reason, contentBlocks),
          usage: fromOllamaUsage(finalChunk),
        },
      }
    },

    /** Generate embeddings */
    async embed(model: string, text: string): Promise<number[]> {
      const res = await fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
      })
      if (!res.ok) throw new Error(`Ollama /api/embed failed: ${res.status}`)
      const data = (await res.json()) as OllamaEmbedResponse
      return data.embeddings[0] || []
    },
  }
}

// ─── Helpers ────────────────────────────────────

/**
 * think (from the gateway's effort plan), temperature, num_predict and (when
 * the request needs more than the default) num_ctx. Thinking tokens count
 * against num_predict, so an explicit level raises a smaller cap to the
 * output the level needs (plan.maxTokensFloor, already within the model's
 * output limit).
 */
function applyOllamaOptions(
  body: { messages: OllamaChatMessage[]; tools?: unknown[]; options?: Record<string, unknown>; think?: boolean | string },
  request: ModelRequest,
): void {
  const plan = request.effortPlan
  const think = ollamaThink(plan)
  if (think !== undefined) body.think = think
  if (request.temperature !== undefined && !plan?.samplingLocked) {
    body.options = { ...body.options, temperature: request.temperature }
  }
  const floor = think !== undefined && think !== false ? plan?.maxTokensFloor : undefined
  const maxTokens = request.maxTokens && typeof floor === 'number' && floor > request.maxTokens ? floor : request.maxTokens
  if (maxTokens) {
    body.options = { ...body.options, num_predict: maxTokens }
  }
  const numCtx = ollamaNumCtx(body.messages, body.tools, maxTokens, request.contextWindow)
  if (numCtx !== undefined) {
    body.options = { ...body.options, num_ctx: numCtx }
  }
}

/**
 * The error a Stop surfaces as: the signal's own abort/timeout reason when it
 * carries one, otherwise an AbortError — both classify as 'aborted' (or
 * 'timeout'), never as a retryable failure.
 */
function ollamaAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error && (reason.name === 'AbortError' || reason.name === 'TimeoutError')) return reason
  const err = new Error('Ollama request aborted')
  err.name = 'AbortError'
  return err
}

function parseParamSize(size: string): number {
  const match = size.match(/([\d.]+)\s*([BM])/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  return match[2].toUpperCase() === 'B' ? num * 1e9 : num * 1e6
}

function estimateContextWindow(sizeB: number): number {
  if (sizeB >= 70e9) return 128000
  if (sizeB >= 13e9) return 32768
  if (sizeB >= 7e9) return 8192
  return 4096
}

function estimateMaxOutput(sizeB: number): number {
  if (sizeB >= 70e9) return 8192
  if (sizeB >= 13e9) return 4096
  return 2048
}

function isVisionModel(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('llava') || lower.includes('vision') || lower.includes('bakllava')
}
