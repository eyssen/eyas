# Ticket-to-Code Pipeline Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the built-but-inert `ticket-to-code` pipeline: adapters over existing EYAS modules, a multi-file PR provider, off-by-default config, and bootstrap attachment of `ctx.pipelineDeps` so its routes mount.

**Architecture:** Five port adapters (internal-board ticketSource, agent-runner-port over `ctx.agents.executeAgent`, artifacts port over `ctx.artifacts`, pipeline prClient over an extended `PrProvider`, no-op checkpoint) are assembled in the module `onStart` when enabled+configured; the existing orchestrator/routes then run unchanged.

**Tech Stack:** Bun, Hono, Drizzle over bun:sqlite, CASL, Zod, Vitest, jsdiff (`diff`, already a dep).

## Global Constraints

- Runtime Bun; TypeScript strict, ESM. English code/comments.
- **Vendor-neutral (hard):** the ONLY built-in ticket source is the internal EYAS board. NO Odoo /
  eyssen.com / vendor-specific code, names, or defaults. Git hosting is generic + operator-configured.
- Secrets NEVER hardcoded/logged; read via `ctx.secrets.get('pipeline-pr-token', 'system')`.
- No fake capability: the module mounts routes ONLY when enabled + PR provider configured + token present.
- Reuse the shipped `src/modules/ops/actions/pr-provider.ts` (extend it) — do not fork a second PR client.
- No real agent call, no real PR, no board mutation beyond the test DB, in any test.
- Do NOT change version numbers. **No git commit/push without explicit user request** — "Checkpoint" = stage and stop.
- Full suite (`bun vitest run`) + typecheck (`bun run lint`) green at each phase end.

---

## Phase 1 — Multi-file PR support on PrProvider

### Task 1: `openMultiFilePullRequest` on Gitea + GitHub providers
**Files:**
- Modify: `src/modules/ops/actions/pr-provider.ts` (add method to the `PrProvider` interface + both impls)
- Test: `tests/modules/ops/pr-provider-multifile.test.ts`

**Interfaces — Produces (add to `PrProvider`):**
```ts
export interface MultiFilePr {
  branch: string; baseBranch?: string; title: string; body: string; draft?: boolean
  files: Array<{ path: string; action: 'add' | 'modify' | 'delete' | 'rename'; content?: string; renamedFrom?: string }>
}
// PrProvider gains:
//   openMultiFilePullRequest(input: MultiFilePr): Promise<{ prUrl: string; number: number; status: 'open' | 'draft' }>
```

- [ ] **Step 1: Write failing test** (`tests/modules/ops/pr-provider-multifile.test.ts`) — reuse the `mockFetchSequence`/`afterEach(unstubAllGlobals)` helper pattern from `pr-provider.test.ts`.
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGiteaPrProvider, createGitHubPrProvider } from '@modules/ops/actions/pr-provider'
// (copy mockFetchSequence from pr-provider.test.ts)
afterEach(() => vi.unstubAllGlobals())

describe('Gitea multi-file PR', () => {
  it('creates a branch, commits each file, opens one draft PR', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { commit: { id: 'base' } } },   // base branch
      { status: 201, json: {} },                            // create branch
      { status: 404 },                                      // file A get (new)
      { status: 200, json: {} },                            // file A put
      { status: 200, json: { sha: 'shaB' } },               // file B get (exists)
      { status: 200, json: {} },                            // file B put
      { status: 201, json: { html_url: 'https://g/infra/r/pulls/3', number: 3 } }, // PR
    ])
    const res = await createGiteaPrProvider({ baseUrl: 'https://g', owner: 'infra', repo: 'r', baseBranch: 'main', token: 't' })
      .openMultiFilePullRequest({ branch: 'pipeline/x', title: 'feat', body: 'b', draft: true,
        files: [{ path: 'a.ts', action: 'add', content: 'A' }, { path: 'b.ts', action: 'modify', content: 'B' }] })
    expect(res).toEqual({ prUrl: 'https://g/infra/r/pulls/3', number: 3, status: 'draft' })
  })
})

describe('GitHub multi-file PR', () => {
  it('creates a branch, commits files, opens a draft PR', async () => {
    mockFetchSequence([
      { status: 200, json: { object: { sha: 'base' } } },   // GET ref
      { status: 201, json: {} },                            // create ref
      { status: 404 },                                      // contents A (new)
      { status: 201, json: {} },                            // put A
      { status: 201, json: { html_url: 'https://github.com/o/r/pull/5', number: 5 } }, // PR (draft:true)
    ])
    const res = await createGitHubPrProvider({ owner: 'o', repo: 'r', baseBranch: 'main', token: 'gh' })
      .openMultiFilePullRequest({ branch: 'pipeline/y', title: 't', body: 'b', draft: true,
        files: [{ path: 'a.ts', action: 'add', content: 'A' }] })
    expect(res).toEqual({ prUrl: 'https://github.com/o/r/pull/5', number: 5, status: 'draft' })
  })
})
```
- [ ] **Step 2: Run — expect FAIL** (`bun vitest run tests/modules/ops/pr-provider-multifile.test.ts`).
- [ ] **Step 3: Implement** — add to the `PrProvider` interface and BOTH factories in `pr-provider.ts`. Reuse each provider's existing `h` headers / `api` base / branch-create logic; put each file via the contents API (base64 content + optional existing sha; `action:'delete'` → DELETE contents); open the PR once at the end. Gitea PR body `{ head, base, title, body }` (Gitea has no draft flag on create → return `status: input.draft ? 'draft' : 'open'` reflecting intent). GitHub PR body `{ head, base, title, body, draft: !!input.draft }` → `status` from `input.draft`.
```ts
// Gitea impl (inside createGiteaPrProvider return object):
async openMultiFilePullRequest(input) {
  const br = await jsonOrThrow(await fetch(`${api}/branches/${input.baseBranch ?? cfg.baseBranch}`, { headers: h }), 'gitea baseBranch')
  await jsonOrThrow(await fetch(`${api}/branches`, { method: 'POST', headers: h,
    body: JSON.stringify({ new_branch_name: input.branch, old_branch_name: input.baseBranch ?? cfg.baseBranch }) }), 'gitea createBranch')
  for (const f of input.files) {
    const path = encodeURIComponent(f.path)
    if (f.action === 'delete') {
      const cur = await fetch(`${api}/contents/${path}?ref=${input.branch}`, { headers: h })
      if (cur.ok) { const sha = (await cur.json()).sha
        await jsonOrThrow(await fetch(`${api}/contents/${path}`, { method: 'DELETE', headers: h,
          body: JSON.stringify({ branch: input.branch, message: input.title, sha }) }), 'gitea deleteFile') }
      continue
    }
    let sha: string | undefined
    const cur = await fetch(`${api}/contents/${path}?ref=${input.branch}`, { headers: h })
    if (cur.ok) sha = (await cur.json()).sha
    await jsonOrThrow(await fetch(`${api}/contents/${path}`, { method: 'PUT', headers: h,
      body: JSON.stringify({ branch: input.branch, message: input.title, content: Buffer.from(f.content ?? '').toString('base64'), sha }) }), 'gitea putFile')
  }
  const pr = await jsonOrThrow(await fetch(`${api}/pulls`, { method: 'POST', headers: h,
    body: JSON.stringify({ head: input.branch, base: input.baseBranch ?? cfg.baseBranch, title: input.title, body: input.body }) }), 'gitea createPr')
  return { prUrl: pr.html_url, number: pr.number, status: input.draft ? 'draft' as const : 'open' as const }
}
```
(GitHub impl: mirror using `git/ref`/`git/refs` for the branch, `contents` for files with `branch` in the body, and `pulls` with `draft: !!input.draft`; `status` from `input.draft`.)
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Full suite + typecheck; Checkpoint.**

---

## Phase 2 — Port adapters

### Task 2: board ticketSource adapter
**Files:**
- Create: `src/modules/pipelines/ticket-to-code/adapters/board-ticket-source.ts`
- Test: `tests/modules/pipelines/board-ticket-source.test.ts`

**Interfaces — Consumes:** `TicketSourcePort`, `TicketContext` from `../port-types.js` / `../types.js`.
**Produces:** `export function createBoardTicketSource(conversations: { get(id: string): { id: string; title: string | null; messages: Array<{ role: string; content: unknown }> } | null }): TicketSourcePort`

- [ ] **Step 1: Write failing test**
```ts
import { describe, it, expect } from 'vitest'
import { createBoardTicketSource } from '@modules/pipelines/ticket-to-code/adapters/board-ticket-source'
it('maps a board conversation to a TicketContext', async () => {
  const conv = { id: 'c1', title: 'Add export button', messages: [{ role: 'user', content: 'We need a CSV export.' }] }
  const src = createBoardTicketSource({ get: (id) => (id === 'c1' ? conv : null) })
  const t = await src.fetchTicket('board', 'c1')
  expect(t.id).toBe('c1'); expect(t.title).toBe('Add export button'); expect(t.body).toContain('CSV export'); expect(t.source).toBe('board')
})
it('throws when the conversation is not found', async () => {
  const src = createBoardTicketSource({ get: () => null })
  await expect(src.fetchTicket('board', 'missing')).rejects.toThrow(/not found/i)
})
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — map `title` (fallback `'Untitled ticket'`), `body` = the messages' text joined (`content` may be string or ContentBlock[]; stringify text parts), `source` from the arg, `raw` = the conversation. Verify the real `ConversationWithMessages`/`ConversationMessage` shape in `src/modules/conversations/conversation-service.ts` and match it.
- [ ] **Step 4: Run — expect PASS. Checkpoint.**

### Task 3: agentRunner port adapter (over `ctx.agents.executeAgent`)
**Files:**
- Create: `src/modules/pipelines/ticket-to-code/adapters/agent-runner-port.ts`
- Test: `tests/modules/pipelines/agent-runner-port.test.ts`

**Interfaces — Consumes:** `AgentRunnerPort`, `AgentRunInput`, `AgentRunOutput` from `../port-types.js`; a high-level executor `executeAgent(conversationId, agentId, task) => Promise<string>` (this is `ctx.agents.executeAgent`, agent/index.ts:302 — CONFIRM its exact signature/return before wiring).
**Produces:** `export function createAgentRunnerPort(deps: { executeAgent(conversationId: string, agentId: string, task: string): Promise<string>; newConversationId?: () => string }): AgentRunnerPort`

- [ ] **Step 1: Write failing test**
```ts
import { describe, it, expect, vi } from 'vitest'
import { createAgentRunnerPort } from '@modules/pipelines/ticket-to-code/adapters/agent-runner-port'
it('runs the agent and parses a JSON completion', async () => {
  const executeAgent = vi.fn(async () => '```json\n{"files":[]}\n```')
  const port = createAgentRunnerPort({ executeAgent })
  const out = await port.run({ agentId: 'dev', sessionId: 'conv1', instructions: 'implement', context: { a: 1 } })
  expect(out.text).toContain('files')
  expect(out.json).toEqual({ files: [] })
  const call = executeAgent.mock.calls[0]
  expect(call[0]).toBe('conv1'); expect(call[1]).toBe('dev'); expect(call[2]).toContain('implement'); expect(call[2]).toContain('"a": 1')
})
it('returns json undefined when the completion is not JSON', async () => {
  const port = createAgentRunnerPort({ executeAgent: async () => 'plain text answer' })
  const out = await port.run({ agentId: 'x', sessionId: null, instructions: 'hi' })
  expect(out.text).toBe('plain text answer'); expect(out.json).toBeUndefined()
})
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**
```ts
import type { AgentRunnerPort, AgentRunInput, AgentRunOutput } from '../port-types.js'
function tryParseJson(text: string): unknown | undefined {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : text).trim()
  try { return JSON.parse(candidate) } catch { return undefined }
}
export function createAgentRunnerPort(deps: {
  executeAgent(conversationId: string, agentId: string, task: string): Promise<string>
  newConversationId?: () => string
}): AgentRunnerPort {
  return {
    async run(input: AgentRunInput): Promise<AgentRunOutput> {
      const conversationId = input.sessionId ?? (deps.newConversationId ? deps.newConversationId() : `pipeline-${input.agentId}`)
      const task = input.context ? `${input.instructions}\n\nContext:\n${JSON.stringify(input.context, null, 2)}` : input.instructions
      const text = await deps.executeAgent(conversationId, input.agentId, task)
      return { text, json: tryParseJson(text) }
    },
  }
}
```
> Note: `modelOverride`/token counts are not surfaced by `executeAgent`; leave `tokensIn/Out` undefined. The agent's own config (model, tools) and the security-gate govern the run — the pipeline does not bypass them.
- [ ] **Step 4: Run — expect PASS. Checkpoint.**

### Task 4: artifacts port + pipeline prClient + no-op checkpoint
**Files:**
- Create: `src/modules/pipelines/ticket-to-code/adapters/artifact-port.ts`, `adapters/pipeline-pr-client.ts`, `adapters/checkpoint-noop.ts`
- Test: `tests/modules/pipelines/pipeline-pr-client.test.ts`

**Interfaces — Produces:**
```ts
// artifact-port.ts
export function createArtifactPort(svc: ArtifactServicePort): ArtifactServicePort  // pass-through/adapter; CONFIRM ctx.artifacts matches the port, else map
// pipeline-pr-client.ts
export function createPipelinePrClient(provider: PrProvider): PRClientPort
// checkpoint-noop.ts
export function createNoopCheckpoint(): CheckpointPort  // { async save(){}, async load(){ return undefined } }
```
- [ ] **Step 1: Write failing test** (`pipeline-pr-client.test.ts`)
```ts
import { describe, it, expect, vi } from 'vitest'
import { createPipelinePrClient } from '@modules/pipelines/ticket-to-code/adapters/pipeline-pr-client'
it('maps PullRequestInput to a multi-file draft PR and resolves patches to content', async () => {
  const openMultiFilePullRequest = vi.fn(async () => ({ prUrl: 'https://g/pr/1', number: 1, status: 'draft' as const }))
  const provider: any = { getFileContent: async () => 'old\n', openMultiFilePullRequest }
  const client = createPipelinePrClient(provider)
  const res = await client.openPullRequest({ title: 't', body: 'b', branch: 'pipeline/x', baseBranch: 'main',
    files: [{ path: 'a.ts', action: 'add', newContent: 'A' }] })
  expect(res).toMatchObject({ url: 'https://g/pr/1', number: 1, branch: 'pipeline/x', status: 'draft' })
  const passed = openMultiFilePullRequest.mock.calls[0][0]
  expect(passed.draft).toBe(true); expect(passed.files[0]).toMatchObject({ path: 'a.ts', action: 'add', content: 'A' })
})
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — `createPipelinePrClient`: for each `PullRequestInput.files[]`, resolve `content` = `newContent` when present, else (patch given) `applyPatch(await provider.getFileContent(path) ?? '', patch)` (honest throw/skip when `applyPatch` returns false — return a failed result or throw so the stage records failure), map to `openMultiFilePullRequest({ branch, baseBranch, title, body, draft: true, files })`, return `{ provider: <'gitea'|'github'>, url, number, branch, status }`. `createArtifactPort`: confirm `ctx.artifacts` (create/getWithPayload/link) matches `ArtifactServicePort`; if identical, `createArtifactPort = (svc) => svc`. `createNoopCheckpoint` as specified.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Full suite + typecheck; Checkpoint.**

---

## Phase 3 — Config + bootstrap wiring

### Task 5: `pipelines.ticketToCode` config
**Files:**
- Modify: `src/core/config/schema.ts` (add `pipelines` block), `src/core/types.ts` (`EyasConfig` mirror if needed — check how `ops` was added)
- Test: extend `tests/core/config.test.ts`

**Produces:** `config.pipelines.ticketToCode = { enabled: boolean; prProvider: 'gitea'|'github'|null; prBaseUrl: string|null; prOwner: string|null; prRepo: string|null; prBaseBranch: string; approvalGates: Record<string,boolean> }`.
- [ ] **Step 1: Write failing test** — default `enabled===false`, `prProvider===null`, `approvalGates['pr-open']===true`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement (Zod)**
```ts
pipelines: z.object({
  ticketToCode: z.object({
    enabled: z.boolean().default(false),
    prProvider: z.enum(['gitea', 'github']).nullable().default(null),
    prBaseUrl: z.string().nullable().default(null),
    prOwner: z.string().nullable().default(null),
    prRepo: z.string().nullable().default(null),
    prBaseBranch: z.string().default('main'),
    approvalGates: z.record(z.string(), z.boolean()).default({ 'pr-open': true }),
  }).default({}),
}).default({}),
```
- [ ] **Step 4: Run — expect PASS. Checkpoint.**

### Task 6: attach `pipelineDeps` + mount routes in `onStart`
**Files:**
- Modify: `src/modules/pipelines/ticket-to-code/index.ts` (`onStart`)
- Test: `tests/modules/pipelines/pipeline-wiring.test.ts`

**Interfaces — Consumes:** all Phase 2 adapters + Task 1 provider + `createPrProviderFromConfig` (#41).
- [ ] **Step 1: Write failing test** — with a `ctx` whose `config.pipelines.ticketToCode.enabled=true` + a configured provider + a stubbed `secrets.get` returning a token, `onStart` sets `ctx.pipelineDeps` (all five ports present) and registers the routes; with `enabled=false`, `ctx.pipelineDeps` is not set and no routes are registered. (Use a minimal fake ctx with `agents.executeAgent`, `artifacts`, `conversations`, `secrets`, `config`, `http`, `logger`.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — at the top of `onStart`: if `!ctx.config.pipelines.ticketToCode.enabled` → log + return. Build `prProvider = await createPrProviderFromConfig({ provider: cfg.prProvider, baseUrl: cfg.prBaseUrl, owner: cfg.prOwner, repo: cfg.prRepo, baseBranch: cfg.prBaseBranch }, () => ctx.secrets.get('pipeline-pr-token','system').then(v => (v as string) ?? null))`. If `!prProvider` → log "disabled: PR provider/token not configured" + return (inert). Else assemble:
```ts
;(ctx as any).pipelineDeps = {
  ticketSource: createBoardTicketSource((ctx as any).conversations ?? (ctx as any).chat),
  agentRunner: createAgentRunnerPort({ executeAgent: (ctx as any).agents.executeAgent }),
  artifacts: createArtifactPort((ctx as any).artifacts),
  prClient: createPipelinePrClient(prProvider),
  checkpoint: createNoopCheckpoint(),
  logger: ctx.logger,
}
```
then let the existing `onStart` route-registration body run (it reads `ctx.pipelineDeps`). Pass `config.approvalGates` through to run config where the orchestrator reads it (confirm where `PipelineRunConfig.approvalGates` is sourced — thread the default from config).
> Confirm the exact names `ctx.conversations`/`ctx.agents.executeAgent`/`ctx.artifacts` at implementation time (grep the modules' `onStart`), and the module-load order (pipelines must start AFTER agent/artifacts/conversations — check `dependencies` in the manifest; add them if missing).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Full suite + typecheck.** `bun vitest run && bun run lint` — all green.
- [ ] **Step 6: Checkpoint** — present the complete diff for review; commit only on explicit request.

---

## Self-Review Notes (author)
- Spec coverage: multi-file PrProvider (T1) ✓, board ticketSource (T2) ✓, agentRunner port (T3) ✓,
  artifacts/prClient/checkpoint (T4) ✓, config (T5) ✓, wiring+route-mount+enable-condition (T6) ✓,
  draft PR ✓ (T1/T4 status), default pr-open gate ✓ (T5 config, threaded T6), deploy stays stub (untouched) ✓,
  vendor-neutral internal-board-only ✓.
- Refinement vs spec §4.2: the agentRunner adapter uses the high-level `ctx.agents.executeAgent` (agent/index.ts:302)
  rather than draining the low-level runner generator — simpler and correct.
- Verify-at-impl notes are explicit (executeAgent signature, ConversationMessage shape, ctx exposure names,
  module load order, approvalGates sourcing) — not vague TODOs.
- Type consistency: `PrProvider.openMultiFilePullRequest`, `PRClientPort.openPullRequest`, adapter factory
  names used identically across tasks.
