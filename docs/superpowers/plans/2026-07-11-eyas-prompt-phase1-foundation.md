# EYAS Prompt System — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authored system prompt actually reach the model on every runtime path, from one canonical DB-seeded/editable source, with memory + team context and voice connected — so subsequent content authoring (Phase 2) has effect.

**Architecture:** Complete the abandoned "Task 29" wiring: the agent runner already accepts `systemPrompt?: AssembledPrompt` and flattens it, but the three live callers still pass a bare/empty `system` string. Each caller builds an `AssembledPrompt` via `promptAssembler.buildForPrimary(BuildOptions)` and passes it as `systemPrompt`. Consolidate the two divergent identity/rules sources into one canonical seed, make the assembler read the (editable) master sections from the `prompt_templates` DB store, wire the two null resolvers (memory, team), and remove the legacy `config/agents/*.yaml` drift source.

**Tech Stack:** Bun + TypeScript (strict, ESM), Drizzle over bun:sqlite, Vitest, Hono, Anthropic SDK.

## Global Constraints

- **NO version bump.** Version freeze is in effect (`feedback_eyas_version_freeze`). Do not touch version fields.
- **NO commits or pushes by the executor.** The user rule is: never auto-commit/push; commits happen only on explicit user request (`feedback_no_auto_commit`). Every task ends with a **Verify** checkpoint (typecheck + targeted tests), then **report to the orchestrator — do NOT run `git commit` / `git push`.** The orchestrator batches changes and asks the user before any commit. This applies to every dispatched subagent.
- **Vendor-neutral shipped defaults.** English default; no coupling to eyssen.com / Odoo / any specific vendor (`feedback_eyas_vendor_neutral`). The only allowed eYssen reference is product identity (repo/images/LICENSE).
- **Tests live under `tests/**/*.test.ts`.** `vitest.config.ts` `include` is `tests/**/*.test.ts` only — colocated `src/**/*.test.ts` do NOT run. Put every new test under `tests/`.
- **Test helpers:** in-memory DB via `createMemoryDb()` from `tests/helpers/test-db`; fakes via `vi.fn()`; async runner events via a local `asyncIterable(events)` helper (see `tests/modules/agent/conversation-runner.test.ts`).
- **Prompt rules are model guidance; hard enforcement stays code-side** (CASL, audit, security-gate, blast-radius). Making rule text editable is not a safety hole.
- **Commands:** typecheck `bun run typecheck` (root) and `bun run --cwd src/web typecheck` (web); tests `bunx vitest run <path>`; full suite `bunx vitest run`.
- **Import alias:** `@modules/...` maps to `src/modules/...`; from `tests/` use relative `../../../src/modules/...js` (both are used in the repo — match the neighboring file).

---

## File Structure

**Modified (source):**
- `src/modules/prompt-wizard/core-identity.ts` — canonical `CORE_IDENTITY` (merged platform + autonomous operating model).
- `src/modules/prompt-wizard/core-rules.ts` — canonical `CORE_RULES` (merged 14-rule set, blast-radius, vendor-neutral language).
- `src/modules/prompt-wizard/master-prompt.ts` — `getMasterPrompt()` composes the canonical constants (single source for the DB seed); `personality` unchanged in Phase 1.
- `src/modules/prompt-wizard/context-resolvers.ts` — **NEW.** `resolveTeamContextImpl` / `resolveMemoryContextImpl` (testable, pure-ish; read services off `ctx`).
- `src/modules/prompt-wizard/wizard-service.ts` — add `getMasterSection(section)` read helper.
- `src/modules/prompt-wizard/assembler.ts` — add `resolveMasterSections` dep; `buildForPrimary` uses it instead of the imported constants.
- `src/modules/prompt-wizard/index.ts` — wire the two resolvers + `resolveMasterSections` (DB read, code fallback); stop clobbering locked master rows on boot.
- `src/modules/conversations/system-prompt.ts` — **NEW.** `resolveConversationSystemPrompt(...)` pure helper (assembler → string, with fallback + body.system override).
- `src/modules/conversations/routes.ts` — call the helper; tighten `getAssembler` type.
- `src/modules/agent/conversation-runner.ts` — add `promptAssembler?` dep; select `project_id`; build + pass `systemPrompt`.
- `src/modules/proactive-assistant/bot-executor.ts` — thread `promptAssembler` into `runConversation` deps.
- `src/modules/agent/orchestrator.ts` — add `promptAssembler?` dep; build + pass `systemPrompt`; preserve constraints via `reminders`.
- `src/modules/agent/index.ts` — thread `promptAssembler` getter into `createOrchestrator`; remove the `config/agents` seed call.
- `src/modules/agent/agent-templates.ts` — fix the `$X/month` placeholder (line ~249).

**Deleted:**
- `config/agents/code-reviewer.yaml`, `config/agents/researcher.yaml`, `config/agents/general-assistant.yaml` — legacy v1 drift source.

**New tests:**
- `tests/modules/prompt-wizard/canonical-seed.test.ts`
- `tests/modules/prompt-wizard/context-resolvers.test.ts`
- `tests/modules/prompt-wizard/master-section-db.test.ts`
- `tests/modules/conversations/system-prompt.test.ts`
- (extend) `tests/modules/agent/conversation-runner.test.ts`, `tests/modules/agent/orchestrator*.test.ts`

---

## Task 1: Canonical identity/rules seed + kill Hungarian rule + fix `$X` placeholder

**Files:**
- Modify: `src/modules/prompt-wizard/core-identity.ts`
- Modify: `src/modules/prompt-wizard/core-rules.ts`
- Modify: `src/modules/prompt-wizard/master-prompt.ts:17-79`
- Modify: `src/modules/agent/agent-templates.ts` (the `$X/month` line, ~249)
- Test: `tests/modules/prompt-wizard/canonical-seed.test.ts`

**Interfaces:**
- Produces: `CORE_IDENTITY: string`, `CORE_RULES: string` (unchanged exported names); `getMasterPrompt(params): MasterSections` returns `{ identity, coreRules, personality }` composed from the constants.

- [ ] **Step 1: Write the failing test**

Create `tests/modules/prompt-wizard/canonical-seed.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { CORE_IDENTITY } from '../../../src/modules/prompt-wizard/core-identity.js'
import { CORE_RULES } from '../../../src/modules/prompt-wizard/core-rules.js'
import { getMasterPrompt } from '../../../src/modules/prompt-wizard/master-prompt.js'

describe('canonical seed', () => {
  it('core identity carries platform + autonomous framing, vendor-neutral', () => {
    expect(CORE_IDENTITY).toMatch(/self-hosted personal AI/i)
    expect(CORE_IDENTITY).toMatch(/NOT a passive chatbot/i)
    expect(CORE_IDENTITY).toMatch(/IDENTITY\.md/)
    expect(CORE_IDENTITY).not.toMatch(/eyssen\.com|odoo/i)
  })

  it('core rules use blast-radius and are language-neutral (no forced Hungarian)', () => {
    expect(CORE_RULES).toMatch(/BLAST RADIUS/)
    expect(CORE_RULES).toMatch(/CRITICAL \(cross-system/i)
    expect(CORE_RULES).not.toMatch(/Communicate in Hungarian/i)
    expect(CORE_RULES).toMatch(/Match the owner's language/i)
    expect(CORE_RULES).toMatch(/always in English/i)
  })

  it('getMasterPrompt composes the canonical constants (single source)', () => {
    const m = getMasterPrompt({ version: '9.9.9', ownerName: 'Ada', currentDate: '2026-07-11' })
    expect(m.identity).toContain('9.9.9')
    expect(m.identity).toContain('Ada')
    expect(m.identity).toContain('NOT a passive chatbot')      // body comes from CORE_IDENTITY
    expect(m.coreRules).toBe(CORE_RULES)                       // rules are the canonical constant verbatim
    expect(m.coreRules).not.toMatch(/Communicate in Hungarian/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/prompt-wizard/canonical-seed.test.ts`
Expected: FAIL — current `CORE_RULES` lacks the `Match the owner's language` line; `getMasterPrompt().coreRules` still contains "Communicate in Hungarian" and is not identical to `CORE_RULES`.

- [ ] **Step 3: Rewrite `core-identity.ts`**

Replace the entire body of `src/modules/prompt-wizard/core-identity.ts` with:

```ts
// src/modules/prompt-wizard/core-identity.ts
// Canonical platform identity. Seeded into prompt_templates (level='master',
// section='identity') and read back by the assembler; editable by the owner.

export const CORE_IDENTITY = `You are EYAS, a self-hosted personal AI assistant platform. You act as an
autonomous, dedicated teammate for a single owner — not a public chatbot.

Core understanding:
- You are NOT a passive chatbot. You proactively pursue your assigned mission.
- Each session you wake up fresh — your IDENTITY.md, SOUL.md, AGENTS.md, and
  memory files ARE your continuity. Read IDENTITY.md to know who you are and
  what you're here to do; read SOUL.md to know how to sound.
- You have persistent memory across conversations. Use it proactively — don't
  ask what you should already know. Update MEMORY.md with what matters; log
  notable events in memory/YYYY-MM-DD.md.
- Every conversation belongs to a project with its own context, rules, and
  tools. Respect the project's domain.
- You have tools to read/write files, run commands, search the knowledge base,
  manage documents, schedule work, set heartbeats, and initiate communication —
  without asking permission for routine, low-risk operations.
- You can delegate sub-tasks to specialized agents. Use this for complex work
  that benefits from focused expertise.
- Search indexed documentation, code, and vault knowledge before guessing.
- Act externally (email, message, shared state) only when mission-aligned. When
  uncertain about your mission, ask the owner — don't drift.`
```

- [ ] **Step 4: Rewrite `core-rules.ts`**

Replace the entire body of `src/modules/prompt-wizard/core-rules.ts` with:

```ts
// src/modules/prompt-wizard/core-rules.ts
// Canonical mandatory-rules block. Seeded into prompt_templates
// (level='master', section='core-rules') and read back by the assembler.
// These rules GUIDE the model; hard enforcement is code-side (audit, CASL,
// security-gate, blast-radius confirmation) and is not bypassable by editing
// this text.

export const CORE_RULES = `## Mandatory Rules

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
7. VERIFICATION: Verify before acting on assumptions. Check existing code before
   writing new code, existing data before creating duplicates, and search before
   claiming something doesn't exist.
8. MEMORY: Use your persistent memory proactively. Don't ask the owner to repeat
   what you should already know. Update memory when you learn something new.
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
```

- [ ] **Step 5: Compose `getMasterPrompt` from the constants (single source)**

In `src/modules/prompt-wizard/master-prompt.ts`, replace the `getMasterPrompt` body (lines 17-79). Keep `MasterSections`, `LOCKED_SECTIONS`, `MasterPromptParams`. New body:

```ts
import { CORE_IDENTITY } from './core-identity.js'
import { CORE_RULES } from './core-rules.js'

export function getMasterPrompt(params: MasterPromptParams): MasterSections {
  return {
    identity: `EYAS ${params.version} — owner: ${params.ownerName} — date: ${params.currentDate}

${CORE_IDENTITY}`,
    coreRules: CORE_RULES,
    personality: `## Default Personality

- Concise and direct — lead with the answer, not the reasoning
- Proactive — surface the next concrete step, don't just wait for instructions
- Structured — use lists, tables, and clear formatting when they help
- Technical but approachable — match the owner's expertise level
- Honest about limitations — say "I'm not sure" rather than guessing
- Action-oriented — prefer doing over explaining, unless asked to explain
- Context-aware — adapt tone to the situation
- Respectful of time — if something can be said in one sentence, don't use three`,
  }
}
```

(The `import` lines go at the top of the file with the existing imports. `personality` is intentionally close to the current text — deep "distinctive but warm" re-authoring is Phase 2.)

- [ ] **Step 6: Fix the `$X/month` placeholder**

In `src/modules/agent/agent-templates.ts`, find the line (≈249, in `PRIMARY_TEMPLATES` `system-engineer` → `workspaceSeed.identityMd`):

```
- Anything requiring infra spend > $X/month.
```

Replace with a concrete, placeholder-free line:

```
- Anything requiring new recurring infrastructure spend.
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/prompt-wizard/canonical-seed.test.ts`
Expected: PASS.

- [ ] **Step 8: Update the existing master-prompt test if it asserts old text**

Run: `bunx vitest run tests/modules/prompt-wizard/master-prompt.test.ts`
If it asserts "Communicate in Hungarian" or the old rule wording, update those assertions to the new canonical text (blast-radius, language-neutral). Re-run until green.

- [ ] **Step 9: Verify checkpoint (NO commit)**

Run: `bun run typecheck` then `bunx vitest run tests/modules/prompt-wizard/`
Expected: typecheck clean; prompt-wizard tests green.
**Report to orchestrator. Do NOT commit.**

---

## Task 2: Wire the two null resolvers (memory + team) as testable functions

**Files:**
- Create: `src/modules/prompt-wizard/context-resolvers.ts`
- Modify: `src/modules/prompt-wizard/index.ts:144-145`
- Test: `tests/modules/prompt-wizard/context-resolvers.test.ts`

**Interfaces:**
- Produces:
  - `resolveTeamContextImpl(ctx: any, conversationId: string | null): Promise<TeamContextSummary | null>`
  - `resolveMemoryContextImpl(ctx: any, conversationId: string | null, agentId: string): Promise<MemoryContextSummary | null>`
- Consumes (from `ctx`): `ctx.agents.teamSessions` (`listByConversation`, `readMemory`), `ctx.agents.registry` (`get`), `ctx.memory.working` (`listByPrefix`), `ctx.conversations` (`getAncestry`). Types verbatim from `cache-suffix-builder.ts` (`TeamContextSummary`, `MemoryContextSummary`).

- [ ] **Step 1: Write the failing test**

Create `tests/modules/prompt-wizard/context-resolvers.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { resolveTeamContextImpl, resolveMemoryContextImpl } from '../../../src/modules/prompt-wizard/context-resolvers.js'

describe('resolveTeamContextImpl', () => {
  it('returns null when no conversationId', async () => {
    expect(await resolveTeamContextImpl({}, null)).toBeNull()
  })

  it('maps the newest running session to a TeamContextSummary', async () => {
    const ctx: any = {
      agents: {
        teamSessions: {
          listByConversation: () => [
            { id: 'ts1', status: 'running', config: JSON.stringify({ phases: [{ agents: ['a1', 'a2'] }, { agents: ['a2'] }] }) },
          ],
          readMemory: () => [{ id: 'm1' }, { id: 'm2' }],
        },
        registry: { get: (id: string) => ({ name: id.toUpperCase(), tier: 'team' }) },
      },
    }
    const out = await resolveTeamContextImpl(ctx, 'conv-1')
    expect(out).toEqual({
      teamSessionId: 'ts1',
      members: [
        { name: 'A1', tier: 'team', status: 'running' },
        { name: 'A2', tier: 'team', status: 'running' },
      ],
      sharedMemoryEntryCount: 2,
    })
  })

  it('returns null and never throws on malformed config', async () => {
    const ctx: any = { agents: { teamSessions: { listByConversation: () => [{ id: 'ts', status: 'running', config: '{not json' }], readMemory: () => [] }, registry: { get: () => null } } }
    expect(await resolveTeamContextImpl(ctx, 'c')).not.toThrow?.()
  })
})

describe('resolveMemoryContextImpl', () => {
  it('collects agent-scoped working memory and goal ancestry', async () => {
    const ctx: any = {
      memory: { working: { listByPrefix: (p: string) => (p === 'a1:' ? [{ content: 'pref X' }] : []) } },
      conversations: { getAncestry: () => [{ title: 'Root', goalDescription: 'ship it' }, { title: 'Child', goalDescription: null }] },
    }
    const out = await resolveMemoryContextImpl(ctx, 'conv-1', 'a1')
    expect(out).toEqual({ workingMemory: [{ content: 'pref X' }], goalAncestry: '[Root] ship it' })
  })

  it('returns null when nothing is available', async () => {
    const ctx: any = { memory: { working: { listByPrefix: () => [] } }, conversations: { getAncestry: () => [] } }
    expect(await resolveMemoryContextImpl(ctx, 'conv-1', 'a1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/prompt-wizard/context-resolvers.test.ts`
Expected: FAIL — module `context-resolvers.js` does not exist.

- [ ] **Step 3: Create `context-resolvers.ts`**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/context-resolvers.ts
// Resolves live team + working-memory context for the prompt assembler.
// Read services off ctx INSIDE the call (lazy) so module load order is irrelevant.
import type { TeamContextSummary, MemoryContextSummary } from './cache-suffix-builder.js'

export async function resolveTeamContextImpl(
  ctx: any,
  conversationId: string | null,
): Promise<TeamContextSummary | null> {
  if (!conversationId) return null
  try {
    const teamSessions = (ctx as any).agents?.teamSessions
    const registry = (ctx as any).agents?.registry
    if (!teamSessions?.listByConversation) return null
    const sessions = teamSessions.listByConversation(conversationId) as any[]
    if (!sessions?.length) return null
    const active = sessions.find((s) => s.status === 'running') ?? sessions[0]
    if (!active) return null
    let ids: string[] = []
    try {
      const cfg = JSON.parse(active.config)
      ids = [...new Set((cfg?.phases ?? []).flatMap((p: any) => p.agents ?? []))] as string[]
    } catch {
      ids = []
    }
    const members = ids.map((id) => {
      const a = registry?.get?.(id)
      return { name: a?.name ?? id, tier: a?.tier ?? 'specialist', status: active.status }
    })
    const sharedMemoryEntryCount = teamSessions.readMemory?.(active.id)?.length ?? 0
    return { teamSessionId: active.id, members, sharedMemoryEntryCount }
  } catch {
    return null
  }
}

export async function resolveMemoryContextImpl(
  ctx: any,
  conversationId: string | null,
  agentId: string,
): Promise<MemoryContextSummary | null> {
  try {
    const working = (ctx as any).memory?.working
    // agent-scoped only — never listAll() (would leak other agents' working memory)
    const blocks = agentId ? (working?.listByPrefix?.(`${agentId}:`) ?? []) : []
    const workingMemory = (blocks as any[]).map((b) => ({ content: b.content }))
    let goalAncestry: string | null = null
    if (conversationId) {
      const chain = (ctx as any).conversations?.getAncestry?.(conversationId) ?? []
      const goals = (chain as any[])
        .filter((c) => c.goalDescription)
        .map((c) => `[${c.title ?? 'Untitled'}] ${c.goalDescription}`)
      goalAncestry = goals.length ? goals.join(' -> ') : null
    }
    if (workingMemory.length === 0 && !goalAncestry) return null
    return { workingMemory, goalAncestry }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/prompt-wizard/context-resolvers.test.ts`
Expected: PASS. (If the malformed-config assertion form errors, simplify it to `expect(await resolveTeamContextImpl(ctx, 'c')).toBeNull()`.)

- [ ] **Step 5: Wire the resolvers into the assembler deps**

In `src/modules/prompt-wizard/index.ts`, add the import near the top:

```ts
import { resolveTeamContextImpl, resolveMemoryContextImpl } from './context-resolvers.js'
```

Replace lines 144-145:

```ts
      resolveTeamContext: async (_convId) => null,
      resolveMemoryContext: async (_convId, _agentId) => null,
```

with:

```ts
      resolveTeamContext: (convId) => resolveTeamContextImpl(ctx, convId),
      resolveMemoryContext: (convId, agentId) => resolveMemoryContextImpl(ctx, agentId ? agentId : '', ... ),
```

**Correct call — match the `AssemblerDeps` signatures** (`resolveMemoryContext: (conversationId, agentId) => ...`):

```ts
      resolveTeamContext: (convId) => resolveTeamContextImpl(ctx, convId),
      resolveMemoryContext: (convId, agentId) => resolveMemoryContextImpl(ctx, convId, agentId),
```

- [ ] **Step 6: Verify checkpoint (NO commit)**

Run: `bun run typecheck` then `bunx vitest run tests/modules/prompt-wizard/`
Expected: typecheck clean; green. **Report to orchestrator. Do NOT commit.**

---

## Task 3: Interactive-chat caller — build & pass the assembled system prompt

**Files:**
- Create: `src/modules/conversations/system-prompt.ts`
- Modify: `src/modules/conversations/routes.ts:328-340` (and the `getAssembler` param type at 43)
- Test: `tests/modules/conversations/system-prompt.test.ts`

**Interfaces:**
- Produces: `resolveConversationSystemPrompt(args): Promise<string>` where
  ```ts
  interface ResolveArgs {
    bodySystem?: string
    assembler?: { buildForPrimary(o: BuildOptions): Promise<AssembledPrompt> }
    agentId: string | null
    projectId: string | null
    conversationId: string
    fallbackAgentId?: () => string | null   // e.g. project.defaultAgentId
  }
  ```
- Consumes: `PromptAssembler.buildForPrimary` (Task 0 existing), `AssembledPrompt`.

- [ ] **Step 1: Write the failing test**

Create `tests/modules/conversations/system-prompt.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, vi } from 'vitest'
import { resolveConversationSystemPrompt } from '../../../src/modules/conversations/system-prompt.js'

const fakeAssembled = { prefix: '<core-identity>\nX\n</core-identity>', suffix: '<active-voice>\nv\n</active-voice>', reminders: [], cacheBoundaryHint: 0, prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 } }

describe('resolveConversationSystemPrompt', () => {
  it('body.system always wins and skips the assembler', async () => {
    const assembler = { buildForPrimary: vi.fn() }
    const out = await resolveConversationSystemPrompt({ bodySystem: 'OVERRIDE', assembler, agentId: 'a1', projectId: null, conversationId: 'c1' })
    expect(out).toBe('OVERRIDE')
    expect(assembler.buildForPrimary).not.toHaveBeenCalled()
  })

  it('composes prefix+suffix+reminders into one string', async () => {
    const assembler = { buildForPrimary: vi.fn().mockResolvedValue(fakeAssembled) }
    const out = await resolveConversationSystemPrompt({ assembler, agentId: 'a1', projectId: 'p1', conversationId: 'c1' })
    expect(out).toContain('<core-identity>')
    expect(out).toContain('<active-voice>')
    expect(assembler.buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a1', conversationId: 'c1', projectId: 'p1' }))
  })

  it('uses the fallback agentId when the conversation has none', async () => {
    const assembler = { buildForPrimary: vi.fn().mockResolvedValue(fakeAssembled) }
    await resolveConversationSystemPrompt({ assembler, agentId: null, projectId: 'p1', conversationId: 'c1', fallbackAgentId: () => 'default-agent' })
    expect(assembler.buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'default-agent' }))
  })

  it('returns "" (never throws) when no agentId is resolvable', async () => {
    const assembler = { buildForPrimary: vi.fn() }
    const out = await resolveConversationSystemPrompt({ assembler, agentId: null, projectId: null, conversationId: 'c1' })
    expect(out).toBe('')
    expect(assembler.buildForPrimary).not.toHaveBeenCalled()
  })

  it('returns "" when the assembler throws (fails soft)', async () => {
    const assembler = { buildForPrimary: vi.fn().mockRejectedValue(new Error('boom')) }
    const out = await resolveConversationSystemPrompt({ assembler, agentId: 'a1', projectId: null, conversationId: 'c1' })
    expect(out).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/conversations/system-prompt.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `system-prompt.ts`**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/system-prompt.ts
// Resolves the interactive-chat system prompt: body.system override wins;
// otherwise assemble via the prompt assembler (with a fallback agentId) and
// compose the AssembledPrompt into a single string. Fails soft to '' — never
// throws — so a missing agent/assembler degrades gracefully.
import type { PromptAssembler } from '@modules/prompt-wizard/assembler'

interface ResolveArgs {
  bodySystem?: string
  assembler?: PromptAssembler
  agentId: string | null
  projectId: string | null
  conversationId: string
  fallbackAgentId?: () => string | null
}

export async function resolveConversationSystemPrompt(args: ResolveArgs): Promise<string> {
  if (args.bodySystem) return args.bodySystem
  if (!args.assembler) return ''
  try {
    // resolve inside the try — fallbackAgentId may throw (e.g. a DB error in getWithStages)
    const agentId = args.agentId ?? args.fallbackAgentId?.() ?? null
    if (!agentId) return ''
    const assembled = await args.assembler.buildForPrimary({
      agentId,
      agentName: agentId, // buildForPrimary does not read agentName today; id is a safe label
      conversationId: args.conversationId,
      projectId: args.projectId,
      channelContext: null,
    })
    return [assembled.prefix, assembled.suffix, ...assembled.reminders].filter((s) => s.trim()).join('\n\n')
  } catch {
    return ''
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/conversations/system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Call the helper from `routes.ts`**

In `src/modules/conversations/routes.ts`, add the import (top of file):

```ts
import { resolveConversationSystemPrompt } from './system-prompt.js'
```

Replace the broken block at lines 328-340:

```ts
    // Build system prompt via PromptAssembler
    let system = body.system ?? ''
    if (!system) {
      const assembler = getAssembler?.()
      if (assembler) {
        try {
          const assembled = await assembler.build(id)
          system = assembled.system
        } catch {
          // Assembler failure falls back to empty system prompt
        }
      }
    }
```

with:

```ts
    // Build system prompt via PromptAssembler (Task 29 wiring).
    // body.system still wins; otherwise assemble from the conversation's agent.
    let system = await resolveConversationSystemPrompt({
      bodySystem: body.system,
      assembler: getAssembler?.(),
      agentId: (conv as any).agentId ?? null,
      projectId: (conv as any).projectId ?? null,
      conversationId: id,
      fallbackAgentId: () =>
        getBoard?.()?.projects.getWithStages((conv as any).projectId ?? '')?.defaultAgentId ?? null,
    })
```

Also tighten the `getAssembler` param type (line 43) from `() => any` to:

```ts
  getAssembler?: () => import('@modules/prompt-wizard/assembler').PromptAssembler | undefined,
```

Leave the downstream skill-append (342-370), the runner call (`system: system || undefined`), and the gateway fallback (`streamRequest.system = system`) unchanged — they consume the composed string and keep working.

- [ ] **Step 6: Verify checkpoint (NO commit)**

Run: `bun run typecheck` then `bunx vitest run tests/modules/conversations/`
Expected: typecheck clean (the tightened type may surface other bad callers — fix by conforming to `PromptAssembler`); conversations tests green. **Report to orchestrator. Do NOT commit.**

---

## Task 4: DB-backed, editable master sections (identity + core-rules)

**Files:**
- Modify: `src/modules/prompt-wizard/wizard-service.ts` (add `getMasterSection`)
- Modify: `src/modules/prompt-wizard/assembler.ts` (add `resolveMasterSections` dep; use it in `buildForPrimary`)
- Modify: `src/modules/prompt-wizard/index.ts` (wire `resolveMasterSections`; stop clobbering locked rows at boot)
- Test: `tests/modules/prompt-wizard/master-section-db.test.ts`

**Interfaces:**
- Produces:
  - `wizardService.getMasterSection(section: 'identity' | 'core-rules' | 'personality'): string | null`
  - `AssemblerDeps.resolveMasterSections: () => Promise<{ identity: string; coreRules: string }>`
- Consumes: `CORE_IDENTITY`, `CORE_RULES` (fallback), `prompt_templates` rows (`master-identity`, `master-core-rules`).

- [ ] **Step 1: Write the failing test**

Create `tests/modules/prompt-wizard/master-section-db.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createWizardService } from '../../../src/modules/prompt-wizard/wizard-service.js'

function makeTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS prompt_templates (
    id TEXT PRIMARY KEY, level TEXT NOT NULL, target_id TEXT, name TEXT NOT NULL,
    content TEXT NOT NULL, section TEXT, locked INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
}

describe('wizardService.getMasterSection', () => {
  it('reads a master section by its (hyphenated) section name', () => {
    const db = createMemoryDb()
    makeTable(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO prompt_templates (id, level, target_id, name, content, section, locked, is_active, created_by, created_at, updated_at)
      VALUES ('master-core-rules', 'master', NULL, 'Core Rules', 'EDITED RULES', 'core-rules', 1, 1, 'system', ${now}, ${now})`)
    const svc = createWizardService(db)
    expect(svc.getMasterSection('core-rules')).toBe('EDITED RULES')
    expect(svc.getMasterSection('identity')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run tests/modules/prompt-wizard/master-section-db.test.ts`
Expected: FAIL — `svc.getMasterSection` is not a function.

- [ ] **Step 3: Add `getMasterSection` to `wizard-service.ts`**

Inside the object returned by `createWizardService(db)` (next to `get`/`getActive`), add:

```ts
    getMasterSection(section: string): string | null {
      const rows = db.all(sql`SELECT content FROM prompt_templates
        WHERE level = 'master' AND section = ${section} AND is_active = 1 LIMIT 1`) as any[]
      return rows.length > 0 ? (rows[0].content as string) : null
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `bunx vitest run tests/modules/prompt-wizard/master-section-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `resolveMasterSections` to the assembler**

In `src/modules/prompt-wizard/assembler.ts`:

Add to `AssemblerDeps`:

```ts
  resolveMasterSections: () => Promise<{ identity: string; coreRules: string }>
```

In `buildForPrimary`, replace the direct use of the imported constants. Currently the prefix is built with `coreIdentity: CORE_IDENTITY, coreRules: CORE_RULES`. Change to resolve them first:

```ts
    const master = await deps.resolveMasterSections()
    // ...
    const prefix = buildCachePrefix({
      coreIdentity: master.identity,
      coreRules: master.coreRules,
      workspace: ws,
      cascade,
      skillsList: skills,
      toolsList: tools,
      budget,
    })
```

Remove the now-unused `import { CORE_IDENTITY } from './core-identity.js'` and `import { CORE_RULES } from './core-rules.js'` from `assembler.ts` (they move to `index.ts` as the fallback).

- [ ] **Step 6: Wire `resolveMasterSections` in `index.ts` (DB read, code fallback) + stop clobbering edits**

In `src/modules/prompt-wizard/index.ts`, add imports:

```ts
import { CORE_IDENTITY } from './core-identity.js'
import { CORE_RULES } from './core-rules.js'
```

Add the dep to the `createPromptAssembler({ ... })` call:

```ts
      resolveMasterSections: async () => {
        const svc = (ctx as any).promptWizard
        return {
          identity: svc?.getMasterSection?.('identity') ?? CORE_IDENTITY,
          coreRules: svc?.getMasterSection?.('core-rules') ?? CORE_RULES,
        }
      },
```

Then make the seed no longer clobber owner edits. In the seeding loop (lines ~172-179), **remove the unconditional `UPDATE ... WHERE id = ? AND locked = 1`** so that `INSERT OR IGNORE` seeds once and later edits persist:

```ts
    for (const s of masterSections) {
      ctx.db.run(sql`INSERT OR IGNORE INTO prompt_templates
        (id, level, target_id, name, content, section, locked, is_active, created_by, created_at, updated_at)
        VALUES (${s.id}, 'master', NULL, ${s.name}, ${s.content}, ${s.section}, ${s.locked}, 1, 'system', ${now}, ${now})`)
      // NOTE: no re-sync UPDATE — master sections are owner-editable (D2). Reset-to-default is a separate explicit action (Phase 2 UI).
    }
```

- [ ] **Step 7: Extend the DB test to prove editability round-trips through the assembler**

Append to `tests/modules/prompt-wizard/master-section-db.test.ts`:

```ts
import { createPromptAssembler } from '../../../src/modules/prompt-wizard/assembler.js'

const fakeWs = {
  agentId: 'a', rootPath: '/tmp/a',
  identity: { name: 'IDENTITY.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  soulMd: { name: 'SOUL.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  soulStyleJson: { name: 'SOUL.style.json', path: '', exists: true, frontmatter: null, body: '{}', byteSize: 0, truncated: false },
  agentsMd: { name: 'AGENTS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  toolsMd: { name: 'TOOLS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  memoryMd: { name: 'MEMORY.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  dailyMemory: [],
}

it('assembler prefix reflects an edited master identity row', async () => {
  const db = createMemoryDb(); makeTable(db)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO prompt_templates (id, level, target_id, name, content, section, locked, is_active, created_by, created_at, updated_at)
    VALUES ('master-identity', 'master', NULL, 'System Identity', 'MY EDITED IDENTITY', 'identity', 1, 1, 'system', ${now}, ${now})`)
  const svc = createWizardService(db)
  const assembler = createPromptAssembler({
    workspaceLoader: { load: async () => fakeWs as never, invalidate: () => {}, invalidateAll: () => {} },
    projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
    resolveSkillsFor: async () => [], resolveToolsFor: async () => [],
    resolveTeamContext: async () => null, resolveMemoryContext: async () => null,
    resolveActiveVoice: async () => ({ scope: 'internal', reason: 'x', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
    resolveRuntime: () => ({ date: '2026-07-11', time: '10:00 CET', channel: 'owner_dm', os: 'darwin' }),
    resolveContextWindow: async () => 200_000,
    resolveMasterSections: async () => ({ identity: svc.getMasterSection('identity') ?? 'FALLBACK', coreRules: svc.getMasterSection('core-rules') ?? 'FALLBACK RULES' }),
  })
  const a = await assembler.buildForPrimary({ agentId: 'a', agentName: 'a', conversationId: null, projectId: null, channelContext: null })
  expect(a.prefix).toContain('MY EDITED IDENTITY')
})
```

- [ ] **Step 8: Run + verify checkpoint (NO commit)**

Run: `bunx vitest run tests/modules/prompt-wizard/master-section-db.test.ts tests/modules/prompt-wizard/assembler-primary.test.ts` then `bun run typecheck`.
Expected: PASS + typecheck clean. **Report to orchestrator. Do NOT commit.**

---

## Task 5: Background/autonomous caller (`conversation-runner`) — pass `systemPrompt`

**Files:**
- Modify: `src/modules/agent/conversation-runner.ts:22-31` (deps), `:60-63` (SELECT), `:84-108` (run call)
- Modify: `src/modules/proactive-assistant/bot-executor.ts:6,34`
- Test: extend `tests/modules/agent/conversation-runner.test.ts`

**Interfaces:**
- Consumes: `promptAssembler.buildForPrimary(BuildOptions)`; `AgentRunOptions.systemPrompt?: AssembledPrompt` (already exists; runner flattens + precedence over `system`).
- Produces: `ConversationRunnerDeps.promptAssembler?: PromptAssembler` (optional).

- [ ] **Step 1: Write the failing test (extend the existing file)**

Add to `tests/modules/agent/conversation-runner.test.ts`:

```ts
  it('passes an assembled systemPrompt to the runner when promptAssembler is present', async () => {
    const assembled = { prefix: 'PFX', suffix: 'SFX', reminders: [], cacheBoundaryHint: 0, prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 } }
    deps.promptAssembler = { buildForPrimary: vi.fn().mockResolvedValue(assembled) }
    await runConversation('conv-1', deps)
    expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: assembled }))
    expect(deps.promptAssembler.buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1', conversationId: 'conv-1' }))
  })

  it('falls back to the system string when no promptAssembler is provided', async () => {
    await runConversation('conv-1', deps)
    const call = deps.agentRunner.run.mock.calls[0][0]
    expect(call.systemPrompt).toBeUndefined()
    expect(call.system).toBe('sp')
  })
```

Note: the `createTables` SELECT test helper already omits `project_id`; add it to the CREATE TABLE and INSERT in this file's `beforeEach` if the runner now selects it (add `project_id TEXT` to the table and `NULL` to the insert — the runner coerces `?? null`).

- [ ] **Step 2: Run to verify the new test fails**

Run: `bunx vitest run tests/modules/agent/conversation-runner.test.ts`
Expected: FAIL — runner does not yet pass `systemPrompt`.

- [ ] **Step 3: Add `promptAssembler?` to `ConversationRunnerDeps`**

`src/modules/agent/conversation-runner.ts` lines 22-31, add the field:

```ts
export interface ConversationRunnerDeps {
  db: any
  agentRunner: any
  agentRegistry: any
  toolRegistry: any
  supervisor?: any
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug?: (m: string) => void }
  generateId?: () => string
  promptAssembler?: import('@modules/prompt-wizard/assembler').PromptAssembler
}
```

- [ ] **Step 4: Select `project_id` and build + pass the assembled prompt**

Change the SELECT (lines 60-63) to include `project_id`:

```ts
  const conv = (db.all(sql`
    SELECT id, agent_id, project_id, goal_description, provider_id, model_id
    FROM conversations WHERE id = ${conversationId}
  `) as any[])[0]
```

Just before the `for await (const event of agentRunner.run({` loop (line ~89), add:

```ts
    let assembledPrompt: import('@modules/prompt-wizard/assembler').AssembledPrompt | undefined
    if (deps.promptAssembler) {
      try {
        assembledPrompt = await deps.promptAssembler.buildForPrimary({
          agentId: conv.agent_id,
          agentName: agent.name,
          conversationId: conv.id,
          projectId: conv.project_id ?? null,
          channelContext: null,
        })
      } catch {
        assembledPrompt = undefined // fail soft — keep the system string fallback
      }
    }
```

Then in the run options object add `systemPrompt` (keep `system` as the fallback the runner ignores when `systemPrompt` is set):

```ts
      tools: toolDefs,
      system: agent.systemPrompt,
      systemPrompt: assembledPrompt,
      maxTurns: agent.maxTurns ?? 20,
```

(Import `AssembledPrompt` type where needed, or use the inline `import(...)` form shown.)

- [ ] **Step 5: Thread `promptAssembler` from the two callers**

`src/modules/proactive-assistant/bot-executor.ts`: add `promptAssembler?: any` to the factory deps (line 6) and destructure it (line 7); then include it in the `runConversation(conv.id, {...})` deps object (line 34):

```ts
export function createBotExecutor(deps: { db: any; agentRunner: any; agentRegistry: any; toolRegistry: any; logger: any; supervisor?: any; promptAssembler?: any }) {
  const { db, agentRunner, agentRegistry, toolRegistry, logger, supervisor, promptAssembler } = deps
```
```ts
          const result = await runConversation(conv.id, { db, agentRunner, agentRegistry, toolRegistry, supervisor, logger, promptAssembler })
```

The factory's own caller must supply `promptAssembler: (ctx as any).promptAssembler` (find where `createBotExecutor` is constructed — in the proactive-assistant module `onStart` — and add the field). The **retry route** path (`POST /agent/runs/:id/retry` → `resumeRun` → `runConversation`) forwards the same `deps`; add `promptAssembler: (ctx as any).promptAssembler` where that deps object is built (search `resumeRun(` / `runConversation(` call sites in the agent module route wiring).

- [ ] **Step 6: Run + verify checkpoint (NO commit)**

Run: `bunx vitest run tests/modules/agent/conversation-runner.test.ts` then `bun run typecheck`.
Expected: PASS + clean. **Report to orchestrator. Do NOT commit.**

---

## Task 6: Team/delegated caller (`orchestrator`) — pass `systemPrompt`, preserve constraints

**Files:**
- Modify: `src/modules/agent/orchestrator.ts:222-231` (deps), `:582-597` (child projectId), `:618-657` (build + pass)
- Modify: `src/modules/agent/index.ts:237-246` (thread `promptAssembler` getter)
- Test: extend the orchestrator test suite (find `tests/modules/agent/orchestrator*.test.ts`)

**Interfaces:**
- Consumes: `promptAssembler.buildForPrimary`; `agent.constraints: string[]`.
- Produces: `OrchestratorDeps.promptAssembler?` (optional).

- [ ] **Step 1: Write the failing test**

Locate the orchestrator test that exercises `runAgentInConversation` / team execution (grep `tests/modules/agent` for `orchestrator`). Add a test asserting that, when `deps.promptAssembler` is present, the runner receives `systemPrompt` whose `reminders` include the agent's constraints. Concrete assertion shape:

```ts
  it('delegated agent gets an assembled systemPrompt with constraints preserved in reminders', async () => {
    const assembled = { prefix: 'PFX', suffix: 'SFX', reminders: [], cacheBoundaryHint: 0, prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 } }
    deps.promptAssembler = { buildForPrimary: vi.fn().mockResolvedValue(assembled) }
    // ...drive runAgentInConversation for an agent with constraints: ['no deploy']...
    const call = deps.agentRunner.run.mock.calls[0][0]
    expect(call.systemPrompt.prefix).toBe('PFX')
    expect(call.systemPrompt.reminders.join('\n')).toContain('no deploy')
  })
```

(Match the existing orchestrator test's setup for building `deps` and invoking the team path; reuse its fakes.)

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run tests/modules/agent/orchestrator*.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `promptAssembler?` to `OrchestratorDeps`**

`orchestrator.ts:222-231`:

```ts
interface OrchestratorDeps {
  agentRegistry: AgentRegistry
  agentRunner: ReturnType<typeof createAgentRunner>
  gateway: ModelGateway
  conversations: ConversationService
  toolRegistry: ToolRegistry
  toolExecutor: ReturnType<typeof createToolExecutor>
  bus?: { emit(subject: string, data: unknown): void }
  teamSessions?: { pause(id: string): Promise<void> }
  promptAssembler?: import('@modules/prompt-wizard/assembler').PromptAssembler
}
```

- [ ] **Step 4: Build the assembled prompt (with constraints in reminders) and pass it**

Replace the hand-rolled `systemPrompt` construction (618-627) — keep the string as the fallback, and additionally build the assembled prompt:

```ts
      const toolDefs = toolRegistry.toToolDefinitions(agent.tools)

      // Legacy string (fallback when no assembler): identity+constraints inline.
      const systemPrompt = [
        agent.systemPrompt,
        agent.constraints.length > 0
          ? `\nConstraints:\n${agent.constraints.map(c => `- ${c}`).join('\n')}`
          : '',
      ].join('\n')

      // v2: assemble the full prompt; preserve per-agent constraints by adding
      // them as a reminder (reminders are appended after prefix+suffix by the runner).
      let assembledPrompt: import('@modules/prompt-wizard/assembler').AssembledPrompt | undefined
      if (deps.promptAssembler) {
        try {
          const parentProjectId = conversations.get(parentConversationId)?.projectId ?? null
          const base = await deps.promptAssembler.buildForPrimary({
            agentId,
            agentName: agent.name,
            conversationId: childConv.id,
            projectId: parentProjectId,
            channelContext: null,
          })
          const constraintReminder =
            agent.constraints.length > 0
              ? `Constraints:\n${agent.constraints.map(c => `- ${c}`).join('\n')}`
              : null
          assembledPrompt = constraintReminder
            ? { ...base, reminders: [...base.reminders, constraintReminder] }
            : base
        } catch {
          assembledPrompt = undefined // fail soft — string fallback still applies
        }
      }
```

Then in the runner call (641-657) add `systemPrompt`:

```ts
        for await (const event of agentRunner.run({
          messages,
          tools: toolDefs,
          system: systemPrompt,
          systemPrompt: assembledPrompt,
          maxTurns: agent.maxTurns ?? 20,
          provider,
          model,
          ...
```

(If `agentId`/`childConv`/`parentConversationId` are not in scope at the build site, move the build block to where they are — they are all in `runAgentInConversation`; verify exact scope when editing.)

- [ ] **Step 5: Thread the assembler from `agent/index.ts`**

`src/modules/agent/index.ts:237-246`, add a lazy getter to the `createOrchestrator({...})` call:

```ts
    const orchestrator = createOrchestrator({
      agentRegistry: registry,
      agentRunner: runner,
      gateway: ctx.model,
      get conversations() { return (ctx as any).conversations },
      get toolRegistry() { return (ctx as any).tools?.registry },
      get toolExecutor() { return (ctx as any).tools?.executor },
      bus: ctx.bus,
      teamSessions: teamSessionService,
      get promptAssembler() { return (ctx as any).promptAssembler },
    })
```

- [ ] **Step 6: Run + verify checkpoint (NO commit)**

Run: `bunx vitest run tests/modules/agent/orchestrator*.test.ts` then `bun run typecheck`.
Expected: PASS + clean. **Report to orchestrator. Do NOT commit.**

---

## Task 7: Remove the legacy `config/agents` drift source

**Files:**
- Delete: `config/agents/code-reviewer.yaml`, `config/agents/researcher.yaml`, `config/agents/general-assistant.yaml`
- Modify: `src/modules/agent/index.ts:164-172` (remove the `seedFromDirectory` call)
- Test: grep + update any test asserting the seeded ids

**Interfaces:** none produced; removes duplicate `agent_definitions` rows on fresh installs.

- [ ] **Step 1: Find tests / references that assume the seeded ids**

Run: `grep -rn "general-assistant\|config/agents\|seedFromDirectory" tests/ src/ | grep -v node_modules`
Record every hit. Expected consumers: possibly an agent-module boot test, or a fixture referencing `general-assistant`.

- [ ] **Step 2: Write/adjust the guard test**

Add a test (e.g. in `tests/modules/agent/agent-directory.test.ts` or a new `tests/modules/agent/no-legacy-seed.test.ts`) asserting the seed directory is no longer read — or, if a test currently asserts those agents exist after boot, invert it to assert they are NOT auto-seeded. Minimal example:

```ts
import { existsSync } from 'node:fs'
it('legacy config/agents yaml seeds are removed', () => {
  expect(existsSync('config/agents/general-assistant.yaml')).toBe(false)
  expect(existsSync('config/agents/code-reviewer.yaml')).toBe(false)
  expect(existsSync('config/agents/researcher.yaml')).toBe(false)
})
```

- [ ] **Step 3: Delete the three YAML files**

```bash
rm config/agents/code-reviewer.yaml config/agents/researcher.yaml config/agents/general-assistant.yaml
```

- [ ] **Step 4: Remove the seed call in `agent/index.ts`**

Delete lines 164-172 (the `resolve(process.cwd(), 'config/agents')` + `registry.seedFromDirectory(agentDir)` block). Leave `seedFromDirectory` defined on the registry (harmless; other code/tests may reference the method) but no longer invoke it at boot.

- [ ] **Step 5: Update any broken tests found in Step 1**

Adjust assertions that expected the seeded `general-assistant`/`code-reviewer`/`researcher` rows. The canonical specialists remain available via `agent-templates.ts` (SPECIALIST_TEMPLATES). Re-run affected suites until green.

- [ ] **Step 6: Run + verify checkpoint (NO commit)**

Run: `bunx vitest run tests/modules/agent/` then `bun run typecheck`.
Expected: green + clean. **Report to orchestrator.**
**Note for the orchestrator / user:** deleting config YAML is a config change (`CLAUDE.md` asks for commit confirmation) and does NOT clean pre-existing `agent_definitions` rows in an already-migrated DB. Existing-row cleanup is a separate, FK-guarded manual step (check `project_types.default_agent_id`, `projects.default_agent_id`, `users.agent_definition_id` before deleting any row) — do not automate a destructive migration here. **Do NOT commit.**

---

## Deferred to a Phase-1 follow-up: prompt-cache `cache_control` (Risk R1)

**Not implemented in this plan — explicit decision, not an omission.** The live Anthropic provider (`provider.ts`) sends `params.system` as a flat string with no `cache_control`; the cache-aware `AnthropicAdapter.send()` exists but is unregistered. Enabling prompt caching requires threading `AssembledPrompt.prefix/suffix` through `ModelRequest` → gateway → provider (route A) or registering the adapter path (route B, touches all four providers). This is a **cost optimization, not a correctness fix**, and has higher blast radius. Recommendation: land Tasks 1-7 first (they deliver the goal — the prompt reaches the model), then do `cache_control` as a small dedicated follow-up (route A preferred: emit `params.system = [{type:'text',text:prefix,cache_control:{type:'ephemeral'}},{type:'text',text:suffix}]`, preserving the empty-block `.trim()` guards, in BOTH `complete()` and `stream()`). Tracked as Phase-1.5.

---

## Self-Review (plan vs. spec §5)

**Spec coverage:**
- §5.1(1) complete Task 29 (3 callers) → Tasks 3, 5, 6. ✅
- §5.1(2) assembler DB-backed + editable → Task 4. ✅ (personality section wiring deferred to Phase 2 with its re-authoring — noted; identity+core-rules editable now.)
- §5.1(3) wire null resolvers → Task 2. ✅
- §5.1(4) consolidate dual stack (one canonical seed) → Task 1 (constants are the single source; `getMasterPrompt` composes them). ✅
- §5.1(5) fix defects ($X, Hungarian, drift) → Task 1 ($X, Hungarian) + Task 7 (drift). ✅
- §5.1(6) prompt-cache → **deferred** with rationale (Phase-1.5). ⚠️ (documented, not silently dropped.)
- §5.2 acceptance criteria → covered by tests in Tasks 1-6 (non-empty canonical prompt per path; memory/team wiring; editability round-trip; no `$X`/Hungarian/duplicate seeds).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". Every code step shows complete code. The one judgment step (Task 6 Step 1 test) references the existing orchestrator test's fakes rather than inventing a DB — this is deliberate (reuse the established harness) and the assertion shape is fully specified.

**Type consistency:** `buildForPrimary(BuildOptions)` / `AssembledPrompt{prefix,suffix,reminders,...}` / `AgentRunOptions.systemPrompt` / `ConversationRunnerDeps.promptAssembler?` / `OrchestratorDeps.promptAssembler?` / `AssemblerDeps.resolveMasterSections` / `wizardService.getMasterSection(section)` — all names match across tasks. Section names use the **hyphenated** DB form (`'core-rules'`) in queries and camelCase (`coreRules`) only in the `resolveMasterSections` return object (matching `buildCachePrefix`'s `coreRules` input).

**Open coordination note:** the tightened `getAssembler` type (Task 3) and the removed boot-time re-sync (Task 4) may surface follow-on typecheck/test failures elsewhere; each task's Verify step catches them within that task's scope.
