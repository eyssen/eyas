# Claude Provider Model Versions + First-Run Wizard Extension — Design

**Date:** 2026-06-24
**Status:** Approved design (pre-implementation)
**Author:** Krisztian Eyssen (with Claude Code)

## 1. Problem

Two related gaps in EYAS:

1. **Stale, hardcoded Claude model versions.** The Claude CLI provider
   (`src/modules/model/submodules/claude-code/`) hardcodes three placeholder
   model entries with stale capability specs because it "couldn't query them".
   The native Anthropic API provider (`submodules/anthropic/`) is also stale
   (`claude-opus-4-20250514`, `claude-sonnet-4-5-20250514`,
   `claude-haiku-3-5-20241022`) — it predates Opus 4.8 / Sonnet 4.6 / Haiku 4.5.

2. **First-run wizard does nothing about AI providers/models.** The setup wizard
   creates a root owner + primary/team agents but never configures which model
   each agent should use, and never detects whether the Claude CLI is installed.

## 2. Ground-truth findings (verified against source)

- **CLI provider** (`claude-code/provider.ts`):
  - `KNOWN_MODELS` (lines 36-40) are **alias placeholders** — IDs
    `claude-code-opus|sonnet|haiku`, not concrete version IDs. Caps are stale
    (sonnet listed 200K/16K; real Sonnet 4.6 is 1M/64K).
  - `query()` (lines 294-296) **never passes a `model` option** → the agent's
    `model` field is ignored; the CLI uses the user's own config default.
  - `probeCliModels()` (46-82) runs `claude --model <alias> -p … --output-format
    json` and reads the real model ID from `modelUsage`. Only invoked on the
    manual "Refresh from CLI" (`fetchModels()`), never on startup. It reads
    `usage.contextWindow`/`maxOutputTokens` which the CLI JSON does **not**
    populate → it gets the real ID but falls back to 200K/16K for caps.
  - CLI availability is already detected via `claude --version`
    (`claude-code/manifest.ts:11-17`).
- **Native Anthropic provider** (`anthropic/provider.ts`):
  - `ANTHROPIC_MODELS` (6-11) stale; defaults in `complete`/`stream` point at
    `claude-sonnet-4-5-20250514`.
  - Sends `thinking: {type:'enabled', budget_tokens}` and `temperature`.
- **Model resolution** (`gateway.ts:21-37`): resolves a request to a provider by
  **exact model-ID match** against each provider's `listModels()`. There is **no
  alias normalization**. `agent-runner.ts:318` passes `model`/`provider`
  straight through; `agent/index.ts:307` sets `model = agentDef.model` with
  `provider` undefined. ⇒ A bare `'sonnet'` (as in the seeded YAML agents)
  resolves to **nothing** and throws `No provider found for model: sonnet`.
- **Setup wizard backend** (`src/modules/setup/`): step-registry pattern.
  `SetupStepDefinition` = `{id, module, title, description, required, order,
  fields[], onComplete}`. Steps today: `master-password` (secrets, 5),
  `root-owner` (auth, 10), `primary-agents` (auth, 20), `team-agents` (auth, 25,
  optional). The **model module registers no setup step**. `setupGuard` blocks
  non-setup endpoints until all required steps complete; env auto-complete via
  `EYAS_SETUP_*`.
- **Setup wizard frontend** (`src/web/src/pages/setup/`): `setup-page.tsx`
  fetches `/api/v1/setup/steps`, renders by `step.id` (generic `SetupStep`,
  custom `team-agents-step.tsx`, `voice-step.tsx`). Completion navigates to
  `/login`. `__root.tsx` redirects to `/setup` while incomplete. Provider/model
  config lives at `/providers`; per-agent model assignment at `/agents/$agentId`.
  The setup pages have **no i18n** today; other namespaces use a
  `i18n.ts` + `locales/{en,hu}.json` pattern.
- **`ModelInfo`** already supports an optional `metadata` field (used by
  `probeCliModels`).

## 3. Authoritative current model IDs & caps

Source: bundled `claude-api` skill (`shared/models.md`, cached 2026-06-04).
**Use the exact strings; never append date suffixes** (except Haiku's full ID).

| Friendly | ID | Context | Max output |
|---|---|---|---|
| Fable 5 | `claude-fable-5` | 1,000,000 | 128,000 |
| Opus 4.8 | `claude-opus-4-8` | 1,000,000 | 128,000 |
| Opus 4.7 | `claude-opus-4-7` | 1,000,000 | 128,000 |
| Opus 4.6 | `claude-opus-4-6` | 1,000,000 | 128,000 |
| Sonnet 4.6 | `claude-sonnet-4-6` | 1,000,000 | 64,000 |
| Haiku 4.5 | `claude-haiku-4-5` (`…-20251001`) | 200,000 | 64,000 |

## 4. Decisions (locked)

1. **Version handling: hybrid.** Keep CLI aliases; refresh hardcoded caps;
   capture concrete IDs in metadata; auto-probe once (cached) + manual refresh;
   pass `model` to `query()`.
2. **Scope:** Claude CLI provider **+** native Anthropic provider (+ its
   `model-router` rules). OpenAI/Gemini lists out of scope.
3. **Wizard mapping:** type-based defaults, **user-reviewable** before apply.
4. **Redirect:** wizard completion → `/providers` (both branches).
5. **Seeded-agent latent bug:** fix via **alias normalization in the resolver**.
6. **`ai-models` step owner:** the **model module**, `required: false`.

## 5. Design

### 5.1 Shared building block — tier resolver + alias normalization

New module `src/modules/model/tier-resolver.ts` (pure, unit-testable):

- `TIER = 'opus' | 'sonnet' | 'haiku'`.
- `AGENT_TYPE_TIER: Record<AgentType, Tier>`:
  - `assistant→sonnet`, `engineer→opus`, `developer→opus`, `reviewer→opus`,
    `critic→opus`, `researcher→sonnet`, `planner→opus`, `coordinator→opus`,
    `observer→haiku`.
- `resolveTier(tier, providers): { provider, modelId } | null` — given the set
  of registered/enabled providers (queried via the gateway/providerConfig),
  return a concrete `{provider, modelId}`. **Provider preference:**
  `claude-code` → `anthropic` → first provider exposing a matching tier. Tier→ID
  mapping per provider:
  - `claude-code`: `claude-code-{opus|sonnet|haiku}`.
  - `anthropic`: `opus→claude-opus-4-8`, `sonnet→claude-sonnet-4-6`,
    `haiku→claude-haiku-4-5`.
- `normalizeModelAlias(model, providers): string | undefined` — if `model` is a
  bare tier alias (`opus`/`sonnet`/`haiku`) or otherwise not a listed ID, resolve
  it to a concrete listed ID via `resolveTier`. Returns the original if already a
  valid listed ID; `undefined` if unresolvable.

**Integration point for normalization (fixes the seeded-agent bug):** apply
`normalizeModelAlias` inside `gateway.resolveProvider` (`gateway.ts`) — before
the "No provider found" throw, attempt alias normalization against the built
`modelCache`. This makes bare `'sonnet'`/`'opus'` from any source (seeded YAML,
hand-typed) resolve to the preferred available provider's concrete ID, while
exact IDs pass through unchanged. The normalized ID is also what gets forwarded
to the provider as `request.model`.

> Rationale for placing it in the gateway: it's the single choke point every
> agent/conversation model request flows through, so one fix covers seeded
> agents, the wizard, and future callers without touching the runner.

### 5.2 Claude CLI provider (`claude-code/provider.ts`)

- **`KNOWN_MODELS`** refreshed caps + concrete-ID metadata:
  - `claude-code-opus` → 1,000,000 / 128,000, `metadata: {alias:'opus',
    realModelId:'claude-opus-4-8'}`.
  - `claude-code-sonnet` → 1,000,000 / 64,000, `metadata: {alias:'sonnet',
    realModelId:'claude-sonnet-4-6'}`.
  - `claude-code-haiku` → 200,000 / 64,000, `metadata: {alias:'haiku',
    realModelId:'claude-haiku-4-5'}`.
- **`query()` model pass-through:** map `request.model` → CLI alias and set
  `queryOptions.model`:
  - `claude-code-opus`→`opus`, `claude-code-sonnet`→`sonnet`,
    `claude-code-haiku`→`haiku`. Unknown/empty → leave unset (CLI default). The
    `@anthropic-ai/claude-agent-sdk` `query()` accepts `model` (same values as
    the CLI `--model` flag, incl. aliases).
- **Probe hardening (`probeCliModels`)**: keep reading the real model ID from
  `modelUsage`; take caps from the refreshed `KNOWN_MODELS` table keyed by alias
  (not the missing `usage.contextWindow`); store the discovered real model ID in
  `metadata.realModelId`. Result entries keep the stable `claude-code-*` IDs.
- **Auto-probe once, cached:** in `claude-code/manifest.ts`, after registering
  the provider, if `providerConfig.listModels('claude-code')` has no discovered
  metadata yet, run `fetchModels()` once (best-effort, non-blocking, guarded by
  try/catch and a short timeout) and `upsertModels`. Manual "Refresh from CLI"
  remains. `listModels()` stays synchronous/instant (returns persisted/known).

### 5.3 Native Anthropic provider (`anthropic/provider.ts` + `adapter.ts`)

- **`ANTHROPIC_MODELS`** replaced with: Fable 5, Opus 4.8, Opus 4.7, Opus 4.6,
  Sonnet 4.6, Haiku 4.5 (exact IDs + caps from §3). Order most-capable→cheapest.
- **Defaults:** `complete`/`stream` fallback `claude-sonnet-4-5-20250514` →
  `claude-sonnet-4-6`.
- **Required thinking/sampling compat fix** (per `claude-api` API-drift table —
  without it, thinking-on requests 400 on the new models). Add a per-model policy
  helper (e.g. in `adapter.ts`):
  - `adaptive` models — `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`,
    `claude-opus-4-6`, `claude-sonnet-4-6`: when thinking requested →
    `thinking:{type:'adaptive'}` (drop `budget_tokens`); when not requested →
    **omit** the `thinking` param entirely. **Never** send `temperature`/`top_p`
    for `claude-fable-5`/`claude-opus-4-8`/`claude-opus-4-7`.
  - `budget` models — `claude-haiku-4-5` (and any legacy): keep existing
    `thinking:{type:'enabled', budget_tokens}` + `temperature` behavior.
  - `claude-fable-5`: never send `thinking:{type:'disabled'}` (omit instead).
- **`model-router.ts` `DEFAULT_RULES`:** `claude-opus-4-20250514`→
  `claude-opus-4-8`; `claude-sonnet-4-20250514`→`claude-sonnet-4-6`; haiku rules
  already `claude-haiku-4-5-20251001` (leave). Ultimate fallback (line 50) →
  `claude-sonnet-4-6`.

### 5.4 Wizard — backend `ai-models` setup step (model module)

Register from `src/modules/model/index.ts` via `ctx.setup.registerStep`:

- `id: 'ai-models'`, `module: 'model'`, `order: 30`, `required: false`.
- `fields: [{ name: 'assignments', type: 'text', required: false }]` — carries a
  JSON string of `{ agentId: modelId }` (mirrors the `team-agents` payload
  pattern; the custom frontend component builds it).
- **Dedicated read endpoint.** Because the generic field set can't express the
  agent table, the model module exposes `GET /api/v1/setup/ai-models` (keeps the
  generic `/setup/steps` list clean) returning:
  - `claudeDetected: boolean` (`claude --version`, reuse manifest probe).
  - `availableProviders`: enabled providers + their listed models.
  - `agents`: each pre-installed agent `{ id, name, agentType, proposedTier,
    proposedModelId }`, where `proposedModelId = resolveTier(AGENT_TYPE_TIER[
    agentType], providers)`.
- **`onComplete(data)`**: parse `assignments`; for each `{agentId, modelId}`,
  `agentRegistry.update(agentId, { model: modelId })`. Reach the agent registry
  via `ctx` (verify exposure during planning; `auth` already reaches it for the
  agent steps). No-op safe if empty (optional step / no claude).
- **Env auto-complete:** if `EYAS_SETUP_AI_MODELS=auto` (or claude detected in a
  headless run), auto-apply the type-based mapping and mark the step complete
  (mirrors `setup/index.ts` env auto-complete).

### 5.5 Wizard — frontend `ai-models-step.tsx`

- Rendered in `setup-page.tsx` when `currentStep.id === 'ai-models'` (same switch
  as `team-agents`/`voice-profiles`).
- Fetches the enriched payload (step detail or the dedicated read endpoint).
- **Claude detected:** heading *"Claude CLI detektálva és beállítva"*; a table
  `agent → agentType → model` where model is a `<SearchableSelect>`/dropdown
  prefilled with `proposedModelId`, options = `availableProviders` concrete
  models. "Alkalmaz" → POST `{assignments}` → advance.
- **Not detected:** message *"A wizard után állítsd be a megfelelő providert és
  modelleket az agenteknek."* + primary button → `/providers`. POST empty
  assignments (or skip) to complete the optional step.
- **i18n:** introduce `src/web/src/pages/setup/i18n.ts` +
  `locales/{en,hu}.json` (matching the `mission-control` pattern) for the new
  strings. Existing hardcoded strings in `team-agents`/`voice` may be migrated
  opportunistically but are out of scope.

### 5.6 Wizard — completion redirect

- `setup-page.tsx` final navigation `/login` → `/providers`.
- **Auth caveat (verify in planning):** if `__root`/route guards require an
  authenticated session and the wizard does not auto-login the root owner, land
  on `/login` with a post-login redirect to `/providers` (query param /
  returnTo), so the user is not bounced. The end state is "user sees
  `/providers`". Decide the exact mechanism after reading the login flow.

## 6. Testing (Vitest)

- `tier-resolver`: agentType→tier map; provider preference (claude-code >
  anthropic); tier→ID per provider; fallback when a tier/provider is absent;
  `normalizeModelAlias` (bare alias → concrete ID; exact ID passthrough;
  unresolvable → undefined).
- `gateway.resolveProvider`: bare `'sonnet'` resolves via normalization;
  unknown still throws.
- Anthropic provider: `listModels()` contains the current IDs; thinking policy
  helper picks adaptive vs budget vs omit per model; no `temperature` for
  4.7/4.8/Fable.
- CLI provider: `query()` maps `claude-code-opus`→`model:'opus'`; probe merges
  real ID with current caps.
- Setup step: registration + order; enriched payload (claudeDetected, agents
  with proposals); `onComplete` applies model assignments; optional/skip path.
- Frontend component test if a setup-component test pattern exists.

## 7. Out of scope / flagged

- OpenAI & Gemini model lists not refreshed (scope = CLI + Anthropic).
- Existing hardcoded strings in `team-agents`/`voice` steps (i18n migration
  optional).
- `version freeze until external testing` (`feedback_eyas_version_freeze`): these
  are additive/compat changes, no schema migration; acceptable.

## 8. File touch list

**Backend**
- `src/modules/model/tier-resolver.ts` (new)
- `src/modules/model/gateway.ts` (alias normalization in `resolveProvider`)
- `src/modules/model/submodules/claude-code/provider.ts` (caps, metadata,
  `query()` model, probe merge)
- `src/modules/model/submodules/claude-code/manifest.ts` (auto-probe once)
- `src/modules/model/submodules/anthropic/provider.ts` (model list, defaults,
  thinking/sampling policy)
- `src/modules/model/submodules/anthropic/adapter.ts` (per-model thinking helper)
- `src/modules/agent/model-router.ts` (refresh rule model IDs)
- `src/modules/model/index.ts` (register `ai-models` step; enriched payload /
  read endpoint; env auto-complete)

**Frontend**
- `src/web/src/pages/setup/ai-models-step.tsx` (new)
- `src/web/src/pages/setup/setup-page.tsx` (render new step; redirect → /providers)
- `src/web/src/pages/setup/i18n.ts` + `locales/{en,hu}.json` (new)

**Tests** — co-located under `tests/modules/model/`, `tests/modules/setup/`,
and frontend test dir per existing conventions.
