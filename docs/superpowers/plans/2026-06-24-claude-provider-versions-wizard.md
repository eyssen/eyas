# Claude Provider Model Versions + First-Run Wizard Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh Claude model versions across the CLI + native Anthropic providers (hybrid: stable aliases + accurate caps + dynamic probe + working model pass-through) and extend the first-run wizard to detect Claude and assign each pre-installed agent a suitable model.

**Architecture:** A new pure `tier-resolver` is the shared spine: it maps `agentType → tier → concrete model ID` against whichever providers are actually registered, and normalizes bare aliases. The gateway calls it so any `model` value (bare alias or concrete ID) resolves. Providers get current model IDs/caps; the native Anthropic provider additionally switches to adaptive thinking for 4.6+ models (required, or thinking-on requests 400). The model module registers an optional `ai-models` setup step + a pre-auth read endpoint that drives a new wizard screen.

**Tech Stack:** Bun + TypeScript (strict, ESM), Drizzle/bun:sqlite, Hono, Vitest, Vite + React 19 + TanStack Router, `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`.

## Global Constraints

- **Code & comments in English.** Hungarian only where the spec calls for user-facing HU strings (i18n `hu.json`).
- **eYssen file header** on every new `.ts` file: `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- **Logging:** Pino via `ctx.logger` — never `console.log` in production code.
- **MIT-compatible deps only** — no new dependencies are introduced by this plan.
- **Exact model IDs (never append date suffixes):** `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`. CLI alias IDs stay `claude-code-opus|sonnet|haiku`.
- **Model caps:** Fable5 1M/128K · Opus4.8 1M/128K · Opus4.7 1M/128K · Opus4.6 1M/128K · Sonnet4.6 1M/64K · Haiku4.5 200K/64K.
- **Test command:** `bun vitest run <path>`. **Type-check:** `bunx tsc --noEmit` (root) / web: `cd src/web && bunx tsc --noEmit`.
- **Git policy (user override):** Do **NOT** run `git commit` automatically — commits happen only on explicit user request. Each "Checkpoint" step means: stage the listed files (`git add …`) and pause; the user batches/approves commits. **Never** add `Co-Authored-By` lines. Never create branches or push without explicit request.

---

### Task 1: Tier resolver + alias normalization (pure module)

**Files:**
- Create: `src/modules/model/tier-resolver.ts`
- Test: `tests/modules/model/tier-resolver.test.ts`

**Interfaces:**
- Produces:
  - `type ModelTier = 'opus' | 'sonnet' | 'haiku'`
  - `interface ProviderModels { providerId: string; modelIds: string[] }`
  - `AGENT_TYPE_TIER: Record<string, ModelTier>`
  - `tierForAgentType(agentType: string): ModelTier`
  - `resolveTier(tier: ModelTier, providers: ProviderModels[]): { provider: string; modelId: string } | null`
  - `normalizeModelAlias(model: string, providers: ProviderModels[]): string | undefined`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/modules/model/tier-resolver.test.ts
import { describe, it, expect } from 'vitest'
import {
  tierForAgentType,
  resolveTier,
  normalizeModelAlias,
  type ProviderModels,
} from '@modules/model/tier-resolver.js'

const cc: ProviderModels = { providerId: 'claude-code', modelIds: ['claude-code-opus', 'claude-code-sonnet', 'claude-code-haiku'] }
const anth: ProviderModels = { providerId: 'anthropic', modelIds: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'] }

describe('tier-resolver', () => {
  it('maps agent types to tiers', () => {
    expect(tierForAgentType('reviewer')).toBe('opus')
    expect(tierForAgentType('assistant')).toBe('sonnet')
    expect(tierForAgentType('observer')).toBe('haiku')
    expect(tierForAgentType('unknown-type')).toBe('sonnet') // safe default
  })

  it('prefers claude-code when present', () => {
    expect(resolveTier('opus', [anth, cc])).toEqual({ provider: 'claude-code', modelId: 'claude-code-opus' })
  })

  it('falls back to anthropic when claude-code absent', () => {
    expect(resolveTier('sonnet', [anth])).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' })
  })

  it('returns null when no provider can serve the tier', () => {
    expect(resolveTier('opus', [{ providerId: 'ollama', modelIds: ['llama3'] }])).toBeNull()
  })

  it('normalizes a bare alias to the preferred concrete id', () => {
    expect(normalizeModelAlias('sonnet', [cc, anth])).toBe('claude-code-sonnet')
    expect(normalizeModelAlias('opus', [anth])).toBe('claude-opus-4-8')
  })

  it('passes a valid concrete id through unchanged', () => {
    expect(normalizeModelAlias('claude-sonnet-4-6', [anth])).toBe('claude-sonnet-4-6')
  })

  it('returns undefined for an unresolvable model', () => {
    expect(normalizeModelAlias('gpt-9', [anth])).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/tier-resolver.test.ts`
Expected: FAIL — cannot find module `tier-resolver.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/modules/model/tier-resolver.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Capability tier shared across all Claude-family providers. */
export type ModelTier = 'opus' | 'sonnet' | 'haiku'

/** A provider and the concrete model IDs it currently exposes. */
export interface ProviderModels {
  providerId: string
  modelIds: string[]
}

/** Most-suitable tier per agent type (the wizard's default policy). */
export const AGENT_TYPE_TIER: Record<string, ModelTier> = {
  assistant: 'sonnet',
  engineer: 'opus',
  developer: 'opus',
  reviewer: 'opus',
  critic: 'opus',
  researcher: 'sonnet',
  planner: 'opus',
  coordinator: 'opus',
  observer: 'haiku',
}

/** Concrete model ID per provider for each tier. */
const PROVIDER_TIER_MODEL: Record<string, Record<ModelTier, string>> = {
  'claude-code': { opus: 'claude-code-opus', sonnet: 'claude-code-sonnet', haiku: 'claude-code-haiku' },
  anthropic: { opus: 'claude-opus-4-8', sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5' },
}

/** Provider preference order when more than one can serve a tier. */
const PROVIDER_PREFERENCE = ['claude-code', 'anthropic']

const TIER_ALIASES = new Set<string>(['opus', 'sonnet', 'haiku'])

export function tierForAgentType(agentType: string): ModelTier {
  return AGENT_TYPE_TIER[agentType] ?? 'sonnet'
}

export function resolveTier(
  tier: ModelTier,
  providers: ProviderModels[],
): { provider: string; modelId: string } | null {
  const byId = new Map(providers.map((p) => [p.providerId, new Set(p.modelIds)]))
  const ordered = [
    ...PROVIDER_PREFERENCE.filter((id) => byId.has(id)),
    ...providers.map((p) => p.providerId).filter((id) => !PROVIDER_PREFERENCE.includes(id)),
  ]
  for (const providerId of ordered) {
    const have = byId.get(providerId)!
    const want = PROVIDER_TIER_MODEL[providerId]?.[tier]
    if (want && have.has(want)) return { provider: providerId, modelId: want }
    // Heuristic fallback: any listed model whose id mentions the tier word.
    const heur = [...have].find((id) => id.toLowerCase().includes(tier))
    if (heur) return { provider: providerId, modelId: heur }
  }
  return null
}

export function normalizeModelAlias(
  model: string,
  providers: ProviderModels[],
): string | undefined {
  // Already a concrete, listed id → pass through.
  for (const p of providers) if (p.modelIds.includes(model)) return model
  // Bare tier alias → resolve to the preferred provider's concrete id.
  if (TIER_ALIASES.has(model)) return resolveTier(model as ModelTier, providers)?.modelId
  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/model/tier-resolver.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Checkpoint**

```bash
git add src/modules/model/tier-resolver.ts tests/modules/model/tier-resolver.test.ts
# commit only on explicit user request — message: "feat(model): tier resolver + alias normalization"
```

---

### Task 2: Gateway alias normalization

**Files:**
- Modify: `src/modules/model/gateway.ts` (the `resolveProvider` closure + cache build, lines ~10-45)
- Test: `tests/modules/model/gateway.test.ts` (add cases)

**Interfaces:**
- Consumes: `normalizeModelAlias`, `ProviderModels` from Task 1.
- Produces: `resolveProvider` resolves bare tier aliases by mutating `request.model` to the concrete id and returning the owning provider.

- [ ] **Step 1: Write the failing test** (append to the existing describe block in `gateway.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { createModelGateway } from '@modules/model/gateway.js'
import type { AIProvider, ModelInfo } from '@modules/model/types.js'

function fakeProvider(id: string, ids: string[]): AIProvider {
  const models: ModelInfo[] = ids.map((mid) => ({
    id: mid, name: mid, provider: id, contextWindow: 1000, maxOutputTokens: 100,
    supportsTools: true, supportsImages: true, supportsStreaming: true,
  }))
  return {
    id, name: id,
    async listModels() { return models },
    async complete(req) { return { id: 'x', provider: id, model: req.model ?? '', content: [], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } } },
    async *stream() {},
  }
}

describe('gateway alias normalization', () => {
  it('resolves a bare tier alias to the preferred provider and rewrites request.model', async () => {
    const gw = createModelGateway()
    gw.registerProvider(fakeProvider('claude-code', ['claude-code-opus', 'claude-code-sonnet', 'claude-code-haiku']))
    gw.registerProvider(fakeProvider('anthropic', ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']))
    const req = { model: 'sonnet', messages: [{ role: 'user' as const, content: 'hi' }] }
    const res = await gw.complete(req)
    expect(res.provider).toBe('claude-code')
    expect(req.model).toBe('claude-code-sonnet') // mutated to concrete id
  })

  it('still throws for a truly unknown model', async () => {
    const gw = createModelGateway()
    gw.registerProvider(fakeProvider('anthropic', ['claude-opus-4-8']))
    await expect(gw.complete({ model: 'gpt-9', messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/No provider found for model: gpt-9/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/gateway.test.ts -t "alias normalization"`
Expected: FAIL — `sonnet` resolves to nothing → "No provider found for model: sonnet".

- [ ] **Step 3: Implement** — edit `src/modules/model/gateway.ts`

Add the import at the top:

```typescript
import { normalizeModelAlias, type ProviderModels } from './tier-resolver.js'
```

Change the cache state declaration:

```typescript
  const providers = new Map<string, AIProvider>()
  let modelCache: Map<string, string> | null = null
  let providerModels: ProviderModels[] = []
```

Replace the `request.model` branch inside `resolveProvider` (current lines 21-37):

```typescript
    if (request.model) {
      // Rebuild cache if needed
      if (!modelCache) {
        modelCache = new Map()
        providerModels = []
        for (const [providerId, provider] of providers) {
          const models = await provider.listModels()
          const ids: string[] = []
          for (const model of models) { modelCache.set(model.id, providerId); ids.push(model.id) }
          providerModels.push({ providerId, modelIds: ids })
        }
      }
      const providerId = modelCache.get(request.model)
      if (providerId) return providers.get(providerId)!

      // Bare alias / non-listed model → normalize to a concrete listed id and
      // forward that to the provider (the seeded YAML agents use 'sonnet'/'opus').
      const normalized = normalizeModelAlias(request.model, providerModels)
      if (normalized) {
        const pid = modelCache.get(normalized)
        if (pid) { request.model = normalized; return providers.get(pid)! }
      }
      throw new Error(`No provider found for model: ${request.model}`)
    }
```

Also reset `providerModels = []` wherever `modelCache = null` is set (in `registerProvider` and `unregisterProvider`):

```typescript
    registerProvider(provider: AIProvider) {
      providers.set(provider.id, provider)
      modelCache = null // invalidate cache
      providerModels = []
    },

    unregisterProvider(id: string) {
      providers.delete(id)
      modelCache = null
      providerModels = []
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun vitest run tests/modules/model/gateway.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Checkpoint**

```bash
git add src/modules/model/gateway.ts tests/modules/model/gateway.test.ts
# commit msg (on request): "fix(model): resolve bare tier aliases in gateway"
```

---

### Task 3: Native Anthropic provider — current models + adaptive thinking

**Files:**
- Modify: `src/modules/model/submodules/anthropic/adapter.ts` (add thinking/sampling policy helpers; fix `AnthropicAdapter.send`)
- Modify: `src/modules/model/submodules/anthropic/provider.ts` (model list, defaults, thinking/temperature in `complete` + `stream`)
- Test: `tests/modules/model/submodules/anthropic-policy.test.ts` (create)

**Interfaces:**
- Produces (from `adapter.ts`):
  - `applyAnthropicThinking(params: Record<string, any>, modelId: string, thinking?: { enabled: boolean; budgetTokens?: number }): void`
  - `allowsTemperature(modelId: string): boolean`
  - `ANTHROPIC_MODELS: ModelInfo[]` is **moved into `provider.ts`** (unchanged location) and exported for the test.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/modules/model/submodules/anthropic-policy.test.ts
import { describe, it, expect } from 'vitest'
import { applyAnthropicThinking, allowsTemperature } from '@modules/model/submodules/anthropic/adapter.js'
import { ANTHROPIC_MODELS } from '@modules/model/submodules/anthropic/provider.js'

describe('anthropic model list', () => {
  it('exposes the current model ids', () => {
    const ids = ANTHROPIC_MODELS.map((m) => m.id)
    expect(ids).toEqual(expect.arrayContaining([
      'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
      'claude-sonnet-4-6', 'claude-haiku-4-5',
    ]))
    expect(ids).not.toContain('claude-sonnet-4-5-20250514')
  })
})

describe('anthropic thinking/sampling policy', () => {
  it('uses adaptive thinking for 4.6+ models when enabled', () => {
    const p: Record<string, any> = {}
    applyAnthropicThinking(p, 'claude-opus-4-8', { enabled: true, budgetTokens: 9000 })
    expect(p.thinking).toEqual({ type: 'adaptive' })
  })
  it('omits thinking entirely when not enabled (safe for Fable 5)', () => {
    const p: Record<string, any> = {}
    applyAnthropicThinking(p, 'claude-fable-5', { enabled: false })
    expect(p.thinking).toBeUndefined()
  })
  it('keeps budget_tokens for Haiku 4.5', () => {
    const p: Record<string, any> = {}
    applyAnthropicThinking(p, 'claude-haiku-4-5', { enabled: true, budgetTokens: 5000 })
    expect(p.thinking).toEqual({ type: 'enabled', budget_tokens: 5000 })
  })
  it('forbids temperature on 4.7/4.8/Fable, allows on 4.6/sonnet/haiku', () => {
    expect(allowsTemperature('claude-opus-4-8')).toBe(false)
    expect(allowsTemperature('claude-opus-4-7')).toBe(false)
    expect(allowsTemperature('claude-fable-5')).toBe(false)
    expect(allowsTemperature('claude-opus-4-6')).toBe(true)
    expect(allowsTemperature('claude-sonnet-4-6')).toBe(true)
    expect(allowsTemperature('claude-haiku-4-5')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/submodules/anthropic-policy.test.ts`
Expected: FAIL — `applyAnthropicThinking`/`allowsTemperature` not exported; ids mismatch.

- [ ] **Step 3a: Implement the policy helpers** — append to `src/modules/model/submodules/anthropic/adapter.ts`

```typescript
// ─── Thinking & sampling policy (model-version aware) ────────────────────────
// Per the Anthropic API: budget_tokens + sampling params are REMOVED (HTTP 400)
// on Fable 5 / Opus 4.8 / 4.7; adaptive thinking is the only on-mode on 4.6+.

const ADAPTIVE_THINKING_MODELS = new Set([
  'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6',
])
const NO_SAMPLING_MODELS = new Set([
  'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7',
])

/** Set `params.thinking` (or leave it unset) according to the model's policy. */
export function applyAnthropicThinking(
  params: Record<string, any>,
  modelId: string,
  thinking?: { enabled: boolean; budgetTokens?: number },
): void {
  if (!thinking?.enabled) return // omit the param — safe on every model incl. Fable 5
  if (ADAPTIVE_THINKING_MODELS.has(modelId)) {
    params.thinking = { type: 'adaptive' }
  } else {
    params.thinking = { type: 'enabled', budget_tokens: thinking.budgetTokens ?? 10000 }
  }
}

/** Whether `temperature`/`top_p` may be sent for this model. */
export function allowsTemperature(modelId: string): boolean {
  return !NO_SAMPLING_MODELS.has(modelId)
}
```

Also fix the **v2 `AnthropicAdapter.send`** thinking block (current lines 117-119):

```typescript
    if (req.tools?.length) params.tools = toAnthropicTools(req.tools)
    applyAnthropicThinking(params, req.modelId, req.thinking)
```

(Remove the old `if (req.thinking?.enabled) { params.thinking = { type: 'enabled', budget_tokens: ... } }`.)

- [ ] **Step 3b: Implement the model list + provider compat** — edit `src/modules/model/submodules/anthropic/provider.ts`

Replace `ANTHROPIC_MODELS` (lines 6-11) and export it:

```typescript
import { toAnthropicMessages, toAnthropicTools, fromAnthropicResponse, mapAnthropicStopReason, applyAnthropicThinking, allowsTemperature } from './adapter.js'

export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-opus-4-8',  name: 'Claude Opus 4.8',  provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-opus-4-7',  name: 'Claude Opus 4.7',  provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-opus-4-6',  name: 'Claude Opus 4.6',  provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
]
```

(Delete the now-duplicate `mapAnthropicStopReason` import line if it already exists — keep one combined import.)

In **`complete`** replace the default and the thinking/temperature block (current lines 26, 34-43):

```typescript
    const model = request.model || 'claude-sonnet-4-6'
    const params: any = {
      model,
      max_tokens: request.maxTokens || 4096,
      messages: toAnthropicMessages(request.messages),
    }
    if (request.system) params.system = request.system
    if (request.tools?.length) params.tools = toAnthropicTools(request.tools)
    if (request.stopSequences?.length) params.stop_sequences = request.stopSequences

    applyAnthropicThinking(params, model, request.thinking)
    if (!request.thinking?.enabled && request.temperature !== undefined && allowsTemperature(model)) {
      params.temperature = request.temperature
    }
```

In **`stream`** apply the same default (`const model = request.model || 'claude-sonnet-4-6'`, use `model` for `params.model`) and the same `applyAnthropicThinking(params, model, request.thinking)` + guarded temperature (mirror the lines that currently set thinking/temperature in `stream`, ~lines 60+).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun vitest run tests/modules/model/submodules/anthropic-policy.test.ts`
Then the existing adapter/provider tests: `bun vitest run tests/modules/model/adapters tests/modules/model/provider-defaults.test.ts`
Expected: PASS. If `provider-defaults.test.ts` asserts old model ids, update those expectations to the new ids.

- [ ] **Step 5: Checkpoint**

```bash
git add src/modules/model/submodules/anthropic/ tests/modules/model/submodules/anthropic-policy.test.ts
# commit msg (on request): "feat(model): refresh Anthropic models + adaptive thinking"
```

---

### Task 4: Refresh model-router rule model IDs

**Files:**
- Modify: `src/modules/agent/model-router.ts` (lines 16-28 + fallback line 50)
- Test: `tests/modules/agent/model-router.test.ts` (create or extend)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/modules/agent/model-router.test.ts
import { describe, it, expect } from 'vitest'
import { createModelRouter } from '@modules/agent/model-router.js'

describe('model-router default rules', () => {
  it('uses current model ids', () => {
    const r = createModelRouter()
    expect(r.selectModel('architecture', 'complex')).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' })
    expect(r.selectModel('implementation', 'complex')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
    expect(r.selectModel('lookup', 'trivial')).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(r.selectModel('unknown', 'unknown')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/agent/model-router.test.ts`
Expected: FAIL — current rules return `claude-opus-4-20250514` / `claude-sonnet-4-20250514`.

- [ ] **Step 3: Implement** — in `src/modules/agent/model-router.ts`, replace every `claude-opus-4-20250514` with `claude-opus-4-8`, every `claude-sonnet-4-20250514` with `claude-sonnet-4-6`, and the ultimate fallback (line 50) `claude-sonnet-4-20250514` with `claude-sonnet-4-6`. Leave the `claude-haiku-4-5-20251001` rules as-is (they are current).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/agent/model-router.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

```bash
git add src/modules/agent/model-router.ts tests/modules/agent/model-router.test.ts
# commit msg (on request): "chore(agent): refresh model-router model ids"
```

---

### Task 5: Claude CLI provider — caps, metadata, model pass-through, probe merge

**Files:**
- Modify: `src/modules/model/submodules/claude-code/provider.ts`
- Test: `tests/modules/model/claude-code-provider.test.ts` (extend)

**Interfaces:**
- Produces: `listModels()` returns the 3 alias models with current caps + `metadata.{alias,realModelId}`; `stream()` sets `queryOptions.model` from `request.model`.

- [ ] **Step 1: Write the failing test** (append cases)

```typescript
import { describe, it, expect } from 'vitest'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'

describe('claude-code listModels caps + metadata', () => {
  it('returns current caps and concrete-id metadata', async () => {
    const p = createClaudeCodeProvider()
    const models = await p.listModels()
    const sonnet = models.find((m) => m.id === 'claude-code-sonnet')!
    expect(sonnet.contextWindow).toBe(1_000_000)
    expect(sonnet.maxOutputTokens).toBe(64_000)
    expect((sonnet.metadata as any).realModelId).toBe('claude-sonnet-4-6')
    expect((sonnet.metadata as any).alias).toBe('sonnet')
    const opus = models.find((m) => m.id === 'claude-code-opus')!
    expect(opus.maxOutputTokens).toBe(128_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/claude-code-provider.test.ts -t "caps + metadata"`
Expected: FAIL — sonnet caps are 200K/16K, no metadata.

- [ ] **Step 3: Implement** — edit `src/modules/model/submodules/claude-code/provider.ts`

Replace `KNOWN_MODELS` (lines 36-40):

```typescript
const KNOWN_MODELS: ModelInfo[] = [
  { id: 'claude-code-opus', name: 'Claude Code (Opus)', provider: 'claude-code', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true, metadata: { alias: 'opus', realModelId: 'claude-opus-4-8' } },
  { id: 'claude-code-sonnet', name: 'Claude Code (Sonnet)', provider: 'claude-code', contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true, metadata: { alias: 'sonnet', realModelId: 'claude-sonnet-4-6' } },
  { id: 'claude-code-haiku', name: 'Claude Code (Haiku)', provider: 'claude-code', contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true, metadata: { alias: 'haiku', realModelId: 'claude-haiku-4-5' } },
]

/** Map our model id → the CLI `--model` / SDK alias. */
const MODEL_TO_CLI_ALIAS: Record<string, string> = {
  'claude-code-opus': 'opus',
  'claude-code-sonnet': 'sonnet',
  'claude-code-haiku': 'haiku',
}
```

Replace `probeCliModels` (lines 46-82) so caps come from the accurate table and only the real model id is discovered:

```typescript
async function probeCliModels(): Promise<ModelInfo[]> {
  const byAlias = new Map(KNOWN_MODELS.map((m) => [(m.metadata as any).alias as string, m]))
  const models: ModelInfo[] = []
  for (const alias of CLI_MODEL_ALIASES) {
    const base = byAlias.get(alias)
    if (!base) continue
    try {
      const result = execFileSync('claude', [
        '--model', alias, '-p', 'respond ONLY with OK', '--output-format', 'json',
      ], { timeout: 30_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      const parsed = JSON.parse(result)
      const realModelId = Object.keys(parsed.modelUsage ?? {})[0]
      const display = alias.charAt(0).toUpperCase() + alias.slice(1)
      models.push({
        ...base,
        name: realModelId ? `Claude Code (${display}) — ${realModelId}` : base.name,
        metadata: { ...(base.metadata as Record<string, unknown>), ...(realModelId ? { realModelId } : {}) },
      })
    } catch {
      models.push(base) // probe failed — keep accurate known caps
    }
  }
  return models.length > 0 ? models : KNOWN_MODELS
}
```

In `stream`, set the model option in `queryOptions` (after line 219, inside the `queryOptions` object or right after it):

```typescript
      // Pass the selected model through to the SDK so the agent's model choice
      // actually steers the CLI (previously the CLI used the user's default).
      const cliAlias = request.model ? MODEL_TO_CLI_ALIAS[request.model] : undefined
      if (cliAlias) queryOptions['model'] = cliAlias
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/model/claude-code-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

```bash
git add src/modules/model/submodules/claude-code/provider.ts tests/modules/model/claude-code-provider.test.ts
# commit msg (on request): "feat(model): claude-code caps refresh + model pass-through"
```

---

### Task 6: CLI manifest — one-time background probe enrichment

**Files:**
- Modify: `src/modules/model/submodules/claude-code/manifest.ts` (the `existingModels` block, lines 33-37)
- Test: covered by Task 5 + manual; add a light guard test only if a manifest test harness exists (otherwise skip — note below).

- [ ] **Step 1: Implement** — replace lines 33-37 of `claude-code/manifest.ts`:

```typescript
  const existingModels = ctx.providerConfig.listModels('claude-code')
  if (existingModels.length === 0) {
    // Persist accurate known caps immediately (instant, no CLI call)...
    ctx.providerConfig.upsertModels('claude-code', await provider.listModels())
    // ...then enrich names with real model ids in the background (best-effort,
    // non-blocking — never delays startup, failures are ignored).
    void provider.fetchModels!()
      .then((models) => ctx.providerConfig.upsertModels('claude-code', models))
      .catch(() => { /* CLI probe unavailable — known caps stand */ })
  }
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Checkpoint**

```bash
git add src/modules/model/submodules/claude-code/manifest.ts
# commit msg (on request): "feat(model): one-time background probe for claude-code"
```

> Note: `model_config` has no metadata column, so the discovered real model id is surfaced via the model `name` field (`Claude Code (Sonnet) — claude-sonnet-4-6`), which the providers page already renders. No schema change.

---

### Task 7: `ai-models` setup step (backend, model module)

**Files:**
- Modify: `src/modules/model/index.ts` (add `'setup'` dependency; register step in `onRegister`; register `GET /api/v1/setup/ai-models` in `onStart`; env auto-complete)
- Test: `tests/modules/setup/ai-models-step.test.ts` (create)

**Interfaces:**
- Consumes: `tierForAgentType`, `resolveTier`, `ProviderModels` (Task 1); `ctx.model` (gateway), `ctx.providerConfig`, `ctx.setup`, `ctx.db`, `ctx.http`, `ctx.logger`.
- Produces:
  - Setup step `id: 'ai-models'`, `module: 'model'`, `order: 30`, `required: false`, field `assignments` (text). `onComplete` applies `{ [agentId]: modelId }` to `agent_definitions.model`.
  - `GET /api/v1/setup/ai-models` → `{ claudeDetected, providers: {id,models:[{id,name}]}[], agents: {id,name,agentType,proposedTier,proposedModelId}[] }`.

- [ ] **Step 1: Write the failing test** (focused on the pure proposal + apply logic via small exported helpers)

We extract two pure helpers so they are unit-testable without HTTP. Add them to `src/modules/model/ai-models-step.ts` (new file) and have `index.ts` import them.

```typescript
// tests/modules/setup/ai-models-step.test.ts
import { describe, it, expect } from 'vitest'
import { buildAgentProposals, type SeedAgentRow } from '@modules/model/ai-models-step.js'
import type { ProviderModels } from '@modules/model/tier-resolver.js'

const providers: ProviderModels[] = [
  { providerId: 'claude-code', modelIds: ['claude-code-opus', 'claude-code-sonnet', 'claude-code-haiku'] },
]
const agents: SeedAgentRow[] = [
  { id: 'a1', name: 'Reviewer', agent_type: 'reviewer' },
  { id: 'a2', name: 'Helper', agent_type: 'assistant' },
  { id: 'a3', name: 'Monitor', agent_type: 'observer' },
]

describe('buildAgentProposals', () => {
  it('proposes tier-appropriate concrete models per agent', () => {
    const out = buildAgentProposals(agents, providers)
    expect(out).toEqual([
      { id: 'a1', name: 'Reviewer', agentType: 'reviewer', proposedTier: 'opus', proposedModelId: 'claude-code-opus' },
      { id: 'a2', name: 'Helper', agentType: 'assistant', proposedTier: 'sonnet', proposedModelId: 'claude-code-sonnet' },
      { id: 'a3', name: 'Monitor', agentType: 'observer', proposedTier: 'haiku', proposedModelId: 'claude-code-haiku' },
    ])
  })
  it('leaves proposedModelId null when no provider available', () => {
    const out = buildAgentProposals(agents, [])
    expect(out[0].proposedModelId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/setup/ai-models-step.test.ts`
Expected: FAIL — module `ai-models-step.js` not found.

- [ ] **Step 3a: Implement the pure helper** — create `src/modules/model/ai-models-step.ts`

```typescript
// src/modules/model/ai-models-step.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { tierForAgentType, resolveTier, type ProviderModels, type ModelTier } from './tier-resolver.js'

export interface SeedAgentRow {
  id: string
  name: string
  agent_type: string
}

export interface AgentProposal {
  id: string
  name: string
  agentType: string
  proposedTier: ModelTier
  proposedModelId: string | null
}

/** Build the per-agent model proposal table shown in the wizard. */
export function buildAgentProposals(agents: SeedAgentRow[], providers: ProviderModels[]): AgentProposal[] {
  return agents.map((a) => {
    const tier = tierForAgentType(a.agent_type)
    const resolved = resolveTier(tier, providers)
    return {
      id: a.id,
      name: a.name,
      agentType: a.agent_type,
      proposedTier: tier,
      proposedModelId: resolved?.modelId ?? null,
    }
  })
}
```

- [ ] **Step 3b: Wire the step + endpoint** — edit `src/modules/model/index.ts`

1. Add `'setup'` to `dependencies`:

```typescript
  dependencies: ['secrets', 'setup'],
```

2. At the top, import helpers:

```typescript
import { buildAgentProposals } from './ai-models-step.js'
import type { ProviderModels } from './tier-resolver.js'
```

3. Inside `onRegister`, after `ctx.model = gateway` (line ~106), register the step:

```typescript
    // First-run wizard: assign each pre-installed agent a suitable model.
    ctx.setup.registerStep({
      id: 'ai-models',
      module: 'model',
      title: 'AI Models',
      description: 'Assign the best model to each pre-installed agent',
      required: false,
      order: 30,
      fields: [
        { name: 'assignments', type: 'text', label: 'Model assignments (JSON)', required: false },
      ],
      async onComplete(data) {
        const raw = (data.assignments as string) || '{}'
        let map: Record<string, string> = {}
        try { map = JSON.parse(raw) } catch { map = {} }
        const now = new Date().toISOString()
        for (const [agentId, modelId] of Object.entries(map)) {
          if (!agentId || !modelId) continue
          ctx.db.run(sql`UPDATE agent_definitions SET model = ${modelId}, updated_at = ${now} WHERE id = ${agentId}`)
        }
      },
    })
```

4. Add a helper inside `onRegister`/module scope to gather provider models (used by the endpoint), or compute inline in the route. Register the route in `onStart` (after submodule `onStart` so providers reflect availability — after line 116):

```typescript
    // Pre-auth read endpoint backing the wizard's AI-models step. Allowed by
    // setupGuard (path under /api/v1/setup). Computes proposals at request time.
    ctx.http.get('/api/v1/setup/ai-models', async (c) => {
      const providerModels: ProviderModels[] = []
      const providersOut: Array<{ id: string; models: Array<{ id: string; name: string }> }> = []
      for (const provider of ctx.model.listProviders()) {
        const models = await provider.listModels()
        providerModels.push({ providerId: provider.id, modelIds: models.map((m) => m.id) })
        providersOut.push({ id: provider.id, models: models.map((m) => ({ id: m.id, name: m.name })) })
      }
      const rows = (ctx.db as any).all(
        sql`SELECT id, name, agent_type FROM agent_definitions WHERE source = 'seed' ORDER BY name`,
      ) as Array<{ id: string; name: string; agent_type: string }>
      const agents = buildAgentProposals(rows, providerModels)
      return c.json({
        claudeDetected: providerModels.some((p) => p.providerId === 'claude-code'),
        providers: providersOut,
        agents,
      })
    })
```

5. Env auto-complete (headless) — at the end of `onStart`, before the final log line:

```typescript
    // Headless: auto-apply the type-based mapping when explicitly opted in.
    if (process.env.EYAS_SETUP_AI_MODELS === 'auto' && !ctx.setup.getStep('ai-models')?.completedAt) {
      const providerModels: ProviderModels[] = []
      for (const provider of ctx.model.listProviders()) {
        const models = await provider.listModels()
        providerModels.push({ providerId: provider.id, modelIds: models.map((m) => m.id) })
      }
      const rows = (ctx.db as any).all(
        sql`SELECT id, name, agent_type FROM agent_definitions WHERE source = 'seed'`,
      ) as Array<{ id: string; name: string; agent_type: string }>
      const assignments: Record<string, string> = {}
      for (const a of buildAgentProposals(rows, providerModels)) {
        if (a.proposedModelId) assignments[a.id] = a.proposedModelId
      }
      try {
        await ctx.setup.completeStep('ai-models', { assignments: JSON.stringify(assignments) })
        ctx.logger.info({ count: Object.keys(assignments).length }, 'ai-models step auto-completed from env')
      } catch { /* step may already be complete */ }
    }
```

> The step is registered in `onRegister`; `getStep('ai-models')` is therefore valid in `onStart`. `ctx.setup` is created in bootstrap before module registration, and the `'setup'` dependency guarantees ordering.

- [ ] **Step 4: Run tests + type-check**

Run: `bun vitest run tests/modules/setup/ai-models-step.test.ts`
Run: `bunx tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 5: Checkpoint**

```bash
git add src/modules/model/index.ts src/modules/model/ai-models-step.ts tests/modules/setup/ai-models-step.test.ts
# commit msg (on request): "feat(model): ai-models setup step + read endpoint"
```

---

### Task 8: Wizard frontend — `ai-models` step, redirect to /providers

**Files:**
- Create: `src/web/src/pages/setup/ai-models-step.tsx`
- Create: `src/web/src/pages/setup/i18n.ts`
- Create: `src/web/src/pages/setup/locales/en.json`, `src/web/src/pages/setup/locales/hu.json`
- Modify: `src/web/src/pages/setup/setup-page.tsx` (render new step; completion → `/login?redirect=/providers`)
- Modify: `src/web/src/routes/login.tsx` (accept `redirect` search param)
- Modify: `src/web/src/pages/login/login-page.tsx` (honor `redirect` after login)

- [ ] **Step 1: Create i18n bundles**

`src/web/src/pages/setup/locales/en.json`:

```json
{
  "aiModels.title": "AI Models",
  "aiModels.detected": "Claude CLI detected and configured",
  "aiModels.detectedHint": "Review the model assigned to each agent. The most suitable Haiku/Sonnet/Opus model is pre-selected per agent — adjust if you like.",
  "aiModels.notDetected": "No Claude provider detected",
  "aiModels.notDetectedHint": "After setup, configure a provider and assign models to your agents on the Providers page.",
  "aiModels.agent": "Agent",
  "aiModels.model": "Model",
  "aiModels.apply": "Apply",
  "aiModels.goProviders": "Go to Providers",
  "aiModels.complete": "Complete Setup",
  "aiModels.continue": "Continue"
}
```

`src/web/src/pages/setup/locales/hu.json`:

```json
{
  "aiModels.title": "AI modellek",
  "aiModels.detected": "Claude CLI detektálva és beállítva",
  "aiModels.detectedHint": "Nézd át az egyes agentekhez rendelt modellt. Agentenként a legalkalmasabb Haiku/Sonnet/Opus modell van előre kiválasztva — igény szerint módosíthatod.",
  "aiModels.notDetected": "Nem található Claude provider",
  "aiModels.notDetectedHint": "A wizard után állítsd be a megfelelő providert és rendelj modelleket az agentekhez a Providers oldalon.",
  "aiModels.agent": "Agent",
  "aiModels.model": "Modell",
  "aiModels.apply": "Alkalmaz",
  "aiModels.goProviders": "Tovább a Providers oldalra",
  "aiModels.complete": "Beállítás befejezése",
  "aiModels.continue": "Tovább"
}
```

`src/web/src/pages/setup/i18n.ts` (copy the mission-control pattern):

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import en from './locales/en.json'
import hu from './locales/hu.json'

type Lang = 'hu' | 'en'
const bundles: Record<Lang, Record<string, string>> = { en, hu }

function detectLang(): Lang {
  if (typeof document !== 'undefined') {
    const lang = document.documentElement.lang?.toLowerCase()
    if (lang === 'hu' || lang === 'en') return lang
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('hu')) return 'hu'
  return 'hu'
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = detectLang()
  const raw = bundles[lang][key] ?? bundles.en[key] ?? key
  if (!vars) return raw
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`))
}
```

- [ ] **Step 2: Create the step component** — `src/web/src/pages/setup/ai-models-step.tsx`

```tsx
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { t } from './i18n'

interface AgentProposal {
  id: string
  name: string
  agentType: string
  proposedTier: string
  proposedModelId: string | null
}
interface AiModelsData {
  claudeDetected: boolean
  providers: { id: string; models: { id: string; name: string }[] }[]
  agents: AgentProposal[]
}

interface Props {
  onComplete: (assignments: Record<string, string>) => Promise<void>
  onGoProviders: () => void
  isLast: boolean
}

export function AiModelsStep({ onComplete, onGoProviders, isLast }: Props) {
  const [data, setData] = useState<AiModelsData | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<AiModelsData>('/setup/ai-models').then((d) => {
      setData(d)
      const init: Record<string, string> = {}
      for (const a of d.agents) if (a.proposedModelId) init[a.id] = a.proposedModelId
      setChoices(init)
    })
  }, [])

  const allModels = data?.providers.flatMap((p) => p.models) ?? []

  const apply = async () => {
    setError(null); setLoading(true)
    try { await onComplete(choices) } catch (e: any) { setError(e.message || 'Error') } finally { setLoading(false) }
  }

  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>

  if (!data.claudeDetected && allModels.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('aiModels.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('aiModels.notDetected')}</p>
        </div>
        <p className="text-sm text-muted-foreground">{t('aiModels.notDetectedHint')}</p>
        <div className="flex justify-end">
          <Button onClick={async () => { await onComplete({}); onGoProviders() }}>{t('aiModels.goProviders')}</Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('aiModels.title')}</h2>
        {data.claudeDetected && <Badge variant="outline" className="mt-1">{t('aiModels.detected')}</Badge>}
        <p className="text-sm text-muted-foreground mt-1">{t('aiModels.detectedHint')}</p>
      </div>

      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
        {data.agents.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border/50">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{a.name}</span>
                <Badge variant="outline" className="text-[9px]">{a.agentType}</Badge>
              </div>
            </div>
            <select
              className="text-sm bg-background border border-border rounded px-2 py-1"
              value={choices[a.id] ?? ''}
              onChange={(e) => setChoices((c) => ({ ...c, [a.id]: e.target.value }))}
            >
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={apply} disabled={loading}>
          {loading ? 'Please wait…' : isLast ? t('aiModels.complete') : t('aiModels.continue')}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Wire into setup-page + redirect** — edit `src/web/src/pages/setup/setup-page.tsx`

Add the import:

```tsx
import { AiModelsStep } from './ai-models-step'
```

Replace the completion navigations: define a helper and use `/providers` via login redirect. At the top of the component body add:

```tsx
  const finish = () => navigate({ to: '/login', search: { redirect: '/providers' } })
```

Replace `navigate({ to: '/login' })` on line 44 with `finish()`, line 58 with `finish()`, and line 100-102's `navigate({ to: '/login' })` with `finish()`.

Add a render branch before the generic `SetupStep` (inside the conditional chain, after the `voice-profiles` branch):

```tsx
            ) : currentStep.id === 'ai-models' ? (
              <AiModelsStep
                isLast={currentIndex === steps.length - 1}
                onGoProviders={finish}
                onComplete={async (assignments) => {
                  await api.post(`/setup/ai-models-apply-noop`, {}) // placeholder removed below
                }}
              />
```

Replace that `onComplete` body with the real submit (POST to the step, then advance/finish):

```tsx
                onComplete={async (assignments) => {
                  await api.post(`/setup/steps/ai-models`, { assignments: JSON.stringify(assignments) })
                  if (currentIndex < steps.length - 1) setCurrentIndex((i) => i + 1)
                  else finish()
                }}
```

- [ ] **Step 4: Login redirect support** — edit `src/web/src/routes/login.tsx`

```tsx
import { createFileRoute } from '@tanstack/react-router'
import LoginPage from '@/pages/login/login-page'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
})
```

Edit `src/web/src/pages/login/login-page.tsx` — read the param and honor it:

```tsx
import { useNavigate, useSearch } from '@tanstack/react-router'
```

```tsx
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: '/login' })
```

```tsx
      await login(username, password)
      navigate({ to: redirect ?? '/' })
```

- [ ] **Step 5: Verify (type-check + build)**

Run: `cd src/web && bunx tsc --noEmit`
Run: `bun run build:web`
Expected: no type errors; web build succeeds.

- [ ] **Step 6: Manual smoke (record result)**

Start `bun run dev` against a fresh DB (no existing setup). Walk the wizard: confirm the `ai-models` step appears last, shows agents with pre-selected models (claude-detected badge when CLI present), apply works, and completion lands on `/login?redirect=/providers` → after login → `/providers`. With no Claude provider, confirm the "not detected" message + "Go to Providers" path.

- [ ] **Step 7: Checkpoint**

```bash
git add src/web/src/pages/setup/ src/web/src/routes/login.tsx src/web/src/pages/login/login-page.tsx
# commit msg (on request): "feat(web): ai-models wizard step + post-setup redirect to providers"
```

---

## Self-Review

**Spec coverage:**
- §5.1 resolver + alias normalization → Task 1; gateway integration → Task 2. ✓
- §5.2 CLI provider caps/metadata/query-model/probe → Task 5; auto-probe → Task 6. ✓
- §5.3 Anthropic list + adaptive-thinking/sampling compat → Task 3; model-router → Task 4. ✓
- §5.4 backend `ai-models` step + read endpoint + env auto-complete → Task 7. ✓
- §5.5 frontend step + i18n → Task 8 (steps 1-3). ✓
- §5.6 redirect to /providers (via login redirect) → Task 8 (steps 3-4). ✓
- §6 tests → each task has a test step (frontend verified via type-check/build + manual). ✓

**Placeholder scan:** One placeholder line is shown then explicitly replaced in Task 8 Step 3 (the `ai-models-apply-noop` line is immediately superseded by the real `onComplete` body in the same step) — the engineer writes only the final version. No `TBD`/`handle edge cases`/`similar to`. ✓

**Type consistency:** `ProviderModels`/`ModelTier`/`resolveTier`/`normalizeModelAlias`/`tierForAgentType` names match across Tasks 1, 2, 7. `applyAnthropicThinking`/`allowsTemperature`/`ANTHROPIC_MODELS` consistent across Task 3. `buildAgentProposals`/`SeedAgentRow` consistent across Task 7 and its test. `MODEL_TO_CLI_ALIAS` local to Task 5. ✓

**Known verification points (resolve while implementing, not blockers):**
- Task 7: confirm `ctx.http` is the live Hono app in `onStart` and that auth middleware exempts `/api/v1/setup/*` (the existing wizard already proves this). If a different registration hook is required, register the route alongside the existing `_pendingRoutingRoutes` factory but **without** the auth gate.
- Task 8: `useSearch({ from: '/login' })` typing depends on the generated `routeTree.gen.ts` — re-run the dev server / `bun run build:web` to regenerate types after adding `validateSearch`.
