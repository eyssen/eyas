# Model Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified AI provider gateway with Anthropic, OpenAI, OpenRouter, and Gemini providers — single entry point for all AI calls with streaming and tool use support.

**Architecture:** A `model` core module exposes `ctx.model: ModelGateway` on `ModuleContext`. Each AI provider is a submodule under `model/submodules/` implementing the `AIProvider` interface. Provider-agnostic message types (`ModelMessage`, `ModelRequest`, `ModelResponse`, `StreamEvent`) with per-provider adapters handle SDK format conversion. Routes expose REST + SSE endpoints for frontend/CLI access.

**Tech Stack:** @anthropic-ai/sdk (MIT), openai (Apache-2.0), @google/genai (Apache-2.0), Hono SSE

**Spec:** `docs/superpowers/specs/2026-03-31-model-module-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/modules/model/types.ts` | All interfaces: ContentBlock, ModelMessage, ModelRequest, ModelResponse, StreamEvent, AIProvider, ModelInfo, ModelGateway |
| `src/modules/model/gateway.ts` | ModelGateway implementation — provider registry + dispatch |
| `src/modules/model/helpers.ts` | contentToText(), normalizeContent() utilities |
| `src/modules/model/routes.ts` | `/api/v1/model/*` REST + SSE endpoints |
| `src/modules/model/index.ts` | EyasModule — registers submodules, wires ctx.model |
| `src/modules/model/submodules/anthropic/manifest.ts` | SubmoduleManifest |
| `src/modules/model/submodules/anthropic/provider.ts` | AIProvider using @anthropic-ai/sdk |
| `src/modules/model/submodules/anthropic/adapter.ts` | ModelMessage ↔ Anthropic SDK format |
| `src/modules/model/submodules/openai/manifest.ts` | SubmoduleManifest |
| `src/modules/model/submodules/openai/provider.ts` | AIProvider using openai SDK |
| `src/modules/model/submodules/openai/adapter.ts` | ModelMessage ↔ OpenAI chat format |
| `src/modules/model/submodules/openrouter/manifest.ts` | SubmoduleManifest |
| `src/modules/model/submodules/openrouter/provider.ts` | AIProvider using openai SDK with custom baseURL |
| `src/modules/model/submodules/openrouter/adapter.ts` | Reexports OpenAI adapter |
| `src/modules/model/submodules/gemini/manifest.ts` | SubmoduleManifest |
| `src/modules/model/submodules/gemini/provider.ts` | AIProvider using @google/genai |
| `src/modules/model/submodules/gemini/adapter.ts` | ModelMessage ↔ Gemini format |
| `tests/modules/model/types.test.ts` | Type guard tests |
| `tests/modules/model/gateway.test.ts` | Gateway dispatch tests with mock providers |
| `tests/modules/model/helpers.test.ts` | Helper utility tests |
| `tests/modules/model/adapters/anthropic.test.ts` | Anthropic adapter conversion tests |
| `tests/modules/model/adapters/openai.test.ts` | OpenAI adapter conversion tests |
| `tests/modules/model/adapters/gemini.test.ts` | Gemini adapter conversion tests |
| `tests/modules/model/routes.test.ts` | Route tests with mock gateway |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add @anthropic-ai/sdk, openai, @google/genai |
| `src/core/types.ts` | Add `model: ModelGateway` to `ModuleContext` |
| `src/core/bootstrap.ts` | Create ModelGateway, register model module |
| `src/modules/auth/index.ts` | Register model routes auth middleware |

---

## Task 1: Install SDKs + Types + Helpers

**Files:**
- Modify: `package.json`
- Create: `src/modules/model/types.ts`
- Create: `src/modules/model/helpers.ts`
- Create: `tests/modules/model/helpers.test.ts`

- [ ] **Step 1: Install SDKs**

```bash
cd /Users/eyssen/GitHub/eyas && bun add @anthropic-ai/sdk openai @google/genai
```

Verify licenses:
```bash
for pkg in @anthropic-ai/sdk openai @google/genai; do echo "$pkg: $(cat node_modules/$pkg/package.json | grep '"license"')"; done
```

Expected: MIT, Apache-2.0, Apache-2.0.

- [ ] **Step 2: Create types**

Create `src/modules/model/types.ts`:

```typescript
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

export interface ModelRequest {
  provider?: string
  model?: string
  messages: ModelMessage[]
  system?: string
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  stopSequences?: string[]
}

export interface ModelResponse {
  id: string
  provider: string
  model: string
  content: ContentBlock[]
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

// ─── Streaming ─────────────────────────────────

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_input'; delta: string }
  | { type: 'tool_use_end' }
  | { type: 'done'; response: ModelResponse }
  | { type: 'error'; error: Error }

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
}

export interface AIProvider {
  id: string
  name: string
  listModels(): Promise<ModelInfo[]>
  complete(request: ModelRequest): Promise<ModelResponse>
  stream(request: ModelRequest): AsyncIterable<StreamEvent>
}

// ─── Gateway ───────────────────────────────────

export interface ModelGateway {
  registerProvider(provider: AIProvider): void
  getProvider(id: string): AIProvider | undefined
  listProviders(): AIProvider[]
  listAllModels(): Promise<ModelInfo[]>
  complete(request: ModelRequest): Promise<ModelResponse>
  stream(request: ModelRequest): AsyncIterable<StreamEvent>
}
```

- [ ] **Step 3: Create helpers**

Create `src/modules/model/helpers.ts`:

```typescript
import type { ContentBlock, ModelMessage } from './types.js'

export function contentToText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
}

export function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}
```

- [ ] **Step 4: Write helper tests**

Create `tests/modules/model/helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { contentToText, normalizeContent } from '@modules/model/helpers'

describe('contentToText', () => {
  it('returns string content as-is', () => {
    expect(contentToText('hello')).toBe('hello')
  })

  it('extracts text from content blocks', () => {
    expect(contentToText([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ])).toBe('hello world')
  })

  it('ignores non-text blocks', () => {
    expect(contentToText([
      { type: 'text', text: 'before ' },
      { type: 'tool_use', id: 't1', name: 'fn', input: {} },
      { type: 'text', text: 'after' },
    ])).toBe('before after')
  })

  it('returns empty string for empty blocks', () => {
    expect(contentToText([])).toBe('')
  })
})

describe('normalizeContent', () => {
  it('wraps string in text block', () => {
    expect(normalizeContent('hello')).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('returns blocks unchanged', () => {
    const blocks = [{ type: 'text' as const, text: 'hi' }]
    expect(normalizeContent(blocks)).toBe(blocks)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/model/helpers.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 6: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All existing 187 + 5 new = 192 tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock src/modules/model/types.ts src/modules/model/helpers.ts tests/modules/model/helpers.test.ts
git commit -m "feat(model): add types, helpers, and install AI provider SDKs"
```

---

## Task 2: ModelGateway Implementation

**Files:**
- Create: `src/modules/model/gateway.ts`
- Create: `tests/modules/model/gateway.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/model/gateway.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createModelGateway } from '@modules/model/gateway'
import type { AIProvider, ModelGateway, ModelRequest, ModelResponse, StreamEvent, ModelInfo } from '@modules/model/types'

function createMockProvider(id: string, models: ModelInfo[]): AIProvider {
  return {
    id,
    name: `Mock ${id}`,
    async listModels() { return models },
    async complete(req: ModelRequest): Promise<ModelResponse> {
      return {
        id: `resp-${id}`,
        provider: id,
        model: req.model || models[0].id,
        content: [{ type: 'text', text: `Response from ${id}` }],
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
    async *stream(req: ModelRequest): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: `Stream from ${id}` }
      yield {
        type: 'done',
        response: {
          id: `resp-${id}`,
          provider: id,
          model: req.model || models[0].id,
          content: [{ type: 'text', text: `Stream from ${id}` }],
          stopReason: 'end',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
    },
  }
}

const mockModelA: ModelInfo = {
  id: 'model-a', name: 'Model A', provider: 'provider-a',
  contextWindow: 100000, maxOutputTokens: 4096,
  supportsTools: true, supportsImages: true, supportsStreaming: true,
}

const mockModelB: ModelInfo = {
  id: 'model-b', name: 'Model B', provider: 'provider-b',
  contextWindow: 50000, maxOutputTokens: 2048,
  supportsTools: false, supportsImages: false, supportsStreaming: true,
}

let gateway: ModelGateway

beforeEach(() => {
  gateway = createModelGateway()
})

describe('ModelGateway', () => {
  describe('provider management', () => {
    it('registers and retrieves a provider', () => {
      const provider = createMockProvider('provider-a', [mockModelA])
      gateway.registerProvider(provider)
      expect(gateway.getProvider('provider-a')).toBe(provider)
    })

    it('lists registered providers', () => {
      gateway.registerProvider(createMockProvider('a', []))
      gateway.registerProvider(createMockProvider('b', []))
      expect(gateway.listProviders()).toHaveLength(2)
    })

    it('returns undefined for unknown provider', () => {
      expect(gateway.getProvider('unknown')).toBeUndefined()
    })

    it('lists all models from all providers', async () => {
      gateway.registerProvider(createMockProvider('a', [mockModelA]))
      gateway.registerProvider(createMockProvider('b', [mockModelB]))
      const models = await gateway.listAllModels()
      expect(models).toHaveLength(2)
      expect(models.map(m => m.id)).toContain('model-a')
      expect(models.map(m => m.id)).toContain('model-b')
    })
  })

  describe('dispatch by provider', () => {
    it('dispatches to named provider', async () => {
      gateway.registerProvider(createMockProvider('provider-a', [mockModelA]))
      const resp = await gateway.complete({
        provider: 'provider-a',
        model: 'model-a',
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(resp.provider).toBe('provider-a')
    })

    it('throws for unknown provider', async () => {
      await expect(gateway.complete({
        provider: 'unknown',
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('Provider not found: unknown')
    })
  })

  describe('dispatch by model', () => {
    it('finds provider by model name', async () => {
      gateway.registerProvider(createMockProvider('provider-a', [mockModelA]))
      gateway.registerProvider(createMockProvider('provider-b', [mockModelB]))
      const resp = await gateway.complete({
        model: 'model-b',
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(resp.provider).toBe('provider-b')
    })

    it('throws for unknown model', async () => {
      gateway.registerProvider(createMockProvider('a', [mockModelA]))
      await expect(gateway.complete({
        model: 'nonexistent',
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('No provider found for model: nonexistent')
    })
  })

  describe('dispatch with neither provider nor model', () => {
    it('throws error', async () => {
      gateway.registerProvider(createMockProvider('a', [mockModelA]))
      await expect(gateway.complete({
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('Either provider or model must be specified')
    })
  })

  describe('streaming', () => {
    it('streams from named provider', async () => {
      gateway.registerProvider(createMockProvider('provider-a', [mockModelA]))
      const events: StreamEvent[] = []
      for await (const event of gateway.stream({
        provider: 'provider-a',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        events.push(event)
      }
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('text')
      expect(events[1].type).toBe('done')
    })
  })
})
```

- [ ] **Step 2: Implement gateway**

Create `src/modules/model/gateway.ts`:

```typescript
import type { AIProvider, ModelGateway, ModelRequest, ModelResponse, ModelInfo, StreamEvent } from './types.js'

export function createModelGateway(): ModelGateway {
  const providers = new Map<string, AIProvider>()
  let modelCache: Map<string, string> | null = null

  async function resolveProvider(request: ModelRequest): Promise<AIProvider> {
    if (request.provider) {
      const provider = providers.get(request.provider)
      if (!provider) throw new Error(`Provider not found: ${request.provider}`)
      return provider
    }

    if (request.model) {
      // Rebuild cache if needed
      if (!modelCache) {
        modelCache = new Map()
        for (const [providerId, provider] of providers) {
          const models = await provider.listModels()
          for (const model of models) {
            modelCache.set(model.id, providerId)
          }
        }
      }
      const providerId = modelCache.get(request.model)
      if (providerId) {
        return providers.get(providerId)!
      }
      throw new Error(`No provider found for model: ${request.model}`)
    }

    throw new Error('Either provider or model must be specified')
  }

  return {
    registerProvider(provider: AIProvider) {
      providers.set(provider.id, provider)
      modelCache = null // invalidate cache
    },

    getProvider(id: string) {
      return providers.get(id)
    },

    listProviders() {
      return Array.from(providers.values())
    },

    async listAllModels(): Promise<ModelInfo[]> {
      const allModels: ModelInfo[] = []
      for (const provider of providers.values()) {
        const models = await provider.listModels()
        allModels.push(...models)
      }
      return allModels
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const provider = await resolveProvider(request)
      return provider.complete(request)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const provider = await resolveProvider(request)
      yield* provider.stream(request)
    },
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/model/gateway.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/model/gateway.ts tests/modules/model/gateway.test.ts
git commit -m "feat(model): add ModelGateway with provider dispatch by name and model"
```

---

## Task 3: Anthropic Adapter + Provider

**Files:**
- Create: `src/modules/model/submodules/anthropic/adapter.ts`
- Create: `src/modules/model/submodules/anthropic/provider.ts`
- Create: `src/modules/model/submodules/anthropic/manifest.ts`
- Create: `tests/modules/model/adapters/anthropic.test.ts`

- [ ] **Step 1: Write adapter tests**

Create `tests/modules/model/adapters/anthropic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  toAnthropicMessages,
  toAnthropicTools,
  fromAnthropicResponse,
  mapAnthropicStopReason,
} from '@modules/model/submodules/anthropic/adapter'
import type { ModelMessage, ToolDefinition } from '@modules/model/types'

describe('Anthropic adapter', () => {
  describe('toAnthropicMessages', () => {
    it('converts string content', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
      const result = toAnthropicMessages(messages)
      expect(result).toEqual([{ role: 'user', content: 'hello' }])
    })

    it('converts text blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      }]
      const result = toAnthropicMessages(messages)
      expect(result).toEqual([{
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      }])
    })

    it('converts tool_use blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'fn', input: { a: 1 } }],
      }]
      const result = toAnthropicMessages(messages)
      expect(result[0].content).toEqual([{ type: 'tool_use', id: 't1', name: 'fn', input: { a: 1 } }])
    })

    it('converts tool_result blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: 'result' }],
      }]
      const result = toAnthropicMessages(messages)
      expect(result[0].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'result' }])
    })

    it('converts image blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'abc' } }],
      }]
      const result = toAnthropicMessages(messages)
      expect(result[0].content).toEqual([{
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'abc' },
      }])
    })
  })

  describe('toAnthropicTools', () => {
    it('converts tool definitions', () => {
      const tools: ToolDefinition[] = [{
        name: 'search',
        description: 'Search the web',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      }]
      const result = toAnthropicTools(tools)
      expect(result).toEqual([{
        name: 'search',
        description: 'Search the web',
        input_schema: { type: 'object', properties: { q: { type: 'string' } } },
      }])
    })
  })

  describe('mapAnthropicStopReason', () => {
    it('maps end_turn to end', () => {
      expect(mapAnthropicStopReason('end_turn')).toBe('end')
    })
    it('maps tool_use to tool_use', () => {
      expect(mapAnthropicStopReason('tool_use')).toBe('tool_use')
    })
    it('maps max_tokens to max_tokens', () => {
      expect(mapAnthropicStopReason('max_tokens')).toBe('max_tokens')
    })
    it('maps stop_sequence to stop_sequence', () => {
      expect(mapAnthropicStopReason('stop_sequence')).toBe('stop_sequence')
    })
  })

  describe('fromAnthropicResponse', () => {
    it('converts a complete response', () => {
      const raw = {
        id: 'msg_123',
        model: 'claude-sonnet-4-5-20250514',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }
      const result = fromAnthropicResponse(raw as any)
      expect(result).toEqual({
        id: 'msg_123',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250514',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 5 },
      })
    })

    it('converts tool_use blocks in response', () => {
      const raw = {
        id: 'msg_456',
        model: 'claude-sonnet-4-5-20250514',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me search.' },
          { type: 'tool_use', id: 't1', name: 'search', input: { q: 'weather' } },
        ],
        usage: { input_tokens: 20, output_tokens: 15 },
      }
      const result = fromAnthropicResponse(raw as any)
      expect(result.stopReason).toBe('tool_use')
      expect(result.content).toHaveLength(2)
      expect(result.content[1]).toEqual({ type: 'tool_use', id: 't1', name: 'search', input: { q: 'weather' } })
    })
  })
})
```

- [ ] **Step 2: Implement adapter**

Create `src/modules/model/submodules/anthropic/adapter.ts`:

```typescript
import type { ModelMessage, ContentBlock, ToolDefinition, ModelResponse } from '../../types.js'

export function toAnthropicMessages(messages: ModelMessage[]): any[] {
  return messages.map(msg => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content }
    }
    return {
      role: msg.role,
      content: msg.content.map(block => {
        switch (block.type) {
          case 'text':
            return { type: 'text', text: block.text }
          case 'image':
            return {
              type: 'image',
              source: { type: block.source.type, media_type: block.source.mediaType, data: block.source.data },
            }
          case 'tool_use':
            return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
          case 'tool_result':
            return {
              type: 'tool_result',
              tool_use_id: block.toolUseId,
              content: block.content,
              ...(block.isError !== undefined && { is_error: block.isError }),
            }
        }
      }),
    }
  })
}

export function toAnthropicTools(tools: ToolDefinition[]): any[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }))
}

export function mapAnthropicStopReason(reason: string): ModelResponse['stopReason'] {
  switch (reason) {
    case 'end_turn': return 'end'
    case 'tool_use': return 'tool_use'
    case 'max_tokens': return 'max_tokens'
    case 'stop_sequence': return 'stop_sequence'
    default: return 'end'
  }
}

export function fromAnthropicResponse(raw: any): ModelResponse {
  const content: ContentBlock[] = raw.content.map((block: any) => {
    if (block.type === 'text') return { type: 'text', text: block.text }
    if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    return { type: 'text', text: '' }
  })

  return {
    id: raw.id,
    provider: 'anthropic',
    model: raw.model,
    content,
    stopReason: mapAnthropicStopReason(raw.stop_reason),
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
    },
  }
}
```

- [ ] **Step 3: Implement provider**

Create `src/modules/model/submodules/anthropic/provider.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent } from '../../types.js'
import { toAnthropicMessages, toAnthropicTools, fromAnthropicResponse, mapAnthropicStopReason } from './adapter.js'
import type { ContentBlock } from '../../types.js'

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 32000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet 4.5', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 8192, supportsTools: true, supportsImages: true, supportsStreaming: true },
]

export function createAnthropicProvider(apiKey: string): AIProvider {
  const client = new Anthropic({ apiKey })

  return {
    id: 'anthropic',
    name: 'Anthropic Claude API',

    async listModels() {
      return ANTHROPIC_MODELS
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const params: any = {
        model: request.model || 'claude-sonnet-4-5-20250514',
        max_tokens: request.maxTokens || 4096,
        messages: toAnthropicMessages(request.messages),
      }
      if (request.system) params.system = request.system
      if (request.tools?.length) params.tools = toAnthropicTools(request.tools)
      if (request.temperature !== undefined) params.temperature = request.temperature
      if (request.stopSequences?.length) params.stop_sequences = request.stopSequences

      const response = await client.messages.create(params)
      return fromAnthropicResponse(response)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const params: any = {
        model: request.model || 'claude-sonnet-4-5-20250514',
        max_tokens: request.maxTokens || 4096,
        messages: toAnthropicMessages(request.messages),
        stream: true,
      }
      if (request.system) params.system = request.system
      if (request.tools?.length) params.tools = toAnthropicTools(request.tools)
      if (request.temperature !== undefined) params.temperature = request.temperature
      if (request.stopSequences?.length) params.stop_sequences = request.stopSequences

      const stream = await client.messages.create(params) as any

      const contentBlocks: ContentBlock[] = []
      let currentToolId = ''
      let currentToolName = ''
      let currentToolInput = ''
      let model = request.model || 'claude-sonnet-4-5-20250514'
      let msgId = ''
      let inputTokens = 0
      let outputTokens = 0
      let stopReason: ModelResponse['stopReason'] = 'end'

      for await (const event of stream) {
        if (event.type === 'message_start') {
          msgId = event.message.id
          model = event.message.model
          inputTokens = event.message.usage?.input_tokens || 0
        } else if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            // text block start — nothing to emit yet
          } else if (event.content_block.type === 'tool_use') {
            currentToolId = event.content_block.id
            currentToolName = event.content_block.name
            currentToolInput = ''
            yield { type: 'tool_use_start', id: currentToolId, name: currentToolName }
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text }
            // Accumulate for final response
            const lastBlock = contentBlocks[contentBlocks.length - 1]
            if (lastBlock?.type === 'text') {
              lastBlock.text += event.delta.text
            } else {
              contentBlocks.push({ type: 'text', text: event.delta.text })
            }
          } else if (event.delta.type === 'input_json_delta') {
            currentToolInput += event.delta.partial_json
            yield { type: 'tool_use_input', delta: event.delta.partial_json }
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolId) {
            let parsedInput: Record<string, unknown> = {}
            try { parsedInput = JSON.parse(currentToolInput) } catch {}
            contentBlocks.push({ type: 'tool_use', id: currentToolId, name: currentToolName, input: parsedInput })
            currentToolId = ''
            currentToolName = ''
            currentToolInput = ''
            yield { type: 'tool_use_end' }
          }
        } else if (event.type === 'message_delta') {
          stopReason = mapAnthropicStopReason(event.delta.stop_reason)
          outputTokens = event.usage?.output_tokens || 0
        }
      }

      yield {
        type: 'done',
        response: {
          id: msgId,
          provider: 'anthropic',
          model,
          content: contentBlocks,
          stopReason,
          usage: { inputTokens, outputTokens },
        },
      }
    },
  }
}
```

- [ ] **Step 4: Create manifest**

Create `src/modules/model/submodules/anthropic/manifest.ts`:

```typescript
import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createAnthropicProvider } from './provider.js'

export const anthropicManifest: SubmoduleManifest = {
  id: 'model.anthropic',
  name: 'Anthropic Claude API',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    const apiKey = await ctx.secrets.get('anthropic-api-key', 'system')
    if (!apiKey) {
      ctx.logger.warn('Anthropic provider skipped — no API key in secrets')
      return
    }
    const provider = createAnthropicProvider(apiKey)
    ctx.model.registerProvider(provider)
    ctx.logger.info('Anthropic provider registered')
  },
}
```

- [ ] **Step 5: Run adapter tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/model/adapters/anthropic.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 6: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/model/submodules/anthropic/ tests/modules/model/adapters/anthropic.test.ts
git commit -m "feat(model): add Anthropic provider with adapter and streaming"
```

---

## Task 4: OpenAI Adapter + Provider

**Files:**
- Create: `src/modules/model/submodules/openai/adapter.ts`
- Create: `src/modules/model/submodules/openai/provider.ts`
- Create: `src/modules/model/submodules/openai/manifest.ts`
- Create: `tests/modules/model/adapters/openai.test.ts`

- [ ] **Step 1: Write adapter tests**

Create `tests/modules/model/adapters/openai.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  toOpenAIMessages,
  toOpenAITools,
  fromOpenAIResponse,
  mapOpenAIFinishReason,
} from '@modules/model/submodules/openai/adapter'
import type { ModelMessage, ToolDefinition } from '@modules/model/types'

describe('OpenAI adapter', () => {
  describe('toOpenAIMessages', () => {
    it('adds system message at the start', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }]
      const result = toOpenAIMessages(messages, 'Be helpful')
      expect(result[0]).toEqual({ role: 'system', content: 'Be helpful' })
      expect(result[1]).toEqual({ role: 'user', content: 'hi' })
    })

    it('converts tool_use blocks to assistant tool_calls', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Searching...' },
          { type: 'tool_use', id: 'c1', name: 'search', input: { q: 'weather' } },
        ],
      }]
      const result = toOpenAIMessages(messages)
      expect(result[0].role).toBe('assistant')
      expect(result[0].content).toBe('Searching...')
      expect(result[0].tool_calls).toEqual([{
        id: 'c1',
        type: 'function',
        function: { name: 'search', arguments: '{"q":"weather"}' },
      }])
    })

    it('converts tool_result blocks to tool role messages', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'c1', content: '72°F' }],
      }]
      const result = toOpenAIMessages(messages)
      expect(result[0]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '72°F' })
    })
  })

  describe('toOpenAITools', () => {
    it('wraps in function format', () => {
      const tools: ToolDefinition[] = [{
        name: 'search', description: 'Search', inputSchema: { type: 'object' },
      }]
      const result = toOpenAITools(tools)
      expect(result).toEqual([{
        type: 'function',
        function: { name: 'search', description: 'Search', parameters: { type: 'object' } },
      }])
    })
  })

  describe('mapOpenAIFinishReason', () => {
    it('maps stop to end', () => expect(mapOpenAIFinishReason('stop')).toBe('end'))
    it('maps tool_calls to tool_use', () => expect(mapOpenAIFinishReason('tool_calls')).toBe('tool_use'))
    it('maps length to max_tokens', () => expect(mapOpenAIFinishReason('length')).toBe('max_tokens'))
  })

  describe('fromOpenAIResponse', () => {
    it('converts a text response', () => {
      const raw = {
        id: 'chatcmpl-123',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }
      const result = fromOpenAIResponse(raw as any, 'openai')
      expect(result.id).toBe('chatcmpl-123')
      expect(result.provider).toBe('openai')
      expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
      expect(result.stopReason).toBe('end')
    })

    it('converts tool calls in response', () => {
      const raw = {
        id: 'chatcmpl-456',
        model: 'gpt-4o',
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"hi"}' } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 20, completion_tokens: 15 },
      }
      const result = fromOpenAIResponse(raw as any, 'openai')
      expect(result.stopReason).toBe('tool_use')
      expect(result.content).toEqual([
        { type: 'tool_use', id: 'c1', name: 'search', input: { q: 'hi' } },
      ])
    })
  })
})
```

- [ ] **Step 2: Implement adapter**

Create `src/modules/model/submodules/openai/adapter.ts`:

```typescript
import type { ModelMessage, ContentBlock, ToolDefinition, ModelResponse } from '../../types.js'
import { contentToText } from '../../helpers.js'

export function toOpenAIMessages(messages: ModelMessage[], system?: string): any[] {
  const result: any[] = []
  if (system) result.push({ role: 'system', content: system })

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    // Check for tool_result blocks — these become separate 'tool' role messages
    const toolResults = msg.content.filter(b => b.type === 'tool_result')
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        if (tr.type === 'tool_result') {
          result.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content })
        }
      }
      continue
    }

    // Check for tool_use blocks — these become tool_calls on assistant message
    const toolUses = msg.content.filter(b => b.type === 'tool_use')
    const textContent = contentToText(msg.content)
    if (toolUses.length > 0) {
      result.push({
        role: msg.role,
        content: textContent || null,
        tool_calls: toolUses.map(tu => {
          if (tu.type !== 'tool_use') return null
          return {
            id: tu.id,
            type: 'function',
            function: { name: tu.name, arguments: JSON.stringify(tu.input) },
          }
        }).filter(Boolean),
      })
      continue
    }

    // Plain text/image content
    result.push({ role: msg.role, content: textContent })
  }

  return result
}

export function toOpenAITools(tools: ToolDefinition[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }))
}

export function mapOpenAIFinishReason(reason: string): ModelResponse['stopReason'] {
  switch (reason) {
    case 'stop': return 'end'
    case 'tool_calls': return 'tool_use'
    case 'length': return 'max_tokens'
    case 'content_filter': return 'end'
    default: return 'end'
  }
}

export function fromOpenAIResponse(raw: any, providerId: string): ModelResponse {
  const choice = raw.choices[0]
  const content: ContentBlock[] = []

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content })
  }
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(tc.function.arguments) } catch {}
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
    }
  }

  return {
    id: raw.id,
    provider: providerId,
    model: raw.model,
    content,
    stopReason: mapOpenAIFinishReason(choice.finish_reason),
    usage: {
      inputTokens: raw.usage?.prompt_tokens || 0,
      outputTokens: raw.usage?.completion_tokens || 0,
    },
  }
}
```

- [ ] **Step 3: Implement provider**

Create `src/modules/model/submodules/openai/provider.ts`:

```typescript
import OpenAI from 'openai'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock } from '../../types.js'
import { toOpenAIMessages, toOpenAITools, fromOpenAIResponse, mapOpenAIFinishReason } from './adapter.js'

const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', contextWindow: 128000, maxOutputTokens: 4096, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'o3-mini', name: 'o3 Mini', provider: 'openai', contextWindow: 200000, maxOutputTokens: 100000, supportsTools: true, supportsImages: false, supportsStreaming: true },
]

export interface OpenAIProviderOptions {
  apiKey: string
  baseURL?: string
  providerId?: string
  providerName?: string
  models?: ModelInfo[]
  defaultHeaders?: Record<string, string>
}

export function createOpenAIProvider(options: OpenAIProviderOptions): AIProvider {
  const providerId = options.providerId || 'openai'
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL && { baseURL: options.baseURL }),
    ...(options.defaultHeaders && { defaultHeaders: options.defaultHeaders }),
  })
  const models = options.models || OPENAI_MODELS

  return {
    id: providerId,
    name: options.providerName || 'OpenAI',

    async listModels() {
      return models
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const params: any = {
        model: request.model || 'gpt-4o',
        messages: toOpenAIMessages(request.messages, request.system),
      }
      if (request.tools?.length) params.tools = toOpenAITools(request.tools)
      if (request.maxTokens) params.max_tokens = request.maxTokens
      if (request.temperature !== undefined) params.temperature = request.temperature
      if (request.stopSequences?.length) params.stop = request.stopSequences

      const response = await client.chat.completions.create(params)
      return fromOpenAIResponse(response, providerId)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const params: any = {
        model: request.model || 'gpt-4o',
        messages: toOpenAIMessages(request.messages, request.system),
        stream: true,
        stream_options: { include_usage: true },
      }
      if (request.tools?.length) params.tools = toOpenAITools(request.tools)
      if (request.maxTokens) params.max_tokens = request.maxTokens
      if (request.temperature !== undefined) params.temperature = request.temperature
      if (request.stopSequences?.length) params.stop = request.stopSequences

      const stream = await client.chat.completions.create(params) as any

      const contentBlocks: ContentBlock[] = []
      let currentText = ''
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      let msgId = ''
      let model = request.model || 'gpt-4o'
      let inputTokens = 0
      let outputTokens = 0
      let finishReason: ModelResponse['stopReason'] = 'end'

      for await (const chunk of stream) {
        if (chunk.id) msgId = chunk.id
        if (chunk.model) model = chunk.model
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || 0
          outputTokens = chunk.usage.completion_tokens || 0
        }

        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue

        if (chunk.choices[0].finish_reason) {
          finishReason = mapOpenAIFinishReason(chunk.choices[0].finish_reason)
        }

        if (delta.content) {
          currentText += delta.content
          yield { type: 'text', text: delta.content }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCalls.has(tc.index)) {
              toolCalls.set(tc.index, { id: tc.id || '', name: tc.function?.name || '', args: '' })
              if (tc.id) yield { type: 'tool_use_start', id: tc.id, name: tc.function?.name || '' }
            }
            const existing = toolCalls.get(tc.index)!
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name = tc.function.name
            if (tc.function?.arguments) {
              existing.args += tc.function.arguments
              yield { type: 'tool_use_input', delta: tc.function.arguments }
            }
          }
        }
      }

      // Build final content
      if (currentText) contentBlocks.push({ type: 'text', text: currentText })
      for (const tc of toolCalls.values()) {
        let input: Record<string, unknown> = {}
        try { input = JSON.parse(tc.args) } catch {}
        contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
        yield { type: 'tool_use_end' }
      }

      yield {
        type: 'done',
        response: { id: msgId, provider: providerId, model, content: contentBlocks, stopReason: finishReason, usage: { inputTokens, outputTokens } },
      }
    },
  }
}
```

- [ ] **Step 4: Create manifest**

Create `src/modules/model/submodules/openai/manifest.ts`:

```typescript
import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createOpenAIProvider } from './provider.js'

export const openaiManifest: SubmoduleManifest = {
  id: 'model.openai',
  name: 'OpenAI',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    const apiKey = await ctx.secrets.get('openai-api-key', 'system')
    if (!apiKey) {
      ctx.logger.warn('OpenAI provider skipped — no API key in secrets')
      return
    }
    const provider = createOpenAIProvider({ apiKey })
    ctx.model.registerProvider(provider)
    ctx.logger.info('OpenAI provider registered')
  },
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/model/adapters/openai.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 6: Run all tests + commit**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
git add src/modules/model/submodules/openai/ tests/modules/model/adapters/openai.test.ts
git commit -m "feat(model): add OpenAI provider with adapter and streaming"
```

---

## Task 5: OpenRouter Provider (reuses OpenAI adapter)

**Files:**
- Create: `src/modules/model/submodules/openrouter/adapter.ts`
- Create: `src/modules/model/submodules/openrouter/provider.ts`
- Create: `src/modules/model/submodules/openrouter/manifest.ts`

- [ ] **Step 1: Create adapter (reexport)**

Create `src/modules/model/submodules/openrouter/adapter.ts`:

```typescript
// OpenRouter uses the OpenAI-compatible API format
export { toOpenAIMessages, toOpenAITools, fromOpenAIResponse, mapOpenAIFinishReason } from '../openai/adapter.js'
```

- [ ] **Step 2: Create provider**

Create `src/modules/model/submodules/openrouter/provider.ts`:

```typescript
import { createOpenAIProvider } from '../openai/provider.js'
import type { AIProvider, ModelInfo } from '../../types.js'

const OPENROUTER_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (OpenRouter)', provider: 'openrouter', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)', provider: 'openrouter', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (OpenRouter)', provider: 'openrouter', contextWindow: 1048576, maxOutputTokens: 8192, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B (OpenRouter)', provider: 'openrouter', contextWindow: 131072, maxOutputTokens: 4096, supportsTools: true, supportsImages: false, supportsStreaming: true },
]

export function createOpenRouterProvider(apiKey: string): AIProvider {
  return createOpenAIProvider({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    models: OPENROUTER_MODELS,
    defaultHeaders: {
      'HTTP-Referer': 'https://eyas.app',
      'X-Title': 'EYAS',
    },
  })
}
```

- [ ] **Step 3: Create manifest**

Create `src/modules/model/submodules/openrouter/manifest.ts`:

```typescript
import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createOpenRouterProvider } from './provider.js'

export const openrouterManifest: SubmoduleManifest = {
  id: 'model.openrouter',
  name: 'OpenRouter',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    const apiKey = await ctx.secrets.get('openrouter-api-key', 'system')
    if (!apiKey) {
      ctx.logger.warn('OpenRouter provider skipped — no API key in secrets')
      return
    }
    const provider = createOpenRouterProvider(apiKey)
    ctx.model.registerProvider(provider)
    ctx.logger.info('OpenRouter provider registered')
  },
}
```

- [ ] **Step 4: Run all tests + commit**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
git add src/modules/model/submodules/openrouter/
git commit -m "feat(model): add OpenRouter provider (reuses OpenAI adapter)"
```

---

## Task 6: Gemini Adapter + Provider

**Files:**
- Create: `src/modules/model/submodules/gemini/adapter.ts`
- Create: `src/modules/model/submodules/gemini/provider.ts`
- Create: `src/modules/model/submodules/gemini/manifest.ts`
- Create: `tests/modules/model/adapters/gemini.test.ts`

- [ ] **Step 1: Write adapter tests**

Create `tests/modules/model/adapters/gemini.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  toGeminiContents,
  toGeminiTools,
  fromGeminiResponse,
  mapGeminiFinishReason,
} from '@modules/model/submodules/gemini/adapter'
import type { ModelMessage, ToolDefinition } from '@modules/model/types'

describe('Gemini adapter', () => {
  describe('toGeminiContents', () => {
    it('converts user text message', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
      const result = toGeminiContents(messages)
      expect(result).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }])
    })

    it('converts assistant to model role', () => {
      const messages: ModelMessage[] = [{ role: 'assistant', content: 'hi' }]
      const result = toGeminiContents(messages)
      expect(result[0].role).toBe('model')
    })

    it('converts tool_use to functionCall part', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'weather' } }],
      }]
      const result = toGeminiContents(messages)
      expect(result[0].parts[0]).toEqual({
        functionCall: { name: 'search', args: { q: 'weather' } },
      })
    })

    it('converts tool_result to functionResponse part', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: '72°F' }],
      }]
      const result = toGeminiContents(messages)
      expect(result[0].parts[0]).toEqual({
        functionResponse: { name: 't1', response: { result: '72°F' } },
      })
    })
  })

  describe('toGeminiTools', () => {
    it('wraps in functionDeclarations', () => {
      const tools: ToolDefinition[] = [{
        name: 'search', description: 'Search', inputSchema: { type: 'object', properties: {} },
      }]
      const result = toGeminiTools(tools)
      expect(result).toEqual([{
        functionDeclarations: [{
          name: 'search', description: 'Search', parameters: { type: 'object', properties: {} },
        }],
      }])
    })
  })

  describe('mapGeminiFinishReason', () => {
    it('maps STOP to end', () => expect(mapGeminiFinishReason('STOP')).toBe('end'))
    it('maps MAX_TOKENS to max_tokens', () => expect(mapGeminiFinishReason('MAX_TOKENS')).toBe('max_tokens'))
  })

  describe('fromGeminiResponse', () => {
    it('converts a text response', () => {
      const raw = {
        responseId: 'resp-123',
        candidates: [{
          content: { role: 'model', parts: [{ text: 'Hello!' }] },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        modelVersion: 'gemini-2.0-flash',
      }
      const result = fromGeminiResponse(raw as any)
      expect(result.id).toBe('resp-123')
      expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
      expect(result.stopReason).toBe('end')
    })

    it('converts function calls', () => {
      const raw = {
        responseId: 'resp-456',
        candidates: [{
          content: {
            role: 'model',
            parts: [{ functionCall: { name: 'search', args: { q: 'hi' } } }],
          },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 15 },
        modelVersion: 'gemini-2.0-flash',
      }
      const result = fromGeminiResponse(raw as any)
      expect(result.content[0]).toEqual({
        type: 'tool_use', id: 'gemini-tool-0', name: 'search', input: { q: 'hi' },
      })
    })
  })
})
```

- [ ] **Step 2: Implement adapter**

Create `src/modules/model/submodules/gemini/adapter.ts`:

```typescript
import type { ModelMessage, ContentBlock, ToolDefinition, ModelResponse } from '../../types.js'

export function toGeminiContents(messages: ModelMessage[]): any[] {
  return messages.map(msg => {
    const role = msg.role === 'assistant' ? 'model' : 'user'

    if (typeof msg.content === 'string') {
      return { role, parts: [{ text: msg.content }] }
    }

    const parts: any[] = []
    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          parts.push({ text: block.text })
          break
        case 'image':
          parts.push({
            inlineData: { mimeType: block.source.mediaType, data: block.source.data },
          })
          break
        case 'tool_use':
          parts.push({ functionCall: { name: block.name, args: block.input } })
          break
        case 'tool_result':
          parts.push({
            functionResponse: { name: block.toolUseId, response: { result: block.content } },
          })
          break
      }
    }

    return { role, parts }
  })
}

export function toGeminiTools(tools: ToolDefinition[]): any[] {
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    })),
  }]
}

export function mapGeminiFinishReason(reason: string): ModelResponse['stopReason'] {
  switch (reason) {
    case 'STOP': return 'end'
    case 'MAX_TOKENS': return 'max_tokens'
    case 'SAFETY':
    case 'RECITATION':
    case 'OTHER':
    default: return 'end'
  }
}

export function fromGeminiResponse(raw: any): ModelResponse {
  const candidate = raw.candidates?.[0]
  const content: ContentBlock[] = []

  if (candidate?.content?.parts) {
    let toolIndex = 0
    for (const part of candidate.content.parts) {
      if (part.text) {
        content.push({ type: 'text', text: part.text })
      } else if (part.functionCall) {
        content.push({
          type: 'tool_use',
          id: `gemini-tool-${toolIndex++}`,
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        })
      }
    }
  }

  return {
    id: raw.responseId || '',
    provider: 'gemini',
    model: raw.modelVersion || '',
    content,
    stopReason: mapGeminiFinishReason(candidate?.finishReason || 'STOP'),
    usage: {
      inputTokens: raw.usageMetadata?.promptTokenCount || 0,
      outputTokens: raw.usageMetadata?.candidatesTokenCount || 0,
    },
  }
}
```

- [ ] **Step 3: Implement provider**

Create `src/modules/model/submodules/gemini/provider.ts`:

```typescript
import { GoogleGenAI } from '@google/genai'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock } from '../../types.js'
import { toGeminiContents, toGeminiTools, fromGeminiResponse, mapGeminiFinishReason } from './adapter.js'

const GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', provider: 'gemini', contextWindow: 1048576, maxOutputTokens: 65536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', provider: 'gemini', contextWindow: 1048576, maxOutputTokens: 65536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', contextWindow: 1048576, maxOutputTokens: 8192, supportsTools: true, supportsImages: true, supportsStreaming: true },
]

export function createGeminiProvider(apiKey: string): AIProvider {
  const ai = new GoogleGenAI({ apiKey })

  return {
    id: 'gemini',
    name: 'Google Gemini',

    async listModels() {
      return GEMINI_MODELS
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const config: any = {}
      if (request.system) config.systemInstruction = request.system
      if (request.tools?.length) {
        config.tools = toGeminiTools(request.tools)
      }
      if (request.maxTokens) config.maxOutputTokens = request.maxTokens
      if (request.temperature !== undefined) config.temperature = request.temperature
      if (request.stopSequences?.length) config.stopSequences = request.stopSequences

      const response = await ai.models.generateContent({
        model: request.model || 'gemini-2.0-flash',
        contents: toGeminiContents(request.messages),
        config,
      })
      return fromGeminiResponse(response)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const config: any = {}
      if (request.system) config.systemInstruction = request.system
      if (request.tools?.length) {
        config.tools = toGeminiTools(request.tools)
      }
      if (request.maxTokens) config.maxOutputTokens = request.maxTokens
      if (request.temperature !== undefined) config.temperature = request.temperature
      if (request.stopSequences?.length) config.stopSequences = request.stopSequences

      const stream = await ai.models.generateContentStream({
        model: request.model || 'gemini-2.0-flash',
        contents: toGeminiContents(request.messages),
        config,
      })

      const contentBlocks: ContentBlock[] = []
      let currentText = ''
      let toolIndex = 0
      let responseId = ''
      let modelVersion = ''
      let inputTokens = 0
      let outputTokens = 0
      let finishReason: ModelResponse['stopReason'] = 'end'

      for await (const chunk of stream) {
        if (chunk.responseId) responseId = chunk.responseId
        if (chunk.modelVersion) modelVersion = chunk.modelVersion
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount || 0
          outputTokens = chunk.usageMetadata.candidatesTokenCount || 0
        }

        const candidate = chunk.candidates?.[0]
        if (candidate?.finishReason) {
          finishReason = mapGeminiFinishReason(candidate.finishReason)
        }

        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              currentText += part.text
              yield { type: 'text', text: part.text }
            } else if (part.functionCall) {
              const id = `gemini-tool-${toolIndex++}`
              yield { type: 'tool_use_start', id, name: part.functionCall.name }
              const args = JSON.stringify(part.functionCall.args || {})
              yield { type: 'tool_use_input', delta: args }
              contentBlocks.push({
                type: 'tool_use', id, name: part.functionCall.name, input: part.functionCall.args || {},
              })
              yield { type: 'tool_use_end' }
            }
          }
        }
      }

      if (currentText) contentBlocks.push({ type: 'text', text: currentText })

      yield {
        type: 'done',
        response: { id: responseId, provider: 'gemini', model: modelVersion, content: contentBlocks, stopReason: finishReason, usage: { inputTokens, outputTokens } },
      }
    },
  }
}
```

- [ ] **Step 4: Create manifest**

Create `src/modules/model/submodules/gemini/manifest.ts`:

```typescript
import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createGeminiProvider } from './provider.js'

export const geminiManifest: SubmoduleManifest = {
  id: 'model.gemini',
  name: 'Google Gemini',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    const apiKey = await ctx.secrets.get('gemini-api-key', 'system')
    if (!apiKey) {
      ctx.logger.warn('Gemini provider skipped — no API key in secrets')
      return
    }
    const provider = createGeminiProvider(apiKey)
    ctx.model.registerProvider(provider)
    ctx.logger.info('Gemini provider registered')
  },
}
```

- [ ] **Step 5: Run adapter tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/model/adapters/gemini.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 6: Run all tests + commit**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
git add src/modules/model/submodules/gemini/ tests/modules/model/adapters/gemini.test.ts
git commit -m "feat(model): add Gemini provider with adapter and streaming"
```

---

## Task 7: Model Routes

**Files:**
- Create: `src/modules/model/routes.ts`
- Create: `tests/modules/model/routes.test.ts`

- [ ] **Step 1: Write route tests**

Create `tests/modules/model/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createModelRoutes } from '@modules/model/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import type { AIProvider, ModelGateway, ModelRequest, ModelResponse, StreamEvent, ModelInfo } from '@modules/model/types'

function createMockProvider(): AIProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    async listModels(): Promise<ModelInfo[]> {
      return [{
        id: 'mock-model', name: 'Mock Model', provider: 'mock',
        contextWindow: 100000, maxOutputTokens: 4096,
        supportsTools: true, supportsImages: true, supportsStreaming: true,
      }]
    },
    async complete(): Promise<ModelResponse> {
      return {
        id: 'resp-1', provider: 'mock', model: 'mock-model',
        content: [{ type: 'text', text: 'Mock response' }],
        stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'Mock ' }
      yield { type: 'text', text: 'stream' }
      yield {
        type: 'done',
        response: {
          id: 'resp-1', provider: 'mock', model: 'mock-model',
          content: [{ type: 'text', text: 'Mock stream' }],
          stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
    },
  }
}

const testDb = createTestDb('model-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let gateway: ModelGateway
let ownerToken: string

beforeEach(async () => {
  db = testDb.open()
  gateway = createModelGateway()
  gateway.registerProvider(createMockProvider())
  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

  app = new Hono()
  app.onError(errorHandler)
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })
  createModelRoutes(app, gateway)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => { testDb.cleanup() })

describe('GET /api/v1/model/providers', () => {
  it('lists providers', async () => {
    const res = await app.request('/api/v1/model/providers', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0].id).toBe('mock')
  })

  it('requires auth', async () => {
    const res = await app.request('/api/v1/model/providers')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/model/models', () => {
  it('lists all models', async () => {
    const res = await app.request('/api/v1/model/models', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.models).toHaveLength(1)
    expect(body.models[0].id).toBe('mock-model')
  })
})

describe('POST /api/v1/model/complete', () => {
  it('returns completion', async () => {
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'mock', model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.content[0].text).toBe('Mock response')
  })

  it('validates request body', async () => {
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/model/stream', () => {
  it('returns SSE stream', async () => {
    const res = await app.request('/api/v1/model/stream', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'mock', model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('"type":"text"')
    expect(text).toContain('"type":"done"')
  })
})
```

- [ ] **Step 2: Implement routes**

Create `src/modules/model/routes.ts`:

```typescript
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ModelGateway } from './types.js'

export function createModelRoutes(app: Hono, gateway: ModelGateway): void {
  const router = app as any

  router.get('/api/v1/model/providers', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const providers = gateway.listProviders()
    const result = await Promise.all(providers.map(async p => {
      const models = await p.listModels()
      return { id: p.id, name: p.name, modelCount: models.length }
    }))
    return c.json({ providers: result })
  })

  router.get('/api/v1/model/providers/:id', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const provider = gateway.getProvider(c.req.param('id'))
    if (!provider) throw new HTTPException(404, { message: 'Provider not found' })

    const models = await provider.listModels()
    return c.json({ id: provider.id, name: provider.name, models })
  })

  router.get('/api/v1/model/models', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const models = await gateway.listAllModels()
    return c.json({ models })
  })

  router.post('/api/v1/model/complete', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const body = await c.req.json()
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new HTTPException(400, { message: 'messages array is required' })
    }

    const response = await gateway.complete(body)
    return c.json(response)
  })

  router.post('/api/v1/model/stream', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const body = await c.req.json()
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new HTTPException(400, { message: 'messages array is required' })
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of gateway.stream(body)) {
            controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
          }
        } catch (err: any) {
          controller.enqueue(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`)
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  })
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/model/routes.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 4: Run all tests + commit**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
git add src/modules/model/routes.ts tests/modules/model/routes.test.ts
git commit -m "feat(model): add model REST API routes with SSE streaming"
```

---

## Task 8: Model Module + Bootstrap + Auth Wiring

**Files:**
- Create: `src/modules/model/index.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/bootstrap.ts`
- Modify: `src/modules/auth/index.ts`

- [ ] **Step 1: Add ModelGateway to ModuleContext**

In `src/core/types.ts`, add:
- Import: `import type { ModelGateway } from '@modules/model/types'`
- Field: `model: ModelGateway` to `ModuleContext`

- [ ] **Step 2: Create model module**

Create `src/modules/model/index.ts`:

```typescript
import type { EyasModule, ModuleContext } from '@core/types'
import { createModelGateway } from './gateway.js'
import { createModelRoutes } from './routes.js'
import { anthropicManifest } from './submodules/anthropic/manifest.js'
import { openaiManifest } from './submodules/openai/manifest.js'
import { openrouterManifest } from './submodules/openrouter/manifest.js'
import { geminiManifest } from './submodules/gemini/manifest.js'

export const modelModule: EyasModule = {
  id: 'model',
  name: 'Model Gateway',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Unified AI provider gateway — single entry point for all AI calls',
  dependencies: ['secrets'],
  submodules: [anthropicManifest, openaiManifest, openrouterManifest, geminiManifest],

  async onRegister(ctx: ModuleContext) {
    const gateway = createModelGateway()
    ctx.model = gateway
    ctx.logger.info('Model module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Start submodules — each registers its provider if API key is available
    for (const sub of this.submodules || []) {
      if (sub.enabled && sub.onStart) {
        await sub.onStart(ctx)
      }
    }

    const providerCount = ctx.model.listProviders().length
    if (providerCount === 0) {
      ctx.logger.warn('No AI providers active — add API keys in secrets to enable')
    } else {
      ctx.logger.info(`Model gateway started with ${providerCount} provider(s)`)
    }
  },

  async onStop() {},
}
```

- [ ] **Step 3: Update bootstrap**

In `src/core/bootstrap.ts`:
1. Add imports:
```typescript
import { modelModule } from '@modules/model/index'
import { createModelGateway } from '@modules/model/gateway'
import type { ModelGateway } from '@modules/model/types'
```

2. Create a placeholder ModelGateway before ctx:
```typescript
const modelPlaceholder: ModelGateway = {
  registerProvider() { throw new Error('Model not initialized') },
  getProvider() { return undefined },
  listProviders() { return [] },
  async listAllModels() { return [] },
  async complete() { throw new Error('Model not initialized') },
  async *stream() { throw new Error('Model not initialized') },
}
```

3. Add `model: modelPlaceholder` to ctx object.

4. Register model module after secrets, before auth:
```typescript
if (!moduleLoader.hasModule(modelModule.id)) {
  moduleLoader.register(modelModule)
}
```

- [ ] **Step 4: Wire auth middleware for model routes**

In `src/modules/auth/index.ts`, add import and register auth middleware for model routes:
```typescript
import { createModelRoutes } from '@modules/model/routes'
```

In `onStart`, after `createSecretsRoutes(...)`:
```typescript
// Register model routes AFTER auth routes (so authenticate middleware is applied first)
createModelRoutes(ctx.http, ctx.model)
```

In `src/modules/auth/routes.ts`, add authenticate + CSRF middleware for model routes:
```typescript
router.use('/api/v1/model/*', authenticate)
router.use('/api/v1/model/*', csrfProtection)
```

- [ ] **Step 5: Run TypeScript check**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit
```

- [ ] **Step 6: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/model/index.ts src/core/types.ts src/core/bootstrap.ts src/modules/auth/index.ts src/modules/auth/routes.ts
git commit -m "feat(model): wire model module into bootstrap with submodule providers"
```

---

## Task 9: Full Integration Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All tests pass (187 existing + ~36 new).

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit
```

- [ ] **Step 3: Dev server smoke test**

```bash
cd /Users/eyssen/GitHub/eyas
rm -f data/sqlite/eyas.db data/sqlite/eyas.db-wal data/sqlite/eyas.db-shm data/master.key
bun src/main.ts &
sleep 3

# Setup
curl -s -X POST http://localhost:3000/api/v1/setup/steps/master-password -H "Content-Type: application/json" -d '{"masterPassword":"TestMaster123!","confirmPassword":"TestMaster123!"}'
curl -s -X POST http://localhost:3000/api/v1/setup/steps/root-owner -H "Content-Type: application/json" -d '{"username":"admin","password":"adminpass123","displayName":"Admin"}'
curl -s -X POST http://localhost:3000/api/v1/setup/steps/first-agent -H "Content-Type: application/json" -d '{"name":"jarvis"}'

TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/token -H "Content-Type: application/json" -d '{"username":"admin","password":"adminpass123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# Check providers (should be empty — no API keys yet)
echo "=== Providers ==="
curl -s http://localhost:3000/api/v1/model/providers -H "Authorization: Bearer $TOKEN"

# Check models
echo -e "\n=== Models ==="
curl -s http://localhost:3000/api/v1/model/models -H "Authorization: Bearer $TOKEN"

# Store an API key and restart would be needed for real test
# For now just verify the endpoints work with 0 providers

kill %1
```

- [ ] **Step 4: Fix any issues and commit**

```bash
# Only if fixes needed
git add -A && git commit -m "fix(model): integration smoke test fixes"
```

---

## Summary

| Task | Description | New Tests |
|------|-------------|-----------|
| 1 | Install SDKs + types + helpers | 5 |
| 2 | ModelGateway implementation | 9 |
| 3 | Anthropic adapter + provider | 10 |
| 4 | OpenAI adapter + provider | 9 |
| 5 | OpenRouter provider (reuses OpenAI) | 0 |
| 6 | Gemini adapter + provider | 8 |
| 7 | Model routes (REST + SSE) | 5 |
| 8 | Module + bootstrap + auth wiring | 0 |
| 9 | Smoke test | 0 |

**Total new tests: ~46**
**New dependencies: @anthropic-ai/sdk (MIT), openai (Apache-2.0), @google/genai (Apache-2.0)**
