# Autonomous Agent Prompt Architecture (v2)

**Date:** 2026-04-26
**Status:** Draft (design approved, ready for implementation plan)
**Scope:** Replaces current DB-backed system prompt assembly with a file-based agent workspace, dual-scope voice system, provider-agnostic cache-aware runtime assembly, and sub-agent snapshot delegation.
**Supersedes:** `2026-04-08-prompt-system-design.md` (6-layer prompt assembler), `2026-04-09-agent-unification-design.md` (DB-stored persona fields)

---

## 1. Goal & Scope

### Problem

The current EYAS base system prompt lives in **DB columns** (`agent_definitions.role/goal/backstory/systemPrompt`) with a 4-tier inheritance cascade (master → project_type → project → conversation). This works but has significant limitations:

- **Not git-trackable, not portable.** A "Jarvis" persona cannot be moved to another machine or shared.
- **Agent cannot self-edit.** Forge proposals (DB updates via approval) work, but are not the same as an agent atomically updating its own "soul".
- **Identity and personality are conflated** in a single `systemPrompt` text blob, making fine-tuning hard.
- **No channel awareness.** The same voice is used for Telegram and email.
- **No prompt-cache exploitation.** Every turn rebuilds the full prompt; no static/dynamic separation.
- **Sub-agent prompts are ad-hoc.** The parent's voice is not snapshotted, so a delegated worker may speak in a different register.

### What this design delivers

- **File-based agent workspace** at `data/agents/<id>/` with `IDENTITY.md`, `SOUL.md`, `SOUL.style.json`, `AGENTS.md`, `TOOLS.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`.
- **Two-tier identity layer**: framework-controlled `CORE_IDENTITY` (in code, all agents share) + per-agent `IDENTITY.md` (mission, proactive duties, escalation rules).
- **Structured dual-scope voice system**: 6 orthogonal style dimensions (address, tone, verbosity, directness, humor, emoji) × two scopes (internal / external) per addressable agent, with 8 presets and freeform overrides.
- **AGENTS.md-only cascade** (master in code → project_type → project → agent); `IDENTITY`, `SOUL`, `TOOLS`, `MEMORY` are agent-only, never overridden by projects.
- **Provider-agnostic runtime assembly** with explicit cache boundary; provider adapters wire it up correctly for Anthropic (explicit `cache_control`), OpenAI (auto prefix cache), Gemini (`cachedContents` if applicable), Ollama (single system message + KV-cache reuse).
- **Sub-agent prompt snapshot**: when a primary delegates, the originating agent's voice profile is snapshotted into the sub-agent's prompt; consistent voice along the entire delegation chain.
- **Channel-aware voice selection**: a `ChannelResolver` decides the active scope per turn based on participants; group chats with any external participant default to external voice.
- **Self-evolution with trust tiers**: agents may freely write `AGENTS.md` / `TOOLS.md` / `MEMORY.md`; may edit `IDENTITY.md` with automatic user notification; may only modify `SOUL.style.json` via forge proposals subject to user approval.

### Out of scope (deferred to other specs)

- **Channel routing** (which agent receives which inbound message) — separate ingress feature.
- **Provider-specific overlay system** (e.g., GPT-5-only tuning sections) — interesting concept from OpenClaw, deferred.
- **MCP tool prompt-injection refactor** — already in flight.
- **A/B style experimentation runtime** for forge proposals — schema is forward-compatible, runtime deferred.
- **Inline tool-calling fallback** for legacy local models without native tool support — deferred; supported models are documented as those with native tool calling (Anthropic Claude, OpenAI GPT-4o+/o1, Google Gemini 1.5+/2.0+, Ollama Llama 3.1+/Qwen 2.5+/Mistral Nemo+, xAI Grok, DeepSeek).
- **Frontend redesign** of the agent editor UI — minimal additive changes only (new fields), no new design system.
- **Retroactive rewriting of historical audit prompts** — old logs continue to reference v1 fields; new structure applies forward only.

### Anti-scope (explicit non-goals)

- **No agent "life story" backstory field** — CrewAI's `backstory` is criticized in research as anti-pattern; SOUL stays operational, not narrative.
- **Not Hungarian-language-only** — style dimensions are language-independent enums; only the `address` dimension localizes (tegező/magázó/önöző for Hungarian; falls back to formal/casual for English/German/etc.).
- **No multi-tenant style isolation** — single-user EYAS, no tenant boundaries needed.

### Success criteria

1. A new user completes a working primary-agent style setup in **under 3 minutes** in the wizard.
2. An agent's `SOUL.md` is git-trackable and produces **byte-for-byte identical persona** on another machine after restore.
3. Sub-agent output is **stylistically indistinguishable** from the parent agent's own output.
4. With Anthropic and OpenAI providers, repeated agent loops (10 turns) achieve **≥80% prompt cache hit ratio** measured via provider usage telemetry. With other providers (Ollama, Mistral), the stable-prefix design produces **no latency or cost regression** versus the v1 system.
5. The existing 16 agent template seeds **migrate** to the new structure without data loss.
6. The agent can **explicitly answer** questions like "What is your job?", "What do you do proactively?", "When will you interrupt me?" by reading directly from CORE_IDENTITY + IDENTITY.md, not by hallucinating.

---

## 2. File-Based Architecture (C+)

### Filesystem layout

```
data/
├── sqlite/
│   └── eyas.db                       # registry, runtime state, audit logs (no prompt content)
├── agents/
│   └── <agent-id>/                   # per-agent workspace
│       ├── IDENTITY.md               # who + mission + proactive duties + escalation
│       ├── SOUL.md                   # voice (RENDERED from SOUL.style.json — read-only)
│       ├── SOUL.style.json           # source of truth for the 6 dim × 2 scope voice profile
│       ├── AGENTS.md                 # custom operational notes (user + agent edited)
│       ├── TOOLS.md                  # environment-specific notes
│       ├── MEMORY.md                 # long-term curated memory (loaded only in internal sessions)
│       ├── memory/
│       │   ├── 2026-04-26.md         # daily log files (auto-written by agent)
│       │   └── 2026-04-25.md
│       └── .history/                 # auto-snapshot rollback history (git-ignored if user uses git)
│           └── IDENTITY.md.2026-04-26T14-32-05.md
├── projects/
│   └── <project-id>/
│       └── AGENTS.md                 # project-specific cascade content
└── project-types/
    └── <type-id>/
        └── AGENTS.md                 # type-level cascade content (e.g. "Odoo dev conventions")
```

Framework-controlled (in source, not in workspace):

```
src/modules/prompt-wizard/
├── core-identity.ts                  # "You are an autonomous AI agent in EYAS..."
├── core-rules.ts                     # MANDATORY: audit, permissions, cost, blast radius
├── soul-renderer.ts                  # SOUL.style.json → SOUL.md transform
└── assembler.ts                      # main runtime assembler
```

These three files are **never editable** by user or agent — only deploy can change them.

### File specifications

| File | Purpose | Cap | Render source |
|---|---|---|---|
| `IDENTITY.md` | Who + what + why + when to interrupt | 600 tokens | Hand-edited or wizard-generated |
| `SOUL.md` *(rendered)* | Voice rules, both scopes inline | 500 tokens | Auto-rendered from `SOUL.style.json` |
| `SOUL.style.json` | Structured: 6 dim × 2 scope + freeform | n/a (form data) | Form input or preset selection |
| `AGENTS.md` | Custom rules + lessons learned | 800 tokens | Hand-edited or agent self-edit |
| `TOOLS.md` | Environment-specific notes | 400 tokens | Hand-edited or agent self-edit |
| `MEMORY.md` | Curated long-term memory | 800 tokens | Agent self-edit |
| `memory/YYYY-MM-DD.md` | Daily raw event log | 600 tokens/day | Agent self-edit |

Per-agent total cap: **60,000 chars** (OpenClaw-derived). Truncation marker inserted if exceeded.

### Edit rights matrix

| File | Wizard inits | UI form edit | Agent self-edit | Audit log | User notify |
|---|---|---|---|---|---|
| `IDENTITY.md` | ✓ AI-assisted | ✓ split form | ✓ via tool | ✓ | ✓ on change |
| `SOUL.style.json` | ✓ preset | ✓ structured form | ✗ direct (forge proposal only) | ✓ | ✓ approval flow |
| `SOUL.md` | n/a (rendered) | ✗ view only | ✗ never | render event | n/a |
| `AGENTS.md` | empty | ✓ markdown editor | ✓ append/edit | ✓ | none (silent) |
| `TOOLS.md` | empty | ✓ markdown editor | ✓ append/edit | ✓ | none |
| `MEMORY.md` | empty | ✓ view + edit | ✓ append/edit | ✓ | none |
| `memory/*.md` | n/a | ✓ view | ✓ auto-append | summary only | none |

### Database registry (metadata only)

`agent_definitions` table is reduced to a **registry**:

```typescript
{
  id: string                          // PK
  name: string
  tier: 'primary' | 'team' | 'specialist'
  addressable: boolean                // NEW — only addressable agents have SOUL/IDENTITY
  agentType: AgentType
  workspacePath: string               // NEW — relative path to data/agents/<id>/
  model: string
  maxTurns: number
  enabled: boolean
  source: 'seed' | 'user' | 'generated'
  monthlyTokenBudget: number
  tokensUsedMonth: number
  budgetResetAt: string
  config: string                      // JSON misc
  createdAt: string
  updatedAt: string
}
```

**Removed columns** (data migrated into workspace files): `role`, `goal`, `backstory`, `systemPrompt`, `capabilities`, `constraints`. Snapshotted to `agent_definitions_v1_snapshot` for one release cycle to allow rollback.

Tools (`agent_definitions.tools` JSON array of tool name pointers) **remain in DB** — pointers, not content.

### Cascade scope

Only `AGENTS.md` cascades. `IDENTITY.md`, `SOUL.md` / `SOUL.style.json`, `TOOLS.md`, `MEMORY.md` are **agent-only**. Rationale: persona and personal experience belong to the agent; a project must not rewrite "be a different person on this project". If different style is needed for a project, create a different agent for it.

---

## 3. Style System (6 Dimensions × 2 Scopes)

### Dimensions and enum values

```typescript
const ENUM_VALUES = {
  address:    ['tegező', 'magázó', 'önöző', 'kontextus-érzékeny'],
  tone:       ['komoly', 'kiegyensúlyozott', 'baráti', 'laza', 'játékos'],
  verbosity:  ['lényegre törő', 'kiegyensúlyozott', 'részletező'],
  directness: ['nagyon direkt', 'direkt + udvarias', 'diplomatikus', 'körülíró'],
  humor:      ['nincs', 'száraz/szellemes', 'könnyed', 'csípős/provokatív'],
  emoji:      ['soha', 'funkcionálisan', 'gyakran'],
} as const
```

**Constraints:**
- `address: 'kontextus-érzékeny'` — **external scope only** (in internal scope the owner's preference is fixed). Runtime: agent inspects the first few turns and mirrors the addresser; defaults to `magázó` on first contact.
- `humor: 'csípős/provokatív'` — UI displays a warning badge for external scope ("risky in client communication").

### Two scopes per addressable agent (both required)

Every addressable agent (`addressable=true`, typically `tier='primary'` and optionally `tier='team'`) must fill both:
- **Internal voice** — when speaking with the owner or internal team members
- **External voice** — when speaking with clients or anyone outside the internal circle

Specialists / sub-agents do **not** have their own SOUL — they snapshot from their parent at delegation time (see Section 4).

### Freeform fields (per scope, optional)

```typescript
{
  blockedPhrases: string[]            // max 10 items, max 80 chars each
  signature: string                   // max 200 chars
}
```

`blockedPhrases` lists corporate fillers to avoid (e.g., "Great question!", "Természetesen, ahogy szeretnéd"). `signature` is a short freeform note describing distinctive voice traits (e.g., "occasionally uses Hungarian idioms; avoids conditional mood").

### `SOUL.style.json` schema (Zod, version 1)

```typescript
export const voiceProfileSchema = z.object({
  address: z.enum(ENUM_VALUES.address),
  tone: z.enum(ENUM_VALUES.tone),
  verbosity: z.enum(ENUM_VALUES.verbosity),
  directness: z.enum(ENUM_VALUES.directness),
  humor: z.enum(ENUM_VALUES.humor),
  emoji: z.enum(ENUM_VALUES.emoji),
  blockedPhrases: z.array(z.string().max(80)).max(10).default([]),
  signature: z.string().max(200).default(''),
})

const internalProfileSchema = voiceProfileSchema.extend({
  address: z.enum(['tegező', 'magázó', 'önöző']),  // 'kontextus-érzékeny' excluded
})

export const soulStyleSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  preset: z.object({
    internal: z.enum([...PRESET_KEYS, 'custom']),
    external: z.enum([...PRESET_KEYS, 'custom']),
  }),
  internal: internalProfileSchema,
  external: voiceProfileSchema,
})
```

### Presets (8 + custom)

```typescript
const PRESETS = {
  'jarvis':       { address: 'magázó', tone: 'komoly',    verbosity: 'lényegre törő',    directness: 'direkt + udvarias', humor: 'nincs',             emoji: 'soha' },
  'best-buddy':   { address: 'tegező', tone: 'baráti',    verbosity: 'kiegyensúlyozott', directness: 'diplomatikus',      humor: 'száraz/szellemes',  emoji: 'funkcionálisan' },
  'senior-ceo':   { address: 'magázó', tone: 'komoly',    verbosity: 'lényegre törő',    directness: 'nagyon direkt',     humor: 'száraz/szellemes',  emoji: 'soha' },
  'pajtas-dev':   { address: 'tegező', tone: 'laza',      verbosity: 'lényegre törő',    directness: 'direkt + udvarias', humor: 'száraz/szellemes',  emoji: 'funkcionálisan' },
  'standup':      { address: 'tegező', tone: 'játékos',   verbosity: 'kiegyensúlyozott', directness: 'nagyon direkt',     humor: 'csípős/provokatív', emoji: 'gyakran' },
  'diplomata':    { address: 'önöző',  tone: 'komoly',    verbosity: 'részletező',       directness: 'diplomatikus',      humor: 'nincs',             emoji: 'soha' },
  'coach':        { address: 'tegező', tone: 'kiegyensúlyozott', verbosity: 'kiegyensúlyozott', directness: 'nagyon direkt', humor: 'száraz/szellemes', emoji: 'funkcionálisan' },
  'tutor':        { address: 'tegező', tone: 'baráti',    verbosity: 'részletező',       directness: 'diplomatikus',      humor: 'könnyed',           emoji: 'funkcionálisan' },
} as const
```

**Application rule:** selecting a preset sets all 6 enum fields. Modifying any field afterward flips `preset` to `'custom'`. Reselecting a preset overwrites.

### Render: `SOUL.style.json` → `SOUL.md` (English)

`SOUL.md` is auto-rendered. The renderer outputs both scopes in a single markdown file. The agent reads this file at session start; the runtime injects which scope is active via a separate `<active-voice>` block.

Address dimension renders language-aware (Hungarian / English / German mappings):

```typescript
const ADDRESS_RENDER_BY_LANG = {
  hu: { tegező: 'Use "te" / second-person singular',
        magázó: 'Use "Ön" / formal "you"',
        önöző:  'Use "ön" / softer formal',
        'kontextus-érzékeny': 'Mirror the addresser; default to "Ön" if first contact' },
  en: { tegező: 'Use casual "you" — no titles',
        magázó: 'Use formal address — Mr./Ms., professional distance',
        önöző:  'Same as magázó (English has no equivalent)',
        'kontextus-érzékeny': 'Mirror addresser register; default formal' },
  de: { tegező: 'Use "du"',
        magázó: 'Use "Sie"',
        önöző:  'Use "Sie" with extra politeness',
        'kontextus-érzékeny': 'Mirror; default "Sie"' },
}
```

### Wizard flow per addressable agent

1. **Internal voice** — pick preset, optionally tune the 6 dimensions
2. **External voice** — pick preset, optionally tune
3. **Optional freeform** — blocked phrases + signature flair (skippable)

Default install (2 agents, see Section 8.3) requires only **4 preset clicks** (no fine-tuning) if defaults are acceptable.

---

## 4. Inheritance & Cascade + Sub-Agent Snapshot

Two distinct mechanisms must be kept separate:

### 4.1 Vertical cascade (AGENTS.md only)

Order in the runtime prompt:

```
1. CORE_RULES (code, locked)                    ─┐
2. project-types/<typeId>/AGENTS.md              │  conditional, included only if
3. projects/<projectId>/AGENTS.md                │  type/project context exists
4. agents/<agentId>/AGENTS.md                   ─┘
```

**Append semantics**: each level concatenates to the next; lower levels add rules, do not replace.

**Conflict resolution**: when a lower level explicitly contradicts a higher level, the more specific (lower) level wins. CORE_RULES contains only red-line rules (audit, security, cost) that cannot be overridden; everything else can be refined or overridden at any lower level.

**Token cap for the cascade**: 3200 total. Truncation order: project-type → project → agent (truncate from highest level first to preserve agent-specific rules).

**Files NOT in cascade**: `IDENTITY.md`, `SOUL.md` / `SOUL.style.json`, `TOOLS.md`, `MEMORY.md`, `memory/*` are **agent-only, never cascade**.

### 4.2 Horizontal snapshot (sub-agent delegation)

When a primary agent invokes `delegate_to_agent` (or a team session spawns a sub-agent):

#### What the sub-agent receives

```typescript
interface SubAgentPromptInput {
  // Framework constants (static)
  coreIdentity: string
  coreRules: string

  // Project context (cascade)
  projectTypeAgents?: string
  projectAgents?: string

  // Sub-agent role (narrowed)
  subagentName: string
  delegatedTask: string
  outputAudience: 'parent' | 'external'

  // Parent snapshot (the key part)
  parentSnapshot: {
    agentId: string                   // originating agent ID
    name: string
    voiceProfile: VoiceProfile        // the relevant scope (internal or external)
    voiceProfileSource: 'internal' | 'external'
    blockedPhrases: string[]
    signature: string
    originatingAgentId: string
  }

  // Team context (optional)
  teamMembers?: TeamMemberSummary[]
  parentMemoryDigest?: string         // shared findings from team memory
}
```

#### Sub-agent prompt sections (reduced mode)

```
1. CORE_IDENTITY (code, static)                  ← cache prefix
2. CORE_RULES (code, static)                     ← cache prefix
3. <project-context>                             ← cache prefix (if present)
4. <subagent-role>                               ← dynamic
5. <delegated-voice>                             ← dynamic, parent snapshot
6. <task>                                        ← dynamic
7. <output-audience>                             ← dynamic
8. <runtime>                                     ← dynamic
```

**Excluded** from sub-agent prompts (OpenClaw `PromptMode='minimal'` pattern): own SOUL/IDENTITY (none), MEMORY, daily memory, full skills list, heartbeat / proactive duties (sub-agents are not proactive — they execute one delegated task and exit).

#### Voice scope selection from snapshot

| `outputAudience` | Voice scope used |
|---|---|
| `'parent'` (default — sub-agent reports back to parent) | parent **internal** voice |
| `'external'` (e.g. "draft an email to client") | parent **external** voice |

Override: the `delegate_to_agent` tool accepts `voiceOverride: 'internal' | 'external' | { custom voice profile }` for explicit cases.

#### Originating agent — root of the delegation chain

When primary A delegates to primary B who delegates to specialist C, **C's voice is snapshotted from A**, not B. Rationale: the user/client experiences a single consistent voice for the conversation, regardless of internal team handoffs.

The `team_sessions` table gains `originating_agent_id` (the ID of the primary that started the user-facing conversation).

**Exception**: when a sub-agent communicates directly back to the immediate parent (not the originating agent), the immediate parent's voice wins. Rare.

#### Snapshot temporal stability

The snapshot is taken at delegation time and stored in `team_sessions.parent_snapshot` (JSON). If the parent's style is updated mid-session via UI, **already-running sub-agents continue using the old snapshot** — no context re-injection. New sub-agent spawns get a fresh snapshot.

#### Spawn depth

Default `maxSpawnDepth=2` (OpenClaw-derived): primary → sub-agent → sub-sub-agent. Beyond depth 2, spawning is disabled to prevent depth explosion. Configurable via `agents.defaults.maxSpawnDepth`.

---

## 5. Runtime Prompt Assembly (Provider-Agnostic)

### Stable prefix → cache boundary → dynamic suffix → reminders

```
┌─ Cache prefix (stable until workspace files change) ─┐
│  1. CORE_IDENTITY                                     │
│  2. CORE_RULES                                        │
│  3. PROJECT CONTEXT CASCADE                           │
│  4. AGENT IDENTITY (IDENTITY.md)                      │
│  5. AGENT VOICE (SOUL.md — both scopes)               │
│  6. AGENT NOTES (AGENTS.md)                           │
│  7. AGENT ENV NOTES (TOOLS.md)                        │
│  8. AVAILABLE SKILLS (names + 1-line)                 │
│  9. AVAILABLE TOOLS (names + 1-line)                  │
├══ CACHE BOUNDARY (hint for adapters) ═══════════════┤
│  Cache suffix (dynamic per turn)                      │
│  10. TEAM CONTEXT (if team session)                   │
│  11. MEMORY CONTEXT (top-N working + ancestry)        │
│  12. RUNTIME (date, channel, env, git status)         │
│  13. ACTIVE VOICE DIRECTIVE                           │
└──────────────────────────────────────────────────────┘

Plus: per-message system reminders (separate messages, not in system prompt)
```

### Output type (provider-agnostic)

```typescript
export interface AssembledPrompt {
  prefix: string                      // stable section
  suffix: string                      // dynamic section
  reminders: string[]                 // runtime per-turn injections
  cacheBoundaryHint: number           // char position of stable/dynamic boundary
  prefixHash: string                  // sha256(prefix) for cache lookup
  tokenEstimate: { prefix: number; suffix: number; reminders: number }
}
```

The boundary is **metadata only** — each provider adapter decides what to do with it.

### Provider compatibility

| Provider | Cache mechanism | Adapter behavior |
|---|---|---|
| Anthropic Claude | Explicit `cache_control: ephemeral`, 5-min TTL, separate cache_write pricing | Two `system` blocks: prefix with cache_control marker, then suffix and reminders |
| OpenAI (GPT-4o, o1) | Automatic prefix cache, 5-10 min TTL, transparent ~50% discount on cached tokens | Single `system` message: prefix + suffix concatenated; prefix stability auto-caches |
| Google Gemini | Explicit `cachedContents` API, min 32k tokens, configurable TTL | Use explicit cache only when prefix > 32k (rare). Otherwise single system message |
| xAI Grok | OpenAI-style automatic | Same as OpenAI adapter |
| DeepSeek | Automatic prefix cache, separate billing tier | Same as OpenAI adapter |
| Ollama / local | No API-level cache | Single system message; stable prefix may help llama.cpp KV-cache reuse |
| Mistral | No formal cache (yet) | Single system message |

The "stable prefix → boundary → dynamic suffix" design is beneficial for **all providers**, even those without explicit cache APIs (auto-prefix-cache providers like OpenAI; KV-cache reuse for local).

### Tool descriptions — always via native API

Tool schemas go through the provider's native function-calling API (`tools` array for Anthropic / OpenAI / Gemini / Ollama). The prompt's `<available-tools>` section contains only **human-readable name + 1-line description** so the agent knows what's available; full schemas are not in the prompt.

Legacy local models without native tool calling: deferred (out of scope for MVP). Documented supported models list those with native tool calling.

### System reminders channel (separate messages)

Following the Claude Code pattern, runtime context (channel updates, scope switches, tool result truncation notices) is injected as `<system-reminder>` blocks in **separate messages**, not in the system prompt. This avoids invalidating the prompt cache.

For providers that don't support multiple system messages (Google's `systemInstruction`), the adapter concatenates with newline separators.

### Token budget allocation

| Section | Cap | Truncation behavior |
|---|---|---|
| CORE_IDENTITY | 200 | Hard limit, code-controlled |
| CORE_RULES | 500 | Hard limit, code-controlled |
| Project cascade (3 levels) | 3000 | Truncate top-down (project-type first) |
| IDENTITY.md | 600 | Trunc marker + UI warning |
| SOUL.md | 500 | Hard limit (rendered output) |
| AGENTS.md | 800 | Trunc marker |
| TOOLS.md | 400 | Trunc marker |
| Skills list | 400 | Top-K by relevance |
| Tools list | 500 | Names + 1-line, schemas via native API |
| Team context | 400 | Trunc oldest member info |
| Memory context | 600 | Top-3 working + 1-line ancestry |
| Runtime | 200 | Hard limit |
| Active voice | 100 | Hard limit |
| **Cache prefix subtotal** | **~6900** | |
| **Cache suffix subtotal** | **~1900** | |
| **Grand total base prompt** | **~8800** | |

Sub-agent prompt (reduced): ~3000 tokens (CORE + project cascade + DELEGATED_VOICE + TASK + RUNTIME).

### Dynamic budget shrinking for small-context models

Model registry includes `effectiveContextWindow: number` (required for new models). Default budget formula:

```
promptBudget = min(8800, effectiveContextWindow * 0.4)
```

40% reserved for the system prompt; 60% for conversation history + response. YAML override available per-model: `models.<id>.promptBudget` for exotic cases. For Llama 3.1 8B (8k context), the effective budget is ~3200 tokens — IDENTITY.md and SOUL.md fit, but project cascade and most of AGENTS.md get truncated.

### Assembler API skeleton

```typescript
// src/modules/prompt-wizard/assembler.ts
export interface AssemblerDeps {
  agentRegistry: AgentRegistry
  workspaceLoader: WorkspaceLoader
  projectContextLoader: ProjectContextLoader
  skillsMatcher: SkillsMatcher
  toolRegistry: ToolRegistry
  contextBuilder: ContextBuilderV2
  channelResolver: ChannelResolver
}

export function createPromptAssembler(deps: AssemblerDeps) {
  async function buildForPrimary(opts: BuildOptions): Promise<AssembledPrompt> {
    const ws = await deps.workspaceLoader.load(opts.agentId)
    const projectCascade = await deps.projectContextLoader.cascade(opts)
    const scope = deps.channelResolver.resolveScope(opts.channelContext)
    const prefix = buildCachePrefix({ ws, projectCascade, ... })
    const suffix = await buildCacheSuffix({ ws, scope, opts })
    return {
      prefix,
      suffix,
      reminders: [],
      cacheBoundaryHint: prefix.length,
      prefixHash: sha256(prefix),
      tokenEstimate: estimateTokens(prefix, suffix),
    }
  }

  async function buildForSubAgent(opts: SubAgentOptions): Promise<AssembledPrompt> {
    // Reduced prompt with parent snapshot, no own SOUL/IDENTITY
  }

  return { buildForPrimary, buildForSubAgent }
}
```

### File-watcher → cache invalidation

A `chokidar` watcher monitors `data/agents/<id>/`. On file change:
1. Recompute `prefixHash` for affected agent
2. Old cache implicitly invalidates (different hash → new lookup key)
3. Next turn writes a new cache entry

`SOUL.style.json` changes also trigger `soul-renderer` to re-emit `SOUL.md` (debounced 250ms + content hash check to avoid render loops).

---

## 6. Channel-Aware Voice Selection (Rule B)

### The problem

The same agent communicates across many channels with different audiences. The runtime must pick the right scope (internal vs external) per turn.

### Channel context resolver

```typescript
export type VoiceScope = 'internal' | 'external'

export interface ChannelContext {
  channelType: 'web' | 'telegram' | 'email' | 'odoo-chatter' | 'hand-companion' | 'api'
  conversationKind: 'owner-dm' | 'group' | 'public-channel' | 'broadcast'
  participants: ParticipantInfo[]
  origin: 'inbound' | 'outbound-proactive'
}

export interface ParticipantInfo {
  id: string
  type: 'owner' | 'team-member' | 'known-contact' | 'unknown-external'
}
```

### Resolution rule (Rule B — agreed)

```typescript
export function resolveScope(ctx: ChannelContext): VoiceScope {
  // 1. Owner-only DM → internal
  if (ctx.participants.length === 1 && ctx.participants[0].type === 'owner') {
    return 'internal'
  }
  // 2. Owner + team-members only (no externals) → internal
  if (ctx.participants.every(p => p.type === 'owner' || p.type === 'team-member')) {
    return 'internal'
  }
  // 3. Anyone else (known-contact or unknown-external) present → external
  return 'external'
}
```

### Internal contacts registry

New table `internal_contacts`:

```typescript
{
  id: string                          // PK
  identifier: string                  // e.g. telegram_user_id, email, slack_id
  channelType: ChannelType
  displayName: string
  role: 'owner' | 'team-member'
  scope: 'internal' | 'external'      // always 'internal' for team-member
  notes: string
  addedAt: string
  addedBy: string
}
```

Wizard prompts the user to add their own contacts during install (Telegram ID, email). Team members can be added later via UI or via agent tool `add_internal_contact` (with user confirmation).

**Default for unknown contacts**: `external` (safer to over-formal than to over-familiar).

### Voice scope override hierarchy

When the resolver returns a scope, it can be overridden. Priority (highest wins):

1. **Per-message explicit override** (programmatic API, e.g., scheduler tasks)
2. **Session ephemeral override** (user instruction in conversation: "tegezz minket nyugodtan")
3. **Per-conversation UI override** (`conversations.voice_scope_override`)
4. **Per-channel forced scope** (`channels.force_voice_scope`)
5. **Auto resolution** (default, `ChannelResolver`)

### Active voice runtime injection

Every message includes in the suffix:

```xml
<active-voice>
Voice scope: EXTERNAL
Reason: Telegram group with unknown participants (1 owner, 2 team-members, 1 known-contact)
Effective profile (from your SOUL.md):
- Address: magázó
- Tone: komoly
- Verbosity: kiegyensúlyozott
- Directness: diplomatikus
- Humor: nincs
- Emoji: soha
- Blocked phrases: ["Szuper!", "Imádni való"]
</active-voice>
```

The agent sees **why** the scope was chosen — easier to debug and to answer user questions like "why are you being formal?".

### Group chat behavior (separate from voice scope)

Group chat speech-act guidelines (when to speak vs stay quiet) are documented in CORE_IDENTITY (apply to all agents) and may be customized per agent in IDENTITY.md. Default rules:

> Group chat behavior: don't speak for the owner. Stay quiet by default. Respond when: directly mentioned, asked a question, can correct important misinformation, or asked to summarize. Stay quiet when: it's casual banter between humans, or someone already answered.

This is a behavioral rule, separate from voice style.

### New unknown contact flow

When a message arrives from an unknown sender:
1. Resolver classifies as `unknown-external` → `external` scope
2. Agent responds formally
3. If owner reveals during conversation that this person is internal ("Ez Imre, az új munkatársunk"), the agent invokes `add_internal_contact` tool, which (with owner confirmation) updates the `internal_contacts` table → from the next turn the contact is `team-member` → scope shifts to internal

---

## 7. Self-Evolution & Forge Integration

### Trust tiers per file

```
HIGHEST    SOUL.style.json      — agent CANNOT direct-write; forge proposal only
   ↑
MEDIUM     IDENTITY.md          — agent may edit; auto-notify owner with diff
   ↑
LOW        AGENTS.md            — agent freely writes; audit log only
           TOOLS.md
           MEMORY.md
           memory/YYYY-MM-DD.md
   ↑
NEVER      core-identity.ts     — code, deploy-only
           core-rules.ts        — code, deploy-only
           SOUL.md (rendered)   — auto-rendered, never an edit target
           agent_definitions    — most fields admin-only
```

Logic: persona ("how you sound") is the strongest contract with the user; voice changes require approval. Mission ("what you do") may evolve, but the user must be told. Notes/memory are the agent's own head; silent self-update is fine.

### Self-edit tools

```typescript
// Free-write to agent's own AGENTS.md / TOOLS.md / MEMORY.md / memory/YYYY-MM-DD.md
{
  name: 'workspace_append',
  description: 'Append content to your own workspace file',
  inputSchema: z.object({
    file: z.enum(['AGENTS.md', 'TOOLS.md', 'MEMORY.md'])
      .or(z.string().regex(/^memory\/\d{4}-\d{2}-\d{2}\.md$/)),
    content: z.string().max(8000),
    section: z.string().optional(),
  }),
}

{
  name: 'workspace_edit',
  description: 'Edit existing content in your own workspace file',
  inputSchema: z.object({
    file: z.enum(['AGENTS.md', 'TOOLS.md', 'MEMORY.md']),
    oldString: z.string(),
    newString: z.string(),
  }),
}

// IDENTITY.md — self-edit triggers user notification
{
  name: 'workspace_update_identity',
  description: 'Update your own IDENTITY.md (mission, proactive duties, escalation rules). User will be notified with a diff.',
  inputSchema: z.object({
    section: z.enum(['Who I am', 'My mission', 'Ongoing proactive duties', 'When to escalate', 'When to refuse']),
    newContent: z.string().max(2000),
    reasoning: z.string().min(20).max(500),
  }),
}

// SOUL.style.json — proposal only, requires user approval
{
  name: 'forge_propose_soul_change',
  description: 'Propose a change to your own voice/style profile. Goes to user for approval.',
  inputSchema: z.object({
    scope: z.enum(['internal', 'external']),
    field: z.enum(['address', 'tone', 'verbosity', 'directness', 'humor', 'emoji', 'blockedPhrases', 'signature']),
    currentValue: z.unknown(),
    proposedValue: z.unknown(),
    reasoning: z.string().min(50),
    evidenceCount: z.number(),
  }),
}

// Project AGENTS.md (cascade levels) — proposal only
{
  name: 'forge_propose_project_rule',
  description: 'Propose adding/changing a rule in the project AGENTS.md cascade.',
  inputSchema: z.object({
    level: z.enum(['project', 'project-type']),
    levelId: z.string(),
    operation: z.enum(['append', 'edit', 'remove']),
    section: z.string().optional(),
    proposedContent: z.string(),
    reasoning: z.string().min(50),
  }),
}
```

### IDENTITY.md self-edit notification flow

After a `workspace_update_identity` write:
1. Audit log entry (`audit_log.action='identity_update'`)
2. Notification to owner via `notifications` module (batched, 5-minute window):
   - title: `"<agent name> updated their IDENTITY.md"`
   - body: section name + reasoning
   - diff view embedded
   - actions: `[Approve (no-op), Revert]`
3. User can revert with one click; revert restores from `.history/` snapshot

Config flag: `autonomy.identitySelfUpdate` (default `true`). When `false`, IDENTITY.md changes also require forge approval.

### Forge integration for SOUL changes

The `forge_proposals` table is extended with `target='soul'`. UI displays SOUL proposals in the existing forge approval list with a diff view of the affected dimension(s). On approval:
1. `SOUL.style.json` is updated
2. `soul-renderer` re-emits `SOUL.md`
3. File-watcher invalidates the cache
4. Audit log entry
5. Notification ack

### Self-edit detection triggers

The `self-learning` and `skill-evolution` modules already build friction-pattern detection. Integration:

| Trigger | Action | Target |
|---|---|---|
| User repeatedly corrects agent's verbosity (3+ times) | `forge_propose_soul_change` | `SOUL.style.json` |
| User states a recurring preference ("always include …") | `workspace_append` | `MEMORY.md` |
| New skill/tool used several times → workflow learned | `workspace_append` | `AGENTS.md` |
| New environment fact (SSH host, device name) | `workspace_append` | `TOOLS.md` |
| Owner instructs new proactive duty ("also do summary at 6pm") | `workspace_update_identity` | `IDENTITY.md` |

### Rollback and history

Every write to a workspace file produces an automatic snapshot in `data/agents/<id>/.history/`:

```
.history/
├── IDENTITY.md.2026-04-26T14-32-05.md
├── AGENTS.md.2026-04-26T14-15-22.md
└── ...
```

Cap: last 30 snapshots per file (older auto-purged). UI shows a "History" button per file with diff view and "Restore" action. If the user uses git on `data/agents/<id>/`, `.history/` is added to `.gitignore` automatically.

### Hard boundaries (agent NEVER touches)

- Own `tier` / `addressable` / `monthlyTokenBudget` (registry metadata)
- Other agents' workspaces
- `core-identity.ts`, `core-rules.ts` (in code)
- Other users' `internal_contacts`
- Host filesystem outside `data/agents/<id>/`

Enforced by `workspace_*` tool input schema (path validation) + permissions module (CASL).

---

## 8. Migration & Testing

### 8.1 Migration script (`scripts/migrate-prompts-v2.ts`)

```
1. Pre-flight check
   - data/sqlite/eyas.db exists
   - data/agents/ does not exist (or is empty) — abort otherwise
   - Backup: data/sqlite/eyas.db.pre-prompts-v2.bak

2. Read existing
   - SELECT * FROM agent_definitions
   - SELECT * FROM prompt_templates
   - SELECT * FROM project_types
   - SELECT * FROM projects

3. Per agent — create workspace
   For each row in agent_definitions:
     mkdir -p data/agents/<id>/memory/
     write IDENTITY.md from { name, role, goal, backstory, tier }
     write SOUL.style.json with default preset (no SOUL data exists in v1)
     soul-renderer → SOUL.md
     write AGENTS.md from { systemPrompt, capabilities, constraints } via AI-assisted split
     write empty TOOLS.md, MEMORY.md
     UPDATE agent_definitions SET workspace_path = 'data/agents/<id>/'

4. Per project_type / project — create cascade files
   For each row in project_types WHERE prompt IS NOT NULL:
     mkdir -p data/project-types/<id>/
     write AGENTS.md from prompt
   Same for projects

5. Schema migration (Drizzle)
   - ADD agent_definitions.workspace_path TEXT NOT NULL
   - ADD agent_definitions.addressable INTEGER NOT NULL DEFAULT 0
     (tier IN ('primary','team') → addressable=1; specialist → 0)
   - DROP role, goal, backstory, system_prompt, capabilities, constraints
     (snapshotted to agent_definitions_v1_snapshot for 1 release)
   - DROP TABLE prompt_templates (moved to code)
   - CREATE TABLE internal_contacts
   - ADD team_sessions.originating_agent_id, team_sessions.parent_snapshot
   - ADD conversations.voice_scope_override
   - ADD channels.force_voice_scope

6. Snapshot table
   - agent_definitions_v1_snapshot (full row backup)
   - kept for 1 release; CLI command: eyas migrate rollback prompts-v2

7. Bootstrap CORE files (from build, not migration)
   - core-identity.ts and core-rules.ts deployed via code

8. Validation
   - Per agent: assembler.buildForPrimary() returns without error
   - Token estimate ≤ 8800 per agent
   - Voice render valid for both scopes

9. Report
   - Console: agents migrated, project_type cascades, truncations
   - Log: data/migrations/2026-04-26_prompts-v2.log
```

### 8.2 AI-assisted system_prompt split

The legacy `agent_definitions.systemPrompt` is a single text blob. Migration uses one LLM call per agent to split it:

```typescript
async function splitLegacySystemPrompt(legacy: string, agentMeta: AgentMeta): Promise<{
  identityMission: string
  identityProactiveDuties: string
  identityEscalation: string
  agentsRules: string
}>
```

Fallback: on low confidence or LLM failure, the entire `systemPrompt` is appended verbatim to `AGENTS.md` under a `## Legacy Rules` section, marked in the UI as "Migrated legacy rules" for user review.

### 8.3 Re-seed the 16 agent templates

`src/modules/agent/agent-templates.ts` gets a new shape:

```typescript
export interface AgentTemplate {
  id: string
  name: string
  tier: 'primary' | 'team' | 'specialist'
  addressable: boolean                // NEW
  agentType: AgentType
  category: 'primary' | 'recommended' | 'specialist'
  defaultEnabled: boolean
  description: string

  workspaceSeed: {
    identityMd: string                // full IDENTITY.md content
    soulStylePreset: PresetKey        // e.g. 'jarvis', 'best-buddy'
    agentsMdSeed: string              // initial AGENTS.md
    toolsMdSeed: string               // typically empty / template
  }

  model: string
  maxTurns: number
  defaultTools: string[]
}
```

The 16 existing templates are **rewritten by hand** (one-time, ~2 days of work) to produce high-quality workspace seeds and to validate the new format end-to-end.

The two default-install primary agents:
- **Personal Assistant (Jarvis-like)** — preset `best-buddy` (internal) + `diplomata` (external)
- **System Engineer** — preset `pajtas-dev` (internal) + `diplomata` (external)

### 8.4 Backwards compatibility

- `model` module API unchanged (input/output types stable)
- `conversations` API unchanged
- Existing audit log entries remain readable (new types added, old not deleted)
- Frontend agent-edit form is rebuilt around new fields; deep links to old field-edit URLs redirect to the new workspace file editors

### 8.5 Forward compatibility — schema versioning

Every workspace file begins with YAML frontmatter:

```yaml
---
schema: eyas.workspace.v1
agentId: jarvis-uuid
generatedAt: 2026-04-26T14:32:05Z
---
```

The workspace loader detects the schema version. Future v2 changes ship with auto-upgrade migrations.

### 8.6 Unit tests (Vitest)

| Module | Tests |
|---|---|
| `assembler.buildForPrimary` | 12 tests: minimal/full prompt, cascade levels, missing files, truncation, voice scope, token budget |
| `assembler.buildForSubAgent` | 8 tests: parent snapshot, originating agent, depth limits, audience scope, cascade inclusion, exclusion of own SOUL/IDENTITY |
| `soul-renderer` | 10 tests: each preset → valid SOUL.md, all enums, freeform fields, both scopes, missing fields fallback, JSON schema validation |
| `channel-resolver.resolveScope` | 12 tests: owner DM, owner+team-member, owner+external, group all-internal, group mixed, group all-external, override per conversation/channel, ephemeral override, default unknown=external |
| `workspace-loader` | 6 tests: valid load, missing file fallback, oversized truncation, invalid schema, file-watcher invalidation, hash stability |
| forge propose for soul | 4 tests: valid proposal create, approval applies, reject reverts, audit logged |

Coverage target: **≥85% line coverage per module**.

### 8.7 Integration tests

| Scenario | Verifies |
|---|---|
| End-to-end: wizard → workspace → first message → assembled prompt | Full flow works, token cap respected |
| Sub-agent delegation: primary → specialist → output → parent | Snapshot voice works, originating agent preserved |
| Voice scope switch mid-conversation: external → user override → internal | Ephemeral override applies, agent style changes |
| Self-edit IDENTITY.md → user notification → revert | Notification fires, revert restores |
| SOUL change forge proposal → user approve → render | SOUL.md regenerated, cache invalidates |
| Telegram group with mixed participants → external scope | Resolver classifies correctly |
| Cascade: project-type + project + agent AGENTS.md → all visible in prompt | Append order and truncation order correct |
| Provider switch: same prompt → Anthropic / OpenAI / Ollama | All adapters wire stable prefix correctly |

### 8.8 Performance / cache measurement

```typescript
describe('Prompt cache hit ratio (Anthropic)', () => {
  it('achieves ≥80% cache hit in 10-turn loop', async () => {
    const agent = await setupTestAgent()
    const conversation = await startConversation(agent.id)

    let cacheHits = 0
    for (let i = 0; i < 10; i++) {
      const response = await sendMessage(conversation, `turn ${i}`)
      if (response.usage.cache_read_input_tokens > 0) cacheHits++
    }
    expect(cacheHits / 10).toBeGreaterThanOrEqual(0.8)
  })
})
```

OpenAI equivalent: `usage.prompt_tokens_details.cached_tokens`. Local Ollama: skip (no cache API).

### 8.9 Voice scope test fixtures

`tests/fixtures/voice-scenarios.json` with 20+ scenarios, each:
- channel context input
- expected scope
- expected SOUL.md voice profile snippet that should activate
- expected runtime injection

### 8.10 Migration tests

```typescript
describe('Migration v1 → v2', () => {
  it('preserves all 16 default agent templates', async () => {
    await seedV1Database()
    await runMigration('prompts-v2')

    for (const templateId of DEFAULT_TEMPLATE_IDS) {
      const ws = await loadWorkspace(templateId)
      expect(ws.identity).toContain('mission')
      expect(ws.soulStyle).toMatchSchema(soulStyleSchema)
      expect(ws.agentsMd).toBeTruthy()
    }
  })

  it('rollback restores v1 state', async () => {
    await seedV1Database()
    await runMigration('prompts-v2')
    await runRollback('prompts-v2')

    const v1Data = await db.select().from(agent_definitions_v1_snapshot)
    expect(v1Data).toEqual(originalSeed)
  })
})
```

### 8.11 Manual QA checklist (release gate)

- [ ] Fresh install → wizard → 2 default agents → both scopes filled in <1 minute
- [ ] Personal Assistant on Telegram with owner → tegező
- [ ] Personal Assistant on Telegram group with client → magázó
- [ ] Mid-conversation: "tegezz minket" → switches
- [ ] System Engineer commit request → magázás or tegezés per default
- [ ] Sub-agent (code-reviewer) output → arrives in Jarvis voice
- [ ] IDENTITY.md self-edit → notification with diff
- [ ] SOUL change proposal → forge UI shows approve button
- [ ] Existing project (Werth) prompt visible in cascade
- [ ] Anthropic + OpenAI + Ollama all work with same agent
- [ ] Anthropic 10-turn loop ≥80% cache hit
- [ ] Token budget overflow → truncation marker, no error

### 8.12 Risks and mitigations

| Risk | Mitigation |
|---|---|
| AI split of legacy systemPrompt misclassifies | Fallback: full text to AGENTS.md → user refines; UI marks as "Migrated legacy" |
| Agent self-edit too frequent → notification spam | Rate limit (max 3 IDENTITY changes per day), batched 5-minute notification window |
| Manual workspace file edit → invalid schema | Loader Zod validation; on error fallback to default + user notify |
| Cache invalidation too frequent (file-watcher noise) | Debounce 250ms + content hash check |
| Provider behavior drift (e.g., OpenAI less sensitive to tegezés than Claude) | `<active-voice>` block is explicit and redundant; 20-scenario fixture tested per provider |

---

## Decision log (during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Persona storage | C+ hybrid: DB registry + workspace markdown files | Gitable + portable + agent self-editable + UI-manageable; balances all constraints |
| Style dimensions | 6 enums per scope, 8 presets, 2 freeform fields | Few enough for a 3-min wizard, expressive enough for variety |
| Style scope | Per addressable agent, both internal + external mandatory | Every addressable agent talks to both audiences eventually |
| Sub-agent style | Snapshot from originating agent (chain root) | Single consistent voice for the user/client throughout delegation chain |
| Default install agents | Personal Assistant + System Engineer (current EYAS seeds) | Existing roles cover the two main use cases |
| Style on specialists | None — specialists snapshot from parent only | Specialists are tools, not characters |
| Cascade scope | AGENTS.md only (IDENTITY/SOUL/TOOLS/MEMORY agent-only) | Persona is constant across projects; rules can vary |
| Project-level voice override | Not supported | Cleaner model: create a different agent for different style |
| Voice scope detection | Rule B — owner+team-members only → internal; any external → external | Pragmatic, no message-level audience detection complexity |
| Group chat default | External voice always (unless all participants are internal) | Conservative; safe default |
| `address: 'kontextus-érzékeny'` | External scope only | Internal is always between owner-known parties |
| `humor: 'csípős/provokatív'` | Allowed external with UI warning badge | User informed of risk; not blocked |
| Token budget per model | Dynamic (`min(8800, ctx*0.4)`) + optional YAML override | Zero-config for most models; power users can tune |
| Inline tool fallback for legacy local models | Deferred (not in MVP) | Modern Ollama models support native tool calling; no need yet |
| `autonomy.identitySelfUpdate` default | `true` (agent may self-edit IDENTITY with notify) | Autonomy is the point; notify keeps user informed |
| `maxSpawnDepth` | 2 (OpenClaw-derived) | Prevents depth explosion |
| Originating-agent voice in chain | Always wins over immediate parent | Conversation continuity |
| Spec language | English | Consistent with codebase and other specs |
| SOUL.md render language | English | Consistent with prompt; runtime selects language for the user-facing message |

---

## Open items (resolved during implementation, not blocking design)

- **Concrete CORE_IDENTITY text** — to be drafted during implementation; reviewed by user before code merge
- **Concrete CORE_RULES text** — to be drafted during implementation; reviewed by user
- **AI-split prompt template** for migration — to be tuned with sample agents during implementation
- **UI mockups** for the new style editor — to be prepared during frontend implementation phase
- **Forge proposal UI** for SOUL changes — to be added to existing forge UI; specific design during frontend work
- **Localization of SOUL.md address render** for languages beyond hu/en/de — only hu/en/de in MVP; others added on demand

---

## Next step

Hand off to `writing-plans` skill for a detailed implementation plan covering:
- Phase 0: scaffolding (new module structure, schemas)
- Phase 1: file-based workspace + loader + watcher
- Phase 2: SOUL system (schema, presets, renderer, validation)
- Phase 3: assembler refactor (provider-agnostic, cache boundary)
- Phase 4: provider adapter updates (Anthropic / OpenAI / Gemini / Ollama)
- Phase 5: ChannelResolver + voice scope wiring
- Phase 6: self-edit tools + forge integration
- Phase 7: migration script + 16 template re-seed
- Phase 8: tests (unit + integration + perf + manual QA)
- Phase 9: frontend (wizard updates, agent editor, voice scope UI, forge UI for SOUL)
- Phase 10: documentation update (CHANGELOG, architecture spec section)
