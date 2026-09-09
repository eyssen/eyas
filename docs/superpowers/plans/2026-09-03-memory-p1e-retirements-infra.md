# Memory P1e — Retirements, R2 Boundary, Interim Fixes, Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the R2 boundary (no model-facing memory write: `save_memory` retired everywhere, in six languages), make background model work go only to headless + isolated providers (`supportsHeadlessInvocation`, `isEligibleForBackground`, no gateway fallback), gate `gateway.embed()` on a declared embedding model, land the four interim fixes (vector-only hydration, lazy agent memory routes, `CORE_IDENTITY` budget, privacy `tool_result` scanning), delete the dead memory files, and fix the shipping infrastructure (Dockerfile build + Bun pin, k8s `1Gi/2Gi`, a CI SQLite-capability job).

**Architecture:** Every change here is subtractive or a boundary fix on code that already exists; nothing in this plan writes to the new `memory_*` tables. The retirement is enforced by one contract test that scans `src/` and the production tool registry so the tool cannot come back. Provider eligibility is one predicate (`isEligibleForBackground`) applied inside the existing capture ladder, whose rung (d) is removed; a background call with nothing eligible throws a typed `NoEligibleProviderError` that the legacy capture records as `degraded_no_model` (P1c's Phase 1 `runExtraction` never attempts a model call and does not consume this error; Phase 3's model pass will record the same status in `memory_run` through P1a's `recordRun` — P1a's `memory_run.status` CHECK already admits it). Infra changes are last and flagged for owner coordination because they touch the shipping `Dockerfile` and the k8s manifests.

**Tech Stack:** TypeScript 5.9 strict/ESM, Bun 1.3.10 (Node 22 fallback), Hono, Drizzle raw `sql`, Zod, Pino, Vitest (`bun vitest run <path>`), Docker (`oven/bun:1.3.10-slim`), Helm 3, GitHub Actions. **No new dependencies in this plan.**

**Spec:** `docs/superpowers/specs/2026-09-03-sovereign-layered-memory-design.md` (§3 principles, §6 model pass, §11 authorization collapse, §13 storage/runtime, §14 retirements, §15 Phase 1 + interim fixes, §16-9/-15/-16/-17, §17 risks) as corrected by `docs/superpowers/specs/2026-09-03-memory-p0-spike-report.md` (§2 #3, #4, #16, #17, #18, #22; §5 test ports; §6 spec changes). Companion: `docs/superpowers/specs/2026-09-03-memory-gap-analysis.md` (§A rows 26, 42, 45; §B.2 retire list; §B.3 conflicts 1 and 4; §E-1, §E-2).

**Depends on:** plan `p1a-foundation` **only** for Task 13's CI probe script, which imports `probeSqliteCapabilities` from `src/core/db/sqlite-capabilities.ts`. Every other task is independent of p1a–p1d and can be executed first. Nothing in p1b–p1d consumes Task 5/6's `supportsHeadlessInvocation` / `isEligibleForBackground` / `NoEligibleProviderError` in Phase 1 — P1c's extractor is deterministic-only and keeps `degraded_no_model` reserved for Phase 3 (P1c Task 11 semantics); the Phase 3 model pass is the consumer, recording `status: 'degraded_no_model'` through `recordRun` in `src/modules/memory/v2/runs.ts`.

## Global Constraints

- Spec §1: **TypeScript/Bun (Node 22 fallback), single process, embedded SQLite via Drizzle, MIT-compatible dependencies only, VPS/K8s pods without GPU, no local LLM assumed (CLI-only providers such as Claude Code or Grok CLI may be the only model), six UI languages, the existing board (a task is a conversation) and scheduler.**
- Spec §3: "The model proposes, EYAS decides … There is **no model-facing write tool** (today's `save_memory` is retired)." Degraded mode (zero model calls) is the default path.
- Spec §6 / spike §2 #16: `eligible(p) := p.supportsHeadlessInvocation === true && (p.supportsIsolatedCompletion === true || !isCliProviderId(p.id))`; `supportsHeadlessInvocation` is `true` on every API provider and claude-code, **absent** on grok-cli and kimi-cli; the ladder's `gateway-fallback` rung (d) is **not used for background work**.
- Spike §2 #18: `gateway.embed()` selects only providers that **declare** an embedding model; the inherited compat `embed` is gated behind a catalog flag.
- Spike §2 #3, #4, #22 / spec §16-15, §16-16: runtime image `oven/bun:1.3.10-slim` (glibc), tag pinned to the project's Bun; `bun install … --ignore-scripts` in the deps stages; k8s `requests memory: 1Gi / limits 2Gi`, CPU `500m / 2`; `512Mi/1Gi` kept only as the documented bridge-embeddings profile.
- Spec §15 interim fixes / §16-9: vector-hydration drop fixed as an interim S; `agent/index.ts:979` made lazy; `CORE_IDENTITY` overrun fixed by raising the prefix reserve to 9 000; `collectSegments` scans `tool_result`.
- Repo rules: English code and comments; Pino via `ctx.logger` / injected logger, **never `console.log`** in `src/` (CI scripts under `scripts/` print, like the existing scripts); Zod for config; `/api/v1/` prefix; every user-facing string in six languages (the handbook edits here are the only user-facing strings, hence six files each); version stays **0.8.22-beta** — `package.json`'s version is not touched.
- Git: **an agent executing this plan never runs `git commit`, `git push`, or creates a branch.** Each task ends with the commit command the owner runs by hand; stop at that step and hand over. No `Co-Authored-By` lines.
- Tests: new tests under `tests/modules/memory/**`, `tests/modules/model/**`, `tests/modules/agent/**`, `tests/modules/privacy/**`, `tests/contracts/**`; use `createMemoryDb()` / `createTestDb()` from `tests/helpers/test-db.ts`; run one file with `bun vitest run <path>`; type-check with `bun run lint` (`tsc --noEmit`).
- Coordination: the nested `src/web` install (`Dockerfile` `build-web` stage, `bun run build:web`, the installer CHANGELOG entry) landed as `65c485c7` and shipped in `9711ea1f` (0.8.22-beta); the working tree is clean at plan time. Still, run `git status --short Dockerfile package.json CHANGELOG.md` before Tasks 4 and 13–15 and, if any of them is dirty again, apply this plan's hunks on top (never reset the file) and tell the owner which hunks are not this plan's. Tasks 13–15 (infra) remain flagged **coordinate** — they change the shipping image and manifests — and are executed only after the owner confirms. `package.json` is not modified by this plan at all (the Docker fix uses `--ignore-scripts`, not `optionalDependencies`).

---

## File structure

| Path | Responsibility |
|---|---|
| `src/modules/tools/builtin/memory-tools.ts` (modify) | Only `search_memory` remains (re-contracted in Phase 2). |
| `src/modules/prompt-wizard/core-rules.ts` (modify rule 8) · `seed-migration.ts` (add prior body) | The agent is told it cannot save memory; existing installs pick the rule up through the seed migration. |
| `src/modules/agent/agent-templates.ts` (11 allow-lists + 2 comments) · `src/modules/security-gate/autonomy-policy.ts:130` · `src/modules/security-gate/types.ts:84` · `src/modules/agent/conversation-runner.ts:871,883` | Every remaining `save_memory` binding removed; `memory_maintenance` category kept. |
| `tests/contracts/save-memory-retired.contract.test.ts` (create) | The retirement, pinned: registry, templates, gate tiers, autonomy map, resume ledger, core rules, and a `src/` source scan. |
| `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/knowledge/memory.md` + `automation/tools.md` (12 files) · `CHANGELOG.md` | Six-language handbook wording + the `[Unreleased]` entry. |
| `src/modules/model/types.ts` (modify `AIProvider`) + 7 provider files | `supportsHeadlessInvocation`, `supportsEmbeddings`, `embeddingModels`. |
| `src/modules/memory/capture/completion.ts` (modify) · `capture/index.ts` (modify catch) | `isEligibleForBackground`, `NoEligibleProviderError`, rung (d) removed, `degraded_no_model` row. |
| `src/modules/model/gateway.ts:245-262` · `src/modules/model/submodules/openai-compat/{catalog,provider}.ts` · `src/modules/memory/embeddings/model-bridge.ts` | Embedding selection gated on the declaration. |
| `src/modules/memory/memory-service.ts` (modify before "Graph boosts") | Vector-only hits hydrated from their own tables. |
| `src/modules/agent/routes-memory.ts` (modify) · `src/modules/agent/index.ts:979-988` | Memory resolved lazily per request. |
| `src/modules/prompt-wizard/token-budget.ts` (modify) | `PREFIX_RESERVE_TOKENS = 9_000`, `coreIdentity: 500`. |
| `src/modules/privacy/index.ts` (modify `collectSegments`, `applySegmentSanitizations`) | `tool_result` blocks scanned and written back. |
| Deleted: `src/modules/memory/context-builder-v2.ts`, `search/context-builder.ts`, `consolidation/decay.ts`, `consolidation/implicit-extractor.ts`, `tests/modules/memory/{consolidation,context-builder}.test.ts`; trimmed: `types.ts` `MemoryConfig`, `blocks/memory-blocks.ts` `formatForPrompt`; rewritten: `consolidator/README.md`; `CLAUDE.md` `a2a` | Dead surface removed with its tests. |
| `Dockerfile` (modify) · `scripts/ci/sqlite-capability-probe.ts` (create) · `.github/workflows/image-capabilities.yml` (create) · `deploy/k8s/deployment.yaml` · `deploy/k8s/helm/eyas/{values.yaml,Chart.yaml}` · `deploy/k8s/README.md` | Build fix, Bun pin, capability probe stage + CI, resource sizing. |

**Execution order.** Tasks 1–4 (retirement) → 5–7 (providers) → 8–11 (interim fixes) → 12 (dead files) → 13–15 (infra, **coordinate**) → 16 (verification). Tasks 5–12 do not depend on 1–4 and may run in parallel with them; nothing after Task 4 touches the handbook.

---

### Task 1: Remove the `save_memory` tool

**Files:**
- Modify: `src/modules/tools/builtin/memory-tools.ts:58-92` (delete the second tool)
- Test: `tests/contracts/tool-service/memory-tools.contract.test.ts` (rewrite), `tests/modules/memory/scope-stamping.test.ts` (rewrite)

**Interfaces:**
- Consumes: `createMemoryTools(getService: () => any): ToolImplementation[]` (unchanged signature); `createToolContractHarness` from `tests/helpers/tool-contract.ts`; `memory.episodic.create({ content, sourceType })`.
- Produces: `createMemoryTools()` returns exactly one tool, `search_memory`. The registry (and therefore the CLI-MCP bridge, which proxies `tools/list` to the live registry — `src/modules/model/cli-mcp/stdio-mcp-server.ts:65-66`) no longer advertises `save_memory`. `search_memory` is untouched: Phase 2 replaces it with `memory_search` / `memory_expand`.

- [ ] **Step 1: Rewrite the contract test so it seeds memory the way EYAS does, not through a tool**

Replace the whole of `tests/contracts/tool-service/memory-tools.contract.test.ts` with:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { createMemoryTables } from '@modules/memory/schema'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createArchiveMemoryService } from '@modules/memory/tiers/archive-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from '@modules/memory/memory-service'
import { createMemoryTools } from '@modules/tools/builtin/memory-tools'

/**
 * Contract test: the memory tools against the REAL memory service, through
 * the REAL executor. Guards the seam that once made the search tool dead — it
 * called `service.search(query, opts)` while the service only exposes the
 * one-object `search({ query, tiers, limit })`.
 *
 * Since the sovereign-memory Phase 1 (spec §3) there is no model-facing write
 * tool: EYAS records memory itself. Rows are therefore seeded the way EYAS
 * writes them — straight through the episodic service — never through a tool.
 */

let db: ReturnType<typeof createMemoryDb>
let vaultPath: string
let memory: ReturnType<typeof createMemoryService>
let harness: ToolContractHarness

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  vaultPath = mkdtempSync(join(tmpdir(), 'eyas-memtools-'))

  const wikilinks = createWikilinkService(db)
  wikilinks.init()
  const working = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
  const episodic = createEpisodicMemoryService(db)
  const archive = createArchiveMemoryService(db)
  const vault = createVaultService(vaultPath)
  const indexer = createVaultIndexer(db, vault, wikilinks)

  memory = createMemoryService({ working, episodic, archive, vault, indexer, wikilinks, db })
  harness = createToolContractHarness(createMemoryTools(() => memory))
})

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true })
})

describe('memory tools ↔ memory service contract', () => {
  it('exposes exactly one memory tool — search_memory — and no model-facing write (R2)', () => {
    expect(harness.registry.list().map((t) => t.name)).toEqual(['search_memory'])
    expect(harness.registry.has('save_memory')).toBe(false)
  })

  it('search_memory finds what EYAS recorded (tier filter honoured)', async () => {
    memory.episodic.create({ content: 'Kubernetes deployment guide for OKE', sourceType: 'extraction' })

    const r = await harness.run('search_memory', { query: 'kubernetes', tier: 'episodic' })

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(Array.isArray(output.results)).toBe(true)
    expect(output.results.length).toBeGreaterThan(0)
    expect(output.results[0].content).toContain('Kubernetes')
  })

  it('search_memory honours the limit and returns hydrated results', async () => {
    memory.episodic.create({ content: 'Cloudflare tunnel setup for the ingress node', sourceType: 'extraction' })
    memory.episodic.create({ content: 'Cloudflare WAF rule for the ingress node', sourceType: 'extraction' })

    const r = await harness.run('search_memory', { query: 'cloudflare ingress', limit: 1 })

    expect(r.success).toBe(true)
    expect((r.output as any).results).toHaveLength(1)
  })

  it('does not advertise the unsearchable "working" tier in its input schema', () => {
    const tool = harness.registry.get('search_memory')!
    const tierEnum = (tool.inputSchema as any).properties.tier.enum as string[]

    expect(tierEnum).not.toContain('working')
    expect(tierEnum).toEqual(['episodic', 'semantic', 'procedural', 'archive', 'conversation'])
  })

  it('search_memory forwards excludeConversationId from toolCtx.conversationId', async () => {
    const spy = vi.spyOn(memory, 'search')

    await harness.run('search_memory', { query: 'x' }, { conversationId: 'conv-xyz' })

    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0][0].excludeConversationId).toBe('conv-xyz')
  })

  it('fails soft (structured error, not throw) when the module is not started yet', async () => {
    const h = createToolContractHarness(createMemoryTools(() => undefined))

    const search = await h.run('search_memory', { query: 'x' })
    expect(search.success).toBe(true)
    expect((search.output as any).error).toMatch(/not ready/i)
    expect(h.registry.has('save_memory')).toBe(false)
  })
})
```

- [ ] **Step 2: Rewrite the scope-stamping test (the two `save_memory` cases go; PreCompact stays)**

Replace the whole of `tests/modules/memory/scope-stamping.test.ts` with:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createMemoryTools } from '@modules/tools/builtin/memory-tools'
import { createMemoryLifecycle } from '@modules/memory/consolidation/memory-lifecycle'

let db: any, episodic: any

beforeEach(() => { db = createMemoryDb(); createMemoryTables(db); episodic = createEpisodicMemoryService(db) })

describe('scope stamping', () => {
  it('the memory tool set carries no write tool — the model never stamps scope itself (R2)', () => {
    // Before Phase 1 `save_memory` stamped conversation_id/project_id from the
    // ToolContext. That path is gone: L0 capture stamps scope at the
    // persistence layer (plan p1b), and the only remaining tool is a read.
    expect(createMemoryTools(() => ({ episodic })).map((t) => t.name)).toEqual(['search_memory'])
  })

  it('PreCompact stamps the conversation and the resolved project', () => {
    const hooks = createMemoryLifecycle({ episodic, resolveProjectId: () => 'p9' })
    hooks.onContextCompact!('c2', 'a compaction summary long enough to be worth keeping around')
    const row = (db.all(sql`SELECT conversation_id, project_id FROM episodic_memories`) as any[])[0]
    expect(row).toEqual({ conversation_id: 'c2', project_id: 'p9' })
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `bun vitest run tests/contracts/tool-service/memory-tools.contract.test.ts tests/modules/memory/scope-stamping.test.ts`
Expected: FAIL — `expected ['search_memory', 'save_memory'] to deeply equal ['search_memory']` (twice), `harness.registry.has('save_memory')` is `true`.

- [ ] **Step 4: Delete the tool**

In `src/modules/tools/builtin/memory-tools.ts` delete lines 58–92 — the block that starts with

```ts
    {
      name: 'save_memory',
      description: 'Save a new entry to episodic memory. Use for important observations, decisions, or facts worth remembering.',
```

and ends with

```ts
        return { saved: true, id: entry.id }
      },
    },
```

so the array closes right after `search_memory`'s `},` (line 57). Then replace the header comment (lines 6–7):

```ts
/** `getService` resolves `ctx.memory`, which only exists after memory.onStart. */
export function createMemoryTools(getService: () => any): ToolImplementation[] {
```

with:

```ts
/**
 * `getService` resolves `ctx.memory`, which only exists after memory.onStart.
 *
 * Read-only on purpose. There is no model-facing write tool: EYAS records
 * memory itself at the persistence layer (sovereign memory, spec §3 — the
 * former `save_memory` was retired in Phase 1). `search_memory` stays until
 * Phase 2 re-contracts it as `memory_search` / `memory_expand`.
 */
export function createMemoryTools(getService: () => any): ToolImplementation[] {
```

The file now ends:

```ts
        return { results }
      },
    },
  ]
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun vitest run tests/contracts/tool-service/memory-tools.contract.test.ts tests/modules/memory/scope-stamping.test.ts tests/modules/memory/search-scope.test.ts tests/contracts/registry-tier.contract.test.ts`
Expected: PASS (6 + 2 + existing). `search-scope.test.ts` only uses `search_memory` and is unaffected. `tests/modules/memory/capture-wiring.test.ts:410` keeps the phrase "saved that to memory with save_memory" inside an *assistant narration fixture* — that is the narration-immunity test's point (the claim is a lie the model tells) and stays as is.

- [ ] **Step 6: Commit**

```bash
git add src/modules/tools/builtin/memory-tools.ts tests/contracts/tool-service/memory-tools.contract.test.ts tests/modules/memory/scope-stamping.test.ts
git commit -m "feat(memory): retire the save_memory tool — no model-facing memory write (R2)"
```

---

### Task 2: Rule 8 — "you cannot save memory; EYAS records automatically" + seed migration

**Files:**
- Modify: `src/modules/prompt-wizard/core-rules.ts:33-37`
- Modify: `src/modules/prompt-wizard/seed-migration.ts:67-148` (`PRIOR_CORE_RULES`)
- Test: `tests/modules/prompt-wizard/canonical-seed.test.ts:26-42`, `tests/modules/prompt-wizard/seed-migration-hashset.test.ts:138-189`, `tests/modules/prompt-wizard/cache-prefix-builder.test.ts:56-57`

**Interfaces:**
- Consumes: `CORE_RULES` (consumed by `prompt-wizard/index.ts:154`, `master-prompt.ts:30`, `subagent-prompt-builder.ts:44` — untouched); `refreshMasterSeedsFromKnownDefaults(db, currentSeeds)` — a locked `core-rules` row whose SHA-256 is in `PRIOR_CORE_RULES_HASHES` is refreshed to the current seed, so **the outgoing text must be added verbatim** or every already-seeded install keeps the old rule (touchpoints §5).
- Produces: the new rule 8 text; `PRIOR_CORE_RULES[2]` = the outgoing (F1.1) body.

- [ ] **Step 1: Update the canonical-seed test**

In `tests/modules/prompt-wizard/canonical-seed.test.ts` replace lines 26–42:

```ts
  it('the memory rule binds an agent to EYAS memory in BOTH directions (F1.1)', () => {
    // Recall was the only half the rule ever stated, and "update memory when you
    // learn something new" names no tool — a CLI-backed agent reads that as its
    // own machine-global convention and writes outside EYAS entirely.
    const memoryRule = CORE_RULES.split('\n').slice(
      CORE_RULES.split('\n').findIndex((l) => l.startsWith('8. MEMORY:')),
      CORE_RULES.split('\n').findIndex((l) => l.startsWith('9. ')),
    ).join('\n')
    expect(memoryRule).toMatch(/search_memory/)
    expect(memoryRule).toMatch(/save_memory/)
    expect(memoryRule).toMatch(/only memory/i)
    expect(memoryRule).toMatch(/\.claude/)
    expect(memoryRule).toMatch(/\.grok/)
    // MEMORY.md only: CLAUDE.md was dropped from the rule so it agrees with the
    // gate, which lets a workspace's own .claude config through.
    expect(memoryRule).toMatch(/MEMORY\.md/)
  })
```

with:

```ts
  it('the memory rule binds an agent to EYAS memory: recall via search_memory, no model-side write (R2)', () => {
    // Spec §3: "there is no model-facing write tool". The rule has to say so in
    // words a CLI-backed agent cannot read as "use your own machine-global
    // memory instead" — and still name the one read tool it does have. F1.1's
    // two-way rule ("record with save_memory") is the outgoing text; the seed
    // migration carries it as a known prior.
    const memoryRule = CORE_RULES.split('\n').slice(
      CORE_RULES.split('\n').findIndex((l) => l.startsWith('8. MEMORY:')),
      CORE_RULES.split('\n').findIndex((l) => l.startsWith('9. ')),
    ).join('\n')
    expect(memoryRule).toMatch(/cannot save memory/i)
    expect(memoryRule).toMatch(/records automatically/i)
    expect(memoryRule).toMatch(/search_memory/)
    expect(memoryRule).not.toMatch(/save_memory/)
    expect(memoryRule).toMatch(/only memory/i)
    expect(memoryRule).toMatch(/\.claude/)
    expect(memoryRule).toMatch(/\.grok/)
    // MEMORY.md only: CLAUDE.md was dropped from the rule so it agrees with the
    // gate, which lets a workspace's own .claude config through.
    expect(memoryRule).toMatch(/MEMORY\.md/)
  })
```

- [ ] **Step 2: Update the seed-migration hashset test**

In `tests/modules/prompt-wizard/seed-migration-hashset.test.ts` change lines 186–188:

```ts
    // …and the body seeded here is genuinely the outgoing one, not the current.
    expect(priorRules).not.toBe(CORE_RULES)
    expect(CORE_RULES).toMatch(/save_memory/)
```

to:

```ts
    // …and the body seeded here is genuinely a prior one, not the current.
    expect(priorRules).not.toBe(CORE_RULES)
    expect(CORE_RULES).not.toMatch(/save_memory/)
```

and insert this new case directly after that `it(...)` block (i.e. before line 191 `it('does not treat the current CORE_RULES text as stale (already current)', …`):

```ts
  it('refreshes the F1.1 CORE_RULES body (two-way rule naming save_memory) to the current seed', () => {
    const db = createMemoryDb(); table(db)
    // Verbatim outgoing body — every instance seeded between F1.1 and the
    // sovereign-memory Phase 1 holds exactly this. Until it is a KNOWN prior,
    // "you cannot save memory" reaches nobody who has already booted.
    const priorRules = `## Mandatory Rules

These rules guide your behavior. Enforcement is also applied in code — audit
logging, permission checks, the security gate, and blast-radius confirmation
are not bypassable.

1. AUDIT: Every action is logged. Never attempt to hide or obscure your actions.
2. PERMISSIONS: Respect permission checks. Never attempt to escalate privileges.
3. BLAST RADIUS: Before any action, assess reversibility and act accordingly:
   - LOW (read, list, search): execute freely.
   - MEDIUM (write, edit, send a message): proceed when the task implies it.
   - HIGH (delete, push, transfer money, broadcast): require explicit confirmation.
   - CRITICAL (cross-system, irreversible): require typed confirmation.
4. SECRETS & PRIVACY: Never expose passwords, tokens, or API keys in responses
   or logs. Never exfiltrate private data. Request secrets through the secrets module.
5. HONESTY: If you don't know or can't verify something, say so. Never fabricate
   APIs, functions, file paths, or data. "I don't know" is an acceptable answer.
6. SCOPE: Act only within your assigned tools and capabilities. If a task needs
   tools you don't have, report it — don't improvise.
7. VERIFICATION / GROUNDING: Do not work from model knowledge alone when the
   owner has indexed sources or a knowledge base. Before asserting APIs, file
   paths, symbols, schemas, or doc facts: list_search_sources + search_indexed
   (code/docs), search_knowledge (wiki), or search_memory (vault). Cite hits as
   [source:<id>]. If retrieval is empty, say so — never fabricate. Also check
   existing code before writing new code, and existing data before duplicates.
8. MEMORY: EYAS's own memory is the only memory you have. Recall with
   search_memory before assuming or asking the owner to repeat something;
   record a durable fact with save_memory as soon as you learn it. Never write
   memory elsewhere — not to ~/.claude, ~/.grok, an ai-memory or Obsidian
   vault, nor to a MEMORY.md outside the workspace.
9. COST: Be token-efficient. Prefer diffs over full-file rewrites. Don't pull
   more context than necessary. Don't repeat back what the owner said or explain
   obvious code.
10. SECURITY: Refuse destructive techniques, mass targeting, supply-chain
    compromise, or detection evasion for malicious purposes.
11. AI DISCLOSURE: When sending external messages on the owner's behalf, disclose
    AI involvement when asked or when contextually appropriate.
12. INTEGRATION TESTS: Use real services where the owner has directed integration
    testing — don't silently mock them.
13. ASK BEFORE COMMIT: Never auto-commit, push, or modify shared state without
    explicit owner approval.
14. LANGUAGE: Match the owner's language. Code, comments, commit messages, and
    technical identifiers are always in English.`
    seed(db, 'master-core-rules', 'core-rules', priorRules)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('core-rules')).toBe(CUR.coreRules)
    expect(priorRules).not.toBe(CORE_RULES)
    expect(priorRules).toMatch(/save_memory/)
  })
```

- [ ] **Step 3: Update the cache-prefix-builder assertion**

In `tests/modules/prompt-wizard/cache-prefix-builder.test.ts` replace lines 56–57:

```ts
    expect(content).toContain('search_memory')
    expect(content).toContain('save_memory')
```

with:

```ts
    expect(content).toContain('search_memory')
    expect(content).toContain('cannot save memory')
    expect(content).not.toContain('save_memory')
```

- [ ] **Step 4: Run the three tests to verify they fail**

Run: `bun vitest run tests/modules/prompt-wizard/canonical-seed.test.ts tests/modules/prompt-wizard/seed-migration-hashset.test.ts tests/modules/prompt-wizard/cache-prefix-builder.test.ts`
Expected: FAIL — canonical-seed `expected … to match /cannot save memory/i`; hashset: the new case leaves the row at the prior text (hash unknown) and `expect(CORE_RULES).not.toMatch(/save_memory/)` fails; cache-prefix: `expected … not to contain 'save_memory'`.

- [ ] **Step 5: Rewrite rule 8**

In `src/modules/prompt-wizard/core-rules.ts` replace lines 33–37:

```
8. MEMORY: EYAS's own memory is the only memory you have. Recall with
   search_memory before assuming or asking the owner to repeat something;
   record a durable fact with save_memory as soon as you learn it. Never write
   memory elsewhere — not to ~/.claude, ~/.grok, an ai-memory or Obsidian
   vault, nor to a MEMORY.md outside the workspace.
```

with:

```
8. MEMORY: You cannot save memory; EYAS records automatically. EYAS's own
   memory is the only memory you have — use search_memory to look things up
   before assuming or asking the owner to repeat something. Never write
   memory elsewhere — not to ~/.claude, ~/.grok, an ai-memory or Obsidian
   vault, nor to a MEMORY.md outside the workspace.
```

- [ ] **Step 6: Add the outgoing body to `PRIOR_CORE_RULES`**

In `src/modules/prompt-wizard/seed-migration.ts`, the array `PRIOR_CORE_RULES` currently ends at line 147–148:

```ts
14. LANGUAGE: Match the owner's language. Code, comments, commit messages, and
    technical identifiers are always in English.`,
]
```

Insert a third element before the closing `]` — the exact text of the old `CORE_RULES` (identical to the `priorRules` literal in Step 2, including the two-way rule 8):

```ts
  // F1.1 → sovereign-memory Phase 1 body: the two-way MEMORY rule that named
  // save_memory. Retired with the tool (spec §3: no model-facing write).
  `## Mandatory Rules

These rules guide your behavior. Enforcement is also applied in code — audit
logging, permission checks, the security gate, and blast-radius confirmation
are not bypassable.

1. AUDIT: Every action is logged. Never attempt to hide or obscure your actions.
2. PERMISSIONS: Respect permission checks. Never attempt to escalate privileges.
3. BLAST RADIUS: Before any action, assess reversibility and act accordingly:
   - LOW (read, list, search): execute freely.
   - MEDIUM (write, edit, send a message): proceed when the task implies it.
   - HIGH (delete, push, transfer money, broadcast): require explicit confirmation.
   - CRITICAL (cross-system, irreversible): require typed confirmation.
4. SECRETS & PRIVACY: Never expose passwords, tokens, or API keys in responses
   or logs. Never exfiltrate private data. Request secrets through the secrets module.
5. HONESTY: If you don't know or can't verify something, say so. Never fabricate
   APIs, functions, file paths, or data. "I don't know" is an acceptable answer.
6. SCOPE: Act only within your assigned tools and capabilities. If a task needs
   tools you don't have, report it — don't improvise.
7. VERIFICATION / GROUNDING: Do not work from model knowledge alone when the
   owner has indexed sources or a knowledge base. Before asserting APIs, file
   paths, symbols, schemas, or doc facts: list_search_sources + search_indexed
   (code/docs), search_knowledge (wiki), or search_memory (vault). Cite hits as
   [source:<id>]. If retrieval is empty, say so — never fabricate. Also check
   existing code before writing new code, and existing data before duplicates.
8. MEMORY: EYAS's own memory is the only memory you have. Recall with
   search_memory before assuming or asking the owner to repeat something;
   record a durable fact with save_memory as soon as you learn it. Never write
   memory elsewhere — not to ~/.claude, ~/.grok, an ai-memory or Obsidian
   vault, nor to a MEMORY.md outside the workspace.
9. COST: Be token-efficient. Prefer diffs over full-file rewrites. Don't pull
   more context than necessary. Don't repeat back what the owner said or explain
   obvious code.
10. SECURITY: Refuse destructive techniques, mass targeting, supply-chain
    compromise, or detection evasion for malicious purposes.
11. AI DISCLOSURE: When sending external messages on the owner's behalf, disclose
    AI involvement when asked or when contextually appropriate.
12. INTEGRATION TESTS: Use real services where the owner has directed integration
    testing — don't silently mock them.
13. ASK BEFORE COMMIT: Never auto-commit, push, or modify shared state without
    explicit owner approval.
14. LANGUAGE: Match the owner's language. Code, comments, commit messages, and
    technical identifiers are always in English.`,
```

Verify the literal byte-for-byte against `git show HEAD:src/modules/prompt-wizard/core-rules.ts` (lines 8–50) — the hash comparison is exact; a stray trailing space breaks it.

- [ ] **Step 7: Run the prompt-wizard suite to verify it passes**

Run: `bun vitest run tests/modules/prompt-wizard`
Expected: PASS. `token-budget.test.ts` still asserts `estimateTokens(CORE_RULES) <= 800` — the new rule 8 is five lines like the old one.

- [ ] **Step 8: Commit**

```bash
git add src/modules/prompt-wizard/core-rules.ts src/modules/prompt-wizard/seed-migration.ts tests/modules/prompt-wizard/canonical-seed.test.ts tests/modules/prompt-wizard/seed-migration-hashset.test.ts tests/modules/prompt-wizard/cache-prefix-builder.test.ts
git commit -m "feat(prompt-wizard): rule 8 — you cannot save memory, EYAS records automatically; prior body kept for the seed migration"
```

---

### Task 3: Persona allow-lists, security gate, autonomy map, resume ledger — and the retirement contract test

**Files:**
- Modify: `src/modules/agent/agent-templates.ts:65,72` (comments) and the 11 `tools:` arrays at lines 159, 249, 502, 654, 728, 863, 935, 1007, 1153, 1229, 1299
- Modify: `src/modules/security-gate/types.ts:84`
- Modify: `src/modules/security-gate/autonomy-policy.ts:130`
- Modify: `src/modules/agent/conversation-runner.ts:871,883`
- Test (create): `tests/contracts/save-memory-retired.contract.test.ts`
- Test (modify): `tests/modules/security-gate/deterministic-gate.test.ts:23,89,137`, `tests/modules/security-gate/approval-tiers.test.ts:65,87,131`, `tests/modules/security-gate/runtime-monitor.test.ts:95,97,116`, `tests/modules/security-gate/llm-judge.test.ts:130`, `tests/modules/agent/resume-run.test.ts:120-138`, `tests/modules/agent/agent-runner-security-mode.test.ts:433-435`

**Interfaces:**
- Consumes: `ALL_TEMPLATES` (`@modules/agent/agent-templates`), `DEFAULT_CONFIG` (`@modules/security-gate/types`), `EXPLICIT_TOOL_CATEGORY` + `categoryForTool(toolName, riskTier?)` (`@modules/security-gate/autonomy-policy`), `DESTRUCTIVE_TOOLS` (`@modules/agent/conversation-runner`), `CORE_RULES`, `CORE_IDENTITY`, `buildProductionToolRegistry()` (`tests/helpers/production-tool-registry.ts`).
- Produces: nothing new — `memory_maintenance` (`autonomy-policy.ts:55`) **stays** as a category (it will bind the L1/L2 admin actions of Phase 3); only its `save_memory` key goes. `critic.ts` is untouched (`search_memory` stays a retrieval tool).

- [ ] **Step 1: Write the retirement contract test**

```ts
// tests/contracts/save-memory-retired.contract.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Sovereign memory, spec §3: "There is no model-facing write tool (today's
// save_memory is retired)." One wave, every binding — this test is what keeps
// the tool from creeping back through a template, a gate tier, the autonomy
// map or the resume ledger, and it scans src/ so a new reference anywhere is
// caught at review time, not in a live run.

import { describe, it, expect, beforeAll } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ToolRegistry } from '@modules/tools/tool-registry'
import { buildProductionToolRegistry } from '../helpers/production-tool-registry'
import { ALL_TEMPLATES } from '@modules/agent/agent-templates'
import { DEFAULT_CONFIG } from '@modules/security-gate/types'
import { EXPLICIT_TOOL_CATEGORY, categoryForTool } from '@modules/security-gate/autonomy-policy'
import { DESTRUCTIVE_TOOLS } from '@modules/agent/conversation-runner'
import { CORE_RULES } from '@modules/prompt-wizard/core-rules'
import { CORE_IDENTITY } from '@modules/prompt-wizard/core-identity'

const RETIRED = 'save_memory'
const SRC_ROOT = join(process.cwd(), 'src')
// The seed migration keeps the OUTGOING rule text verbatim so already-seeded
// installs are refreshed (prompt-wizard/seed-migration.ts PRIOR_CORE_RULES).
const ALLOWED_SOURCE_MENTIONS = new Set(['src/modules/prompt-wizard/seed-migration.ts'])

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsFiles(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

let registry: ToolRegistry

beforeAll(async () => {
  registry = await buildProductionToolRegistry()
})

describe('save_memory is retired (R2 boundary)', () => {
  it('is not in the production tool registry (and therefore not on the CLI-MCP bridge)', () => {
    expect(registry.has(RETIRED)).toBe(false)
    expect(registry.has('search_memory')).toBe(true)
  })

  it('is on no persona allow-list', () => {
    for (const template of ALL_TEMPLATES) {
      expect(template.tools, `template "${template.id}" still lists ${RETIRED}`).not.toContain(RETIRED)
    }
  })

  it('is in no security-gate risk tier', () => {
    for (const [tier, names] of Object.entries(DEFAULT_CONFIG.riskTiers)) {
      expect(names as string[], `tier "${tier}" still lists ${RETIRED}`).not.toContain(RETIRED)
    }
  })

  it('has no autonomy binding, while memory_maintenance survives as a category', () => {
    expect(RETIRED in EXPLICIT_TOOL_CATEGORY).toBe(false)
    expect(categoryForTool(RETIRED, 'yellow')).toBeNull()
    expect(Object.values(EXPLICIT_TOOL_CATEGORY)).not.toContain(undefined)
  })

  it('is not in the resume ledger\'s destructive list', () => {
    expect(DESTRUCTIVE_TOOLS).not.toContain(RETIRED)
  })

  it('is named by neither the core rules nor the core identity', () => {
    expect(CORE_RULES).not.toMatch(/save_memory/)
    expect(CORE_IDENTITY).not.toMatch(/save_memory/)
    expect(CORE_RULES).toMatch(/cannot save memory/i)
  })

  it('appears nowhere in src/ except the seed migration\'s prior text', () => {
    const offenders = tsFiles(SRC_ROOT)
      .filter((file) => readFileSync(file, 'utf-8').includes(RETIRED))
      .map((file) => relative(process.cwd(), file))
      .filter((rel) => !ALLOWED_SOURCE_MENTIONS.has(rel))
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun vitest run tests/contracts/save-memory-retired.contract.test.ts`
Expected: FAIL — templates still list it (11 personas), `DEFAULT_CONFIG.riskTiers.yellow` contains it, `EXPLICIT_TOOL_CATEGORY` has the key, `DESTRUCTIVE_TOOLS` contains it, and the source scan reports `agent-templates.ts`, `autonomy-policy.ts`, `security-gate/types.ts`, `conversation-runner.ts`. (The registry case already passes after Task 1; core rules after Task 2.)

- [ ] **Step 3: Persona allow-lists**

In `src/modules/agent/agent-templates.ts`, on each of the eleven `tools:` lines **159, 249, 502, 654, 728, 863, 935, 1007, 1153, 1229, 1299** replace the substring

```ts
'search_memory', 'save_memory', 
```

with

```ts
'search_memory', 
```

(the comma-space after `'search_memory'` is part of both). Example, line 159 (`primary-assistant`) before:

```ts
    tools: ['run_command', 'read_file', 'write_file', 'edit_file', 'grep', 'glob', 'git_status', 'git_diff', 'search_indexed', 'list_search_sources', 'get_search_context', 'set_search_context', 'research', 'search_memory', 'save_memory', 'search_knowledge', 'get_page', 'create_page', 'list_documents', 'read_document', 'list_projects', 'move_to_stage', 'propose_team', 'delegate_to_agent', 'write_team_memory', 'read_team_memory', 'send_agent_message', 'read_agent_messages', 'list_channels', 'channel_send', 'design_list', 'design_read', 'design_create', 'design_write', 'design_link', 'design_unlink', 'render_html_document'],
```

after:

```ts
    tools: ['run_command', 'read_file', 'write_file', 'edit_file', 'grep', 'glob', 'git_status', 'git_diff', 'search_indexed', 'list_search_sources', 'get_search_context', 'set_search_context', 'research', 'search_memory', 'search_knowledge', 'get_page', 'create_page', 'list_documents', 'read_document', 'list_projects', 'move_to_stage', 'propose_team', 'delegate_to_agent', 'write_team_memory', 'read_team_memory', 'send_agent_message', 'read_agent_messages', 'list_channels', 'channel_send', 'design_list', 'design_read', 'design_create', 'design_write', 'design_link', 'design_unlink', 'render_html_document'],
```

Then the two comment lines. Line 65:

```ts
//     read_document, + search_memory/save_memory where the legacy list had
```

becomes

```ts
//     read_document, + search_memory where the legacy list had
```

and line 72:

```ts
//     search_memory/save_memory/list_documents/read_document
```

becomes

```ts
//     search_memory/list_documents/read_document (no memory write tool:
//     EYAS records memory itself — sovereign memory, Phase 1)
```

Check: `grep -c "save_memory" src/modules/agent/agent-templates.ts` → `0`.

- [ ] **Step 4: Security gate tier and autonomy map**

`src/modules/security-gate/types.ts` line 84:

```ts
      'save_memory', 'create_page', 'move_to_stage', 'create_sub_conversation', 'upload_document', 'Write', 'Edit', 'NotebookEdit',
```

becomes

```ts
      'create_page', 'move_to_stage', 'create_sub_conversation', 'upload_document', 'Write', 'Edit', 'NotebookEdit',
```

`src/modules/security-gate/autonomy-policy.ts` line 130:

```ts
  save_memory: 'memory_maintenance',
```

is deleted. Directly above the map's `send_agent_message: null,` comment block, nothing else changes; the `memory_maintenance` row at line 55 stays — add this comment above it (line 55 becomes two lines):

```ts
  // Reserved for the L1/L2 administrative actions of sovereign memory (Phase 3);
  // no tool binds to it since save_memory was retired.
  { key: 'memory_maintenance', label: 'Memory maintenance', maxLevel: 3, locked: 0 },
```

- [ ] **Step 5: Resume ledger**

`src/modules/agent/conversation-runner.ts` line 871:

```ts
// data-returning/read tool (research, browser_navigate, search_*, save_memory)
```

becomes

```ts
// data-returning/read tool (research, browser_navigate, search_*)
```

and line 883:

```ts
  'send_agent_message', 'write_team_memory', 'save_memory',
```

becomes

```ts
  'send_agent_message', 'write_team_memory',
```

- [ ] **Step 6: Update the six tests that used `save_memory` as their yellow-tier / destructive example**

`tests/modules/security-gate/deterministic-gate.test.ts`
- line 23: `expect(gate.getRiskTier('save_memory')).toBe('yellow')` → `expect(gate.getRiskTier('move_to_stage')).toBe('yellow')`
- line 89: `const result = gate.check('save_memory', { key: 'pref', value: 'dark mode' })` → `const result = gate.check('create_page', { title: 'pref', body: 'dark mode' })`
- line 137: `const r = gate.check('save_memory', { value: 'note about the master.key location' })` → `const r = gate.check('create_page', { body: 'note about the master.key location' })`

`tests/modules/security-gate/approval-tiers.test.ts` — lines 65, 87, 131: every `policy.decide('save_memory', 'yellow')` → `policy.decide('create_page', 'yellow')`.

`tests/modules/security-gate/runtime-monitor.test.ts` — lines 95, 97, 116: every `monitor.recordToolCall('s1', 'save_memory', true, 'yellow')` → `monitor.recordToolCall('s1', 'create_page', true, 'yellow')`.

`tests/modules/security-gate/llm-judge.test.ts` line 130: `await createLlmJudge(gateway).check('save_memory', {}, 'yellow')` → `await createLlmJudge(gateway).check('create_page', {}, 'yellow')`.

`tests/modules/agent/agent-runner-security-mode.test.ts` lines 433 and 435: both `name: 'save_memory'` and `makeToolDef('save_memory')` → `'create_page'`.

`tests/modules/agent/resume-run.test.ts` lines 120–138 — replace the whole `it(...)` with (the non-idempotent write example is now `create_sub_conversation`, which spawns a new conversation per call and is in `DESTRUCTIVE_TOOLS`):

```ts
  it('ledgers the newly-covered destructive tools and EXCLUDES idempotent reads', async () => {
    await recordToolResult(events, 'old-run', 'workspace_append', { file: 'AGENTS.md', text: 'x' }, true)
    await recordToolResult(events, 'old-run', 'add_internal_contact', { id: 'a' }, true)
    await recordToolResult(events, 'old-run', 'forge_propose_soul_change', { p: 1 }, true)
    await recordToolResult(events, 'old-run', 'create_sub_conversation', { title: 'note' }, true)
    await recordToolResult(events, 'old-run', 'research', { query: 'q' }, true)
    await recordToolResult(events, 'old-run', 'browser_navigate', { url: 'u' }, true)

    await resumeRun('old-run', deps)
    const led = deps.agentRunner.run.mock.calls[0][0].idempotencyLedger
    // non-idempotent writes → ledgered (create_sub_conversation spawns a new conversation each call)
    expect(led.has(`workspace_append:${argHash({ file: 'AGENTS.md', text: 'x' })}`)).toBe(true)
    expect(led.has(`add_internal_contact:${argHash({ id: 'a' })}`)).toBe(true)
    expect(led.has(`forge_propose_soul_change:${argHash({ p: 1 })}`)).toBe(true)
    expect(led.has(`create_sub_conversation:${argHash({ title: 'note' })}`)).toBe(true)
    // data-returning reads → NOT ledgered (hard-skip returns a stub → would starve a retry)
    expect(led.has(`research:${argHash({ query: 'q' })}`)).toBe(false)
    expect(led.has(`browser_navigate:${argHash({ url: 'u' })}`)).toBe(false)
  })
```

- [ ] **Step 7: Run the contract test and every touched suite**

Run: `bun vitest run tests/contracts/save-memory-retired.contract.test.ts tests/contracts/template-names.contract.test.ts tests/contracts/registry-tier.contract.test.ts tests/modules/security-gate tests/modules/agent/resume-run.test.ts tests/modules/agent/agent-runner-security-mode.test.ts`
Expected: all PASS (contract: 7 tests). Then `bun run lint` — clean.

- [ ] **Step 8: Commit**

```bash
git add src/modules/agent/agent-templates.ts src/modules/security-gate/types.ts src/modules/security-gate/autonomy-policy.ts src/modules/agent/conversation-runner.ts tests/contracts/save-memory-retired.contract.test.ts tests/modules/security-gate/deterministic-gate.test.ts tests/modules/security-gate/approval-tiers.test.ts tests/modules/security-gate/runtime-monitor.test.ts tests/modules/security-gate/llm-judge.test.ts tests/modules/agent/resume-run.test.ts tests/modules/agent/agent-runner-security-mode.test.ts
git commit -m "feat(agent,security-gate): drop save_memory from personas, gate tiers, autonomy map and resume ledger; pin the retirement with a contract test"
```

---

### Task 4: Handbook (six languages) and the CHANGELOG entry

**Files:**
- Modify: `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/knowledge/memory.md` (two places each)
- Modify: `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/automation/tools.md` (one place each)
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

**Interfaces:**
- Consumes: nothing from code. The handbook is the source of truth; `packages/docs/dist/**` is regenerated by `bun run docs:build` (also on server start) and is **not** edited by hand.
- Produces: zero `save_memory` mentions under `packages/docs/src/content/docs`. The CHANGELOG is English-only by repo convention (one file); "six languages" applies to the handbook.

Each edit below is a **find → replace** on the exact current text (line numbers from the tree at `fc9075bd`; multi-line finds span the lines shown).

- [ ] **Step 1: `en/knowledge/memory.md`**

Lines 145–146, find:

```
in `config/default.yaml`. Writing a note by hand and an agent calling
`save_memory` both still work exactly as before.
```

replace with:

```
in `config/default.yaml`. Writing a note by hand still works exactly as before;
an agent no longer writes memory itself — EYAS records what it needs
automatically, and `search_memory` is the only memory tool on the model's side.
```

Lines 192–193, find:

```
than pretending. Agents are told to use `search_memory` / `save_memory` only,
and the file-writing gate denies `~/.claude`, `~/.grok`, and `ai-memory` paths.
```

replace with:

```
than pretending. Agents are told they cannot save memory — EYAS records
automatically — and to use `search_memory` only; the file-writing gate denies
`~/.claude`, `~/.grok`, and `ai-memory` paths.
```

- [ ] **Step 2: `hu/knowledge/memory.md`**

Lines 107–108, find:

```
kapcsolja ki. A kézzel írt jegyzet és a `save_memory`-t hívó ügynök változatlanul
működik.
```

replace with:

```
kapcsolja ki. A kézzel írt jegyzet változatlanul működik; az ügynök maga már nem
ír memóriát — az EYAS automatikusan rögzíti, amire szüksége van, és a modell
oldalán a `search_memory` az egyetlen memória-eszköz.
```

Lines 151–152, find:

```
nem tettet. Az agenteknek csak `search_memory` / `save_memory` jár, a
fájlíró kapu tiltja a `~/.claude`, `~/.grok` és `ai-memory` utakat.
```

replace with:

```
nem tettet. Az agentek azt kapják, hogy memóriát menteni nem tudnak — az EYAS
automatikusan rögzít —, és csak a `search_memory` jár nekik; a fájlíró kapu
tiltja a `~/.claude`, `~/.grok` és `ai-memory` utakat.
```

- [ ] **Step 3: `de/knowledge/memory.md`**

Lines 76–77, find:

```
`config/default.yaml`; von Hand geschriebene Notizen und `save_memory` bleiben
unverändert.
```

replace with:

```
`config/default.yaml`; von Hand geschriebene Notizen bleiben unverändert. Ein
Agent schreibt kein Gedächtnis mehr selbst — EYAS zeichnet automatisch auf, was
es braucht, und `search_memory` ist das einzige Memory-Tool auf der Modellseite.
```

Line 108, find the sentence:

```
Agenten sollen nur `search_memory` / `save_memory` nutzen; das Schreib-Gate sperrt `~/.claude`, `~/.grok` und `ai-memory`.
```

replace with:

```
Agenten wird gesagt, dass sie kein Gedächtnis speichern können — EYAS zeichnet automatisch auf — und nur `search_memory` nutzen sollen; das Schreib-Gate sperrt `~/.claude`, `~/.grok` und `ai-memory`.
```

- [ ] **Step 4: `es/knowledge/memory.md`**

Lines 77–78, find:

```
`memory.capture.enabled: false` en `config/default.yaml`; escribir una nota a
mano y `save_memory` siguen funcionando igual.
```

replace with:

```
`memory.capture.enabled: false` en `config/default.yaml`; escribir una nota a
mano sigue funcionando igual. Un agente ya no escribe memoria por sí mismo —
EYAS registra automáticamente lo que necesita, y `search_memory` es la única
herramienta de memoria del lado del modelo.
```

Line 111, find the sentence:

```
Los agentes deben usar solo `search_memory` / `save_memory`; la puerta de escritura niega `~/.claude`, `~/.grok` y `ai-memory`.
```

replace with:

```
A los agentes se les indica que no pueden guardar memoria — EYAS registra automáticamente — y que usen solo `search_memory`; la puerta de escritura niega `~/.claude`, `~/.grok` y `ai-memory`.
```

- [ ] **Step 5: `fr/knowledge/memory.md`**

Lines 145–146, find:

```
`config/default.yaml` ; écrire une note à la main et appeler `save_memory`
fonctionnent toujours à l'identique.
```

replace with:

```
`config/default.yaml` ; écrire une note à la main fonctionne toujours à
l'identique. Un agent n'écrit plus la mémoire lui-même — EYAS enregistre
automatiquement ce dont il a besoin, et `search_memory` est le seul outil
mémoire côté modèle.
```

Line 180, find the sentence:

```
Les agents doivent n'utiliser que `search_memory` / `save_memory` ; la porte d'écriture refuse `~/.claude`, `~/.grok` et `ai-memory`.
```

replace with:

```
Les agents apprennent qu'ils ne peuvent pas enregistrer de mémoire — EYAS enregistre automatiquement — et qu'ils ne doivent utiliser que `search_memory` ; la porte d'écriture refuse `~/.claude`, `~/.grok` et `ai-memory`.
```

- [ ] **Step 6: `tlh/knowledge/memory.md`**

Lines 131–132, find:

```
`memory.capture.enabled: false`. ghop ghItlhlu'bogh ghItlhHom `save_memory` je
rIttaH.
```

replace with:

```
`memory.capture.enabled: false`. ghop ghItlhlu'bogh ghItlhHom rIttaH; qawHaq
ghItlhbe' ghoqwI' — poQbogh Hoch qon EYAS, 'ej model jan tetlhDaq `search_memory`
neH qawHaq jan 'oH.
```

Line 162, find the sentence:

```
ghoqwI'pu' neH `search_memory` / `save_memory` lo'nIS; ghItlh ngaQ `~/.claude`, `~/.grok`, `ai-memory` He mev.
```

replace with:

```
qawHaq polbe' ghoqwI'pu' — qon EYAS — 'ej `search_memory` neH lo'nIS; ghItlh ngaQ `~/.claude`, `~/.grok`, `ai-memory` He mev.
```

- [ ] **Step 7: `automation/tools.md` in six languages**

`en` line 94 — replace the whole table row:

```
| `search_memory` / `save_memory` | Recall and record durable vault notes — EYAS memory, not the host CLI's. `search_memory` also searches prior conversation messages (user + assistant) in the current project; `scope=all` crosses projects. `scope` is `current` (default: this project, its type, and global user/feedback/reference notes) or `all` (other projects too). The Memory page search is unfiltered. |
```

with:

```
| `search_memory` | Recall durable vault notes — EYAS memory, not the host CLI's. There is no write tool: EYAS records memory itself, an agent cannot save memory. `search_memory` also searches prior conversation messages (user + assistant) in the current project; `scope=all` crosses projects. `scope` is `current` (default: this project, its type, and global user/feedback/reference notes) or `all` (other projects too). The Memory page search is unfiltered. |
```

`hu` line 94 — replace the whole row:

```
| `search_memory` / `save_memory` | Tartós vault jegyzetek — EYAS memória, nem a host CLI-é. A `search_memory` a projektben a korábbi beszélgetésüzeneteket is keresi (user + assistant); a `scope=all` projekteken átnyúlik. A `scope` alapból `current` (ez a projekt, a típusa, plusz globális user/feedback/reference); `all` a többi projektet is. A Memória oldal keresése szűretlen. |
```

with:

```
| `search_memory` | Tartós vault jegyzetek felidézése — EYAS memória, nem a host CLI-é. Író eszköz nincs: a memóriát az EYAS maga rögzíti, egy ügynök nem tud memóriát menteni. A `search_memory` a projektben a korábbi beszélgetésüzeneteket is keresi (user + assistant); a `scope=all` projekteken átnyúlik. A `scope` alapból `current` (ez a projekt, a típusa, plusz globális user/feedback/reference); `all` a többi projektet is. A Memória oldal keresése szűretlen. |
```

`de` line 43 — inside the long paragraph, find the substring:

```
Memory-Blöcke + `search_memory`/`save_memory` (`scope` default `current`:
```

replace with:

```
Memory-Blöcke + `search_memory` (kein Schreib-Tool: EYAS zeichnet Gedächtnis selbst auf; `scope` default `current`:
```

`es` line 27 — find the substring:

```
bloques de memoria + `search_memory`/`save_memory` (`scope` por defecto `current`:
```

replace with:

```
bloques de memoria + `search_memory` (sin herramienta de escritura: EYAS registra la memoria por sí mismo; `scope` por defecto `current`:
```

`fr` line 27 — find the substring:

```
blocs mémoire + `search_memory`/`save_memory` (`scope` par défaut `current` :
```

replace with:

```
blocs mémoire + `search_memory` (pas d'outil d'écriture : EYAS enregistre la mémoire lui-même ; `scope` par défaut `current` :
```

`tlh` line 27 — find the substring:

```
qawHaq 'ay'mey + `search_memory`/`save_memory` (`scope` motlh `current`:
```

replace with:

```
qawHaq 'ay'mey + `search_memory` (ghItlh jan Hutlh: qawHaq qon EYAS; `scope` motlh `current`:
```

- [ ] **Step 8: Verify the handbook**

Run: `grep -rn "save_memory" packages/docs/src/content/docs`
Expected: no output. Then, optionally (Astro build, ~1–2 min): `bun run docs:build` — expected to finish without an error; the built pages under `packages/docs/dist/<lang>/knowledge/memory/` carry the new sentences.

- [ ] **Step 9: CHANGELOG `[Unreleased]` entry**

`CHANGELOG.md` currently reads (lines 1–5; the `[Unreleased]` section is empty since the 0.8.22-beta release moved the installer entry under its own heading):

```
# Changelog

## [Unreleased]

## [0.8.22-beta] - 2026-09-03 — The door opens
```

Insert the following block directly under `## [Unreleased]` (line 3), keeping one blank line above `## [0.8.22-beta]`. (If another entry already sits under `[Unreleased]` when you execute, insert *below* it and never reorder it.)

```

### Memory — sovereign memory, Phase 1 boundary

- **`save_memory` is retired.** The model no longer decides what EYAS
  remembers. The write tool is gone from the tool registry (and so from the
  CLI-MCP bridge), from all eleven persona allow-lists, from the security
  gate's yellow tier and autonomy map, and from the resume ledger. Rule 8 now
  says it plainly — *you cannot save memory; EYAS records automatically; use
  `search_memory` to look things up* — and already-seeded installs pick the new
  rule up through the seed migration. A contract test scans `src/` and the
  production registry so the tool cannot come back. The handbook says the same
  in all six languages.
- **Background model work goes only to headless, isolated providers.**
  `AIProvider.supportsHeadlessInvocation` is `true` on every API provider and
  on Claude Code; absent on Grok CLI and Kimi CLI, which cannot be isolated
  (`grok -p` keeps ≥ 15 k tokens of host context, a live shell and plugin MCP
  tools under every switch, and read the host's memory vault in the Phase 0
  canary). The capture ladder's "let the gateway choose" rung is gone: an
  instance with no eligible provider records a `degraded_no_model` run instead
  of sending an extraction to an agentic CLI, and that row never counts against
  the per-conversation cap.
- **Embeddings only from providers that declare an embedding model.**
  `gateway.embed()` used to pick the first provider with an `embed()` method;
  OpenAI-compatible hosts inherit one whether or not they serve `/embeddings`.
  Selection now requires `supportsEmbeddings` (OpenAI, Ollama; a compat catalog
  entry can opt in with `supportsEmbeddings` + `embeddingModels`).
- **Interim fixes.** Hybrid memory search no longer drops vector-only hits at
  hydration; the agent memory routes resolve the memory module lazily per
  request instead of depending on boot order; `CORE_IDENTITY` (~495 tokens) is
  no longer clipped to a 200-token budget — the prefix reserve is 9 000 and the
  identity budget 500; the privacy scanner now covers `tool_result` blocks, not
  only prompts.
- **Dead code removed.** `context-builder-v2.ts`, `search/context-builder.ts`,
  `consolidation/decay.ts`, `consolidation/implicit-extractor.ts`, the unused
  `MemoryConfig` interface and `memoryBlocks.formatForPrompt()`, each with its
  tests; the consolidator README describes what actually runs; `a2a` is no
  longer listed as a module.
- **Ship-ability.** The Dockerfile builds again (`bun install … --ignore-scripts`
  keeps `better-sqlite3`'s Node-only build step out of the Bun image) and pins
  `oven/bun:1.3.10` / `1.3.10-slim` — the bundled SQLite and its FTS planner
  follow the Bun version. A `probe` build stage and a CI job run the SQLite
  capability probe (FTS5 + sqlite-vec) inside the runtime base image on amd64
  and arm64. Kubernetes defaults are `1Gi/2Gi` memory and `500m/2` CPU in both
  the raw manifest and the Helm chart; `512Mi/1Gi` remains as the documented
  bridge-embeddings profile.
```

- [ ] **Step 10: Commit**

```bash
git add packages/docs/src/content/docs/en/knowledge/memory.md packages/docs/src/content/docs/hu/knowledge/memory.md packages/docs/src/content/docs/de/knowledge/memory.md packages/docs/src/content/docs/es/knowledge/memory.md packages/docs/src/content/docs/fr/knowledge/memory.md packages/docs/src/content/docs/tlh/knowledge/memory.md packages/docs/src/content/docs/en/automation/tools.md packages/docs/src/content/docs/hu/automation/tools.md packages/docs/src/content/docs/de/automation/tools.md packages/docs/src/content/docs/es/automation/tools.md packages/docs/src/content/docs/fr/automation/tools.md packages/docs/src/content/docs/tlh/automation/tools.md CHANGELOG.md
git commit -m "docs: save_memory retirement in the six-language handbook and the changelog"
```

(If `git status` showed `CHANGELOG.md` dirty before this task, the owner decides whether to commit the foreign hunk together or `git add -p`.)

---

### Task 5: `supportsHeadlessInvocation` on `AIProvider` and every provider

**Files:**
- Modify: `src/modules/model/types.ts:230-246` (`AIProvider`)
- Modify: `src/modules/model/submodules/anthropic/provider.ts:19-20`, `anthropic-compat/provider.ts:35-36`, `claude-code/provider.ts:241-246`, `gemini/provider.ts:15-16`, `lmstudio/provider.ts:17-18`, `ollama/provider.ts:30-31`, `openai/provider.ts:41-42` (covers `openai-compat`, `kimi`, `openrouter`, which spread `...base` from `createOpenAIProvider`), `grok-cli/provider.ts:202-203` and `kimi-cli/provider.ts:153-154` (comment only)
- Test: `tests/modules/model/provider-headless-flag.test.ts`

**Interfaces:**
- Produces: `AIProvider.supportsHeadlessInvocation?: boolean` — `true` on anthropic, anthropic-compat, claude-code, gemini, lmstudio, ollama, openai (+ every OpenAI-compatible derivative); **absent** on grok-cli and kimi-cli. Task 6 reads it through `isEligibleForBackground`.
- Consumes: the provider factories (all side-effect-free at construction: `createAnthropicProvider(apiKey)`, `createAnthropicCompatProvider(def, apiKey)`, `createClaudeCodeProvider()`, `createGeminiProvider(apiKey)`, `createGrokCliProvider()`, `createKimiProvider(apiKey)`, `createKimiCliProvider()`, `createLMStudioProvider()`, `createOllamaProvider()`, `createOpenAIProvider({ apiKey })`, `createCompatProvider(def, apiKey)`, `createOpenRouterProvider(apiKey)`), `ANTHROPIC_COMPAT_CATALOG`, `OPENAI_COMPAT_CATALOG`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/model/provider-headless-flag.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spike §2 #16: `supportsHeadlessInvocation` is true on every API provider and
// on claude-code (SDK query()), and ABSENT on grok-cli and kimi-cli — `grok -p`
// is headless but not isolatable (≥ 15 k tokens of host context, a live shell
// and plugin MCP tools under every documented switch; it read the host's
// memory vault in the Phase 0 canary). Background eligibility is decided by
// isEligibleForBackground() (Task 6), never by this flag alone.

import { describe, it, expect } from 'vitest'
import type { AIProvider } from '@modules/model/types'
import { createAnthropicProvider } from '@modules/model/submodules/anthropic/provider'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider'
import { createGeminiProvider } from '@modules/model/submodules/gemini/provider'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider'
import { createKimiProvider } from '@modules/model/submodules/kimi/provider'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider'
import { createLMStudioProvider } from '@modules/model/submodules/lmstudio/provider'
import { createOllamaProvider } from '@modules/model/submodules/ollama/provider'
import { createOpenAIProvider } from '@modules/model/submodules/openai/provider'
import { createCompatProvider } from '@modules/model/submodules/openai-compat/provider'
import { OPENAI_COMPAT_CATALOG } from '@modules/model/submodules/openai-compat/catalog'
import { createOpenRouterProvider } from '@modules/model/submodules/openrouter/provider'

const xai = OPENAI_COMPAT_CATALOG.find((d) => d.id === 'xai')!

const HEADLESS: Array<[string, () => AIProvider]> = [
  ['anthropic', () => createAnthropicProvider('sk-test')],
  ['anthropic-compat/minimax', () => createAnthropicCompatProvider(ANTHROPIC_COMPAT_CATALOG[0], 'k')],
  ['claude-code', () => createClaudeCodeProvider()],
  ['gemini', () => createGeminiProvider('k')],
  ['kimi (API)', () => createKimiProvider('k')],
  ['lmstudio', () => createLMStudioProvider()],
  ['ollama', () => createOllamaProvider()],
  ['openai', () => createOpenAIProvider({ apiKey: 'k' })],
  ['openai-compat/xai', () => createCompatProvider(xai, 'k')],
  ['openrouter', () => createOpenRouterProvider('k')],
]

const NOT_HEADLESS: Array<[string, () => AIProvider]> = [
  ['grok-cli', () => createGrokCliProvider()],
  ['kimi-cli', () => createKimiCliProvider()],
]

describe('AIProvider.supportsHeadlessInvocation', () => {
  it.each(HEADLESS)('%s declares headless invocation', (_label, make) => {
    expect(make().supportsHeadlessInvocation).toBe(true)
  })

  it.each(NOT_HEADLESS)('%s does NOT declare headless invocation (ACP, not isolatable)', (_label, make) => {
    expect(make().supportsHeadlessInvocation).toBeUndefined()
  })

  it('claude-code is the only CLI that is both headless and isolated', () => {
    const cc = createClaudeCodeProvider()
    expect(cc.supportsIsolatedCompletion).toBe(true)
    expect(cc.supportsHeadlessInvocation).toBe(true)
    for (const [, make] of NOT_HEADLESS) expect(make().supportsIsolatedCompletion).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/provider-headless-flag.test.ts`
Expected: FAIL — ten cases `expected undefined to be true`; the two NOT_HEADLESS cases pass already.

- [ ] **Step 3: Add the flag to the interface**

In `src/modules/model/types.ts`, after line 240 (`  supportsIsolatedCompletion?: boolean`) and before `  listModels(): Promise<ModelInfo[]>`, insert:

```ts
  /**
   * This provider can be invoked with nobody attending: a background job
   * (memory extraction, consolidation) may call it and get a plain completion
   * back. `true` on every API provider and on claude-code (SDK `query()`);
   * deliberately ABSENT on grok-cli and kimi-cli — `grok -p` is headless but
   * not isolatable (spike §2 #16: ≥ 15 k tokens of host context, a live shell
   * and plugin MCP tools under every switch, and it read the host's memory
   * vault). Background eligibility is `isEligibleForBackground()` in
   * memory/capture/completion.ts, never this flag alone.
   */
  supportsHeadlessInvocation?: boolean
```

- [ ] **Step 4: Set it on the providers**

Insert one line after the `name:` line of each returned object:

`src/modules/model/submodules/anthropic/provider.ts` (after line 20 `    name: 'Anthropic Claude API',`):
```ts
    supportsHeadlessInvocation: true,
```

`src/modules/model/submodules/anthropic-compat/provider.ts` (after line 36 `    name: def.name,`):
```ts
    supportsHeadlessInvocation: true,
```

`src/modules/model/submodules/claude-code/provider.ts` (after line 246 `    supportsIsolatedCompletion: true,`):
```ts
    // The SDK query() runs with nobody attending; with the isolated options
    // above it is the one CLI a background job may use (spike §2 #16).
    supportsHeadlessInvocation: true,
```

`src/modules/model/submodules/gemini/provider.ts` (after line 16 `    name: 'Google Gemini',`):
```ts
    supportsHeadlessInvocation: true,
```

`src/modules/model/submodules/lmstudio/provider.ts` (after line 18 `    name: 'LM Studio',`):
```ts
    supportsHeadlessInvocation: true,
```

`src/modules/model/submodules/ollama/provider.ts` (after line 31 `    name: 'Ollama',`):
```ts
    supportsHeadlessInvocation: true,
```

`src/modules/model/submodules/openai/provider.ts` (after line 42 `    name: options.providerName || 'OpenAI',`):
```ts
    // Every OpenAI-compatible host (kimi, openrouter, the compat catalog)
    // spreads this object, so they inherit the flag: an HTTP API has nobody
    // to attend and nothing of its own to load.
    supportsHeadlessInvocation: true,
```

`src/modules/model/submodules/grok-cli/provider.ts` — insert a comment after line 203 (`    name: 'Grok CLI',`), no flag:
```ts
    // No supportsHeadlessInvocation and no supportsIsolatedCompletion on
    // purpose: `grok -p` runs unattended but cannot be isolated (spike §2
    // #16), so background memory work never lands here — see
    // isEligibleForBackground() in memory/capture/completion.ts.
```

`src/modules/model/submodules/kimi-cli/provider.ts` — the same comment after line 154 (`    name: 'Kimi Code CLI',`), with `kimi-cli` in place of `grok -p`:
```ts
    // No supportsHeadlessInvocation and no supportsIsolatedCompletion on
    // purpose: the ACP session cannot be isolated (untested in Phase 0,
    // classed with grok-cli — spike §4.3 #4), so background memory work
    // never lands here — see isEligibleForBackground().
```

- [ ] **Step 5: Run the test and the provider suites**

Run: `bun vitest run tests/modules/model/provider-headless-flag.test.ts tests/modules/model/claude-code-provider.test.ts tests/modules/model/grok-cli-provider.test.ts tests/modules/model/submodules tests/modules/model/kimi-provider.test.ts && bun run lint`
Expected: PASS (13 tests in the new file); `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/modules/model/types.ts src/modules/model/submodules/anthropic/provider.ts src/modules/model/submodules/anthropic-compat/provider.ts src/modules/model/submodules/claude-code/provider.ts src/modules/model/submodules/gemini/provider.ts src/modules/model/submodules/lmstudio/provider.ts src/modules/model/submodules/ollama/provider.ts src/modules/model/submodules/openai/provider.ts src/modules/model/submodules/grok-cli/provider.ts src/modules/model/submodules/kimi-cli/provider.ts tests/modules/model/provider-headless-flag.test.ts
git commit -m "feat(model): supportsHeadlessInvocation on every API provider and claude-code; absent on grok-cli and kimi-cli"
```

---

### Task 6: `isEligibleForBackground`, `NoEligibleProviderError`, and the ladder without rung (d)

**Files:**
- Modify: `src/modules/memory/capture/completion.ts` (rewrite `CaptureTarget`, `LadderGateway`, `resolveCaptureTarget`, `createCaptureComplete`; add the predicate and the error)
- Modify: `src/modules/memory/capture/index.ts:14` (import) and `:284-297` (catch)
- Modify: `src/modules/memory/capture/capture-gate.ts:43-59` (doc comment only)
- Test (create): `tests/modules/memory/capture/provider-eligibility.test.ts`
- Test (rewrite): `tests/modules/memory/capture-provider-ladder.test.ts`

**Interfaces:**
- Produces (contract): `export function isEligibleForBackground(p: { id: string; supportsHeadlessInvocation?: boolean; supportsIsolatedCompletion?: boolean }): boolean` = `p.supportsHeadlessInvocation === true && (p.supportsIsolatedCompletion === true || !isCliProviderId(p.id))`; `export class NoEligibleProviderError extends Error {}` (`name = 'NoEligibleProviderError'`, `code = 'NO_ELIGIBLE_PROVIDER'`). `CaptureTarget.rung` becomes `'tier' | 'non-cli' | 'isolated-cli' | 'none'` (no `'gateway-fallback'`); `createCaptureComplete()` throws `NoEligibleProviderError` before touching the gateway when the rung is `'none'`. The legacy capture records such a run as `memory_capture_runs.skipped_reason = 'degraded_no_model'` with `provider = NULL`; `countExtractions()` does not count it (its `IN (…)` list is unchanged). P1c's Phase 1 `runExtraction` does **not** consume this error (it never attempts a model call — `degraded_no_model` is reserved there for Phase 3); the Phase 3 model pass, inserted in front of `arbitrate`, will catch it and write `memory_run.status = 'degraded_no_model'`.
- Consumes: `isCliProviderId` (`@modules/model/onboarding-reconcile`), `AIProvider.supportsHeadlessInvocation` (Task 5).

**Why capture is "background":** the extraction runs after the reply has been delivered, with nobody attending — exactly the call spike §2 #16 forbids from landing on a non-isolatable CLI. Interactive requests never pass through this ladder (they go to the gateway directly from the routes), so removing rung (d) here changes no interactive behaviour.

- [ ] **Step 1: Write the eligibility test**

```ts
// tests/modules/memory/capture/provider-eligibility.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spike §2 #16 / §5: eligible(p) := headless && (isolated || not a CLI).
// claude-code and API providers qualify; grok-cli / kimi-cli never do, even
// with supportsHeadlessInvocation hypothetically set; and rung (d) — "let the
// gateway choose" — is never selected for background work.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createMemoryCapture } from '@modules/memory/capture/index'
import { countExtractions } from '@modules/memory/capture/capture-gate'
import {
  isEligibleForBackground, resolveCaptureTarget, createCaptureComplete, NoEligibleProviderError,
} from '@modules/memory/capture/completion'

describe('isEligibleForBackground', () => {
  it.each([
    ['claude-code, headless + isolated', { id: 'claude-code', supportsHeadlessInvocation: true, supportsIsolatedCompletion: true }, true],
    ['anthropic API, headless', { id: 'anthropic', supportsHeadlessInvocation: true }, true],
    ['openai API, headless', { id: 'openai', supportsHeadlessInvocation: true }, true],
    ['grok-cli as shipped (no flags)', { id: 'grok-cli' }, false],
    ['kimi-cli as shipped (no flags)', { id: 'kimi-cli' }, false],
    ['grok-cli with headless hypothetically set — still not isolatable', { id: 'grok-cli', supportsHeadlessInvocation: true }, false],
    ['kimi-cli with headless hypothetically set', { id: 'kimi-cli', supportsHeadlessInvocation: true }, false],
    ['a CLI that isolates but never declared headless', { id: 'grok-cli', supportsIsolatedCompletion: true }, false],
    ['an API provider that never declared headless', { id: 'legacy-api' }, false],
  ])('%s → %s', (_label, provider, expected) => {
    expect(isEligibleForBackground(provider)).toBe(expected)
  })
})

function gatewayOf(providers: Array<{ id: string; supportsHeadlessInvocation?: boolean; supportsIsolatedCompletion?: boolean }>) {
  return {
    getProvider: (id: string) => providers.find((p) => p.id === id),
    listProviders: () => providers,
    complete: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"notes":[]}' }] }),
  }
}

describe('background calls never fall back to the gateway', () => {
  it('resolves to none — there is no gateway-fallback rung — when nothing is eligible', () => {
    const target = resolveCaptureTarget({ gateway: gatewayOf([{ id: 'grok-cli' }, { id: 'kimi-cli' }]) })
    expect(target).toEqual({ rung: 'none' })
    expect((target as { rung: string }).rung).not.toBe('gateway-fallback')
  })

  it('createCaptureComplete throws NoEligibleProviderError without calling the gateway', async () => {
    const gateway = gatewayOf([{ id: 'grok-cli' }])
    const complete = createCaptureComplete({ getGateway: () => gateway as any })
    await expect(complete({ system: 'S', user: 'U' })).rejects.toBeInstanceOf(NoEligibleProviderError)
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('capture records degraded_no_model, writes nothing, and spends nothing against the cap', async () => {
    const db = createMemoryDb()
    createMemoryTables(db)
    const gateway = gatewayOf([{ id: 'grok-cli' }])
    const writer = { write: vi.fn() }
    const logger = { warn: vi.fn(), debug: vi.fn() }
    const capture = createMemoryCapture({
      db,
      config: () => ({ enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4_000 }),
      complete: createCaptureComplete({ getGateway: () => gateway as any }),
      writer: writer as any,
      logger,
    })
    await capture({
      conversationId: 'deg',
      projectId: null,
      userMessage: 'Please always answer me in Hungarian, that is how I work.',
      assistantMessage: 'Rendben.',
    })

    const runs = db.all(sql`SELECT notes_written, skipped_reason, provider FROM memory_capture_runs WHERE conversation_id = 'deg'`) as any[]
    expect(runs).toEqual([{ notes_written: 0, skipped_reason: 'degraded_no_model', provider: null }])
    expect(writer.write).not.toHaveBeenCalled()
    expect(gateway.complete).not.toHaveBeenCalled()
    // A degraded row is not an error and not a spend: no warn, and the cap is untouched.
    expect(logger.warn).not.toHaveBeenCalled()
    expect(countExtractions(db, 'deg')).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun vitest run tests/modules/memory/capture/provider-eligibility.test.ts`
Expected: FAIL — `isEligibleForBackground is not a function` / `NoEligibleProviderError` not exported.

- [ ] **Step 3: Rewrite `completion.ts`**

Replace lines 16–136 of `src/modules/memory/capture/completion.ts` (from `export type CompleteResult` through the end of `resolveCaptureTarget`) with:

```ts
/**
 * What capture's `complete` callback resolves to. A bare string stays valid —
 * a caller that only has text is a legitimate caller — and the object form adds
 * the attribution the run row records.
 */
export type CompleteResult = string | { text: string; provider?: string | null }

export interface CaptureTarget {
  /** Which rung answered. Logged, and the one thing worth asserting in a test.
   * 'none' means no registered provider may take a BACKGROUND call: the
   * caller throws NoEligibleProviderError and the run is recorded as
   * degraded_no_model. There is no "let the gateway choose" rung any more —
   * on a CLI-only box that choice was an agentic CLI answering from its own
   * loaded memory (spike §2 #16). */
  rung: 'tier' | 'non-cli' | 'isolated-cli' | 'none'
  /** Absent on 'none'. */
  provider?: string
  model?: string
}

/** The two capability flags a background caller selects on. */
export interface BackgroundCandidate {
  id: string
  supportsHeadlessInvocation?: boolean
  supportsIsolatedCompletion?: boolean
}

/** Only the two lookups the ladder needs — a real ModelGateway satisfies this. */
export interface LadderGateway {
  getProvider(id: string): unknown
  listProviders(): ReadonlyArray<BackgroundCandidate>
}

/** Only the two lookups the ladder needs — a real ProviderConfigService satisfies this. */
export interface LadderProviderConfig {
  getProvider(id: string): { enabled?: boolean; defaultModel?: string | null } | null
  listEnabledModels(id: string): Array<{ id: string }>
}

export interface CaptureTargetDeps {
  gateway: LadderGateway | undefined
  /** The 'heartbeat' tier, best-effort. May be absent, may throw. */
  resolveTier?: () => { provider: string; model: string } | null | undefined
  providerConfig?: LadderProviderConfig
}

/**
 * Thrown by a background caller when no registered provider is eligible.
 * The legacy capture records it as `skipped_reason = 'degraded_no_model'`;
 * the v2 model pass (Phase 3, in front of memory/v2/arbitrate.ts — the
 * Phase 1 extractor never calls a model) as `memory_run.status =
 * 'degraded_no_model'`. Never a warning: degraded mode is the default path
 * (spec §3), not a failure.
 */
export class NoEligibleProviderError extends Error {
  readonly code = 'NO_ELIGIBLE_PROVIDER'
  constructor(message = 'No provider is eligible for background model work: needs supportsHeadlessInvocation, plus supportsIsolatedCompletion for a CLI') {
    super(message)
    this.name = 'NoEligibleProviderError'
  }
}

/**
 * Spike §2 #16: a background call may go only to a provider that runs with
 * nobody attending AND — if it is a CLI — can shed its own loaded context.
 * grok-cli and kimi-cli fail the second half whatever the first says.
 */
export function isEligibleForBackground(p: BackgroundCandidate): boolean {
  return p.supportsHeadlessInvocation === true
    && (p.supportsIsolatedCompletion === true || !isCliProviderId(p.id))
}

/** Best-effort throughout: a broken lookup costs the pin, never the capture. */
function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

/**
 * The provider/model pin for one extraction, or `{ rung: 'none' }` when no
 * registered provider may take a background call. NEVER throws: the caller
 * (createCaptureComplete) turns 'none' into NoEligibleProviderError, and the
 * run row records the outcome either way — an attempt and a degraded skip
 * are both measured, neither is invisible.
 */
export function resolveCaptureTarget(deps: CaptureTargetDeps): CaptureTarget {
  const { gateway } = deps
  if (!gateway) return { rung: 'none' }

  const registered = (attempt(() => gateway.listProviders()) ?? []).filter((p) => !!p?.id)
  // Eligibility first, everything else second: a provider that may not take a
  // background call is not a candidate at any rung.
  const eligible = registered.filter((p) => isEligibleForBackground(p))
  const isEligibleId = (id: string) => eligible.some((p) => p.id === id)
  const enabledInConfig = (id: string) => {
    const row = attempt(() => deps.providerConfig?.getProvider(id))
    return { row, enabled: !(row && row.enabled === false) }
  }
  const modelFor = (id: string, row: { defaultModel?: string | null } | null | undefined) =>
    attempt(() => deps.providerConfig?.listEnabledModels(id)?.[0]?.id) ?? row?.defaultModel ?? undefined

  // (a) The configured cheap tier — but only when this instance actually has
  // that provider, it is not a CLI, and it is eligible. A tier naming a
  // disabled provider is a stale routing row; a tier naming a CLI is usually
  // not an owner's choice at all, since CLI onboarding auto-fills every empty
  // tier with its own models (onboarding-reconcile.applyCliFreshDefaults).
  const tier = attempt(() => deps.resolveTier?.())
  if (tier?.provider && !isCliProviderId(tier.provider) && isEligibleId(tier.provider)) {
    return { rung: 'tier', provider: tier.provider, model: tier.model }
  }

  // (b) The first enabled, eligible non-CLI provider with a nameable model.
  // A model is part of the candidacy, not a bonus: pinning a provider WITHOUT
  // one forces a model-less request onto a provider that may require one.
  for (const provider of eligible) {
    if (isCliProviderId(provider.id)) continue
    const { row, enabled } = enabledInConfig(provider.id)
    if (!enabled) continue
    const model = modelFor(provider.id, row)
    if (model) return { rung: 'non-cli', provider: provider.id, model }
  }

  // (c) CLI-only: an eligible CLI is by definition headless AND isolated —
  // a CLI that loads its own memory into an extraction answers out of that
  // memory (live test #4). The preference is for the CAPABILITY, never for a
  // provider id: whichever CLI advertises both wins, first registered first.
  //
  // A CLI is pinned by PROVIDER and never by model. EYAS's model_config rows
  // are display candidates, not guaranteed-valid CLI aliases: pinning the
  // first enabled row for claude-code sent alias 'fable', which the spawned
  // CLI rejected outright, while the same unpinned call answered fine on the
  // CLI's own default. Only the CLI knows which aliases this install accepts.
  for (const provider of eligible) {
    if (!isCliProviderId(provider.id)) continue
    if (!enabledInConfig(provider.id).enabled) continue
    return { rung: 'isolated-cli', provider: provider.id }
  }

  // No rung (d). "Let the gateway choose" is an interactive convenience; for
  // an unattended call it meant an agentic CLI answering from host memory.
  return { rung: 'none' }
}
```

Then in `createCaptureComplete` (the function keeps its shape) insert, directly after the `deps.logger?.debug?.(…, 'Memory capture: extractor model resolved')` line:

```ts
    if (target.rung === 'none') throw new NoEligibleProviderError()
```

`describeAnswerer` is unchanged (its `target.rung` fallback now names `tier` / `non-cli` / `isolated-cli`). Update the file header comment's last sentence — replace

```ts
// dropped pin lands on the gateway's fallback, which on a CLI-only instance IS
// a CLI. Hence a ladder, and a debug line saying which rung answered.
```

with

```ts
// dropped pin used to land on the gateway's fallback, which on a CLI-only
// instance IS a CLI. Hence a ladder over ELIGIBLE providers only (spike §2
// #16), a typed error when there is none, and a debug line saying which rung
// answered.
```

- [ ] **Step 4: Record the degraded run in `capture/index.ts`**

Line 14 currently reads:

```ts
import { attemptedProviderOf, type CompleteResult } from './completion.js'
```

change to:

```ts
import { attemptedProviderOf, NoEligibleProviderError, type CompleteResult } from './completion.js'
```

The `catch` at lines 284–297 currently begins:

```ts
    } catch (err) {
      // A call that never returned still names what it tried, on the error
      // itself — an 'error' row with a NULL provider cannot say whether the
      // model was unreachable, unconfigured, or refused the alias it was given.
      provider ??= attemptedProviderOf(err)
```

Insert this block as the first statement inside the `catch`, before that comment:

```ts
      if (err instanceof NoEligibleProviderError) {
        // Degraded mode is the default path, not a failure (spec §3): no
        // headless + isolated provider on this instance, so no model call was
        // made and none was attempted. The row is written — the measurement is
        // the point — but it is not an 'error' and never counts against the
        // per-conversation cap (capture-gate.countExtractions).
        deps.logger.debug?.({ conversationId: input.conversationId }, 'Memory capture: no eligible background provider; degraded (no model)')
        recordRun(deps.db, input.conversationId, 0, null, 'degraded_no_model')
        return
      }
```

In `capture-gate.ts`, extend the doc comment above `countExtractions` (line 52, the sentence beginning "A `too-short` or `cap-reached` row") so it reads:

```ts
 * repeatedly is exactly what a runaway guard is for). A `too-short`,
 * `cap-reached` or `degraded_no_model` row never reached the model and must
 * not consume the budget — counting the first two once
 * meant twenty short acknowledgements ("ok", "mehet", "igen") exhausted the cap
 * without a single call, and the next fact-rich turn was refused.
```

(The SQL is unchanged: `degraded_no_model` is simply not in the `IN (…)` list.)

- [ ] **Step 5: Run the eligibility test**

Run: `bun vitest run tests/modules/memory/capture/provider-eligibility.test.ts`
Expected: PASS (12 tests). The old ladder test now fails on every `gateway-fallback` expectation — Step 6 rewrites it.

- [ ] **Step 6: Rewrite the ladder test for the eligible-only ladder**

Replace the whole of `tests/modules/memory/capture-provider-ladder.test.ts` with:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Which model the extractor actually reaches on an instance that is not the
// developer's. Most EYAS installs are a VPS or a pod with no room for a local
// model, so the ladder may assume NOTHING about what is enabled: it works from
// the providers this instance actually registered, whatever they are — and
// since sovereign-memory Phase 1 only from the ELIGIBLE ones (headless, and
// isolated if a CLI; spike §2 #16). The CLI-only instance comes first below
// because it is the common case and the one that was broken twice: first the
// extraction prompt reached a CLI agent that answered in prose, then the
// gateway fallback sent it to a CLI answering from the host's own memory.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createMemoryCapture } from '@modules/memory/capture/index'
import { isCliProviderId } from '@modules/model/onboarding-reconcile'
import {
  resolveCaptureTarget, createCaptureComplete, attemptedProviderOf, NoEligibleProviderError,
} from '@modules/memory/capture/completion'

/**
 * Provider DSL, mirroring what ships:
 *  - `id`   — an API provider (headless) or, for a CLI id, a CLI with NO flags
 *             (grok-cli / kimi-cli as shipped);
 *  - `id!`  — headless AND isolated (claude-code as shipped);
 *  - `id~`  — a provider that never declared headless (a legacy API).
 */
function fakeGateway(ids: string[]) {
  const providers = ids.map((raw) => {
    const id = raw.replace(/[!~]$/, '')
    if (raw.endsWith('!')) return { id, supportsIsolatedCompletion: true, supportsHeadlessInvocation: true }
    if (raw.endsWith('~') || isCliProviderId(id)) return { id }
    return { id, supportsHeadlessInvocation: true }
  })
  return {
    getProvider: (id: string) => providers.find((p) => p.id === id),
    listProviders: () => providers,
    complete: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"notes":[]}' }] }),
  }
}

/** Provider config that knows one enabled model per provider. */
function fakeConfig(models: Record<string, string[]>, disabled: string[] = [], defaults: Record<string, string> = {}) {
  return {
    getProvider: (id: string) => ({ id, enabled: !disabled.includes(id), defaultModel: defaults[id] ?? null }),
    listEnabledModels: (id: string) => (models[id] ?? []).map((m) => ({ id: m })),
  }
}

// ── The primary scenario: a CLI-only instance ───────────────────────────────
//
// grok-cli as the gateway default, claude-code also enabled, every API provider
// disabled and therefore unregistered. This is the owner's live box.

describe('a CLI-only instance', () => {
  const CLI_ONLY = ['grok-cli', 'claude-code!']

  it('pins the one CLI that is headless AND isolated, by provider only', () => {
    expect(resolveCaptureTarget({ gateway: fakeGateway(CLI_ONLY) })).toEqual({ rung: 'isolated-cli', provider: 'claude-code' })
  })

  it('ignores whatever the routing tier happens to name', () => {
    // Whether the tier names a provider this box does not have, or a CLI it
    // does, the answer is the same: the eligible CLI. The ladder never depends
    // on the tier table being right.
    for (const tier of [
      { provider: 'anthropic', model: 'claude-haiku' },   // configured, not installed here
      { provider: 'grok-cli', model: 'grok-cli-default' }, // auto-filled by CLI onboarding
      null,
    ]) {
      expect(resolveCaptureTarget({ gateway: fakeGateway(CLI_ONLY), resolveTier: () => tier }))
        .toEqual({ rung: 'isolated-cli', provider: 'claude-code' })
    }
  })

  it('sends the request pinned to that provider, with no model, isolated', async () => {
    const gateway = fakeGateway(CLI_ONLY)
    const logger = { debug: vi.fn() }
    await createCaptureComplete({
      getGateway: () => gateway as any,
      getDecisionEngine: () => ({ resolveForTier: () => ({ provider: 'anthropic', model: 'claude-haiku' }) }),
      getProviderConfig: () => fakeConfig({}, ['anthropic', 'openai']) as any,
      logger,
    })({ system: 'S', user: 'U' })

    const req = gateway.complete.mock.calls[0][0]
    expect(req.provider).toBe('claude-code')
    expect(req.model).toBeUndefined()
    expect(req.maxTokens).toBe(2_000)
    // Every extraction is isolated, whichever rung answered: a provider that
    // can honour the flag must, and one that cannot is unaffected by it.
    expect(req.isolated).toBe(true)
    expect(JSON.stringify(logger.debug.mock.calls[0])).toContain('isolated-cli')
  })

  it('never sends a grok-only box to the gateway', () => {
    expect(resolveCaptureTarget({ gateway: fakeGateway(['grok-cli']) })).toEqual({ rung: 'none' })
  })

  it('records WHAT IT TRIED on the error row when the call fails', async () => {
    // The run-#5 shape, end to end: the row alone has to name the target, or
    // the next diagnosis needs another live test to find out.
    const db = createMemoryDb()
    createMemoryTables(db)
    const gateway = fakeGateway(['claude-code!'])
    gateway.complete.mockRejectedValueOnce(new Error('There\'s an issue with the selected model'))

    const capture = createMemoryCapture({
      db,
      config: () => ({ enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4_000 }),
      complete: createCaptureComplete({ getGateway: () => gateway as any }),
      writer: { write: vi.fn() } as any,
      logger: { warn: vi.fn(), debug: vi.fn() },
    })
    await capture({
      conversationId: 'cli-err',
      projectId: null,
      userMessage: 'Please always answer me in Hungarian, that is how I work.',
      assistantMessage: 'Rendben.',
    })

    const runs = db.all(sql`SELECT skipped_reason, provider FROM memory_capture_runs WHERE conversation_id = 'cli-err'`) as any[]
    expect(runs[0].skipped_reason).toBe('error')
    expect(runs[0].provider).toBe('claude-code/isolated-cli')
  })

  it('extracts a note end to end from a CLI\'s prose-wrapped answer', async () => {
    // The whole point, exercised together: the hardened prompt reaches the CLI,
    // the CLI narrates anyway (they all do), and the balanced-object scan finds
    // the batch inside the narration. Before F1.1 this turn wrote an
    // `unparsable` row and no note.
    const db = createMemoryDb()
    createMemoryTables(db)

    const batch = JSON.stringify({
      notes: [{ kind: 'user', title: 'Working language', summary: 'Answers in Hungarian', body: 'The owner works in Hungarian.' }],
    })
    const gateway = fakeGateway(['claude-code!'])
    gateway.complete.mockResolvedValueOnce({
      provider: 'claude-code',
      model: 'claude-opus-4-6',
      content: [{ type: 'text', text: `I read through the exchange and found one durable fact.\n\n${batch}\n\nLet me know if you'd like me to keep going.` }],
    })
    const writer = { write: vi.fn().mockResolvedValue({ action: 'created', path: 'semantic/working-language.md' }) }

    const capture = createMemoryCapture({
      db,
      config: () => ({ enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4_000 }),
      complete: createCaptureComplete({ getGateway: () => gateway as any }),
      writer: writer as any,
      logger: { warn: vi.fn(), debug: vi.fn() },
    })
    await capture({
      conversationId: 'cli-1',
      projectId: null,
      userMessage: 'Please always answer me in Hungarian, that is how I work.',
      assistantMessage: 'Rendben.',
    })

    // The CLI was told, in its own prompt, to answer with the object alone.
    const system: string = gateway.complete.mock.calls[0][0].system
    expect(system).toMatch(/nothing else/i)
    expect(system).toMatch(/do not call\s*\n?\s*tools/i)

    expect(writer.write).toHaveBeenCalledTimes(1)
    expect(writer.write.mock.calls[0][0]).toMatchObject({ kind: 'user', summary: 'Answers in Hungarian' })
    const runs = db.all(sql`SELECT notes_written, skipped_reason, provider FROM memory_capture_runs WHERE conversation_id = 'cli-1'`) as any[]
    expect(runs).toHaveLength(1)
    expect(runs[0].notes_written).toBe(1)
    expect(runs[0].skipped_reason).toBeNull()
    // F1.2: the row says WHICH model produced this outcome — what actually
    // answered, from the response itself (the CLI's own default model).
    expect(runs[0].provider).toBe('claude-code/claude-opus-4-6')
  })
})

// ── The ladder's other rungs ────────────────────────────────────────────────

describe('the capture provider ladder', () => {
  it('uses the heartbeat tier when the tier resolves to a REGISTERED, eligible provider', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['anthropic', 'grok-cli']),
      resolveTier: () => ({ provider: 'anthropic', model: 'claude-haiku' }),
    })
    expect(target).toEqual({ rung: 'tier', provider: 'anthropic', model: 'claude-haiku' })
  })

  it('ignores a tier that names a provider nothing registered — the live failure', () => {
    // The tier table is configuration: it names whatever it was configured
    // with, installed here or not. Pinning a provider this instance does not
    // have either fails the call or silently lands on the gateway default.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['grok-cli', 'openai']),
      resolveTier: () => ({ provider: 'a-provider-this-box-does-not-have', model: 'some-model' }),
      providerConfig: fakeConfig({ openai: ['gpt-5-mini'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'openai', model: 'gpt-5-mini' })
  })

  it('ignores a tier that names a CLI, even a registered one', () => {
    // CLI onboarding auto-fills every empty routing tier with its own models,
    // so heartbeat→grok-cli is usually a machine default, not a decision. A
    // provider that answers prompts outranks it.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['grok-cli', 'anthropic']),
      resolveTier: () => ({ provider: 'grok-cli', model: 'grok-cli-default' }),
      providerConfig: fakeConfig({ anthropic: ['claude-haiku'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'anthropic' })
  })

  it('passes over CLI providers for a completion-shaped one', () => {
    // A CLI provider's complete() runs a full agent turn and answers in prose.
    // It is the LAST resort, never a peer of an API provider.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['claude-code!', 'grok-cli', 'kimi-cli', 'anthropic']),
      providerConfig: fakeConfig({ anthropic: ['claude-haiku'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'anthropic' })
  })

  it('treats every non-CLI provider alike — registration order decides, nothing is privileged', () => {
    const models = { ollama: ['llama3'], openai: ['gpt-5-mini'] }
    expect(resolveCaptureTarget({ gateway: fakeGateway(['ollama', 'openai']), providerConfig: fakeConfig(models) }))
      .toMatchObject({ provider: 'ollama' })
    expect(resolveCaptureTarget({ gateway: fakeGateway(['openai', 'ollama']), providerConfig: fakeConfig(models) }))
      .toMatchObject({ provider: 'openai' })
  })

  it('names the provider row default model when no model row is enabled', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['openai']),
      providerConfig: fakeConfig({}, [], { openai: 'gpt-5-mini' }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'openai', model: 'gpt-5-mini' })
  })

  it('skips a provider still registered but switched off in config', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['openai', 'gemini']),
      providerConfig: fakeConfig({ openai: ['gpt-5-mini'], gemini: ['gemini-flash'] }, ['openai']),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'gemini', model: 'gemini-flash' })
  })

  it('passes over a candidate whose model cannot be named', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['lmstudio', 'anthropic']),
      providerConfig: fakeConfig({ anthropic: ['claude-haiku'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'anthropic', model: 'claude-haiku' })
  })

  it('ignores a provider that never declared headless invocation, even with a model', () => {
    // Eligibility is the entry ticket at every rung: an old API provider
    // that predates the flag is not a background candidate until it says so.
    expect(resolveCaptureTarget({
      gateway: fakeGateway(['legacy-api~']),
      providerConfig: fakeConfig({ 'legacy-api': ['m1'] }),
    })).toEqual({ rung: 'none' })
  })

  it('prefers a CLI that is headless AND isolated over one that is neither — either way round', () => {
    // The preference is for the CAPABILITY, never for a provider id. Both
    // orderings, so registration accident cannot be what decides.
    const config = fakeConfig({ 'claude-code': ['claude-code-sonnet'] })
    expect(resolveCaptureTarget({ gateway: fakeGateway(['grok-cli', 'claude-code!']), providerConfig: config }))
      .toEqual({ rung: 'isolated-cli', provider: 'claude-code' })
    expect(resolveCaptureTarget({ gateway: fakeGateway(['claude-code!', 'grok-cli']), providerConfig: config }))
      .toMatchObject({ rung: 'isolated-cli', provider: 'claude-code' })

    // Symmetry: put both capabilities on the OTHER provider and the choice
    // moves with them. Nothing in the ladder knows what a 'claude-code' is.
    const flipped = resolveCaptureTarget({
      gateway: fakeGateway(['claude-code', 'grok-cli!']),
      providerConfig: fakeConfig({ 'grok-cli': ['grok-cli-default'] }),
    })
    expect(flipped).toMatchObject({ rung: 'isolated-cli', provider: 'grok-cli' })
  })

  it('never names a MODEL for a CLI, however many model rows it has', () => {
    // Live test #5: the pin named the first enabled model row for claude-code —
    // claude-code-fable — whose CLI alias 'fable' the spawned CLI rejected
    // outright. EYAS's model rows are display candidates, not guaranteed-valid
    // CLI aliases; a CLI is pinned by PROVIDER and nothing else.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['claude-code!']),
      providerConfig: fakeConfig(
        { 'claude-code': ['claude-code-fable', 'claude-code-sonnet'] },
        [],
        { 'claude-code': 'claude-code-opus' },
      ),
    })
    expect(target).toEqual({ rung: 'isolated-cli', provider: 'claude-code' })
    expect(target.model).toBeUndefined()
  })

  it('does not reach for a CLI while a non-CLI provider can answer', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['claude-code!', 'anthropic']),
      providerConfig: fakeConfig({ 'claude-code': ['claude-code-sonnet'], anthropic: ['claude-haiku'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'anthropic' })
  })

  it('stops at none when no CLI is both headless and isolated', () => {
    expect(resolveCaptureTarget({ gateway: fakeGateway(['grok-cli', 'kimi-cli']) })).toEqual({ rung: 'none' })
  })

  it('never half-pins a NON-CLI provider, capability or not', () => {
    // The half-pin is allowed at the isolation rung because a CLI resolves its
    // own default model. That reasoning does not transfer: an API provider
    // handed no model is the M7 failure mode wearing a capability flag.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['some-isolating-api!']),   // capabilities, no nameable model
      providerConfig: fakeConfig({}),
    })
    expect(target).toEqual({ rung: 'none' })

    // …and with a model it is an ordinary rung-(b) candidate, not an isolation pick.
    expect(resolveCaptureTarget({
      gateway: fakeGateway(['some-isolating-api!']),
      providerConfig: fakeConfig({ 'some-isolating-api': ['m1'] }),
    })).toEqual({ rung: 'non-cli', provider: 'some-isolating-api', model: 'm1' })
  })

  it('stops at none when NO candidate has a nameable model, rather than pinning a modelless one', () => {
    // M7: a half-pin (provider, no model) forces a model-less request onto a
    // provider that may require one. Degraded is the honest answer.
    expect(resolveCaptureTarget({ gateway: fakeGateway(['anthropic']) })).toEqual({ rung: 'none' })
  })

  it('stops at none when no provider is registered at all, and when no gateway exists', () => {
    expect(resolveCaptureTarget({ gateway: fakeGateway([]) })).toEqual({ rung: 'none' })
    expect(resolveCaptureTarget({ gateway: undefined })).toEqual({ rung: 'none' })
  })

  it('never throws when the decision engine or the provider config throws', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['anthropic']),
      resolveTier: () => { throw new Error('routing table gone') },
      providerConfig: {
        getProvider: () => { throw new Error('db locked') },
        listEnabledModels: () => { throw new Error('db locked') },
      },
    })
    // Resolution is best-effort at every rung: a broken lookup costs the pin,
    // never the capture. With no config reachable, no model can be named.
    expect(target).toEqual({ rung: 'none' })
  })

  it('never throws when the gateway itself throws while listing', () => {
    const target = resolveCaptureTarget({
      gateway: {
        getProvider: () => { throw new Error('gateway broken') },
        listProviders: () => { throw new Error('gateway broken') },
      },
      resolveTier: () => ({ provider: 'anthropic', model: 'm' }),
    })
    expect(target).toEqual({ rung: 'none' })
  })
})

describe('the capture completion', () => {
  it('pins the ladder\'s choice, with capture\'s own limits', async () => {
    const gateway = fakeGateway(['anthropic'])
    const complete = createCaptureComplete({
      getGateway: () => gateway as any,
      getProviderConfig: () => fakeConfig({ anthropic: ['claude-haiku'] }) as any,
    })
    await complete({ system: 'S', user: 'U' })

    expect(gateway.complete).toHaveBeenCalledTimes(1)
    expect(gateway.complete.mock.calls[0][0]).toMatchObject({
      system: 'S',
      provider: 'anthropic',
      model: 'claude-haiku',
      maxTokens: 2_000,
      temperature: 0.2,
    })
  })

  it('sends a CLI request with a provider and NO model', async () => {
    const gateway = fakeGateway(['claude-code!'])
    await createCaptureComplete({
      getGateway: () => gateway as any,
      getProviderConfig: () => fakeConfig({ 'claude-code': ['claude-code-fable'] }) as any,
    })({ system: 'S', user: 'U' })

    const req = gateway.complete.mock.calls[0][0]
    expect(req.provider).toBe('claude-code')
    expect(req.model).toBeUndefined()
    expect(req.isolated).toBe(true)
  })

  it('throws NoEligibleProviderError — and never calls the gateway — when nothing is eligible', async () => {
    const gateway = fakeGateway(['grok-cli', 'kimi-cli'])
    const complete = createCaptureComplete({ getGateway: () => gateway as any })
    await expect(complete({ system: 'S', user: 'U' })).rejects.toBeInstanceOf(NoEligibleProviderError)
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('attributes a FAILED call to the target it attempted', async () => {
    const gateway = fakeGateway(['claude-code!'])
    gateway.complete.mockRejectedValueOnce(new Error('There\'s an issue with the selected model'))
    const complete = createCaptureComplete({ getGateway: () => gateway as any })

    const err = await complete({ system: 'S', user: 'U' }).then(() => null, (e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(attemptedProviderOf(err)).toBe('claude-code/isolated-cli')
  })

  it('reports no attempted provider for an error from anywhere else', () => {
    expect(attemptedProviderOf(new Error('unrelated'))).toBeNull()
    expect(attemptedProviderOf(null)).toBeNull()
  })

  it('resolves the gateway per call, so a later module swap is honoured', async () => {
    // privacy and observability REPLACE ctx.model in their own onStart, which
    // may run after memory's. A captured gateway would be the pre-swap one.
    let gateway = fakeGateway(['anthropic'])
    const complete = createCaptureComplete({
      getGateway: () => gateway as any,
      getProviderConfig: () => fakeConfig({ anthropic: ['claude-haiku'] }) as any,
    })
    const swapped = fakeGateway(['anthropic'])
    gateway = swapped
    await complete({ system: 'S', user: 'U' })
    expect(swapped.complete).toHaveBeenCalledTimes(1)
  })

  it('throws when no gateway is wired — capture records the error row', async () => {
    const complete = createCaptureComplete({ getGateway: () => undefined })
    await expect(complete({ system: 'S', user: 'U' })).rejects.toThrow(/gateway/i)
  })

  it('joins the reply\'s text blocks, and names what answered', async () => {
    const gateway = fakeGateway(['anthropic'])
    gateway.complete.mockResolvedValueOnce({
      provider: 'anthropic',
      model: 'claude-haiku',
      content: [{ type: 'text', text: '{"notes":' }, { type: 'thinking' }, { type: 'text', text: '[]}' }],
    })
    const out = await createCaptureComplete({
      getGateway: () => gateway as any,
      getProviderConfig: () => fakeConfig({ anthropic: ['claude-haiku'] }) as any,
    })({ system: 'S', user: 'U' })
    expect(out).toEqual({ text: '{"notes":\n\n[]}', provider: 'anthropic/claude-haiku' })
  })

  it('names the rung when the response does not say which model answered', async () => {
    // A provider that returns no provider/model on its response still has to be
    // attributable, or the row is blank about a call that really happened.
    const gateway = fakeGateway(['claude-code!'])
    const out = await createCaptureComplete({ getGateway: () => gateway as any })({ system: 'S', user: 'U' })
    expect(out).toMatchObject({ provider: 'claude-code/isolated-cli' })
  })
})
```

- [ ] **Step 7: Run both capture test files, then the memory suite and lint**

Run: `bun vitest run tests/modules/memory/capture-provider-ladder.test.ts tests/modules/memory/capture/provider-eligibility.test.ts && bun vitest run tests/modules/memory && bun run lint`
Expected: PASS (ladder: 6 + 17 + 9 = 32 tests; eligibility: 12). `capture-wiring.test.ts` and `capture-candidates.test.ts` still pass: their fake gateways name API-shaped providers, which the new DSL treats as headless — if one of them builds its own provider list without `supportsHeadlessInvocation`, add `supportsHeadlessInvocation: true` to that fake (it models an API provider) rather than weakening the predicate.

- [ ] **Step 8: Commit**

```bash
git add src/modules/memory/capture/completion.ts src/modules/memory/capture/index.ts src/modules/memory/capture/capture-gate.ts tests/modules/memory/capture/provider-eligibility.test.ts tests/modules/memory/capture-provider-ladder.test.ts
git commit -m "feat(memory): background model calls only to headless+isolated providers — no gateway fallback, degraded_no_model when none is eligible"
```

---

### Task 7: `gateway.embed()` selects only providers that declare an embedding model

**Files:**
- Modify: `src/modules/model/types.ts` (`AIProvider`, after the headless flag from Task 5)
- Modify: `src/modules/model/submodules/openai/provider.ts:22-29` (options) and `:41-42` (object literal)
- Modify: `src/modules/model/submodules/ollama/provider.ts:30-31`
- Modify: `src/modules/model/submodules/openai-compat/catalog.ts:13-31` (`CompatProviderDef`) and `openai-compat/provider.ts:19-26`
- Modify: `src/modules/model/gateway.ts:245-262`
- Modify: `src/modules/memory/embeddings/model-bridge.ts:22-25`
- Test: `tests/modules/model/gateway-embed.test.ts` (modify), `tests/modules/memory/model-bridge.test.ts` (modify), `tests/modules/model/provider-embedding-declaration.test.ts` (create)

**Interfaces:**
- Produces: `AIProvider.supportsEmbeddings?: boolean` and `AIProvider.embeddingModels?: readonly string[]` — `true` + `['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002']` on `openai`; `true` + the `OLLAMA_EMBED_DIMENSIONS` keys on `ollama`; `false`/`[]` on every OpenAI-compatible derivative (kimi, openrouter, the compat catalog) unless the catalog entry sets `supportsEmbeddings: true` + `embeddingModels`. `gateway.embed()` — explicit or auto — uses a provider only when `provider.embed && provider.supportsEmbeddings === true`. `createModelBridge().canEmbed()` uses the same rule (so `memory/index.ts:150` "No embedding-capable provider available — vector search disabled" stays truthful).
- Consumes: `OPENAI_EMBED_DIMENSIONS` / `OLLAMA_EMBED_DIMENSIONS` (existing module constants).

- [ ] **Step 1: Extend the gateway and bridge tests, and add the declaration test**

`tests/modules/model/gateway-embed.test.ts` — replace the mock factory (lines 5–22) with:

```ts
function createMockProvider(id: string, options: { supportsEmbed?: boolean; declare?: boolean } = {}): AIProvider {
  const provider: AIProvider = {
    id,
    name: id,
    listModels: vi.fn(async () => []),
    complete: vi.fn(async () => ({ id: '1', provider: id, model: 'm', content: [], stopReason: 'end' as const, usage: { inputTokens: 0, outputTokens: 0 } })),
    stream: vi.fn() as any,
  }
  if (options.supportsEmbed !== false) {
    provider.embed = vi.fn(async (req: EmbedRequest): Promise<EmbedResponse> => ({
      provider: id,
      model: req.model || 'embed-model',
      embeddings: req.texts.map(() => [0.1, 0.2, 0.3]),
      dimensions: 3,
    }))
    // An embed() method alone is what every OpenAI-compatible host inherits;
    // the DECLARATION is what the gateway selects on (spike §2 #18).
    if (options.declare !== false) {
      provider.supportsEmbeddings = true
      provider.embeddingModels = ['embed-model']
    }
  }
  return provider
}
```

and append these cases inside `describe('ModelGateway.embed()', …)`:

```ts
  it('skips a provider that inherited embed() without declaring an embedding model (xai/openrouter shape)', async () => {
    const gateway = createModelGateway()
    const xai = createMockProvider('xai', { declare: false })
    gateway.registerProvider(xai)
    const ollama = createMockProvider('ollama')
    gateway.registerProvider(ollama)

    const result = await gateway.embed({ texts: ['test'] })
    expect(result.provider).toBe('ollama')
    expect(xai.embed).not.toHaveBeenCalled()
  })

  it('refuses an explicit provider that has embed() but declares no embedding model', async () => {
    const gateway = createModelGateway()
    gateway.registerProvider(createMockProvider('xai', { declare: false }))
    await expect(gateway.embed({ provider: 'xai', texts: ['x'] })).rejects.toThrow('does not support embeddings')
  })

  it('reports no embedding-capable provider when the only embed() holder is undeclared', async () => {
    const gateway = createModelGateway()
    gateway.registerProvider(createMockProvider('xai', { declare: false }))
    await expect(gateway.embed({ texts: ['x'] })).rejects.toThrow('No embedding-capable provider')
  })
```

`tests/modules/memory/model-bridge.test.ts` — replace lines 9–11 (the `providers` ternary) with:

```ts
  const providers = options.hasEmbed !== false
    ? [{ id: 'ollama', name: 'Ollama', supportsEmbeddings: true, embeddingModels: ['nomic-embed-text'], embed: vi.fn(), listModels: vi.fn(), complete: vi.fn(), stream: vi.fn() as any }]
    : [{ id: 'anthropic', name: 'Anthropic', listModels: vi.fn(), complete: vi.fn(), stream: vi.fn() as any }]
```

and add inside `describe('ModelBridge (memory embeddings)', …)` after the second `canEmbed` case:

```ts
  it('canEmbed returns false when embed() exists but no embedding model is declared', () => {
    const gateway = createMockGateway({ hasEmbed: false })
    ;(gateway.listProviders as any) = () => [
      { id: 'xai', name: 'xAI', embed: vi.fn(), listModels: vi.fn(), complete: vi.fn(), stream: vi.fn() as any },
    ]
    expect(createModelBridge(gateway).canEmbed()).toBe(false)
  })
```

New file `tests/modules/model/provider-embedding-declaration.test.ts`:

```ts
// tests/modules/model/provider-embedding-declaration.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spike §2 #18: only openai and ollama serve a verified embeddings endpoint;
// xai / openrouter / kimi inherit `embed()` from the shared OpenAI client and
// would hit `${baseURL}/embeddings` unverified. The declaration, not the
// method, is what the gateway and the memory bridge select on.

import { describe, it, expect } from 'vitest'
import { createOpenAIProvider } from '@modules/model/submodules/openai/provider'
import { createOllamaProvider } from '@modules/model/submodules/ollama/provider'
import { createKimiProvider } from '@modules/model/submodules/kimi/provider'
import { createOpenRouterProvider } from '@modules/model/submodules/openrouter/provider'
import { createCompatProvider } from '@modules/model/submodules/openai-compat/provider'
import { OPENAI_COMPAT_CATALOG } from '@modules/model/submodules/openai-compat/catalog'

const xai = OPENAI_COMPAT_CATALOG.find((d) => d.id === 'xai')!

describe('embedding declarations', () => {
  it('openai and ollama declare their embedding models', () => {
    const openai = createOpenAIProvider({ apiKey: 'k' })
    expect(openai.supportsEmbeddings).toBe(true)
    expect(openai.embeddingModels).toContain('text-embedding-3-small')
    const ollama = createOllamaProvider()
    expect(ollama.supportsEmbeddings).toBe(true)
    expect(ollama.embeddingModels).toContain('nomic-embed-text')
  })

  it('OpenAI-compatible derivatives keep the inherited embed() but do NOT declare embeddings', () => {
    for (const p of [createKimiProvider('k'), createOpenRouterProvider('k'), createCompatProvider(xai, 'k')]) {
      expect(typeof p.embed).toBe('function')
      expect(p.supportsEmbeddings).toBe(false)
      expect(p.embeddingModels).toEqual([])
    }
  })

  it('a compat catalog entry can opt in with supportsEmbeddings + embeddingModels', () => {
    const p = createCompatProvider({ ...xai, supportsEmbeddings: true, embeddingModels: ['x-embed-1'] }, 'k')
    expect(p.supportsEmbeddings).toBe(true)
    expect(p.embeddingModels).toEqual(['x-embed-1'])
  })
})
```

- [ ] **Step 2: Run the three tests to verify they fail**

Run: `bun vitest run tests/modules/model/gateway-embed.test.ts tests/modules/memory/model-bridge.test.ts tests/modules/model/provider-embedding-declaration.test.ts`
Expected: FAIL — the gateway still picks `xai` (`expected 'xai' to be 'ollama'`), the explicit `xai` call resolves instead of rejecting, `canEmbed()` is `true`, and `supportsEmbeddings` is `undefined` on every provider.

- [ ] **Step 3: Declare on the interface and the two real embedding providers**

`src/modules/model/types.ts` — after the `supportsHeadlessInvocation?: boolean` line added in Task 5, insert:

```ts
  /**
   * This provider serves a real embeddings endpoint and names the models
   * behind it. `gateway.embed()` — auto-selection AND `{ provider }` — needs
   * it: an OpenAI-compatible host inherits `embed()` from the shared client
   * whether or not it serves `/embeddings`, and "first provider with embed"
   * once picked such a host (spike §2 #18).
   */
  supportsEmbeddings?: boolean
  /** Embedding model ids this provider serves (for the UI and the doctor; not validated per call). */
  embeddingModels?: readonly string[]
```

`src/modules/model/submodules/openai/provider.ts` — extend the options interface (lines 22–29):

```ts
export interface OpenAIProviderOptions {
  apiKey: string
  baseURL?: string
  providerId?: string
  providerName?: string
  models?: ModelInfo[]
  defaultHeaders?: Record<string, string>
  /** Only a host with a verified /embeddings endpoint says so; real OpenAI defaults to true. */
  supportsEmbeddings?: boolean
  embeddingModels?: readonly string[]
}
```

and in the returned object, after the `supportsHeadlessInvocation: true,` line from Task 5, insert:

```ts
    // Real OpenAI declares its embedding models; a derivative (kimi,
    // openrouter, the compat catalog) inherits embed() but must opt in
    // through its own catalog entry (spike §2 #18).
    supportsEmbeddings: options.supportsEmbeddings ?? providerId === 'openai',
    embeddingModels: options.embeddingModels ?? (providerId === 'openai' ? Object.keys(OPENAI_EMBED_DIMENSIONS) : []),
```

`src/modules/model/submodules/ollama/provider.ts` — after `supportsHeadlessInvocation: true,` insert:

```ts
    supportsEmbeddings: true,
    embeddingModels: Object.keys(OLLAMA_EMBED_DIMENSIONS),
```

- [ ] **Step 4: Catalog opt-in for compat hosts**

`src/modules/model/submodules/openai-compat/catalog.ts` — inside `CompatProviderDef`, after `requiresKey?: boolean` (line 31), add:

```ts
  /** The host serves a verified `/embeddings` endpoint; absent = no embeddings (spike §2 #18). */
  supportsEmbeddings?: boolean
  /** Embedding model ids the host serves; required when supportsEmbeddings is true. */
  embeddingModels?: string[]
```

`src/modules/model/submodules/openai-compat/provider.ts` — the `createOpenAIProvider({ … })` call (lines 19–26) becomes:

```ts
  const base = createOpenAIProvider({
    apiKey: apiKey || (def.local ? 'local' : apiKey),
    baseURL: def.baseURL,
    providerId: def.id,
    providerName: def.name,
    models,
    defaultHeaders: def.defaultHeaders,
    supportsEmbeddings: def.supportsEmbeddings === true,
    embeddingModels: def.embeddingModels ?? [],
  })
```

No catalog entry opts in today: none of the compat hosts' `/embeddings` was verified (spike §4.3 #5).

- [ ] **Step 5: Gate the gateway and the bridge**

`src/modules/model/gateway.ts` lines 245–262 become:

```ts
    async embed(request: EmbedRequest): Promise<EmbedResponse> {
      // Resolve provider: explicit > first provider that DECLARES embeddings.
      // `embed` alone is not enough: OpenAI-compatible hosts inherit it from
      // the shared client whether or not they serve /embeddings (spike §2 #18).
      const canEmbed = (p: AIProvider) => typeof p.embed === 'function' && p.supportsEmbeddings === true
      if (request.provider) {
        const provider = providers.get(request.provider)
        if (!provider) throw new Error(`Provider not found: ${request.provider}`)
        if (!canEmbed(provider)) throw new Error(`Provider ${request.provider} does not support embeddings (no declared embedding model)`)
        return provider.embed!(request)
      }

      for (const [, provider] of providers) {
        if (canEmbed(provider)) return provider.embed!(request)
      }

      throw new Error('No embedding-capable provider registered (a provider must declare supportsEmbeddings)')
    },
```

(`AIProvider` is already imported in `gateway.ts`; if `tsc` reports it is not, add it to the existing `import type { … } from './types.js'` line.)

`src/modules/memory/embeddings/model-bridge.ts` lines 22–25 become:

```ts
    canEmbed(): boolean {
      // Same rule as gateway.embed(): a declared embedding model, not a mere
      // embed() method (spike §2 #18).
      const providers = gateway.listProviders()
      return providers.some((p) => typeof p.embed === 'function' && p.supportsEmbeddings === true)
    },
```

- [ ] **Step 6: Run the tests, then everything that touches providers**

Run: `bun vitest run tests/modules/model/gateway-embed.test.ts tests/modules/memory/model-bridge.test.ts tests/modules/model/provider-embedding-declaration.test.ts tests/modules/model tests/modules/memory/vec-store.test.ts && bun run lint`
Expected: PASS (gateway-embed 9, model-bridge 8, declaration 3); `tsc` clean. `tests/modules/model/openai-compat-catalog.test.ts` is unaffected (new optional fields).

- [ ] **Step 7: Commit**

```bash
git add src/modules/model/types.ts src/modules/model/gateway.ts src/modules/model/submodules/openai/provider.ts src/modules/model/submodules/ollama/provider.ts src/modules/model/submodules/openai-compat/catalog.ts src/modules/model/submodules/openai-compat/provider.ts src/modules/memory/embeddings/model-bridge.ts tests/modules/model/gateway-embed.test.ts tests/modules/memory/model-bridge.test.ts tests/modules/model/provider-embedding-declaration.test.ts
git commit -m "fix(model): select embedding providers by declared embedding models, not by an inherited embed() method"
```

---

### Task 8: Interim fix — vector-only hits are hydrated, not dropped

**Files:**
- Modify: `src/modules/memory/memory-service.ts` (insert before line 256 `// --- Graph boosts: seed from top vault FTS hits ---`)
- Test: `tests/modules/memory/hybrid-hydration.test.ts`

**Interfaces:**
- Consumes: `deps.episodic.get(id): EpisodicMemory | null` (`tiers/episodic-memory.ts:47`; fields `content, tags, sourceType, salience, agentId, validUntil`), `vault_index(path, title, tier, tags, content_text, kind, project_id, project_type_id)`, the local `noteInScope(row)` and `safeAll<T>()` helpers, `MemorySearchOptions.agentId / includeShared`.
- Produces: a fused result whose id came only from the vector channel is now returned with its content and metadata — the same shape the FTS channel produces (`source: 'episodic' | 'vault'`, `metadata.tags/sourceType/salience/agentId` or `metadata.path/title/tier/tags`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/hybrid-hydration.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 finding, re-verified in the gap analysis (§A-23): the hydration loop
// only knew rows the FTS channel had seen, so a purely semantic hit — the
// whole point of the vector channel — was fused, ranked, and then dropped.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createArchiveMemoryService } from '@modules/memory/tiers/archive-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from '@modules/memory/memory-service'

let db: ReturnType<typeof createMemoryDb>
let vaultPath: string
let episodicHits: Array<{ id: string; score: number }>
let vaultHits: Array<{ path: string; score: number }>
let memory: ReturnType<typeof createMemoryService>

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  vaultPath = mkdtempSync(join(tmpdir(), 'eyas-hydration-'))
  const wikilinks = createWikilinkService(db)
  wikilinks.init()
  const working = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
  const episodic = createEpisodicMemoryService(db)
  const archive = createArchiveMemoryService(db)
  const vault = createVaultService(vaultPath)
  const indexer = createVaultIndexer(db, vault, wikilinks)
  episodicHits = []
  vaultHits = []
  memory = createMemoryService({
    working, episodic, archive, vault, indexer, wikilinks, db,
    embeddings: {
      searchEpisodic: async () => episodicHits,
      searchVault: async () => vaultHits,
    },
  })
})

afterEach(() => rmSync(vaultPath, { recursive: true, force: true }))

describe('hybrid search hydrates vector-only hits', () => {
  it('returns an episodic row the FTS channel never matched', async () => {
    memory.episodic.create({ content: 'Kubernetes rollout guide for the platform', sourceType: 'extraction' })
    const semanticOnly = memory.episodic.create({ content: 'Deployment cadence agreed with the platform team', sourceType: 'extraction', tags: ['cadence'] })
    episodicHits = [{ id: semanticOnly.id, score: 0.95 }]

    const results = await memory.search({ query: 'kubernetes', tiers: ['episodic'] })
    const hit = results.find((r) => r.id === semanticOnly.id)
    expect(hit).toBeDefined()
    expect(hit!.source).toBe('episodic')
    expect(hit!.content).toContain('cadence')
    expect(hit!.metadata).toMatchObject({ tags: ['cadence'], sourceType: 'extraction' })
  })

  it('returns a vault note the FTS channel never matched, with vault metadata', async () => {
    memory.vault.write('semantic/k8s.md', {
      title: 'Kubernetes patterns', tags: ['k8s'], tier: 'semantic',
      links: [], created: '2026-09-03', updated: '2026-09-03',
    }, '# Kubernetes patterns\nDeployments, services, ingress.')
    memory.vault.write('semantic/vec-only.md', {
      title: 'Release cadence', tags: ['cadence'], tier: 'semantic',
      links: [], created: '2026-09-03', updated: '2026-09-03',
    }, '# Release cadence\nEvery second Tuesday, after the standup.')
    memory.indexer.indexAll()
    vaultHits = [{ path: 'semantic/vec-only.md', score: 0.9 }]

    const results = await memory.search({ query: 'kubernetes', tiers: ['semantic'] })
    const hit = results.find((r) => r.id === 'semantic/vec-only.md')
    expect(hit).toBeDefined()
    expect(hit!.source).toBe('vault')
    expect(hit!.content).toContain('second Tuesday')
    expect(hit!.metadata).toMatchObject({ path: 'semantic/vec-only.md', title: 'Release cadence', tier: 'semantic', tags: ['cadence'] })
  })

  it('still drops an invalidated episodic row, an unknown id, and a vault note outside the requested tiers', async () => {
    const gone = memory.episodic.create({ content: 'Superseded plan', sourceType: 'extraction' })
    memory.episodic.invalidate(gone.id)
    memory.vault.write('procedural/howto.md', {
      title: 'How to', tags: [], tier: 'procedural',
      links: [], created: '2026-09-03', updated: '2026-09-03',
    }, '# How to\nSteps.')
    memory.indexer.indexAll()
    episodicHits = [{ id: gone.id, score: 0.9 }, { id: 'nope', score: 0.8 }]
    vaultHits = [{ path: 'procedural/howto.md', score: 0.7 }]

    const results = await memory.search({ query: 'kubernetes', tiers: ['episodic', 'semantic'] })
    expect(results.map((r) => r.id)).not.toContain(gone.id)
    expect(results.map((r) => r.id)).not.toContain('nope')
    expect(results.map((r) => r.id)).not.toContain('procedural/howto.md')
  })

  it('respects the agent filter for a vector-only episodic row', async () => {
    const other = memory.episodic.create({ content: 'Agent B private finding', sourceType: 'system', agentId: 'agent-b' })
    const shared = memory.episodic.create({ content: 'Shared finding', sourceType: 'system' })
    episodicHits = [{ id: other.id, score: 0.9 }, { id: shared.id, score: 0.8 }]

    const ids = (await memory.search({ query: 'kubernetes', tiers: ['episodic'], agentId: 'agent-a' })).map((r) => r.id)
    expect(ids).not.toContain(other.id)
    expect(ids).toContain(shared.id)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun vitest run tests/modules/memory/hybrid-hydration.test.ts`
Expected: FAIL — the first two cases: `expected undefined to be defined` (the vector-only hit is fused, then dropped by `if (!hit) continue`). The last two may pass by accident (dropping everything satisfies "not contained") — they become meaningful once hydration exists.

- [ ] **Step 3: Hydrate vector-only ids from their own tables**

In `src/modules/memory/memory-service.ts`, insert the following block directly **before** the line `      // --- Graph boosts: seed from top vault FTS hits ---` (line 256), i.e. after the `for (const c of conversationRaw) { … }` loop that ends line 254:

```ts
      // --- Vector-only hits: hydrate from the row's own table ---
      // The map above only knows what the FTS channel returned; a purely
      // semantic hit was fused and ranked below and then dropped by the
      // `if (!hit) continue` — the F2 hydration finding (gap analysis §A-23),
      // fixed here as an interim S until the Phase 2 assembler replaces this
      // search. Same filters as the FTS channel: validity, agent, tier, scope.
      const includeShared = query.includeShared ?? true
      const agentAllows = (agentId: string | null) =>
        !query.agentId || (includeShared ? (agentId === query.agentId || agentId === null) : agentId === query.agentId)
      for (const e of episodicVecRaw) {
        const key = `ep:${e.id}`
        if (contentMap.has(key)) continue
        const row = deps.episodic.get(e.id)
        if (!row || row.validUntil || !agentAllows(row.agentId)) continue
        contentMap.set(key, {
          content: row.content,
          source: 'episodic',
          metadata: { tags: row.tags, sourceType: row.sourceType, salience: row.salience, agentId: row.agentId },
        })
      }
      for (const v of vaultVecRaw) {
        const key = `vt:${v.path}`
        if (contentMap.has(key)) continue
        const row = safeAll<{
          path: string; title: string; tier: string; tags: string | null; content_text: string
          kind: string | null; project_id: string | null; project_type_id: string | null
        }>(sql`SELECT path, title, tier, tags, content_text, kind, project_id, project_type_id
               FROM vault_index WHERE path = ${v.path}`)[0]
        if (!row || !tiers.includes(row.tier as any) || !noteInScope(row)) continue
        contentMap.set(key, {
          content: row.content_text,
          source: 'vault',
          metadata: { path: row.path, title: row.title, tier: row.tier, tags: row.tags ? JSON.parse(row.tags) : [] },
        })
      }

```

- [ ] **Step 4: Run the new test and the search suites**

Run: `bun vitest run tests/modules/memory/hybrid-hydration.test.ts tests/modules/memory/search-integration.test.ts tests/modules/memory/search-scope.test.ts tests/modules/memory/hybrid-search.test.ts tests/modules/memory/search-conversation.test.ts && bun run lint`
Expected: PASS (4 new tests); existing suites unchanged (they run without `embeddings`, so the new block is a no-op there).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/memory-service.ts tests/modules/memory/hybrid-hydration.test.ts
git commit -m "fix(memory): hydrate vector-only hybrid-search hits instead of dropping them"
```

---

### Task 9: Interim fix — agent memory routes resolve `ctx.memory` lazily

**Files:**
- Modify: `src/modules/agent/routes-memory.ts` (whole file, 37 lines)
- Modify: `src/modules/agent/index.ts:979-988`
- Test: `tests/modules/agent/routes-memory-lazy.test.ts`

**Interfaces:**
- Produces: `createAgentMemoryRoutes(app: Hono, getDeps: () => AgentMemoryDeps | undefined): void` — `getDeps()` is called **per request**; `undefined` answers `503 { error: 'Memory module not ready' }`. `export interface AgentMemoryDeps { episodicMemory: { list(opts): any[] }; workingMemory: { listByPrefix(prefix): any[] } }`.
- Consumes: `requirePermission('read', 'Agent')` (`@modules/permissions/middleware`), `(ctx as any).memory` published by memory's `onStart` (`memory/index.ts:187`).

**Why:** `ModuleLoader` orders modules by hard `dependencies` only; memory publishes `ctx.memory` in its own `onStart`, and agent's `onStart` reads it non-lazily — correct today only because `bootstrap.ts` registers memory (217) before agent (238). The same bug class was already fixed once for conversations (`conversations/memory-hooks.ts`; gap analysis §E-1, §A "8.8").

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/agent/routes-memory-lazy.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// agent/index.ts used to read (ctx as any).memory ONCE at its own onStart and
// skip route registration when it was absent — correct only by accident of
// bootstrap registration order (gap analysis §E-1). The routes now resolve
// the memory service per request, the way conversations/memory-hooks.ts does.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { createAgentMemoryRoutes, type AgentMemoryDeps } from '@modules/agent/routes-memory'

function appWith(getDeps: () => AgentMemoryDeps | undefined) {
  const app = new Hono()
  app.use('*', async (c: any, next: any) => { c.set('ability', { can: () => true }); await next() })
  createAgentMemoryRoutes(app as any, getDeps)
  return app
}

describe('agent memory routes (lazy memory)', () => {
  it('answers 503 while memory has not started, then serves once it has — same app, no re-registration', async () => {
    let deps: AgentMemoryDeps | undefined
    const app = appWith(() => deps)

    const before = await app.request('/api/v1/agents/a1/memories')
    expect(before.status).toBe(503)
    expect(await before.json()).toEqual({ error: 'Memory module not ready' })

    deps = {
      episodicMemory: { list: vi.fn(() => [{ id: 'm1' }]) },
      workingMemory: { listByPrefix: vi.fn(() => [{ key: 'a1:goal' }]) },
    }
    const episodic = await app.request('/api/v1/agents/a1/memories?tier=episodic&limit=5')
    expect(episodic.status).toBe(200)
    expect(await episodic.json()).toEqual({ memories: [{ id: 'm1' }], tier: 'episodic', agentId: 'a1' })
    expect(deps.episodicMemory.list).toHaveBeenCalledWith({ agentId: 'a1', includeShared: false, limit: 5 })

    const working = await app.request('/api/v1/agents/a1/memories?tier=working')
    expect(await working.json()).toEqual({ memories: [{ key: 'a1:goal' }], tier: 'working', agentId: 'a1' })
    expect(deps.workingMemory.listByPrefix).toHaveBeenCalledWith('a1:')
  })

  it('still requires read:Agent', async () => {
    const app = new Hono()
    createAgentMemoryRoutes(app as any, () => undefined)
    const res = await app.request('/api/v1/agents/a1/memories')
    expect(res.status).toBe(401)
  })
})

describe('agent/index.ts wiring (source contract)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/modules/agent/index.ts'), 'utf-8')
  it('registers the memory routes with a getter and never gates registration on ctx.memory being present', () => {
    expect(source).toMatch(/createAgentMemoryRoutes\(ctx\.http, \(\) =>/)
    expect(source).not.toMatch(/const memoryService = \(ctx as any\)\.memory\n\s*if \(memoryService\)/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun vitest run tests/modules/agent/routes-memory-lazy.test.ts`
Expected: FAIL — `createAgentMemoryRoutes` receives a function where it expects an object (`deps.episodicMemory.list is not a function` / TypeError), and the source contract fails.

- [ ] **Step 3: Rewrite `routes-memory.ts`**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'

export interface AgentMemoryDeps {
  episodicMemory: {
    list(opts: { agentId?: string; includeShared?: boolean; limit?: number }): any[]
  }
  workingMemory: {
    listByPrefix(prefix: string): any[]
  }
}

/**
 * `getDeps` is called PER REQUEST, never at registration. The module loader
 * orders modules by hard dependencies only, and memory publishes ctx.memory in
 * its own onStart — reading it once at agent's onStart worked by accident of
 * bootstrap order (gap analysis §E-1). Same lazy pattern as
 * conversations/memory-hooks.ts.
 */
export function createAgentMemoryRoutes(app: Hono, getDeps: () => AgentMemoryDeps | undefined) {
  app.get(
    '/api/v1/agents/:id/memories',
    requirePermission('read', 'Agent'),
    (c) => {
      const deps = getDeps()
      if (!deps) return c.json({ error: 'Memory module not ready' }, 503)

      const agentId = c.req.param('id')
      const tier = c.req.query('tier') ?? 'episodic'
      const limit = parseInt(c.req.query('limit') ?? '20', 10)

      if (tier === 'working') {
        const blocks = deps.workingMemory.listByPrefix(`${agentId}:`)
        return c.json({ memories: blocks, tier: 'working', agentId })
      }

      const memories = deps.episodicMemory.list({
        agentId,
        includeShared: false,
        limit,
      })
      return c.json({ memories, tier: 'episodic', agentId })
    },
  )
}
```

- [ ] **Step 4: Wire it lazily in `agent/index.ts`**

Lines 979–988 currently read:

```ts
    // Register agent memory routes if memory module is available
    const memoryService = (ctx as any).memory
    if (memoryService) {
      const { createAgentMemoryRoutes } = await import('./routes-memory.js')
      createAgentMemoryRoutes(ctx.http, {
        episodicMemory: memoryService.episodic,
        workingMemory: memoryService.working,
      })
      ctx.logger.info('Agent memory routes registered')
    }
```

Replace with:

```ts
    // Agent memory routes. Memory is resolved LAZILY per request: the loader
    // orders modules by hard dependencies only, and memory publishes
    // ctx.memory in its own onStart — reading it here worked only because
    // bootstrap.ts happens to register memory before agent (gap analysis §E-1).
    {
      const { createAgentMemoryRoutes } = await import('./routes-memory.js')
      createAgentMemoryRoutes(ctx.http, () => {
        const memoryService = (ctx as any).memory
        return memoryService?.episodic && memoryService?.working
          ? { episodicMemory: memoryService.episodic, workingMemory: memoryService.working }
          : undefined
      })
      ctx.logger.info('Agent memory routes registered (memory resolved lazily per request)')
    }
```

- [ ] **Step 5: Run the test, the agent suites and lint**

Run: `bun vitest run tests/modules/agent/routes-memory-lazy.test.ts tests/modules/agent tests/contracts/api-auth-coverage.contract.test.ts && bun run lint`
Expected: PASS (3 new tests). The API-auth coverage contract still sees `requirePermission('read', 'Agent')` on the route.

- [ ] **Step 6: Commit**

```bash
git add src/modules/agent/routes-memory.ts src/modules/agent/index.ts tests/modules/agent/routes-memory-lazy.test.ts
git commit -m "fix(agent): resolve the memory service lazily per request in the agent memory routes"
```

---

### Task 10: Interim fix — `CORE_IDENTITY` fits its budget; prefix reserve 9 000

**Files:**
- Modify: `src/modules/prompt-wizard/token-budget.ts:22-50`
- Test: `tests/modules/prompt-wizard/token-budget.test.ts:16-42`, `tests/modules/prompt-wizard/cache-prefix-builder.test.ts:37-64,154-156`

**Interfaces:**
- Produces: `export const PREFIX_RESERVE_TOKENS = 9_000`; `DEFAULT_BUDGET_FULL.coreIdentity = 500` (was 200); `shrinkForContextWindow` targets `Math.min(PREFIX_RESERVE_TOKENS, floor(ctx × 0.4))`. The declared sum becomes exactly 9 000 (8 700 + 300).
- Consumes: `estimateTokens(CORE_IDENTITY)` ≈ 495 (the F1.1 "491/200" finding; the literal is ~1 980 chars).
- Note for Phase 2: the injected-memory section's own 1 200-token reserve (spec §16-9) is a per-turn section, declared then — not part of this prefix reserve.

- [ ] **Step 1: Update the budget tests**

`tests/modules/prompt-wizard/token-budget.test.ts` — replace lines 4–10 (the import block) with:

```ts
import {
  DEFAULT_BUDGET_FULL,
  PREFIX_RESERVE_TOKENS,
  totalBudget,
  shrinkForContextWindow,
  estimateTokens,
  clipToBudget,
} from '../../../src/modules/prompt-wizard/token-budget.js'
```

replace the first case (lines 16–23) with:

```ts
  it('default budget fills the 9000 prefix reserve exactly — nothing is left for an undeclared section', () => {
    const total = totalBudget(DEFAULT_BUDGET_FULL)
    expect(PREFIX_RESERVE_TOKENS).toBe(9_000)
    expect(total).toBeGreaterThanOrEqual(8_900)
    // shrinkForContextWindow only leaves the budget alone while the declared sum
    // fits the reserve; past it every variable section starts paying for the
    // locked ones, which are exempt from the shrink ratio.
    expect(total).toBeLessThanOrEqual(PREFIX_RESERVE_TOKENS)
  })
```

and replace the second case (lines 25–42) with:

```ts
  it('every locked section fits the budget it is given — nothing ships pre-truncated', () => {
    // A locked section is text WE ship, measured against a number WE choose, so
    // a mismatch is a self-inflicted cut with no operator in the loop. This
    // caught rule 8 of CORE_RULES being sliced mid-word in every assembled
    // prompt, taking rules 9-14 with it; and CORE_IDENTITY (~495 tokens) was
    // clipped to 200 from F1.1 until the reserve was raised to 9 000 (spec §16-9).
    expect(estimateTokens(CORE_RULES)).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.coreRules)
    expect(estimateTokens(DEFAULT_PERSONALITY)).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.personality)
    expect(
      estimateTokens(CORE_IDENTITY),
      'CORE_IDENTITY must fit coreIdentity; grow the budget (and the reserve) consciously, never let the clip return',
    ).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.coreIdentity)
  })
```

`tests/modules/prompt-wizard/cache-prefix-builder.test.ts` — inside the first case (`'renders all 14 mandatory rules, none of them clipped'`), after line 63 `    expect(rules.droppedChars).toBe(0)`, add:

```ts

    // The identity is a locked section too; it used to lose its last ~16 lines.
    const identity = sections.find((s) => s.key === 'core-identity')!
    expect(identity.truncated).toBe(false)
    expect(identity.content).toContain("don't let this reflection bloat a simple task")
```

and change the comment at line 155 from

```ts
    // DEFAULT_BUDGET_FULL.coreIdentity = 200 tokens = 800 chars
```

to

```ts
    // DEFAULT_BUDGET_FULL.coreIdentity = 500 tokens = 2000 chars
```

(the 5 000-char fixture on the next line still overruns it; the assertions at 170–177 are unchanged).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun vitest run tests/modules/prompt-wizard/token-budget.test.ts tests/modules/prompt-wizard/cache-prefix-builder.test.ts`
Expected: FAIL — `PREFIX_RESERVE_TOKENS` is not exported; `estimateTokens(CORE_IDENTITY)` (≈495) is not ≤ 200; the identity section is `truncated: true`.

- [ ] **Step 3: Raise the budget and the reserve**

In `src/modules/prompt-wizard/token-budget.ts` replace lines 22–50 (from `export const DEFAULT_BUDGET_FULL` through the `const target = …` line inside `shrinkForContextWindow`) with:

```ts
/**
 * Prefix reserve: the declared DEFAULT_BUDGET_FULL must fit inside it, and
 * shrinkForContextWindow only starts scaling once the reserve is exceeded.
 * 9 000 (was 8 800) so coreIdentity can be 500: CORE_IDENTITY is ~495 tokens
 * and had been clipped to a 200-token budget since F1.1 — silently, since a
 * clipped locked section reads like a short one (spec §16-9, §15 interim).
 */
export const PREFIX_RESERVE_TOKENS = 9_000

export const DEFAULT_BUDGET_FULL: SectionBudget = {
  // 500, not 200: the shipped CORE_IDENTITY is ~495 tokens; token-budget.test.ts
  // asserts the fit so a future edit grows this number consciously.
  coreIdentity: 500,
  // 800, not 500: the shipped CORE_RULES is ~730 tokens, so at 500 every
  // assembled prompt cut it mid-rule and rules 9-14 reached no model at all —
  // invisibly, since a clipped locked section reads like a short one. Locked
  // sections are exempt from the shrink ratio, so these are flat additions to
  // the declared sum (8400 → 8700 → 9000), exactly the reserve above.
  coreRules: 800,
  personality: 200,
  projectCascade: 3000,
  identityMd: 600,
  soulMd: 500,
  agentsMd: 800,
  toolsMd: 400,
  skillsList: 400,
  toolsList: 500,
  teamContext: 400,
  memoryContext: 600,
  runtime: 200,
  activeVoice: 100,
}

export function totalBudget(b: SectionBudget): number {
  return Object.values(b).reduce((sum, v) => sum + v, 0)
}

export function shrinkForContextWindow(effectiveCtx: number, override?: Partial<SectionBudget>): SectionBudget {
  // Reserve 40% of context for system prompt, capped at the prefix reserve;
  // suffix is folded inside
  const target = Math.min(PREFIX_RESERVE_TOKENS, Math.floor(effectiveCtx * 0.4))
```

Everything from `  const baseTotal = totalBudget(DEFAULT_BUDGET_FULL)` on is unchanged.

- [ ] **Step 4: Run the prompt-wizard suite and lint**

Run: `bun vitest run tests/modules/prompt-wizard && bun run lint`
Expected: PASS. `shrinkForContextWindow(200000)` still returns the default budget (`9000 <= min(9000, 80000)`); `shrinkForContextWindow(8000)` still shrinks (target 3 200 < 9 000).

- [ ] **Step 5: Commit**

```bash
git add src/modules/prompt-wizard/token-budget.ts tests/modules/prompt-wizard/token-budget.test.ts tests/modules/prompt-wizard/cache-prefix-builder.test.ts
git commit -m "fix(prompt-wizard): CORE_IDENTITY fits its budget — coreIdentity 500, prefix reserve 9000"
```

---

### Task 11: Interim fix — the privacy scanner covers `tool_result` blocks

**Files:**
- Modify: `src/modules/privacy/index.ts:44-67` (`RequestSegment`, `collectSegments`), `:73` (the `wrapGateway` doc line) and `:228-286` (`applySegmentSanitizations`)
- Test: `tests/modules/privacy/sanitization-structure.test.ts` (add two cases)

**Interfaces:**
- Consumes: `ToolResultBlock { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }` (`model/types.ts:26-31`), the existing per-segment scan/policy/write-back in `wrapGateway`.
- Produces: a new segment kind `toolResultBlock`; a `tool_result` block's `content` is scanned exactly like a `text` block's `text` — sanitized in place, or the whole request blocked. Spec §12 names this the R6 redaction engine's precondition; the gap analysis (§A-42, §D F2) calls it "still open, still required" independent of the design — tool output re-enters the prompt on the next turn and is the classic PII/secret carrier.

- [ ] **Step 1: Add the failing cases**

Append inside `describe('Privacy sanitization — structure-aware (S5)', …)` in `tests/modules/privacy/sanitization-structure.test.ts`, before its closing `})`:

```ts
  it('sanitizes inside tool_result blocks and leaves the sibling text block intact', async () => {
    // A fetched page or a file read comes back as a tool_result and is sent
    // straight back to the model on the next turn — the classic PII carrier,
    // and until now the one block kind collectSegments never looked at.
    const toolOutput = 'Contact list: alice@example.com, see appendix.'
    const text = 'Summarise the contacts.'

    const chain = makeChain([
      {
        type: 'email',
        value: 'alice@example.com',
        start: toolOutput.indexOf('alice@example.com'),
        end: toolOutput.indexOf('alice@example.com') + 17,
        confidence: 1,
        scanner: 'regex',
      },
    ])

    const gateway = makeGateway()
    const wrapped = wrapGateway(gateway, chain as any, rules, config, makeCtx())

    await wrapped.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 'tu-1', content: toolOutput },
            { type: 'text', text },
          ] as any,
        },
      ],
    })

    const passed = (gateway.complete as any).mock.calls[0][0] as ModelRequest
    const blocks = passed.messages[0].content as any[]
    expect(blocks[0]).toEqual({ type: 'tool_result', toolUseId: 'tu-1', content: 'Contact list: [EMAIL], see appendix.' })
    expect(blocks[1]).toEqual({ type: 'text', text })
  })

  it('blocks the whole request when a tool_result carries blocked PII', async () => {
    const toolOutput = 'Card on file: 4111-1111-1111-1111'
    const chain = makeChain([
      {
        type: 'credit_card',
        value: '4111-1111-1111-1111',
        start: toolOutput.indexOf('4111'),
        end: toolOutput.indexOf('4111') + 19,
        confidence: 1,
        scanner: 'regex',
      },
    ])

    const gateway = makeGateway()
    const wrapped = wrapGateway(gateway, chain as any, rules, config, makeCtx())

    await expect(
      wrapped.complete({
        messages: [
          { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu-2', content: toolOutput }] as any },
        ],
      }),
    ).rejects.toThrow(/Privacy policy blocked/)
    expect(gateway.complete).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun vitest run tests/modules/privacy/sanitization-structure.test.ts`
Expected: FAIL — the tool_result content reaches the gateway unchanged, and the blocked request is sent (`expected … not to have been called`).

- [ ] **Step 3: Add the segment kind, collect it, write it back**

`src/modules/privacy/index.ts` lines 44–47 (the union) become:

```ts
type RequestSegment =
  | { kind: 'system'; text: string }
  | { kind: 'stringMessage'; messageIndex: number; text: string }
  | { kind: 'textBlock'; messageIndex: number; blockIndex: number; text: string }
  | { kind: 'toolResultBlock'; messageIndex: number; blockIndex: number; text: string }
```

In `collectSegments` (lines 59–63) replace:

```ts
      msg.content.forEach((block, blockIndex) => {
        if (block.type === 'text') {
          segments.push({ kind: 'textBlock', messageIndex, blockIndex, text: block.text })
        }
      })
```

with:

```ts
      msg.content.forEach((block, blockIndex) => {
        if (block.type === 'text') {
          segments.push({ kind: 'textBlock', messageIndex, blockIndex, text: block.text })
        } else if (block.type === 'tool_result' && typeof block.content === 'string') {
          // Tool output re-enters the prompt on the next turn: a fetched page
          // or a file read is the classic PII / secret carrier, and it was the
          // one block kind never scanned (gap analysis §A-42).
          segments.push({ kind: 'toolResultBlock', messageIndex, blockIndex, text: block.content })
        }
      })
```

In `applySegmentSanitizations`, the collection loop (lines 248–258) currently reads:

```ts
    if (s.kind === 'stringMessage') {
      stringMessageReplacements.set(s.messageIndex, v.sanitizedText)
    } else if (s.kind === 'textBlock') {
```

change the second branch to:

```ts
    } else if (s.kind === 'textBlock' || s.kind === 'toolResultBlock') {
```

(one map per message keyed by block index serves both kinds — a block index has exactly one kind). Then the `newContent` mapper (lines 275–282):

```ts
      const newContent = msg.content.map((block, blockIndex) => {
        if (block.type !== 'text') return block
        const replacement = blockMap.get(blockIndex)
        if (replacement !== undefined && replacement !== block.text) {
          return { ...block, text: replacement }
        }
        return block
      })
```

becomes:

```ts
      const newContent = msg.content.map((block, blockIndex) => {
        const replacement = blockMap.get(blockIndex)
        if (replacement === undefined) return block
        if (block.type === 'text' && replacement !== block.text) return { ...block, text: replacement }
        if (block.type === 'tool_result' && replacement !== block.content) return { ...block, content: replacement }
        return block
      })
```

Also update the `wrapGateway` doc comment (line 73) from `Intercepts complete() and stream() to scan outgoing prompts.` to `Intercepts complete() and stream() to scan outgoing prompts — system, messages, text blocks and tool_result blocks.`

- [ ] **Step 4: Run the privacy suites and lint**

Run: `bun vitest run tests/modules/privacy && bun run lint`
Expected: PASS (sanitization-structure: 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/privacy/index.ts tests/modules/privacy/sanitization-structure.test.ts
git commit -m "fix(privacy): scan and sanitize tool_result blocks, not only prompts and text blocks"
```

---

### Task 12: Delete the dead memory surfaces with their tests

**Files:**
- Delete: `src/modules/memory/context-builder-v2.ts` (275 lines, zero importers), `src/modules/memory/search/context-builder.ts` (49 lines; only its own test), `src/modules/memory/consolidation/decay.ts` (80 lines), `src/modules/memory/consolidation/implicit-extractor.ts` (21 lines), `tests/modules/memory/context-builder.test.ts`, `tests/modules/memory/consolidation.test.ts`
- Modify: `src/modules/memory/types.ts:158-188` (remove `MemoryConfig`), `src/modules/memory/blocks/memory-blocks.ts:51-52,152-167` (remove `formatForPrompt`), `tests/modules/memory/memory-blocks.test.ts:30-35`, `src/modules/memory/consolidator/README.md` (rewrite), `CLAUDE.md:75`

**Interfaces:**
- Consumes: the importer scan from the gap analysis §B.2, re-verified at plan time: the four source files have **no** importer in `src/` or `tests/` other than the two test files deleted here; `MemoryConfig` has zero references (the `WorkingMemoryConfig` in `tiers/working-memory.ts` is a different, local interface); `formatForPrompt` is called only from `tests/modules/memory/memory-blocks.test.ts:32` (`memory-block-tools.ts` builds its own responses). `consolidation/memory-lifecycle.ts` stays (live PreCompact hook). The `memory_blocks` table, service and `memory_block_*` tools stay until Phase 4 (spec §14, §16-11).
- Produces: nothing; `bun run lint` and the memory suite are the proof.

- [ ] **Step 1: Delete the four files and their two tests**

```bash
rm src/modules/memory/context-builder-v2.ts src/modules/memory/search/context-builder.ts src/modules/memory/consolidation/decay.ts src/modules/memory/consolidation/implicit-extractor.ts tests/modules/memory/context-builder.test.ts tests/modules/memory/consolidation.test.ts
```

Verify nothing else imported them: `grep -rn "context-builder-v2\|search/context-builder\|consolidation/decay\|implicit-extractor\|createDecayService\|saveExtractedFacts" src tests --include='*.ts' --include='*.tsx'` → no output.

- [ ] **Step 2: Remove `MemoryConfig`**

In `src/modules/memory/types.ts` delete lines 158–188 — from the comment `// --- Memory Config ---` through the closing `}` of `export interface MemoryConfig { … search: { … vectorWeightDefault: number } }` — leaving `// --- Module Context Extension ---` (line 190) as the next section. `grep -rn "MemoryConfig\b" src tests` must then return only `WorkingMemoryConfig` hits in `tiers/working-memory.ts`.

- [ ] **Step 3: Remove `formatForPrompt`**

In `src/modules/memory/blocks/memory-blocks.ts` delete lines 51–52 from the interface:

```ts
  /** Compact view for prompt injection (token-bounded). */
  formatForPrompt(scope: MemoryBlockScope, scopeId: string, maxChars?: number): string
```

and the implementation, lines 152–167 (from `    formatForPrompt(scope, scopeId, maxChars = 4000) {` through its closing `    },`), so `remove(…)` is the last member of the returned object. Then in `tests/modules/memory/memory-blocks.test.ts` delete lines 30–35:

```ts
  it('formats for prompt with budget', () => {
    blocks.upsert({ scope: 'team', scopeId: 't1', key: 'goal', content: 'Ship F4' })
    const text = blocks.formatForPrompt('team', 't1')
    expect(text).toContain('Ship F4')
    expect(text).toContain('goal')
  })
```

- [ ] **Step 4: Rewrite the consolidator README (short, truthful)**

Replace the whole of `src/modules/memory/consolidator/README.md` with:

```markdown
# Memory Consolidator (nightly, legacy)

Nightly sleep-time job (`memory.consolidator.nightly`, cron `0 2 * * *`, handler
`memory.consolidator.runOnce`, registered by `schedule.ts`). Every phase is
wrapped in its own `try/catch`: a failing phase lands in `report.errors` and
the next phase still runs. `isRunning()` guards re-entry both in the scheduler
handler and inside `runOnce()`.

**Status.** This is the pre-sovereign-memory consolidator. It is retired in
Phase 4 of `docs/superpowers/specs/2026-09-03-sovereign-layered-memory-design.md`
(§8 light/heavy passes, §14 retirements): phases 1–3 and the semantic promoter
go with the light/heavy passes, skill-candidate mining moves to skill-evolution,
and orphan GC is retired outright because it physically deletes rows (R5).
Until then, this is what actually runs:

| Phase | What it does today | Live? |
|---|---|---|
| 1 working → episodic | `isWorkingEligibleForEpisodic`: age > 6 h and (accessCount ≥ 2 or `importance` ≥ 7 from `{ text, importance }` JSON) → `episodic.create()` + `working.delete()` | yes |
| 2 episodic → semantic | `fingerprintEpisodic` (lowercase + collapse whitespace, per agent) clusters; ≥ 3 members touched within 30 days → `semanticPromoter` (LLM, `semantic-promoter.ts`) writes `semantic/auto/*.md`, else invalidate-only | yes (promoter needs a model) |
| 3 semantic tombstoning | `findSemanticTombstoneCandidates()` exists but is never called; counter stays 0 | no-op |
| 4 skill candidates | `skill-candidate-extractor.ts` — STUB: sessions with ≥ 6 tool calls become templated candidates in `skill_candidates` | plumbing live, mining stubbed |
| 5 wiki refresh | `wiki-refresher.ts` — production wiring passes `listActiveClients: () => []`, so `wiki_edit_proposals` never gains a row | starved |
| 6 orphan GC | `orphan-gc.ts` would delete unreachable episodic rows ≥ 14 days old, but `isReachable` is not passed in production and defaults to `() => true` | inert (deletes nothing) |

Skill and wiki proposals are persisted (`review-queue.ts`, `INSERT OR IGNORE`)
and exposed at `/api/v1/memory/review/{skill-candidates,wiki-proposals}` — a
live approve/reject queue whose wiki side is permanently empty.

## Files

```
src/modules/memory/consolidator/
├── manifest.ts                   # Submodule metadata
├── index.ts                      # createConsolidator(deps), the six phases
├── types.ts                      # Public types + dependency ports
├── promotion-rules.ts            # Pure rule functions
├── semantic-promoter.ts          # LLM cluster summary → semantic/auto/*.md
├── skill-candidate-extractor.ts  # STUB
├── wiki-refresher.ts             # STUB, starved in production
├── orphan-gc.ts                  # inert in production (see table)
├── review-queue.ts               # skill_candidates / wiki_edit_proposals persistence
├── schedule.ts                   # Scheduler registration
└── README.md
```

## Testing

```
bun vitest run tests/modules/memory/consolidator/
```

Six files: `consolidator-integration`, `orphan-gc`, `promotion-rules`,
`review-queue`, `semantic-promoter`, `skill-candidate-extractor`.
```

- [ ] **Step 5: Drop the phantom `a2a` module from `CLAUDE.md`**

Line 75 currently reads:

```
**Extra Modules:** telegram, research, ingress, remote-node, meeting, disaster-recovery, a2a, hand-hub, browser-use
```

change to:

```
**Extra Modules:** telegram, research, ingress, remote-node, meeting, disaster-recovery, hand-hub, browser-use
```

(There is no `src/modules/a2a`; the `a2a_delegate` tools live in `tools/builtin/a2a-delegate-tools.ts` under the communication module — gap analysis §B.2, as-is §12.5.)

- [ ] **Step 6: Type-check and run the memory suite**

Run: `bun run lint && bun vitest run tests/modules/memory tests/modules/prompt-wizard`
Expected: `tsc` clean (no dangling imports); all memory suites PASS (two files fewer under `tests/modules/memory/`, 6 under `consolidator/`).

- [ ] **Step 7: Commit**

```bash
git add -A src/modules/memory/context-builder-v2.ts src/modules/memory/search/context-builder.ts src/modules/memory/consolidation/decay.ts src/modules/memory/consolidation/implicit-extractor.ts tests/modules/memory/context-builder.test.ts tests/modules/memory/consolidation.test.ts src/modules/memory/types.ts src/modules/memory/blocks/memory-blocks.ts tests/modules/memory/memory-blocks.test.ts src/modules/memory/consolidator/README.md CLAUDE.md
git commit -m "chore(memory): delete dead context builders, decay and implicit extractor; drop MemoryConfig and formatForPrompt; truthful consolidator README; no a2a module"
```

---

## Infra — coordinate: these tasks change the shipping image and manifests; execute Tasks 13–15 only after the owner confirms

Before starting, run `git status --short Dockerfile package.json CHANGELOG.md`. The tree is clean at plan time (the `build-web` stage's nested install is committed — `65c485c7`, shipped in 0.8.22-beta); if `Dockerfile` is dirty again, show the owner `git diff Dockerfile` first. Task 13 edits the `FROM` tags, the two `RUN bun install` lines, and adds a new stage before `runtime` — apply them on top of whatever the working tree holds, never by resetting the file. `package.json` is not touched by any of these tasks.

### Task 13: Dockerfile builds again — `--ignore-scripts`, Bun 1.3.10 pin, `probe` stage; the capability probe script

**Files:**
- Modify: `Dockerfile:1-14,24,33,43-44` and insert a stage before `runtime`
- Create: `scripts/ci/sqlite-capability-probe.ts`
- Verify: `docker build --target probe .`, `docker build --target runtime .`

**Interfaces:**
- Consumes (P1a): `probeSqliteCapabilities(rawDb: any, logger?: Logger): SqliteCapabilities` from `src/core/db/sqlite-capabilities.ts` with `{ sqliteVersion, fts5, vec0, vecVersion, int8Knn, extensionLoading }`. The probe stage copies `src/core` and `src/shared` plus `tsconfig.json`, so Bun resolves the `@shared/*` path aliases at runtime.
- Produces: a `probe` build stage that **fails the build** when FTS5 or vec0 (incl. the int8 KNN) is missing in the runtime base image; the CI job in Task 15 runs it. `docker build .` (no target) still builds `runtime`, which stays the last stage.

**Why each change (spike §2 #3, #4; §4.1 #2, #3):** `bun install --frozen-lockfile --production` exits 1 in every `oven/bun` image because `better-sqlite3` is default-trusted, its prebuild download fails and node-gyp finds no Python — the committed Dockerfile has not built. `--ignore-scripts` keeps the Node-only build step out of the Bun image (Bun cannot load `better-sqlite3` at all; it is the Node fallback only). `oven/bun:1` now resolves to Bun 1.4.0 (SQLite 3.53.2, Node ABI 147) while the project runs 1.3.10 (SQLite 3.51.2) — and the FTS5 query planner changes between those SQLite versions, so the tag pin is load-bearing for query-plan stability, not just reproducibility.

- [ ] **Step 1: Write the probe script**

```ts
// scripts/ci/sqlite-capability-probe.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Runs inside the runtime base image (Dockerfile `probe` stage) and in CI:
// opens an in-memory bun:sqlite database the way src/core/db/connection.ts
// does under Bun, runs the shared capability probe, prints it, and exits 1
// when FTS5 or sqlite-vec (vec0 + int8 KNN) is missing — the two things the
// memory layer is built on. Ported from the Phase 0 spike
// (.superpowers/spikes/2026-09-03-memory/sqlite-ext-docker/ctx/probe-bun.ts).
//
// Usage: bun scripts/ci/sqlite-capability-probe.ts

import { existsSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import { probeSqliteCapabilities } from '../../src/core/db/sqlite-capabilities.js'

if (process.platform === 'darwin') {
  // Apple's SQLite refuses loadExtension; Homebrew's does not. Same probe as
  // connection.ts / tests/helpers/test-db.ts, so the script also runs on a
  // developer Mac. On Linux, Bun loads extensions natively — no probe needed.
  for (const lib of ['/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', '/usr/local/opt/sqlite/lib/libsqlite3.dylib']) {
    if (!existsSync(lib)) continue
    try { (Database as any).setCustomSQLite(lib) } catch { /* bundled SQLite stays */ }
    break
  }
}

const db = new Database(':memory:')
const caps = probeSqliteCapabilities(db)
const report = {
  runtime: `bun ${Bun.version}`,
  platform: `${process.platform}/${process.arch}`,
  ...caps,
}
console.log(JSON.stringify(report, null, 2))

const missing = [
  !caps.fts5 && 'fts5',
  !caps.vec0 && 'vec0',
  !caps.int8Knn && 'int8Knn',
].filter((name): name is string => typeof name === 'string')

if (missing.length > 0) {
  console.error(`sqlite capability probe FAILED: missing ${missing.join(', ')}`)
  process.exit(1)
}
```

Run it locally first: `bun scripts/ci/sqlite-capability-probe.ts`
Expected on a Mac with Homebrew SQLite: JSON with `"fts5": true, "vec0": true, "int8Knn": true`, exit 0. Without Homebrew SQLite: `vec0: false` and exit 1 — that is the documented macOS limitation (spec §13), not a bug; the CI job runs it on Linux.

- [ ] **Step 2: Dockerfile — pin the tag and add `--ignore-scripts`**

Prepend this comment block at the very top of `Dockerfile` (before `# ─── Stage 1`):

```dockerfile
# Bun is PINNED to the project's version (bun.lock / CLAUDE.md: 1.3.10):
# `oven/bun:1` resolves to 1.4.0 today, whose bundled SQLite (3.53.2) and
# FTS5 query planner differ from 1.3.10's (3.51.2). The memory layer's query
# shapes were validated on 1.3.10; a tag drift changes plans silently.
# `--ignore-scripts` keeps better-sqlite3's Node-only build step (prebuild →
# node-gyp → "no Python") out of the Bun image: Bun cannot load that addon at
# all, it is the Node fallback only. See docs/superpowers/specs/
# 2026-09-03-memory-p0-spike-report.md §2 #3, #4.
```

Then change these lines:

- line `FROM oven/bun:1 AS deps` → `FROM oven/bun:1.3.10 AS deps`
- line `RUN bun install --frozen-lockfile --production` → `RUN bun install --frozen-lockfile --production --ignore-scripts`
- line `FROM oven/bun:1 AS build-deps` → `FROM oven/bun:1.3.10 AS build-deps`
- line `RUN bun install --frozen-lockfile` (the build-deps one) → `RUN bun install --frozen-lockfile --ignore-scripts`
- line `FROM oven/bun:1 AS build` → `FROM oven/bun:1.3.10 AS build`
- line `FROM oven/bun:1 AS build-web` → `FROM oven/bun:1.3.10 AS build-web`
- line `FROM oven/bun:1 AS build-docs` → `FROM oven/bun:1.3.10 AS build-docs`
- line `FROM oven/bun:1-slim AS runtime` → `FROM oven/bun:1.3.10-slim AS runtime`

The docs stage's `RUN bun install --frozen-lockfile || bun install` and the web stage's `bun scripts/install-nested-package.ts src/web` are left as they are (neither installs `better-sqlite3`).

- [ ] **Step 3: Dockerfile — the `probe` stage**

Insert this stage **between** the `build-docs` stage (ends `RUN bun run build`) and `# ─── Stage 5: Runtime`, so `runtime` stays the last (default) stage:

```dockerfile
# ─── Stage 4c: SQLite capability probe (CI gate, not part of the image) ────
# Same base as the runtime stage, the production node_modules (sqlite-vec's
# vec0.so comes from there), and the probe from src/core/db. `docker build
# --target probe .` FAILS when the bundled SQLite lacks FTS5 or vec0 cannot be
# loaded — the two things the memory layer is built on. Bun loads extensions
# natively on Linux; what this catches is a Bun tag drift or a musl base.
FROM oven/bun:1.3.10-slim AS probe
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src/core ./src/core
COPY src/shared ./src/shared
COPY scripts/ci ./scripts/ci
RUN bun scripts/ci/sqlite-capability-probe.ts

```

- [ ] **Step 4: Build the probe stage**

Run: `docker build --target probe --progress=plain . 2>&1 | tail -40`
Expected: the JSON report in the log (`"vec0": true`, `"fts5": true`, `"int8Knn": true`, `"runtime": "bun 1.3.10"`) and `exit 0`. On a mac this builds the `deps` stage first (`bun install … --ignore-scripts`, ~1 min) — the very step that used to exit 1.

- [ ] **Step 5: Build the runtime image**

Run: `docker build --target runtime -t eyas:local . && docker run --rm --entrypoint bun eyas:local --version`
Expected: the full image builds (several minutes: web + docs + chromium apt layer) and prints `1.3.10`. If the `build-web` stage fails, that is the committed nested-install stage (`65c485c7`, `scripts/install-nested-package.ts`), not a line this plan touched — report it, do not "fix" it here.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile scripts/ci/sqlite-capability-probe.ts
git commit -m "build(docker): pin oven/bun:1.3.10, install with --ignore-scripts, add a SQLite capability probe stage"
```

(If `git status` showed `Dockerfile` dirty before this task, the owner decides whether to commit the foreign hunk together or `git add -p`.)

---

### Task 14: Kubernetes resources — `1Gi/2Gi`, CPU `500m/2`, bridge profile documented

**Files:**
- Modify: `deploy/k8s/deployment.yaml:34-40`
- Modify: `deploy/k8s/helm/eyas/values.yaml:146-155`, `deploy/k8s/helm/eyas/Chart.yaml:9`
- Modify: `deploy/k8s/README.md` (new "Resources" section after "## Upgrade")

**Interfaces:**
- Produces: both manifests request `cpu: 500m / memory: 1Gi` and limit `cpu: "2" / memory: 2Gi` (spec §16-15, spike §2 #22). The `512Mi/1Gi` profile survives only as documentation for installs that embed through a provider bridge. The chart version bumps `0.1.0 → 0.1.1` (values changed).
- Consumes: `deploy/k8s/helm/eyas/templates/deployment.yaml:85-86` renders `.Values.resources` with `toYaml` — no template change.

- [ ] **Step 1: Raw manifest**

`deploy/k8s/deployment.yaml` lines 34–40 currently read:

```yaml
          resources:
            requests:
              cpu: 200m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

replace with:

```yaml
          # Sized on cgroup numbers for the in-process memory subsystem (local
          # embedder ≈ 0.5 GB RSS, int8 KNN set, WAL writer): cgroup peak
          # 718–873 MB on the 2-vCPU reference pod, `docker stats` 551–558 MiB —
          # above the former 512Mi limit. The old 256Mi/512Mi profile is only
          # valid for bridge embeddings; see deploy/k8s/README.md "Resources".
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: "2"
              memory: 2Gi
```

- [ ] **Step 2: Helm values and chart version**

`deploy/k8s/helm/eyas/values.yaml` lines 146–155 currently read:

```yaml
# -----------------------------------------------------------------------------
# Resources (requests & limits)
# -----------------------------------------------------------------------------
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: "1"
    memory: 1Gi
```

replace with:

```yaml
# -----------------------------------------------------------------------------
# Resources (requests & limits)
# -----------------------------------------------------------------------------
# Sized on cgroup numbers, not process RSS (Phase 0 combined-RSS spike): one
# Bun process with the SQLite WAL loop, a 40 k-row int8 KNN set, the
# in-process multilingual embedder (~0.5 GB RSS — the XLM-R tokenizer alone
# ≈ 250 MB) and HTTP peaked at 718–873 MB cgroup / 551–558 MiB in
# `docker stats` on a 2-vCPU pod — above the previous 512Mi limit.
#
# Bridge-embeddings profile: an install that embeds through a provider
# (ollama / openai) instead of the local model can run on the old numbers:
#   resources:
#     requests: { cpu: 500m, memory: 512Mi }
#     limits:   { cpu: "1",  memory: 1Gi }
resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: "2"
    memory: 2Gi
```

`deploy/k8s/helm/eyas/Chart.yaml` line 9: `version: 0.1.0` → `version: 0.1.1`.

- [ ] **Step 3: README section**

In `deploy/k8s/README.md` insert after the "## Upgrade" block (i.e. before `## Uninstall`):

```markdown
## Resources

The chart defaults (`values.yaml` → `resources`) are sized for the in-process
memory subsystem — the local multilingual embedder (≈ 0.5 GB RSS), the int8
vector set and the SQLite WAL writer — measured on a 2-vCPU pod as a cgroup
peak of 718–873 MB:

| Profile | requests | limits | When |
|---|---|---|---|
| **default** (local embedder) | `cpu: 500m`, `memory: 1Gi` | `cpu: "2"`, `memory: 2Gi` | every install that runs the bundled embedding model |
| bridge embeddings | `cpu: 500m`, `memory: 512Mi` | `cpu: "1"`, `memory: 1Gi` | the instance embeds through a provider (Ollama / OpenAI) and never loads the local model |

Pick the bridge profile with `--set resources.requests.memory=512Mi --set resources.limits.memory=1Gi --set resources.limits.cpu=1`.
Size on cgroup numbers (the pod's metrics, e.g. the metrics-server `top` view),
not on the process's own `memoryUsage().rss` — the page cache of the SQLite
file is charged to the pod.
```

- [ ] **Step 4: Lint and render**

Run: `helm lint deploy/k8s/helm/eyas && helm template eyas deploy/k8s/helm/eyas | grep -A6 'resources:'`
Expected: `1 chart(s) linted, 0 chart(s) failed` and the rendered block shows `memory: 1Gi` / `memory: 2Gi`, `cpu: 500m` / `cpu: "2"`. If `helm` is not installed locally, `scripts/lint-helm.sh` and the `helm-lint` workflow (it triggers on `deploy/k8s/helm/**`) run the same checks in CI.

- [ ] **Step 5: Commit**

```bash
git add deploy/k8s/deployment.yaml deploy/k8s/helm/eyas/values.yaml deploy/k8s/helm/eyas/Chart.yaml deploy/k8s/README.md
git commit -m "deploy(k8s): 1Gi/2Gi memory and 500m/2 CPU for the in-process memory subsystem; bridge profile documented"
```

---

### Task 15: CI — build the runtime image and run the SQLite capability probe inside it (amd64 + arm64)

**Files:**
- Create: `.github/workflows/image-capabilities.yml`

**Interfaces:**
- Consumes: the `probe` and `runtime` Dockerfile stages (Task 13). Actions pinned to the same commit SHAs the existing workflows use (`actions/checkout@11d5960a…` = v4). No `docker/*` actions: plain `docker build` on the hosted runners.
- Produces: a workflow with three jobs — `probe-amd64` (`ubuntu-24.04`), `probe-arm64` (`ubuntu-24.04-arm`, public-repo only: GitHub's free arm64 runners are not available on private repositories, so the mirror `eyas-dev` skips it) and `build-runtime` (proves the committed Dockerfile builds — spike §5's "Dockerfile builds" prerequisite).

- [ ] **Step 1: Write the workflow**

```yaml
name: image-capabilities

# Builds the Dockerfile's `probe` stage — the runtime base image, the
# production node_modules and src/core/db's SQLite capability probe — on
# amd64 and arm64, and fails on a missing FTS5 or sqlite-vec vec0. The Bun tag
# pin is load-bearing for the memory layer (bundled SQLite version and FTS5
# planner follow the Bun version); this is what notices a drift. The third
# job proves the committed Dockerfile builds at all (it did not, before the
# --ignore-scripts fix). See docs/superpowers/specs/
# 2026-09-03-memory-p0-spike-report.md §2 #3, #4 and §5.

on:
  push:
    paths:
      - "Dockerfile"
      - ".dockerignore"
      - "package.json"
      - "bun.lock"
      - "scripts/ci/**"
      - "src/core/db/**"
      - ".github/workflows/image-capabilities.yml"
  pull_request:
    paths:
      - "Dockerfile"
      - ".dockerignore"
      - "package.json"
      - "bun.lock"
      - "scripts/ci/**"
      - "src/core/db/**"
      - ".github/workflows/image-capabilities.yml"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  probe-amd64:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4

      - name: Probe SQLite capabilities inside the runtime base image (amd64)
        run: docker build --target probe --progress=plain .

  probe-arm64:
    # Free arm64 hosted runners exist for public repositories only; the
    # private mirror skips this job rather than queueing forever.
    if: github.repository == 'eyssen/eyas'
    runs-on: ubuntu-24.04-arm
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4

      - name: Probe SQLite capabilities inside the runtime base image (arm64)
        run: docker build --target probe --progress=plain .

  build-runtime:
    needs: probe-amd64
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4

      - name: Build the runtime image
        run: docker build --target runtime -t eyas:ci .

      - name: Smoke the entrypoint
        run: docker run --rm --entrypoint bun eyas:ci --version | grep -x '1.3.10'
```

- [ ] **Step 2: Validate the YAML and the paths**

Run: `bun -e "const y = require('yaml'); const w = y.parse(require('fs').readFileSync('.github/workflows/image-capabilities.yml','utf-8')); console.log(Object.keys(w.jobs).join(','), w.on.push.paths.length)"`
Expected: `probe-amd64,probe-arm64,build-runtime 7`. (`yaml` is already a dependency — `privacy/index.ts` imports it.)

- [ ] **Step 3: Dispatch once after the push (owner)**

After the owner pushes: `gh workflow run image-capabilities --ref main` and `gh run watch` — expected: all three jobs green; the probe logs show `"vec0": true` on both architectures. A red `probe-*` job with `no such module: vec0` means the base image drifted (musl, or a Bun whose bundled SQLite refuses extensions) — that is the signal this job exists for.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/image-capabilities.yml
git commit -m "ci: build the runtime image and run the SQLite capability probe inside it on amd64 and arm64"
```

---

### Task 16: Whole-plan verification and the acceptance checklist

**Files:** none new.

- [ ] **Step 1: Run every test this plan added or rewrote, then the full suite**

Run: `bun vitest run tests/contracts/save-memory-retired.contract.test.ts tests/contracts/tool-service/memory-tools.contract.test.ts tests/modules/memory/scope-stamping.test.ts tests/modules/prompt-wizard tests/modules/security-gate tests/modules/agent/resume-run.test.ts tests/modules/agent/agent-runner-security-mode.test.ts tests/modules/agent/routes-memory-lazy.test.ts tests/modules/model/provider-headless-flag.test.ts tests/modules/model/provider-embedding-declaration.test.ts tests/modules/model/gateway-embed.test.ts tests/modules/memory/model-bridge.test.ts tests/modules/memory/capture/provider-eligibility.test.ts tests/modules/memory/capture-provider-ladder.test.ts tests/modules/memory/hybrid-hydration.test.ts tests/modules/privacy/sanitization-structure.test.ts`
Expected: PASS — retired contract (7), memory-tools contract (6), scope-stamping (2), headless flag (13), embedding declaration (3), gateway-embed (9), model-bridge (8), eligibility (12), ladder (32), hydration (4), routes-memory-lazy (3), sanitization-structure (7), plus the unchanged counts of the prompt-wizard, security-gate and agent suites.

Run: `bun run lint && bun vitest run`
Expected: `tsc` clean; the full suite green.

Run: `grep -rn "save_memory" src packages/docs/src/content/docs --include='*.ts' --include='*.tsx' --include='*.md' | grep -v "src/modules/prompt-wizard/seed-migration.ts"`
Expected: no output.

- [ ] **Step 2: Tick the Phase 1 items this plan owns (spec §15, §16, spike §2, §5)**

| Item | Where proven |
|---|---|
| `save_memory` retired everywhere: registry (and MCP catalog), rule 8, 11 persona allow-lists, autonomy map, yellow tier, resume ledger; documented in six languages | Tasks 1–4; `save-memory-retired.contract.test.ts` (registry, templates, tiers, map, ledger, rules, `src/` scan); handbook grep |
| Existing installs receive the new rule 8 | Task 2; `seed-migration-hashset.test.ts` "refreshes the F1.1 CORE_RULES body" |
| `supportsHeadlessInvocation` on `AIProvider`: true on every API provider + claude-code, absent on grok-cli / kimi-cli | Task 5; `provider-headless-flag.test.ts` |
| `eligible(p)` predicate; rung (d) never used for background work; nothing eligible → `degraded_no_model`, no cap spend | Task 6; `provider-eligibility.test.ts`, `capture-provider-ladder.test.ts` |
| `gateway.embed()` selects only providers that declare an embedding model; compat `embed` gated by catalog flag | Task 7; `gateway-embed.test.ts`, `provider-embedding-declaration.test.ts`, `model-bridge.test.ts` |
| Vector-hydration drop fixed (interim S) | Task 8; `hybrid-hydration.test.ts` |
| `agent/index.ts:979` made lazy | Task 9; `routes-memory-lazy.test.ts` (behaviour + source contract) |
| `CORE_IDENTITY` overrun fixed, prefix reserve 9 000 | Task 10; `token-budget.test.ts` (assertion flipped), `cache-prefix-builder.test.ts` |
| `collectSegments` scans `tool_result` | Task 11; `sanitization-structure.test.ts` |
| Dead files deleted with their tests; `MemoryConfig`, `formatForPrompt`, README, `a2a` | Task 12; `bun run lint` + memory suite |
| Dockerfile install fix and Bun tag pin; capability probe inside the runtime base image | Task 13; `docker build --target probe .`, `--target runtime` |
| k8s `1Gi/2Gi` in raw and Helm manifests; bridge profile documented | Task 14; `helm lint` + `helm template` |
| CI job builds the image and runs the probe (amd64 + arm64) | Task 15; `image-capabilities.yml` |
| Zero new dependencies; `package.json` untouched | every task |

- [ ] **Step 3: Hand over**

Report the test counts, the `docker build` results and the commit list to the owner. Note explicitly any file that carried a foreign uncommitted hunk when you started (`git status` before Tasks 4 and 13) so the owner can `git add -p`. Phase 3's model pass can rely on `NoEligibleProviderError` / `isEligibleForBackground` from `@modules/memory/capture/completion` (P1c's Phase 1 extractor does not use them); Phase 2 replaces `search_memory` with `memory_search` / `memory_expand` and retires `memory-index.ts` / `related-work.ts`.

---

## Self-review

**1. Spec coverage (P1e scope only).**
- §3 "no model-facing write tool … `save_memory` is retired" / §11 "the tool surface collapses to read tools" / §14 "`save_memory` retirement touches rule 8, the persona allow-lists (11, per the touchpoint count — the spec's "12" was a miscount), the `memory_maintenance` binding, the MCP catalog — one wave, documented in six languages" → Tasks 1–4. `critic.ts` untouched (spec: `search_memory` stays a retrieval tool). ✓
- §6 / spike §2 #16 `eligible()`, `supportsHeadlessInvocation` in Phase 1, rung (d) not used for background work → Tasks 5–6. Spike §2 #17 cost accounting (`cost_usd`, `duration_api_ms`, `provider_version`) is P1a's `memory_run` schema + P1c's `recordRun`, not this plan. ✓
- Spike §2 #18 `gateway.embed()` declaration gate → Task 7. ✓
- §15 interim fixes (hydration, `agent/index.ts:979`, `CORE_IDENTITY` via §16-9 reserve 9 000, `collectSegments` `tool_result`) → Tasks 8–11. The fourth interim item in §15, "handbook de/es parity", is a Phase 3 acceptance item ("six languages + handbook de/es parity") and is **not** in this plan — only the `save_memory` sentences are touched in de/es. Gap noted, deliberate. ✓
- §14 retire list, Phase 1 slice: `context-builder-v2.ts`, `search/context-builder.ts`, `decay.ts` + `implicit-extractor.ts` (+ `consolidation.test.ts`), `types.ts` `MemoryConfig`, `blocks/memory-blocks.ts` `formatForPrompt` (table kept until Phase 4), `consolidator/README.md`, `a2a` in `CLAUDE.md` → Task 12. `graph-builder.ts` soft-edge helper, the `eyas.memory.reflection` event, `archive_memories`, `memory-index.ts`/`related-work.ts`, `search/engine.ts` duplicate weights, `orphan-gc.ts`, `wiki-refresher.ts` are later phases per §14 — out of scope here. ✓
- §13 / spike §2 #3, #4 (Dockerfile `--ignore-scripts`, pinned `oven/bun:1.3.10-slim`), §16-15 / spike #22 (k8s `1Gi/2Gi`, bridge profile), §16-16 / §17 "Bun tag drift — pin + CI capability job" → Tasks 13–15. `connection.ts` darwin-only probe + `eyas doctor` self-test are P1a's (spike #2), consumed here through `probeSqliteCapabilities`. ✓
- Interfaces contract used with the exact names: `supportsHeadlessInvocation` on `AIProvider`, `isEligibleForBackground(p)` with the contract formula, `NoEligibleProviderError`, `probeSqliteCapabilities(rawDb, logger?)`, `SqliteCapabilities` fields, `memory_run` status `degraded_no_model` (admitted by P1a's CHECK, written by Phase 3's model pass — not by P1c's Phase 1 extractor). Additive extras: `BackgroundCandidate`, `PREFIX_RESERVE_TOKENS`, `AgentMemoryDeps`, `supportsEmbeddings` / `embeddingModels`, `CaptureTarget.rung = 'none'`.

**2. Placeholder scan.** No "TBD/TODO/implement later"; every modify step quotes the current text with its line numbers and gives the replacement; every test step has a runnable command and an expected result; no "similar to Task N" — the six-language handbook edits and the six test-file edits in Task 3 are each spelled out. Task 13's `docker build` steps state what success looks like and what a `build-web` failure means (the committed nested-install stage, not a line this plan touched). The `bun -e` YAML check in Task 15 and the grep checks in Tasks 3, 4, 12 are concrete commands.

**3. Type consistency.** `createMemoryTools(getService)` keeps its signature (Task 1) and is called the same way in the two rewritten tests. `CaptureTarget.rung` is `'tier' | 'non-cli' | 'isolated-cli' | 'none'` in `completion.ts` and every `toEqual({ rung: … })` in both capture test files; `fakeGateway` returns objects with `id / supportsIsolatedCompletion / supportsHeadlessInvocation` matching `BackgroundCandidate`; `LadderGateway.listProviders()` returns `ReadonlyArray<BackgroundCandidate>`. `NoEligibleProviderError` is imported from `./completion.js` in `capture/index.ts` and from `@modules/memory/capture/completion` in both tests. `AgentMemoryDeps` is exported from `routes-memory.ts` and imported by name in `routes-memory-lazy.test.ts`; `agent/index.ts` passes a getter returning that shape or `undefined`. `PREFIX_RESERVE_TOKENS` is exported from `token-budget.ts` and imported in `token-budget.test.ts`. The privacy segment kind `'toolResultBlock'` is added to the union, produced in `collectSegments`, and consumed in `applySegmentSanitizations`. `supportsEmbeddings` / `embeddingModels` exist on `AIProvider` (Task 7 Step 3), are set on openai/ollama, forwarded through `OpenAIProviderOptions` and `CompatProviderDef`, and read in `gateway.ts` and `model-bridge.ts` with the same `typeof p.embed === 'function' && p.supportsEmbeddings === true` rule. The probe script uses the contract's `SqliteCapabilities` field names (`fts5`, `vec0`, `int8Knn`).
