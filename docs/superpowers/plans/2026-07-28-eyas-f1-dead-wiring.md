# EYAS F1 — Dead-Wiring Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the finished-but-never-wired components the 2026-07-28 vision audit found: the dead agent-facing tool seams (agents currently get zero working retrieval/board/messaging tools on native providers), run-scoped team-memory threading (vision goal 6), the board→agent trigger + async `assign_task` handoff (goal 5), the dead WS topics + missing REST hydration (the realtime UI is systemically blind), and the background-runner settings regression — plus the three contract-test harnesses (tool↔service, WS emit↔subscribe, schema↔update-chain) that structurally kill this defect class.

**Architecture:** "Wire, don't write." Every fix connects an existing component via the smallest correct seam: lazy service getters for tool factories (F0's `getSecurityGate` pattern), one schema-driven update map in conversation-service (compile-error on drift), one stage-automation producer + the existing bot-executor consumer, direct `registry.broadcast` at emit sites through a shared `WS_TOPICS` constants module, and REST hydration for initial state with thin WS refetch pings (data crosses CASL-guarded REST only). All F0 invariants hold: every newly-live tool has a sane riskTier (no unclassified-escalate storms), all runs stay origin-labeled, all tool calls flow through the executor choke point.

**Tech Stack:** TypeScript 5.9 strict ESM, Bun 1.x, Hono, Drizzle + bun:sqlite, Zod, Pino, Vitest, CASL, React 19 + Zustand (src/web), i18n en/hu/de/es.

## Global Constraints

- Version freeze: NO version bump. CHANGELOG under the current 2026-07-28 wave only.
- NEVER commit or push without the owner's explicit approval. Commit checkpoints are **ask-first** gates.
- English code + comments; Pino only (never console.log); Zod for external input.
- Every new user-facing string in ALL FOUR languages (en/hu/de/es) in the module's `locales/` flat JSON bundles.
- F0 invariants (baseline HEAD e434686): tool-executor is an authorization choke point (toolContext needs an actor; trusted paths set `securityPipelineHandled`); unknown tool names escalate to the LLM judge (config riskTiers → registry `ToolImplementation.riskTier` → yellow-unclassified); `ModelRequestMetadata.origin` + `isAutonomousRequest` (absence → autonomous); the bus passes the concrete emitted subject as optional 2nd handler arg; every gate decision is logged.
- Tests: root `vitest.config.ts` (`bun run test`, baseline 3796 pass / 2 skip), aliases `@core`/`@modules`/`@shared`→src/*, `@`→src/web/src; in-memory DB via `tests/helpers/test-db.ts`. New contract tests live under `tests/contracts/` (glob already covers it), named `*.contract.test.ts`.
- Web-side import of `src/shared/*`: the web `@shared` alias maps to `src/modules` (NOT src/shared) — never use it for the new ws-topics module; use the thin re-export (Task 6).

## Owner decisions encoded (approved with this plan; do not re-litigate)

- **D1** `agent_definitions.tools` empty/NULL ⇒ **all registered tools** at the three run paths (unbricks existing installs' primary agents; the F0 choke point still authorizes every call). New creations persist the template's tools list.
- **D2** Template tool renames per the mapping table (Task 3); `bash`→`run_command` stays in primary/builder templates (red tier, judge-gated); `web-fetch`→`research`; `file-read`/`file-write`/`git`/`test-runner` are DROPPED (no native equivalents; run_command covers them — do NOT invent file tools in F1).
- **D3** `send_agent_message`, `read_agent_messages`, `research` added to `DEFAULT_CONFIG.riskTiers.green`; `assign_task` to yellow (defense-in-depth; registry fallback already classifies).
- **D4** `search_knowledge` backed by a minimal LIKE-based `knowledgeService.searchPages` (Orama-indexing of wiki pages deferred).
- **D5** `write_team_memory`/`read_team_memory` stay GREEN (yellow would judge+ladder every coordination write and brick autonomous team runs); `propose_team` stays yellow.
- **D6** Parent conversation's `team_session_id` stamped inside `teamSessionService.create()` (single choke point for both creators); last-write-wins on repeated proposals.
- **D7** `createSubConversation` inherits the parent's `teamSessionId`; `injectTeamMemory` is REVIVED into the orchestrator subagent prompt path.
- **D8** PATCH /conversations/:id may set every mapped field incl. teamSessionId (setting it only STRICTENS classification — no privilege escalation).
- **D9** R15 uses the shared `resolveThinkingAndEffort` resolver (deep⇒effort max parity) AND the deep-orchestration directive on the background path AND per-agent `effort` wiring for EYAS-engine team subagents.
- **D10** grok ACP resume system-prompt drop: DEFERRED to F4 (prompt-lifecycle scope; the speculative `_meta` one-liner is explicitly rejected).
- **D11** Board trigger: origin stays `'scheduled'`; arming promotes mode `'simple'`→`'managed'`; goal backfilled from prompt→title; existing `conv.agentId` never overwritten; auto_assignee-only stages also trigger; immediate bus-kick pickup + 10-min cron sweep; one-time `mode='agent'`→`'managed'` normalization; `assign_task` gets an ancestry depth cap of 5 (mirrors delegation).
- **D12** Mission Control transport = **Option B**: thin `mission-control` ping on the shared `/ws` + CASL/ownership-filtered REST snapshot refetch. The unfiltered dedicated-socket `subscription.ts` and the duplicate React hooks in `src/modules/mission-control/` are DELETED. Adapter `pause`/`resume` throw 'not supported' (interrupt works).
- **D13** `src/modules/conversations/schema.ts` is ALIGNED (not deleted — drizzle-kit consumes it); NO `drizzle-kit generate` run (runtime ALTERs own the columns).
- **D14** Tool contract tests keep the F0 choke point ACTIVE (recording allow-gate + allow-all ability), never `authorization: 'disabled'`; they land in the SAME task as the seam fixes (main stays green).
- **D15** Deferred out of F1: email-triage template's dotted tool ids; knowledge-pages Orama indexing; budget-engine alerts/trackUsage wiring (only the reset path lands); component-test infra (@testing-library); teamSessions `proposal_json` lossless rehydration column; read-back exposure enforcement in the update-chain contract; renaming the confusing web `@shared` alias; orchestrator's pre-existing `console.warn`/`logger: console` violations (note in CHANGELOG follow-ups).

---

### Task 1: Contract-test infrastructure (harness + shared topics module + web i18n parity)

**Files:**
- Create: `tests/helpers/tool-contract.ts`
- Create: `src/shared/ws-topics.ts`
- Create: `src/web/src/lib/ws-topics.ts` (thin re-export)
- Create: `tests/contracts/web-i18n-parity.contract.test.ts`
- Test: the harness is exercised by Task 2's contract tests; this task's own tests are the i18n parity file + a smoke test of the harness

**Interfaces:**
- Produces: `createToolContractHarness(tools: ToolImplementation[]): { registry, gate, run(toolName, input, ctxExtra?), invalidRiskTiers() }` — real registry + real executor with the F0 choke point ACTIVE via a recording allow-gate stub (`validateToolCall` vi.fn returning `{decision:'allow', reason, riskTier:'green'}`) + allow-all ability; default ctx `{conversationId:'contract-c1', userId:'contract-u1', agentId:'contract-a1', logger: silentLogger, actor:{kind:'agent',role:'agent'}}`.
- Produces: `WS_TOPICS` in `src/shared/ws-topics.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Single source of truth for WebSocket topic names, shared by backend
 * broadcast sites (import '@shared/ws-topics.js') and frontend subscriptions
 * (import '@/lib/ws-topics' — a thin re-export; the web '@shared' alias
 * points at src/modules and must NOT be used).
 * RULE: WS frames stay THIN (ids + refetch pings); data crosses CASL-guarded
 * REST. Topic subscription is authenticated but not permission-scoped.
 * Contract: tests/contracts/ws-topics.contract.test.ts (lands in Task 6).
 */
export const WS_TOPICS = {
  /** Module/budget/communication status — broad "something changed" pings. */
  system: 'system',
  /** Agent run lifecycle (started/progress/completed/failed/stuck/cancelled) — list-level. */
  agentRuns: 'agent-runs',
  /** Autonomy ladder + approval queue changes (thin: ids only, refetch via REST). */
  autonomy: 'autonomy',
  /** Mission Control aggregator ping (thin: refetch /mission-control/snapshot). */
  missionControl: 'mission-control',
  board: (projectId: string) => `board:${projectId}`,
  notifications: (userId: string) => `notifications:${userId}`,
  /** Per-agent-definition execution events (agent detail page). */
  agent: (agentId: string) => `agent:${agentId}`,
  chat: (conversationId: string) => `chat:${conversationId}`,
  orchestration: (runId: string) => `orchestration:${runId}`,
  teamEvent: (teamSessionId: string) => `team:${teamSessionId}:event`,
  teamProposed: (conversationId: string) => `team:proposed:${conversationId}`,
} as const

export type WsTopicKey = keyof typeof WS_TOPICS
export const WS_TOPIC_KEYS = Object.keys(WS_TOPICS) as WsTopicKey[]
```

- `src/web/src/lib/ws-topics.ts`: `export { WS_TOPICS, type WsTopicKey } from '../../../shared/ws-topics'` (+ eYssen header). Out-of-root imports are exercised by the web build already; smoke `cd src/web && bunx vite build` once in this task.

- [ ] **Step 1: Write the harness** — `tests/helpers/tool-contract.ts` exactly per the Interfaces block, mirroring `tests/modules/tools/executor-authorization.test.ts` helper style (silentLogger with child(), ExecutorSecurityGate structural type). Include the header comment: the service object handed to `createXTools(...)` MUST be shaped exactly the way `src/modules/tools/index.ts` builds it from ctx — mirroring production wiring is the whole point. Note for future callers: a `requiresApproval` tool needs `{ securityPipelineHandled: true }` in ctxExtra or an L3 autonomyPolicy stub on the gate.
- [ ] **Step 2: Harness smoke test** — `tests/contracts/tool-service/harness.contract.test.ts`: register one inline echo tool (riskTier 'green'), `run()` succeeds and `gate.validateToolCall` was called with the contract ctx; a tool registered with `riskTier: 'purple' as any` shows up in `invalidRiskTiers()`. Run: `bun vitest run tests/contracts` — PASS.
- [ ] **Step 3: ws-topics module + web re-export** — write both files; `bunx tsc --noEmit` + `cd src/web && bunx tsc --noEmit -p tsconfig.json` + a vite build smoke. (No call-site migration yet — that is Task 6; the enforcing contract test also lands there, after migration, so main never goes red.)
- [ ] **Step 4: Web i18n parity contract test** — `tests/contracts/web-i18n-parity.contract.test.ts`: mirror `tests/core/i18n-parity.test.ts` (fs-scan style) with: LOCALES = every dir named `locales` under `src/web/src` (recursive walk, skip node_modules/dist), REQUIRED_LANGS = ['en','hu','de','es'] (each bundle dir must contain exactly these .json files), flat-key parity + `{{placeholder}}` parity vs en per bundle. Run it — expected PASS on current main (fix any real parity gap it finds and list it in the report).
- [ ] **Step 5: Run** — `bun vitest run tests/contracts tests/core/i18n-parity.test.ts` + full typechecks. **Checkpoint** — ASK THE OWNER before committing (`test(contracts): tool-contract harness, shared WS topic constants, web i18n parity guard`).

---

### Task 2: Tool-seam fixes (R6) — lazy wiring + real service APIs + contract tests

**Files:**
- Create: `src/modules/tools/register-builtins.ts` (extracted from tools/index.ts:66-126)
- Modify: `src/modules/tools/index.ts` (replace the registerBuiltins closure; DELETE the dead `hasModule('agent')` branch at ~:91-106 — REQUIRED, or lazy resolution double-registers the agent-owned tools and `tool-registry.register` throws on duplicates at boot)
- Modify: `src/modules/tools/builtin/{search-tools,knowledge-tools,document-tools,memory-tools,board-tools,research-tools,conversation-tools,agent-messaging-tools}.ts`
- Modify: `src/modules/knowledge/knowledge-service.ts` (+`searchPages`), `src/modules/knowledge/types.ts` (slug optional)
- Modify: `src/modules/security-gate/types.ts` (green += 'send_agent_message','read_agent_messages','research')
- Test: `tests/contracts/tool-service/{search,knowledge,document,memory,board,conversation,agent-messaging}-tools.contract.test.ts` (new), `tests/contracts/registry-tier.contract.test.ts` (new); absorb the co-located `src/modules/tools/builtin/team-tools.test.ts` into Task 5's contract file (leave a note; do not move it here)

**Interfaces:**
- Produces: `registerBuiltinTools(registry, wiring: { hasModule(id): boolean; getService(id): any })` — per-call lazy `getService`; tools/index.ts wires it as `{ hasModule: (id) => ctx.hasModule(id), getService: (id) => (ctx as any)[id] }`.
- Tool factory signatures change to lazy getters: `createMemoryTools(getService: () => any)`, `createSearchTools(getService)`, `createKnowledgeTools(getService)`, `createDocumentTools(getService)`, `createResearchTools(getEngine)`, `createBoardTools(deps: { getBoard: () => any; getConversations: () => any })`. Fail-soft contract: service not ready ⇒ structured `{ error: '... not ready' }` (success:true, in-band error), never a throw.

Key per-file fixes (verified against real service APIs):

```ts
// search-tools.ts — real API is search.engine.search(SearchQuery)
execute: async (input) => {
  const engine = getService()?.engine
  if (!engine) return { error: 'Search engine not initialized yet — try again shortly' }
  const results = await engine.search({
    query: input.query as string,
    filters: { sourceId: input.sourceId as string | undefined, language: input.language as string | undefined },
    limit: (input.limit as number) ?? 10,
  })
  return { results: results.map((r: any) => ({ content: r.chunk.content, score: r.score, sourceId: r.chunk.sourceId, collection: r.chunk.collection, metadata: r.chunk.metadata })) }
},
```

```ts
// knowledge-service.ts — NEW searchPages (LIKE-based, D4), after listPages:
searchPages(query: string, opts?: { spaceSlug?: string; limit?: number }): Array<{ id: string; spaceId: string; title: string; slug: string; snippet: string }> {
  const limit = opts?.limit ?? 10
  const like = `%${query}%`
  const rows = (opts?.spaceSlug
    ? (db as any).all(sql`SELECT p.id, p.space_id, p.title, p.slug, substr(p.content_text, 1, 200) AS snippet
        FROM knowledge_pages p JOIN knowledge_spaces s ON s.id = p.space_id
        WHERE p.deleted_at IS NULL AND s.slug = ${opts.spaceSlug}
          AND (p.title LIKE ${like} OR p.content_text LIKE ${like})
        ORDER BY p.updated_at DESC LIMIT ${limit}`)
    : (db as any).all(sql`SELECT id, space_id, title, slug, substr(content_text, 1, 200) AS snippet
        FROM knowledge_pages
        WHERE deleted_at IS NULL AND (title LIKE ${like} OR content_text LIKE ${like})
        ORDER BY updated_at DESC LIMIT ${limit}`)) as any[]
  return rows.map(r => ({ id: r.id, spaceId: r.space_id, title: r.title, slug: r.slug, snippet: r.snippet ?? '' }))
},
```

- knowledge-tools: `search_knowledge` → `service.searchPages(query, { spaceSlug })`; `create_page` maps `content` into the REAL input `{ spaceId, title, body: content, contentText: content, parentId }` (fixes the silent body-drop); `CreatePageInput.slug` becomes optional (impl already falls back to `toSlug(title)`).
- document-tools: `list_documents` → `service.listByOwner(resModel, resId)`; `read_document` → `service.getById(id)` with not-found error; input descriptions updated to owner-module semantics.
- memory-tools: `search_memory` → one-object API `service.search({ query, tiers: input.tier ? [tier] : undefined, limit })`; DROP 'working' from the tier input enum (not searchable); `save_memory` → `service.episodic.create({ content, sourceType: 'agent-memory', tags })`, REMOVE the ignored `salience` input and the legacy `service.save` fallback.
- board-tools: `list_projects` → `deps.getBoard().projects.list()` (mapped to `{id,name,description,typeId}`); `move_to_stage` validates conversation + stage exist, then routes through `deps.getConversations().update(conversationId, { stageId })` — NEVER raw SQL (keeps the `eyas.conversations.stage_changed` bus contract that documents-retention and Task 8's stage-automation consume).
- conversation-tools: `get_conversation_status` — `service.getStatus()` does not exist; fix to `const conv = service.get(input.conversationId); if (!conv) return { error: ... }; return { conversationId: conv.id, status: conv.status, title: conv.title, agentId: conv.agentId, stageId: conv.stageId }` (verify the exact Conversation fields at implementation time).
- research-tools: `createResearchTools(getEngine)`; execute guards `const engine = getEngine(); if (!engine) return { error: 'Research module not ready' }` (ctx.research is set in research.onStart which runs AFTER tools.onStart — the lazy getter is the only correct fix).
- agent-messaging-tools (tool side only; R7 threads the context in Tasks 4-5): read the TYPED `ctx?.sessionId`; send returns `{ error: 'No active session for messaging — this tool only works inside a supervised agent run' }` without it; read returns `{ messages: [] }`.

- [ ] **Step 1: Write the failing contract tests** — one file per tool group under `tests/contracts/tool-service/`, each building the REAL service factory + the REAL tool factory + `createToolContractHarness`. Mirror these setups: memory → `tests/modules/memory/` tier factories + `createMemoryTables` + tmpdir vault (full sketch below); knowledge → `tests/modules/knowledge/knowledge-service.test.ts`; documents → `tests/modules/documents/document-service.test.ts` (PNG_1X1 fixture + local provider); search → `tests/modules/search/integration.test.ts` (Orama provider + file indexer over tmpdir); board → `tests/modules/board/project-service.test.ts` chained factories + real `createConversationService(db, busStub)`; conversation → `createConversationService`; agent-messaging → `createTestDb` (agent_messages exists) + real `createAgentMessaging(db)`.

Memory exemplar (the others mirror it):
```ts
it('save_memory persists an episodic entry through the real executor', async () => {
  const r = await harness.run('save_memory', { content: 'OKE node pool upgrade needs cordon first', tags: ['k8s'] })
  expect(r.success).toBe(true)
  expect((r.output as any).saved).toBe(true)
  expect(memory.episodic.get((r.output as any).id)!.content).toContain('cordon')
})
it('search_memory finds what save_memory wrote (tier filter honoured)', async () => {
  await harness.run('save_memory', { content: 'Kubernetes deployment guide for OKE' })
  const r = await harness.run('search_memory', { query: 'kubernetes', tier: 'episodic' })
  expect(((r.output as any).results).length).toBeGreaterThan(0)
})
it('fails soft (structured error, not throw) when the module is not started yet', async () => {
  const h = createToolContractHarness(createMemoryTools(() => undefined))
  const r = await h.run('search_memory', { query: 'x' })
  expect(r.success).toBe(true)
  expect((r.output as any).error).toMatch(/not ready/i)
})
```
Board must additionally assert: `move_to_stage` → `conversations.get(id)!.stageId === stage.id` AND the busStub captured `eyas.conversations.stage_changed`; unknown conversation/stage → `{ error }`, DB untouched. Knowledge must assert `service.getPage(result.page.id)!.body` EQUALS the content passed (the body-drop catch). Agent-messaging: send with `ctxExtra { sessionId: 'run-1', agentId: 'agent-a' }` → read as agent-b sees it; broadcast visible to all in-session; NO sessionId → in-band error/empty; sinceId filters.

`tests/contracts/registry-tier.contract.test.ts`: build the FULL production registry via `registerBuiltinTools(registry, { hasModule: () => true, getService: () => ({}) })` (getters never invoked at registration) + the agent-module-owned tools with stub deps (mirror `agent/index.ts:415-439`); `createDeterministicGate(DEFAULT_CONFIG, { getRegistryTier: (n) => registry.get(n)?.riskTier })`; for EVERY registered name assert `gate.check(name, {}).reason` does NOT match /unclassified/; assert the enlivened green set yields deterministic `allow`.

- [ ] **Step 2: Run to verify failure** — the board/search/memory/knowledge/document/conversation contract tests FAIL on main (they reproduce the dead seams: "service.listProjects is not a function" etc.).
- [ ] **Step 3: Implement** — register-builtins.ts extraction + all eight tool-file fixes + searchPages + riskTiers green additions, per the Interfaces block. tools/index.ts replacement:
```ts
    const { registerBuiltinTools } = await import('./register-builtins.js')
    await registerBuiltinTools(registry, {
      hasModule: (id) => ctx.hasModule(id),
      getService: (id) => (ctx as any)[id],
    })
    ctx.logger.info(`Tools module: ${registry.list().length} tools registered`)
```
- [ ] **Step 4: Run to verify pass** — `bun vitest run tests/contracts tests/modules/tools tests/modules/knowledge tests/modules/search tests/modules/memory tests/modules/documents tests/modules/board tests/modules/security-gate` + `bunx tsc --noEmit`.
- [ ] **Step 5: Checkpoint** — ASK THE OWNER before committing (`fix(tools): wire builtin tools to the real service APIs via lazy getters; contract tests`).

---

### Task 3: Agent templates + tools persistence (R6f)

**Files:**
- Modify: `src/modules/agent/agent-templates.ts` (all 16 `tools:` arrays)
- Modify: `src/modules/auth/index.ts` (~:116-124 primary-agents INSERT gains the `tools` column with `${JSON.stringify(template.tools)}`)
- Modify: `src/modules/agent/team-bootstrap.ts` (~:56-64 same)
- Modify: `src/modules/agent/index.ts` (~:301-303), `src/modules/agent/conversation-runner.ts` (~:85), `src/modules/agent/orchestrator.ts` (~:620) — empty-tools fallback (D1): `agentDef.tools && agentDef.tools.length > 0 ? toToolDefinitions(agentDef.tools) : toToolDefinitions()`
- Test: `tests/contracts/template-names.contract.test.ts` (new), extend `tests/modules/agent/execute-agent-tool-context.test.ts`

**Interfaces:**
- Rename mapping (NO alias layer — names are provider-facing contracts): `'bash'`→`'run_command'` · `'search'`→`'search_indexed'` · `'memory'`→`'search_memory','save_memory'` · `'documents'`→`'list_documents','read_document'` · `'web-fetch'`→`'research'` · `'file-read','file-write','git','test-runner'`→DROP.
- Every template additionally gains the coordination set `'delegate_to_agent','write_team_memory','read_team_memory','send_agent_message','read_agent_messages'`; the two PRIMARY templates also gain `'propose_team','list_projects','move_to_stage','search_knowledge','get_page'`. Concrete lists per template category (primaries, read-only reviewers, builders, technical-writer, researcher) are in the design record — the implementer applies the category lists from the brief verbatim; the contract test is the enforcement.

- [ ] **Step 1: Write the failing tests** — `tests/contracts/template-names.contract.test.ts`: build the full production registry (same recipe as Task 2's registry-tier test) and assert for every template `registry.has(name)` for every `template.tools` name (message names the template + tool). Plus the persistence check: run the primary-agents INSERT path against `createTestDb` (drive `auth`'s setup step or replicate its INSERT with the template values — choose the lighter one and say which) and assert `JSON.parse(row.tools)` ⊆ registry names. Extend `execute-agent-tool-context.test.ts`: agentDef with `tools: []` → the runner receives a NON-empty tools array (registry stub reports tools); agentDef with `tools: ['search_memory']` → exactly that tool.
- [ ] **Step 2: RED** — template-names fails on every legacy name; the fallback test fails (empty array currently yields zero tools).
- [ ] **Step 3: Implement** — renames + both INSERTs + the three-path fallback.
- [ ] **Step 4: GREEN** — `bun vitest run tests/contracts tests/modules/agent tests/modules/auth` + tsc.
- [ ] **Step 5: Checkpoint** — ASK THE OWNER (`fix(agent): real tool names in templates, persist tools at creation, empty list = all tools`).

---

### Task 4: Conversation update contract + runner settings (R7 core + R15)

**Files:**
- Modify: `src/modules/conversations/conversation-service.ts` — exported `ConversationUpdate` interface + exported `UPDATE_FIELD_MAP` (`satisfies Record<keyof ConversationUpdate, UpdateFieldSpec>`) + schema-driven `update()` loop; `Conversation` interface + `toConversation()` + `create()` gain `teamSessionId: string | null`; `createSubConversation` inherits `team_session_id` from the parent (D7)
- Modify: `src/modules/conversations/schema.ts` — add the five missing Drizzle columns (sdkSessionId, thinking enum off/on/auto default 'off', thinkingBudget, effort enum, orchestration enum) + the "created at runtime by onRegister ALTERs" comment (D13)
- Modify: `src/modules/agent/conversation-runner.ts` — SELECT gains `team_session_id, thinking, thinking_budget, effort, orchestration`; the run options use `...resolveThinkingAndEffort({...})` + `orchestration: conv.orchestration ?? undefined` (import `resolveThinkingAndEffort` from `@modules/conversations/thinking-resolver.js` — pure function, precedent bot-executor→agent) + the deep-orchestration directive (D9): `buildOrchestrationDirective(conv.orchestration, conv.provider_id)` appended to the system prompt / assembled reminders (mirror orchestrator's constraintReminder pattern); toolContext gains `teamSessionId: conv.team_session_id ?? undefined, sessionId: conv.team_session_id ?? undefined`; metadata gains `teamSessionId`
- Modify: `src/modules/conversations/routes.ts` — de-cast the three `(conv as any).teamSessionId` reads
- Modify: `src/modules/prompt-wizard/cache-suffix-builder.ts` (~:66) — `team_memory_get` → `read_team_memory`
- Modify test DDLs in the SAME commit (or three suites fail with "no such column"): `tests/modules/agent/conversation-runner.test.ts`, `tests/modules/agent/resume-run.test.ts`, `tests/modules/proactive-assistant/bot-executor.test.ts` local conversations DDLs + `tests/helpers/test-eyas.ts` minimal DDL — each gains `thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT, orchestration TEXT` (+ `team_session_id TEXT` where absent)
- Test: `tests/contracts/conversation-update-chain.contract.test.ts` (new), `tests/contracts/conversations-schema.contract.test.ts` (new), extend `tests/modules/conversations/conversation-service.test.ts` + `tests/modules/agent/conversation-runner.test.ts`

**Interfaces (the class-killer):**
```ts
interface UpdateFieldSpec {
  column: string
  serialize?: (v: unknown) => unknown
  /** 'in' = write even when the value is undefined-in-payload (null-clearing). Default: skip undefined. */
  presence?: 'defined' | 'in'
}
// Adding a field to ConversationUpdate without a row here (or vice versa) is a
// COMPILE error — the "update() silently drops a field" bug class dies here.
export const UPDATE_FIELD_MAP = { /* all 26 fields incl. teamSessionId: { column: 'team_session_id' } */ } as const satisfies Record<keyof ConversationUpdate, UpdateFieldSpec>
```
`update()` keeps the tracked-changes capture and bus emissions VERBATIM; the 26 if-blocks become one loop issuing per-field `UPDATE conversations SET ${sql.raw(spec.column)} = ${value}, updated_at = ${now}` (sql.raw is safe: column names are compile-time constants — reviewers must reject any change deriving `spec.column` from input).

- [ ] **Step 1: Write the failing tests**
  - `conversation-update-chain.contract.test.ts` (real production DDL: run `conversationsModule.onRegister` + board/agent onRegister for their conversations ALTERs against a stub ctx — fallback if agent onRegister proves stub-hostile: replicate its single ALTER inline with a comment): (1) completeness — every PRAGMA column is in FIXTURES or NON_UPDATABLE (`{id, task_id, user_id, tokens_used, created_at, updated_at}` with reasons); (2) no fixture names a dropped column; (3) per-field round-trip `it.each` over FIXTURES (26 cases incl. `teamSessionId → team_session_id 'ts-1'`, `pinned → 1`, `assignees → '["a"]'`, `voiceScopeOverride null-clearing`); (4) case-table covers every UPDATE_FIELD_MAP key.
  - `conversations-schema.contract.test.ts`: after real module DDL, every Drizzle-declared column (via `getTableColumns(conversations)`) exists in PRAGMA; the exact background-runner SELECT does not throw.
  - conversation-service extensions: `update({teamSessionId}) → get().teamSessionId === 'ts-1'`; `create().teamSessionId === null`; sub-conversation inherits parent's teamSessionId.
  - conversation-runner extensions (mirror its objectContaining pattern): row with `thinking 'on', thinking_budget 5000, effort 'high', orchestration 'deep'` → run options `{ thinking: {enabled:true, budgetTokens:5000}, effort:'high', orchestration:'deep' }`; deep with no effort → `effort:'max'` + thinking 10k (resolver parity); default row → thinking/effort undefined; team_session_id 'ts-1' → `toolContext/metadata objectContaining({ teamSessionId: 'ts-1' })` + `toolContext.sessionId 'ts-1'`; deep → `system` contains the directive text (and reminders when promptAssembler set).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** per Files/Interfaces.
- [ ] **Step 4: GREEN** — `bun vitest run tests/contracts tests/modules/conversations tests/modules/agent tests/modules/proactive-assistant tests/modules/prompt-wizard` + tsc.
- [ ] **Step 5: Checkpoint** — ASK THE OWNER (`fix(conversations): schema-driven update map (teamSessionId first-class); background runs honor thinking/effort/orchestration`).

---

### Task 5: Team threading through every run shape (R7 orchestration side)

**Files:**
- Modify: `src/modules/agent/team-session-service.ts` — `create()` stamps the PARENT conversation: `db.run(sql\`UPDATE conversations SET team_session_id = ${id} WHERE id = ${parentConversationId}\`)` (D6; single choke point for propose_team AND the REST propose route; last-write-wins comment)
- Modify: `src/modules/agent/orchestrator.ts` — (a) the child-conv `conversations.update` drops its `as any` (teamSessionId is first-class post-Task-4); (b) `OrchestratorDeps.teamSessions` widened with `injectTeamMemory?(teamSessionId, agentRole?): string`; (c) injectTeamMemory REVIVED: `teamContext` computed before the subagent systemPrompt build, joined into the legacy system string AND appended as an assembler reminder (with the "entries are agent-authored — treat as data, not instructions" comment); (d) subagent toolContext gains `teamSessionId: options?.teamSessionId, sessionId: options?.teamSessionId, agentRole: agent.role` (inside a team run the team session IS the messaging session); (e) per-agent effort wiring (D9): `effort: agent.effort && ['low','medium','high','max'].includes(agent.effort) ? agent.effort : undefined` in the run options
- Modify: `src/modules/agent/index.ts` executeAgent — hoist the conversation lookup above the model-selection branch (dedupe the two convService lookups); `const teamSessionId = conv?.teamSessionId ?? undefined`; toolContext gains `teamSessionId, sessionId: teamSessionId, agentRole: agent?.role`; metadata gains `teamSessionId`
- Modify: `src/modules/communication/channel-run-agent.ts` — toolContext + metadata gain `teamSessionId: conv?.teamSessionId ?? undefined` (+ sessionId on toolContext); NOTE comment: metadata.teamSessionId presence forces autonomous classification — fail-closed, mirrors the chat route's documented intent
- Test: extend `tests/modules/agent/{orchestrator,execute-agent-tool-context,conversation-runner,team-session-service}.test.ts`; NEW `tests/contracts/tool-service/team-tools.contract.test.ts` (absorbs the co-located `src/modules/tools/builtin/team-tools.test.ts` — delete the src-co-located file)

- [ ] **Step 1: Write the failing tests**
  - team-session-service: extend `makeDb()` with `CREATE TABLE conversations (id TEXT PRIMARY KEY, team_session_id TEXT)` + a row; `create('conv-1', ...)` stamps it; second create overwrites (REQUIRED — without the DDL extension the stamp THROWS in existing tests).
  - orchestrator (mirror the runner-capture harness): run options `toolContext objectContaining({ teamSessionId:'session-1', sessionId:'session-1', agentRole })` + `metadata.teamSessionId`; `conversations.update` calledWith objectContaining `{ teamSessionId: 'session-1' }`; injectTeamMemory: deps stub returns a `<team-context>` block → captured system contains it + called with `('session-1', agent.role)`; assembler branch → reminders contain it; no-session run → not called, toolContext.teamSessionId undefined; agent with `effort:'high'` → run options `effort:'high'`; `effort:'turbo'` → undefined.
  - execute-agent-tool-context: conversations stub `get → { providerId:null, modelId:null, teamSessionId:'ts-9' }` → runCalls toolContext/metadata carry 'ts-9'; null → undefined.
  - channel-run-agent: conv with teamSessionId → threaded into both.
  - team-tools contract file: real `createTeamSessionService` on createTestDb (team_sessions/team_memory DDL exists) + harness; write_team_memory with `ctxExtra { teamSessionId, agentId }` → row lands; read_team_memory honors agentRole visibility; both tools' riskTier valid; registered names exactly `['write_team_memory','read_team_memory']` for the team factory.
- [ ] **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** — `bun vitest run tests/modules/agent tests/modules/communication tests/contracts` + tsc.
- [ ] **Step 5: Checkpoint** — ASK THE OWNER (`fix(agent): thread team session through every run shape; revive team-memory prompt injection`).

---

### Task 6: WS transport closure — backend (R13 part 1)

**Files:**
- Modify: `src/core/http/ws-bridge.ts` — mappings rebuilt on `WS_TOPICS`; `resolveTopic` may return `null` (skip); frames carry the CONCRETE emitted subject as `event` (F0's 2nd handler arg): mappings per the design — `eyas.board.*`→board(projectId), `eyas.notify`→notifications(userId), `eyas.agent.run.*`→agentRuns AND (when payload has agentId) agent(agentId), `eyas.agent.budget.*`→agent(agentId)|null, `eyas.conversation.*` AND the legacy-plural `eyas.conversations.*`→chat(conversationId), `eyas.module.*`/`eyas.budget.*`/`eyas.communication.*`→system
- Modify: `src/modules/agent/run-supervisor.ts` — `WatchState` gains `agentId`/`conversationId`; `beginRun` stores them; `finalize` reads the watch BEFORE `watch.delete` and enriches the emit; `progress`/stuck/`recoverOrphans` emits gain agentId/conversationId (recoverOrphans SELECTs them)
- Create: `src/modules/agent/session-registry-adapter.ts` — `AgentSessionRegistry` over agent_sessions LEFT JOIN conversations (ownerUserId; stuck/refreshing→'running'; `interrupt`→`supervisor.cancel`; pause/resume throw 'not supported'; try/catch → empty on missing table)
- Modify: `src/modules/agent/index.ts` — publish `(ctx as any).agentRegistry = createAgentSessionRegistryAdapter(...)` in onRegister; hoist the lazy `wsRegistry` broadcast shim to onRegister scope and thread it into `createTeamTools(teamSessionService, lazyWsBroadcast)` + `createProposeTeamTool(..., lazyWsBroadcast)` + `createTeamRoutes(..., lazyWsBroadcast)`; budget-reset subscriber in onStart: `ctx.bus.on('model:budget:reset', async () => { agents.registry.resetMonthlyBudgets(); ctx.logger.info(...) })`
- Modify: `src/modules/agent/routes-team.ts` — 6th param `wsBroadcast?`; propose route broadcasts `WS_TOPICS.teamProposed(conversationId)` `{event:'team:proposed', data:{session, proposal}}` (extract the shared proposal literal); approve loop + catch broadcast `WS_TOPICS.teamEvent(id)` `{event:'team', data: event}` / `{type:'team_failed',...}`; memory POST broadcasts `{type:'memory_written', entry}`; fix the stale "bridge is inert" comment
- Modify: `src/modules/tools/builtin/team-tools.ts` — `createTeamTools(teamSessions, wsBroadcast?)`; write_team_memory broadcasts `WS_TOPICS.teamEvent(teamSessionId)` `{event:'team', data:{type:'memory_written', entry}}`; propose-team tool factory gains `wsBroadcast?` and broadcasts teamProposed with the same payload as the route
- Modify: `src/modules/security-gate/autonomy-policy.ts` — `createAutonomyPolicy(db, logger?, hooks?: { onApprovalCreated?(a: {id, category, toolName, reason}) })`; called at the end of `createApproval` in try/catch (hook must never break enqueue) — ONE change covers ALL enqueue paths (executor, runner, bridge, forge, skill-generation, ops)
- Modify: `src/modules/security-gate/index.ts` — wire the hook: bus emit `autonomy:approval-requested` + `broadcastAutonomy('autonomy:approval-requested', {approvalId, category})` via the lazy wsRegistry shim; wrap the routes' emit so every `autonomy:*` event also broadcasts on `WS_TOPICS.autonomy`
- Modify: `src/modules/mission-control/aggregator.ts` — watched subjects += `'eyas.agent.run.*'`; `src/modules/mission-control/index.ts` — aggregator.subscribe → thin `WS_TOPICS.missionControl` ping broadcast; store `unsubscribePing` and call it in onStop; DELETE `src/modules/mission-control/subscription.ts` usage path + the duplicate `useMissionControl.ts`/`useAgentActions.ts` React hooks inside the module tree (D12)
- Modify: stale-comment fixes + literal→constant swaps at backend broadcast sites: `orchestration-broadcaster.ts` (topic via WS_TOPICS.orchestration + comment fix), `orchestration-event-service.ts` fallback, `notifications/channels/web.ts`
- Test: extend `tests/core/websocket.test.ts` (NOTE: its mock-bus keys handlers per subject in a Map — two mappings now share `eyas.agent.run.*`, adjust to `Map<string, Array<fn>>`), `tests/modules/agent/run-supervisor.test.ts` (emits carry agentId/conversationId incl. finalize-before-delete + recoverOrphans), `tests/modules/agent/team-routes-broadcast.test.ts` (wsBroadcast spy: teamProposed on propose, teamEvent on approve/catch/memory-POST), `tests/modules/security-gate/autonomy-policy.test.ts` (hook invoked; throwing hook doesn't prevent insert), NEW `tests/modules/agent/session-registry-adapter.test.ts` (real supervisor + minimal conversations table: list/get/ownerUserId/stuck→running/interrupt/pause-rejects/missing-table→[]), extend `tests/modules/mission-control/aggregator.test.ts` (`eyas.agent.run.started` triggers delivery), NEW `tests/modules/agent/budget-reset.test.ts` (real localBus + `{resetMonthlyBudgets: vi.fn()}`; extract the wiring into an exported helper so the wiring itself is the unit under test)

- [ ] **Step 1: failing tests** per the Test list (concrete cases in the design record; mirror each file's own existing harness). **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** — `bun vitest run tests/core/websocket.test.ts tests/modules/agent tests/modules/security-gate tests/modules/mission-control` + tsc.
- [ ] **Step 5: Checkpoint** — ASK THE OWNER (`fix(ws): live topics for runs/teams/autonomy/mission-control; budget reset subscriber`).

---

### Task 7: WS transport closure — frontend + contract test (R13 part 2)

**Files:**
- Modify frontend subscribe sites → `WS_TOPICS` via `@/lib/ws-topics`: `agent-runs-page.tsx` (5 literal topics → one `WS_TOPICS.agentRuns` subscription + refetch), `autonomy-dashboard.tsx` (→ `WS_TOPICS.autonomy`, refetch approvals+categories), `agent-detail-page.tsx` (→ `WS_TOPICS.agent(agentId)` — handler logic unchanged, it now receives concrete `eyas.agent.run.*` event names), `conversation-page.tsx` (chat/teamEvent/orchestration/teamProposed constants + the hydration block below), `board-page.tsx`, `board-graph.tsx`, `notification-bell.tsx`, `sub-conversation-tree.tsx`, `inbound-queue-tab.tsx`, `pairing-tab.tsx`
- Modify: `src/web/src/hooks/use-websocket.ts` — expose `connected` state (onopen/onclose)
- Rewrite: `src/web/src/pages/mission-control/hooks/useMissionControl.ts` — REST snapshot fetch + `WS_TOPICS.missionControl` refetch ping + `connected` mapping (D12; delete the dead dedicated-socket URL/backoff code)
- Modify: `src/web/src/stores/team-session-store.ts` — `hydrateMemory(entries)` action (REST replay; JSON-parse values with string fallback; REPLACES memoryEntries)
- Modify: `conversation-page.tsx` hydration — team-session discovery via `GET /conversations/:id/team-sessions` (list-based; `status 'proposing'` → rebuild renderable proposal from persisted session config/reasoning/estimatedTokens with `agentGaps: []` + cost `estimatedTokens * 0.000003`; running/paused → `rehydrate` + `GET /team-sessions/:id/memory` → `hydrateMemory`); best-effort .catch; MUST NOT touch hydratedRunRef / the orchestration buffer
- Create: `tests/contracts/ws-topics.contract.test.ts` — fs-scan (i18n-parity style): (1) no inline string-literal first arg at `subscribe(`/`.broadcast(` call sites repo-wide (backend src minus web; frontend src/web/src; skip locales/dist/gen); (2) every `WS_TOPICS.<key>` has ≥1 backend producer AND ≥1 frontend consumer, with an `ONE_SIDED: Partial<Record<WsTopicKey, string>>` justification map (target: EMPTY at landing; `board` counts ws-bridge as producer — note the board-module-emits-nothing limitation in a comment, Task 8 adds real emits)
- Test: extend `tests/web/team-session-store.test.ts` (hydrateMemory maps/replaces; live memory_written appends on top)

- [ ] **Step 1: failing tests** (ws-topics contract fails on every un-migrated literal; store test fails on the missing action). **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** — `bun vitest run tests/contracts tests/web` + `cd src/web && bunx tsc --noEmit -p tsconfig.json` + a vite build smoke.
- [ ] **Step 5: Checkpoint** — ASK THE OWNER (`feat(web): live run/team/autonomy/mission-control updates + REST hydration; WS topic contract`).

---

### Task 8: Board→agent trigger + assign_task (R8)

**Files:**
- Modify: `src/modules/board/schema.ts` (stages += autoAssigneeId, isHidden), `src/modules/board/services/stage-service.ts` (Create/UpdateStageInput + toStage + create/update plumbing for autoAssigneeId), `src/modules/board/services/project-service.ts` (Stage interface += `autoAssigneeId: string | null`), `src/modules/board/routes.ts` (both stage-create routes pass `autoAssigneeId`; PATCH already forwards the body)
- Create: `src/modules/board/stage-automation.ts` — `createStageAutomation({stages, projects, conversations, bus, logger}).handleStageChanged(evt)`: card entering a bot-capable stage (botListen OR autoAssigneeId) is ARMED — agentId backfilled from stage.autoAssigneeId then project default (existing conv.agentId NEVER overwritten), goal backfilled prompt→title, mode 'simple'→'managed', status→'waiting'; unrunnable cards (no agent or goal) are NOT armed (warn); skip status working/archived/deleted; emits `eyas.board.card_armed` `{conversationId, targetId, projectId, stageId, agentId, userId}` (auto-audited + ws-bridged); no recursion (arming never touches stageId)
- Modify: `src/modules/board/index.ts` — onStart subscribes `eyas.conversations.stage_changed` → automation
- Modify: `src/modules/proactive-assistant/bot-executor.ts` — stage scan `bot_listen = 1 OR auto_assignee_id IS NOT NULL`; single-flight guard (`running`/`rerun` coalescing do-while); pre-run claim re-check (`status === 'waiting'` re-SELECT)
- Modify: `src/modules/proactive-assistant/index.ts` — immediate pickup: `ctx.bus.on('eyas.board.card_armed' | 'eyas.board.task_assigned', kick)` where kick = processWaiting + existing logging (cron stays as crash-recovery sweep)
- Modify: `src/modules/conversations/conversation-service.ts` — `CreateSubConversationInput.initialStatus?: 'idle' | 'waiting'` (documented default 'idle' for inline-run callers); INSERT status `${input.initialStatus ?? 'idle'}`, mode `'agent'`→`'managed'`; returned literal aligned; one-time normalization in conversations onRegister: `try { db.run(sql\`UPDATE conversations SET mode='managed' WHERE mode='agent'\`) } catch {}`
- Create: `src/modules/tools/builtin/assign-task-tool.ts` — `assign_task` (yellow, Zod-validated: agentId/title/goalDescription required, stageId/priority/dueDate optional): validates agent exists+enabled (teaching error with availableAgents), resolves the pickup stage (explicit → first bot-capable global stage → configuration teaching error), DEPTH CAP: `conversations.getAncestry(parentConversationId).length >= 5 → { error: 'assignment depth limit reached' }` (D11), creates the child via `createSubConversation({..., initialStatus:'waiting'})` + `update({stageId, priority?, dueDate?})`, emits `eyas.board.task_assigned` `{conversationId, targetId, projectId, stageId, agentId, assignedByAgentId, userId}`, returns `{assigned, conversationId, taskId, stageId, note}` (async handoff — points at get_conversation_status; delegate_to_agent remains the sync option)
- Modify: `src/modules/agent/index.ts` — register assign_task next to createDelegateTool with lazy `getConversations`/`getStages`; `src/modules/agent/conversation-runner.ts` — DESTRUCTIVE_TOOLS += 'assign_task'; `src/modules/security-gate/types.ts` — yellow += 'assign_task'
- Modify: `src/web/src/pages/projects/stages-section.tsx` — Auto-assign Select column (agents from `/agents?enabled=true`, 'none' clears) + local Stage interface; `src/web/src/pages/projects/locales/{en,hu,de,es}.json` — `projects.stages.autoAssign` / `autoAssignNone` / `autoAssignTitle` in all four (hu: "Auto-hozzárendelés"/"Nincs"/"Az ebbe a szakaszba lépő kártyák ehhez az agenthez kerülnek, és autonóm módon futnak"; de/es per the design record)
- Test: NEW `tests/modules/board/stage-automation.test.ts` (real services + real bus + real conversationService — the 9 cases from the design: arm/backfill/no-overwrite/fallback-chain/not-armed-warn/plain-stage/working-archived-skip/single card_armed emit shape/no-re-emit), extend `tests/modules/board/stage-service.test.ts` (autoAssigneeId roundtrip + clear) + `tests/modules/board/routes.test.ts` (create/PATCH echo), extend `tests/modules/proactive-assistant/bot-executor.test.ts` (its local stages DDL MUST gain `auto_assignee_id TEXT` or old cases throw; new: auto-assignee-only pickup, claim re-check, single-flight), extend `tests/modules/conversations/conversation-service.test.ts` (initialStatus + mode 'managed'), NEW `tests/contracts/tool-service/assign-task-tool.contract.test.ts` (real conversation+stage services + harness: happy path DB assertions + task_assigned emit, explicit/unknown/non-bot stage, unknown/disabled agent, no-bot-stage config error, Zod INVALID_INPUT, depth cap, and the triple-list pin: registry yellow + DEFAULT_CONFIG yellow + DESTRUCTIVE_TOOLS all contain 'assign_task'), NEW `tests/integration/board-agent-handoff.test.ts` (real bus chain: card move → armed → kick → mockAgentRunner ran with the goal + origin 'scheduled'; assign_task through the harness → task_assigned → target run fired)

- [ ] **Step 1: failing tests.** **Step 2: RED.** **Step 3: Implement.** **Step 4: GREEN** — `bun vitest run tests/modules/board tests/modules/proactive-assistant tests/modules/conversations tests/contracts tests/integration/board-agent-handoff.test.ts tests/modules/agent` + both tsc + web build smoke.
- [ ] **Step 5: Checkpoint** — ASK THE OWNER (`feat(board): stage automation arms cards for autonomous pickup; assign_task async handoff`).

---

### Task 9: Full-suite verification + CHANGELOG

- [ ] **Step 1:** `bun run test` (full suite) — green expected (baseline 3796 + the new contract/unit tests).
- [ ] **Step 2:** `bunx tsc --noEmit` (root) + `cd src/web && bunx tsc --noEmit -p tsconfig.json` — clean.
- [ ] **Step 3:** CHANGELOG entry under the 2026-07-28 wave: F1 dead-wiring closure — tools live (with the D1 empty-list=all note), team memory threaded + visible, board→agent trigger + assign_task, live WS surfaces + hydration, background runs honor thinking/effort/orchestration (cost note: previously-silent settings now spend tokens), contract-test harnesses; deferred list (D15) as follow-ups. No version bump.
- [ ] **Step 4:** Owner-assisted manual smoke checklist (needs the running instance): chat "keress a memóriában …" → search_memory works; propose_team → TeamProposalCard live + survives reload; write_team_memory → panel updates live; drag a card into a Bot stage → agent run starts; assign_task from chat → target agent picks it up; Agent Runs page auto-refreshes during a run; approval enqueue → Autonomy dashboard badge; Mission Control shows the live run, Interrupt works.
- [ ] **Step 5:** STOP — report results. Commits/pushes only on explicit request.

---

## Self-review notes (already applied)

- **Reconciliations:** ws-topics module = the transport designer's `WS_TOPICS` shape + the conventions designer's web re-export and `tests/contracts/` placement; team-tools live-update = direct `wsBroadcast` (lazy wsRegistry shim), NOT a colon-subject bus emit (colon subjects have no bridge and must not grow one); ALL conversation-runner line edits (R7 threading + R15 columns/resolver/directive) live in Task 4 to avoid same-line collisions; `conversations/schema.ts` is aligned, not deleted (drizzle-kit consumes it).
- **Sequencing:** Task 1 ships infra only (nothing red); Task 2's failing-by-design contract tests land WITH the seam fixes; Task 6 (backend transport) precedes Task 7 (frontend + the enforcing ws-topics contract test) so the literal-ban test never fails on main; Task 8 last (consumes Task 2's board-tool patterns, Task 4's update map + createSubConversation, Task 6's kick subjects).
- **Known cross-task file overlaps (ordered, do not reorder):** `conversation-service.ts` (T4 update-map → T8 createSubConversation), `conversation-runner.ts` (T4 → T8 DESTRUCTIVE_TOOLS line), `agent/index.ts` (T3 fallback → T5 executeAgent → T6 shim/adapter → T8 tool registration), `team-tools.ts` (T5 contract absorb → T6 wsBroadcast), `security-gate/types.ts` (T2 green adds → T8 yellow add).
- **Deliberate behavior changes to release-note:** background runs of thinking/effort/deep conversations now actually spend those tokens; `move_to_stage`/stage moves fire documents-retention lifecycle; existing agents with NULL tools gain the full (per-call-gated) tool menu; a UI drag into a Bot stage starts an unattended agent run (bounded by budget, maxTurns, choke point, ladder).
- **Residual risks accepted:** grep-based contract tests are heuristic (variables escape the literal ban — the producer/consumer matrix is the primary guard); the single-flight bot-executor guard is per-process (multi-process needs CAS — comment in code); `sql.raw` in the update loop is safe only while columns come from the static map (review rule stated in-code); team-memory prompt injection surface via injectTeamMemory is mitigated by the treat-as-data comment, sanitizer deferred to F2.
