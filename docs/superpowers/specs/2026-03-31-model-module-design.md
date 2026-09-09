# Model Module Design

> EYAS 1.0 — Unified AI provider gateway with multi-provider support

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| SDK usage | Provider-specific SDKs (@anthropic-ai/sdk, openai, @google/genai) | Typed, maintained, handles streaming/retries |
| Model selection | Explicit (provider+model) with routing later | MVP simplicity, routing is additive |
| Provider registration | Submodule pattern | Spec-conformant, independently toggleable, own settings page later |
| Streaming | `complete()` + `stream()` both available | Caller chooses; complete() can use stream() internally |
| Tool use | Yes, in MVP | Core to agent module, defines the message type system |
| Message format | Own abstraction with per-provider adapters | No vendor lock-in, richest common denominator |
| Providers | Anthropic, OpenAI, OpenRouter, Gemini | Covers main AI providers; OpenRouter reuses OpenAI SDK |

## Message Type System

All modules communicate with the model gateway using these provider-agnostic types.

### Content Blocks

```typescript
interface TextBlock {
  type: 'text'
  text: string
}

interface ImageBlock {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    mediaType: string
    data: string
  }
}

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
}

type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock
```

### Messages

```typescript
type ModelRole = 'user' | 'assistant'

interface ModelMessage {
  role: ModelRole
  content: string | ContentBlock[]
}
```

`content` as string is shorthand for `[{ type: 'text', text: '...' }]`.

### Tool Definitions

```typescript
interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>  // JSON Schema
}
```

### Request

```typescript
interface ModelRequest {
  provider?: string           // 'anthropic' | 'openai' | 'openrouter' | 'gemini'
  model?: string              // 'claude-sonnet-4-5-20250514' | 'gpt-4o' | 'gemini-2.0-flash'
  messages: ModelMessage[]
  system?: string
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  stopSequences?: string[]
}
```

If `provider` is omitted but `model` is given, the gateway looks up which provider owns that model. If both are omitted, an error is thrown (no default routing in MVP).

### Response

```typescript
interface ModelResponse {
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
```

### Stream Events

```typescript
type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_input'; delta: string }
  | { type: 'tool_use_end' }
  | { type: 'done'; response: ModelResponse }
  | { type: 'error'; error: Error }
```

## AIProvider Interface

Every provider submodule implements this interface.

```typescript
interface AIProvider {
  id: string                          // 'anthropic', 'openai', 'openrouter', 'gemini'
  name: string                        // 'Anthropic Claude API'

  listModels(): Promise<ModelInfo[]>

  complete(request: ModelRequest): Promise<ModelResponse>
  stream(request: ModelRequest): AsyncIterable<StreamEvent>
}

interface ModelInfo {
  id: string                          // 'claude-sonnet-4-5-20250514'
  name: string                        // 'Claude Sonnet 4.5'
  provider: string                    // 'anthropic'
  contextWindow: number               // 200000
  maxOutputTokens: number             // 8192
  supportsTools: boolean
  supportsImages: boolean
  supportsStreaming: boolean
}
```

## ModelGateway

Single entry point exposed on `ModuleContext` as `ctx.model`.

```typescript
interface ModelGateway {
  // Provider management
  registerProvider(provider: AIProvider): void
  getProvider(id: string): AIProvider | undefined
  listProviders(): AIProvider[]
  listAllModels(): Promise<ModelInfo[]>

  // Core — dispatches to the correct provider
  complete(request: ModelRequest): Promise<ModelResponse>
  stream(request: ModelRequest): AsyncIterable<StreamEvent>
}
```

### Dispatch logic

1. If `request.provider` is set → use that provider directly
2. If only `request.model` is set → scan all providers' model lists, use the first match
3. If neither is set → throw error (no default routing in MVP)

## Module Structure

```
src/modules/model/
  types.ts                    ← All interfaces above
  gateway.ts                  ← ModelGateway implementation
  helpers.ts                  ← contentToText(), normalizeMessages()
  routes.ts                   ← /api/v1/model/* endpoints
  index.ts                    ← EyasModule implementation

  submodules/
    anthropic/
      manifest.ts             ← SubmoduleManifest
      provider.ts             ← AIProvider using @anthropic-ai/sdk
      adapter.ts              ← ModelMessage ↔ Anthropic SDK format

    openai/
      manifest.ts
      provider.ts             ← AIProvider using openai SDK
      adapter.ts              ← ModelMessage ↔ OpenAI chat format

    openrouter/
      manifest.ts
      provider.ts             ← AIProvider using openai SDK with custom baseURL
      adapter.ts              ← Extends OpenAI adapter with extra headers

    gemini/
      manifest.ts
      provider.ts             ← AIProvider using @google/genai SDK
      adapter.ts              ← ModelMessage ↔ Gemini format
```

### Submodule manifest pattern

Each submodule follows the existing `SubmoduleManifest` interface from `core/types.ts`:

```typescript
const anthropicManifest: SubmoduleManifest = {
  id: 'model.anthropic',
  name: 'Anthropic Claude API',
  parentModule: 'model',
  enabled: true,               // default; can be overridden in config
  async onStart(ctx) {
    const apiKey = await ctx.secrets.get('anthropic-api-key', 'system')
    if (!apiKey) {
      ctx.logger.warn('Anthropic provider skipped — no API key in secrets')
      return
    }
    const provider = createAnthropicProvider(apiKey)
    ctx.model.registerProvider(provider)
    ctx.logger.info('Anthropic provider registered')
  }
}
```

### API key resolution

Each provider reads its API key from the secrets vault at startup:

| Provider | Secret name | Notes |
|----------|-------------|-------|
| Anthropic | `anthropic-api-key` | Required for Claude models |
| OpenAI | `openai-api-key` | Required for GPT models |
| OpenRouter | `openrouter-api-key` | Required for OpenRouter |
| Gemini | `gemini-api-key` | Required for Gemini models |

All secrets are scoped as `system` — available to all agents and users.

### Config-based enable/disable

```yaml
modules:
  model:
    submodules:
      anthropic: true
      openai: true
      openrouter: false
      gemini: true
```

A submodule is active only if: (1) enabled in config AND (2) API key exists in secrets.

## REST API Endpoints

All endpoints require authentication (owner/admin/agent).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/model/providers` | List active providers (id, name, model count) |
| GET | `/api/v1/model/providers/:id` | Provider details + available models |
| GET | `/api/v1/model/models` | All models from all active providers |
| POST | `/api/v1/model/complete` | Synchronous completion |
| POST | `/api/v1/model/stream` | Streaming SSE response |

### POST /api/v1/model/complete

Request body matches `ModelRequest`:
```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250514",
  "messages": [{ "role": "user", "content": "Hello" }],
  "system": "You are a helpful assistant.",
  "maxTokens": 1024
}
```

Response body matches `ModelResponse`:
```json
{
  "id": "msg_01...",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250514",
  "content": [{ "type": "text", "text": "Hello! How can I help?" }],
  "stopReason": "end",
  "usage": { "inputTokens": 12, "outputTokens": 8 }
}
```

### POST /api/v1/model/stream

Same request body. Response is `text/event-stream` (SSE):
```
data: {"type":"text","text":"Hello"}
data: {"type":"text","text":"! How can"}
data: {"type":"text","text":" I help?"}
data: {"type":"done","response":{...}}
```

## Bootstrap Changes

### ModuleContext extension

```typescript
interface ModuleContext {
  // ... existing fields ...
  model: ModelGateway
}
```

### Module registration order

```
1. setup
2. secrets     (depends: setup)
3. permissions
4. model       (depends: secrets)
5. auth        (depends: permissions, setup, secrets)
```

The model module depends on `secrets` for API key retrieval. It does NOT depend on auth — the routes are protected by the auth middleware registered by the auth module (same pattern as secrets routes).

## Dependencies

| Package | License | Provider |
|---------|---------|----------|
| `@anthropic-ai/sdk` | MIT | Anthropic Claude API |
| `openai` | Apache-2.0 | OpenAI + OpenRouter |
| `@google/genai` | Apache-2.0 | Gemini |

All licenses are MIT-compatible (MIT, Apache-2.0).

OpenRouter uses the `openai` SDK with `baseURL: 'https://openrouter.ai/api/v1'` — no additional dependency.

## Adapter Pattern

Each provider has an `adapter.ts` that converts between EYAS types and SDK-native types.

### Adapter interface (informal)

```typescript
// Each adapter exports:
function toNativeMessages(messages: ModelMessage[], system?: string): NativeFormat
function fromNativeResponse(response: NativeResponse): ModelResponse
function toNativeTools(tools: ToolDefinition[]): NativeToolFormat
function mapStreamEvent(event: NativeStreamEvent): StreamEvent | null
```

### Key adapter differences

| Feature | Anthropic | OpenAI/OpenRouter | Gemini |
|---------|-----------|-------------------|--------|
| System message | Separate `system` param | First message role: 'system' | `systemInstruction` param |
| Tool results | `tool_result` content block | `tool` role message | `functionResponse` part |
| Image format | base64 in content block | base64 or URL in content | `inlineData` part |
| Stream format | Server-sent events | Server-sent events | Server-sent events |

## Testing Strategy

- **Gateway tests**: Provider dispatch (by provider, by model, error on missing), mock providers
- **Adapter tests**: Message conversion roundtrips, tool use conversion, image handling — pure functions, no API calls
- **Provider tests**: SDK call construction verified with mock SDK instances, stream event parsing
- **Route tests**: Auth enforcement, request validation, SSE format
- **No live API tests**: All tests use mocked SDK responses

## Not In Scope (future phases)

- Decision engine / routing strategies
- Budget tracking / cost enforcement
- Response caching
- Request queue / rate limiting
- Token counting analytics / cost dashboard
- Function binding configuration
- Automatic complexity classification
- Prompt caching optimization
- Self-learning feedback loop
