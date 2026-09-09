# EYAS Prompt System — Phase 2 (Authored Content) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Now that Phase 1 made the authored prompt reach the model on every path, write the real proactive / human-like / self-improving content — the warm-distinctive base personality, per-agent proactive duties + self-improvement, seed-project operating briefs, and WHY-driven setup copy — and wire the personality section into the prompt.

**Architecture:** Content authoring across five surfaces plus the small wiring that makes the personality section render and the master seeds evolve cleanly on existing installs. Base text is DB-seeded/editable (Phase 1); a hash-set seed refresh propagates shipped-default changes to un-edited rows.

**Tech Stack:** Bun + TypeScript (strict, ESM), Drizzle over bun:sqlite, Vitest, Hono, React (setup UI).

## Global Constraints

- **NO version bump.** Version freeze in effect.
- **NO commits/pushes by the executor.** Per-task commits are authorized for THIS execution run (as in Phase 1): stage ONLY each task's files (`git add <file> …`, never `-A`/`-a`/`.`), NEVER stage `config/default.yaml` or `docs/`, commit subject conventional, **NO `Co-Authored-By`/attribution trailer**, do NOT push. Each task ends by committing then reporting.
- **Vendor-neutral English defaults.** No eyssen.com / Odoo / vendor coupling; product-identity eYssen references only. All shipped text in English.
- **Tests under `tests/**/*.test.ts`** (colocated src tests don't run). DB-touching tests: run `bun run node_modules/.bin/vitest run <path>` (plain `bunx vitest` fails to resolve `bun:sqlite` in this shell). Typecheck: `bun run lint` (= `tsc --noEmit`; there is no `typecheck` script).
- **Section-key convention (critical):** the DB `section` column is `'identity'`, `'core-rules'` (hyphenated!), `'personality'`. `getMasterSection('core-rules')`, `getMasterSection('personality')`.
- **Master rows:** `master-identity` (locked=1), `master-core-rules` (locked=1), `master-personality` (locked=0), all `created_by='system'`.
- **Specialist proactive duties stay strictly in-lane** (a delegated sub-agent must not scope-creep). The devils-advocate lens checks each duty for scope creep.

---

## File Structure

**Modified (source):**
- `src/modules/prompt-wizard/master-prompt.ts` — new warm-distinctive `DEFAULT_PERSONALITY` (exported const); static identity (drop header).
- `src/modules/prompt-wizard/core-identity.ts` — add the self-improvement clause to `CORE_IDENTITY`.
- `src/modules/prompt-wizard/cache-prefix-builder.ts` — `personality` input + `<default-personality>` tag.
- `src/modules/prompt-wizard/token-budget.ts` — `personality` in `SectionBudget` + `DEFAULT_BUDGET_FULL` + `shrinkForContextWindow`.
- `src/modules/prompt-wizard/assembler.ts` — `resolveMasterSections` returns `personality`; pass into prefix.
- `src/modules/prompt-wizard/index.ts` — `resolveMasterSections` personality + fallback; `resolveRuntime` version/ownerName; migration call site.
- `src/modules/prompt-wizard/cache-suffix-builder.ts` — `RuntimeContext.version?/ownerName?` + `<runtime>` render.
- `src/modules/prompt-wizard/seed-migration.ts` — rewrite to `refreshMasterSeedsFromKnownDefaults` (hash-set + legacy guards + personality).
- `src/modules/agent/agent-templates.ts` — 14 specialist proactive duties + self-improvement clause across templates.
- `src/modules/board/index.ts` — default-project operating brief + richer project-type prompts + UPDATE migration.
- `src/modules/auth/index.ts` — WHY-driven primary-agents copy.
- `src/modules/setup/index.ts` — fix `autoCompleteFromEnv` (`primary-agents`, both names).
- `src/modules/agent/team-bootstrap.ts` — `TeamTemplateInfo` + `listTeamTemplates` gain `agentType` + `defaultEnabled`.
- `src/web/src/pages/setup/setup-page.tsx` — remove dead voice-profiles branch + import.
- `src/web/src/pages/setup/team-agents-step.tsx` — source the list from `/api/v1/agents/templates`.

**Deleted:** `src/web/src/pages/setup/voice-step.tsx` (dead, Hungarian-hardcoded).

**New tests:** `tests/modules/prompt-wizard/personality-prefix.test.ts`, `tests/modules/prompt-wizard/seed-migration-hashset.test.ts`, `tests/modules/agent/template-proactive-duties.test.ts`, `tests/modules/board/seed-project-prompt.test.ts`, `tests/modules/setup/env-autocomplete.test.ts`, plus extend `tests/modules/agent/team-templates*.test.ts`.

---

## Task 1: Base personality + identity text, wired into the prefix

**Files:**
- Modify: `src/modules/prompt-wizard/master-prompt.ts`, `core-identity.ts`, `cache-prefix-builder.ts`, `token-budget.ts`, `assembler.ts`, `index.ts`, `cache-suffix-builder.ts`
- Test: `tests/modules/prompt-wizard/personality-prefix.test.ts`

**Interfaces produced:**
- `export const DEFAULT_PERSONALITY: string` (master-prompt.ts)
- `SectionBudget.personality: number`; `CachePrefixInput.personality: string`; `RuntimeContext.version?: string; ownerName?: string`
- `AssemblerDeps.resolveMasterSections: () => Promise<{ identity: string; coreRules: string; personality: string }>`

- [ ] **Step 1: Failing test** — `tests/modules/prompt-wizard/personality-prefix.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { buildCachePrefix } from '../../../src/modules/prompt-wizard/cache-prefix-builder.js'
import { DEFAULT_BUDGET_FULL } from '../../../src/modules/prompt-wizard/token-budget.js'
import { DEFAULT_PERSONALITY, getMasterPrompt } from '../../../src/modules/prompt-wizard/master-prompt.js'
import { CORE_IDENTITY } from '../../../src/modules/prompt-wizard/core-identity.js'
import { buildCacheSuffix } from '../../../src/modules/prompt-wizard/cache-suffix-builder.js'

const ws: any = {
  identity: { body: '' }, soulMd: { body: '' }, agentsMd: { body: '' }, toolsMd: { body: '' },
}
const cascade: any = { projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }

describe('personality in prefix', () => {
  it('emits a <default-personality> tag from the personality input', () => {
    const out = buildCachePrefix({ coreIdentity: 'ID', coreRules: 'RULES', personality: DEFAULT_PERSONALITY, workspace: ws, cascade, skillsList: [], toolsList: [], budget: DEFAULT_BUDGET_FULL })
    expect(out).toContain('<default-personality>')
    expect(out).toContain('sharp, warm teammate')
  })
  it('identity seed is static (no per-install EYAS header)', () => {
    const m = getMasterPrompt()
    expect(m.identity).toBe(CORE_IDENTITY)
    expect(m.identity).not.toMatch(/owner:/)
    expect(m.identity).toMatch(/reflect on what worked/i) // self-improvement clause present
    expect(m.personality).toBe(DEFAULT_PERSONALITY)
  })
  it('version + owner render in the <runtime> suffix', () => {
    const s = buildCacheSuffix({ team: null, memory: null, activeVoice: { scope: 'internal', reason: '', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }, runtime: { date: '2026-07-11', time: '10:00', channel: 'owner_dm', os: 'darwin', version: '9.9.9', ownerName: 'Ada' }, budget: DEFAULT_BUDGET_FULL })
    expect(s).toContain('9.9.9')
    expect(s).toContain('Ada')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`DEFAULT_PERSONALITY`/`getMasterPrompt()` no-arg/personality-in-prefix don't exist yet).
Run: `bun run node_modules/.bin/vitest run tests/modules/prompt-wizard/personality-prefix.test.ts`

- [ ] **Step 3: `master-prompt.ts` — new personality + static identity.** Replace `getMasterPrompt` (and export the personality const):

```ts
import { CORE_IDENTITY } from './core-identity.js'
import { CORE_RULES } from './core-rules.js'

export const DEFAULT_PERSONALITY = `## Default Personality

You're a sharp, warm teammate — not a corporate assistant.

- Lead with the answer; add the "why" only when it matters.
- Say things plainly, even when it stings. Skip the hedging and the flattery.
- Prefer doing over explaining, unless asked to explain.
- Proactive: when you see the next step, take it or name it — don't wait to be
  asked. Surface risks, blockers, and better options even when unprompted.
- Match depth to the task: one line for a small ask, real structure for a big one.
- Dry humor is fine when it lands; never forced.
- If you're unsure or can't verify something, say so. "I don't know" beats a
  confident guess.
- Respect the owner's time and budget: no filler, no repeating their words back,
  no explaining the obvious.`

export function getMasterPrompt(): MasterSections {
  return { identity: CORE_IDENTITY, coreRules: CORE_RULES, personality: DEFAULT_PERSONALITY }
}
```

Delete `MasterPromptParams` (now unused) and update its only import site (index.ts, Step 7). Keep `LOCKED_SECTIONS`.

- [ ] **Step 4: `core-identity.ts` — add the self-improvement clause.** Append inside the `CORE_IDENTITY` bullet list, before the closing backtick (after the "Act externally… don't drift." bullet):

```
- Get better over time. At the end of a task, briefly reflect on what worked and
  what didn't. When a tool or skill underperforms, or you hit avoidable friction,
  record it so it can be improved. When you keep hitting the same capability gap,
  propose a new skill or a refinement instead of silently working around it — but
  don't let this reflection bloat a simple task.
```

- [ ] **Step 5: `token-budget.ts` — add `personality`.** Add `personality: number` to `SectionBudget` (after `coreRules`); add `personality: 200` to `DEFAULT_BUDGET_FULL`; add `personality: DEFAULT_BUDGET_FULL.personality,` to the `scaled` object in `shrinkForContextWindow` (never-shrink group, next to coreRules).

- [ ] **Step 6: `cache-prefix-builder.ts` — render personality.** Add `personality: string` to `CachePrefixInput` (after `coreRules`). In `buildCachePrefix`, immediately after the core-rules `parts.push(...)`:

```ts
  parts.push(tag('default-personality', clipToBudget(input.personality, input.budget.personality).content))
```

- [ ] **Step 7: `assembler.ts` + `index.ts` + `cache-suffix-builder.ts` — thread it.**
  - `assembler.ts`: widen `resolveMasterSections` type to `() => Promise<{ identity: string; coreRules: string; personality: string }>`; in `buildForPrimary` add `personality: master.personality,` to the `buildCachePrefix({...})` call.
  - `index.ts`: in `resolveMasterSections` add `personality: svc?.getMasterSection?.('personality') ?? DEFAULT_PERSONALITY,` (import `DEFAULT_PERSONALITY` from `./master-prompt.js`); in `resolveRuntime` add `version: (ctx.config as any)?.version ?? '1.0.0',` and `ownerName: (ctx.config as any)?.ownerName ?? 'User',`; the seeding block now calls `getMasterPrompt()` with no args (remove the `masterParams` object; keep `now`).
  - `cache-suffix-builder.ts`: add `version?: string; ownerName?: string` to `RuntimeContext`; in the `<runtime>` render, guard-push before the date line: `if (input.runtime.version) runtimeLines.unshift(\`- EYAS version: ${input.runtime.version}\`)` and `if (input.runtime.ownerName) runtimeLines.unshift(\`- Owner: ${input.runtime.ownerName}\`)`.

- [ ] **Step 8: Run — expect PASS**, then update any prompt-wizard test that (a) asserted the `EYAS <version> — owner:` header in the prefix (moves to suffix), (b) mocks `resolveMasterSections` returning only `{identity,coreRules}` (add `personality`), (c) builds `buildCachePrefix`/`SectionBudget` literals missing `personality`. Run `bun run node_modules/.bin/vitest run tests/modules/prompt-wizard/` until green.

- [ ] **Step 9: Verify + commit.** `bun run lint`; `bun run node_modules/.bin/vitest run tests/modules/prompt-wizard/`. Stage the 7 source files + the new test. Commit `feat(prompt): warm-distinctive base personality wired into prefix; static identity + runtime owner/version`. Report. **No push.**

---

## Task 2: Seed evolution — hash-set refresh (§4.2)

**Files:** Modify `src/modules/prompt-wizard/seed-migration.ts`, `src/modules/prompt-wizard/index.ts`. Test: `tests/modules/prompt-wizard/seed-migration-hashset.test.ts`.
**Depends on:** Task 1 (the new seeds are the refresh target).

**Interfaces produced:** `export function refreshMasterSeedsFromKnownDefaults(db: any, currentSeeds: { identity: string; coreRules: string; personality: string }): void`

- [ ] **Step 1: Failing test** — `tests/modules/prompt-wizard/seed-migration-hashset.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createWizardService } from '../../../src/modules/prompt-wizard/wizard-service.js'
import { refreshMasterSeedsFromKnownDefaults } from '../../../src/modules/prompt-wizard/seed-migration.js'

function table(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS prompt_templates (id TEXT PRIMARY KEY, level TEXT NOT NULL, target_id TEXT, name TEXT NOT NULL, content TEXT NOT NULL, section TEXT, locked INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
}
function seed(db: any, id: string, section: string, content: string, locked = 1, by = 'system') {
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO prompt_templates (id, level, target_id, name, content, section, locked, is_active, created_by, created_at, updated_at) VALUES (${id}, 'master', NULL, ${id}, ${content}, ${section}, ${locked}, 1, ${by}, ${now}, ${now})`)
}
const CUR = { identity: 'NEW IDENTITY BODY', coreRules: 'NEW RULES', personality: 'NEW PERSONALITY' }

describe('refreshMasterSeedsFromKnownDefaults', () => {
  it('refreshes pre-consolidation legacy rows (substring markers)', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-identity', 'identity', 'EYAS 1.0 — owner: X — date: 2026-01-01\n\nYou are EYAS (Eyssen Your AI Suite), an assistant.')
    seed(db, 'master-core-rules', 'core-rules', '5. LANGUAGE: Communicate in Hungarian.')
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    const svc = createWizardService(db)
    expect(svc.getMasterSection('identity')).toBe('NEW IDENTITY BODY')
    expect(svc.getMasterSection('core-rules')).toBe('NEW RULES')
  })
  it('preserves owner edits (content not a known prior seed)', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-personality', 'personality', 'MY OWN VOICE', 0)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('personality')).toBe('MY OWN VOICE')
  })
  it('leaves an owner-edited identity row (locked, no marker) untouched', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-identity', 'identity', 'MY CUSTOM IDENTITY — owner tuned', 1)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('identity')).toBe('MY CUSTOM IDENTITY — owner tuned')
  })
  it('leaves an owner-edited core-rules row (locked, no marker) untouched', () => {
    const db = createMemoryDb(); table(db)
    seed(db, 'master-core-rules', 'core-rules', 'MY OWN RULES — house style', 1)
    refreshMasterSeedsFromKnownDefaults(db, CUR)
    expect(createWizardService(db).getMasterSection('core-rules')).toBe('MY OWN RULES — house style')
  })
})
```

(The Phase-1-canonical-body test cases are added in Step 3 once the known-prior seed strings are embedded.)

- [ ] **Step 2: Run — expect FAIL** (function renamed/not present).

- [ ] **Step 3: Rewrite `seed-migration.ts`.** Complete file:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/seed-migration.ts
// Refresh system-owned, locked master rows whose content is a KNOWN prior shipped
// default (by exact hash, or — for pre-consolidation legacy rows — by substring
// marker) to the current seed. Genuine owner edits (content not a known default)
// are never touched. Idempotent. The assembler reads these rows, and INSERT OR
// IGNORE never refreshes an existing row, so this is how shipped-default text
// evolution reaches an already-seeded DB.
import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'

const h = (s: string) => createHash('sha256').update(s).digest('hex')

// Verbatim bodies of every PRIOR shipped seed (add the previous version here on
// each future seed change). Identity is compared BODY-only (header stripped).
const PRIOR_IDENTITY_BODIES = [
  // Phase-1 canonical CORE_IDENTITY body (pre Phase-2 self-improvement clause):
  `You are EYAS, a self-hosted personal AI assistant platform. You act as an
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
  uncertain about your mission, ask the owner — don't drift.`,
]
const PRIOR_CORE_RULES = [
  // Phase-1 canonical CORE_RULES — paste the EXACT current core-rules.ts string here.
  // (The implementer copies the verbatim current CORE_RULES value at Task-2 time.)
]
const PRIOR_PERSONALITY = [
  // Phase-1 personality ("Concise and direct — lead with the answer, not the reasoning" …)
  `## Default Personality

- Concise and direct — lead with the answer, not the reasoning
- Proactive — surface the next concrete step, don't just wait for instructions
- Structured — use lists, tables, and clear formatting when they help
- Technical but approachable — match the owner's expertise level
- Honest about limitations — say "I'm not sure" rather than guessing
- Action-oriented — prefer doing over explaining, unless asked to explain
- Context-aware — adapt tone to the situation
- Respectful of time — if something can be said in one sentence, don't use three`,
]
const PRIOR_IDENTITY_HASHES = new Set(PRIOR_IDENTITY_BODIES.map(h))
const PRIOR_CORE_RULES_HASHES = new Set(PRIOR_CORE_RULES.map(h))
const PRIOR_PERSONALITY_HASHES = new Set(PRIOR_PERSONALITY.map(h))

// Pre-consolidation legacy substring markers (rows that never booted on Phase 1).
const LEGACY_IDENTITY_MARKER = 'Eyssen Your AI Suite'
const LEGACY_CORE_RULES_MARKER = 'Communicate in Hungarian'

function identityBody(content: string): string {
  // strip a leading "EYAS … — date: …\n\n" header if present
  const i = content.indexOf('\n\n')
  return i >= 0 && /^EYAS .*owner:/i.test(content) ? content.slice(i + 2) : content
}

export function refreshMasterSeedsFromKnownDefaults(
  db: any,
  currentSeeds: { identity: string; coreRules: string; personality: string },
): void {
  const now = new Date().toISOString()
  const rows = db.all(sql`SELECT id, section, content, locked, created_by FROM prompt_templates WHERE level='master' AND created_by='system'`) as any[]
  for (const r of rows) {
    let stale = false
    if (r.section === 'identity' && r.locked === 1) {
      stale = PRIOR_IDENTITY_HASHES.has(h(identityBody(r.content))) || r.content.includes(LEGACY_IDENTITY_MARKER)
      if (stale) db.run(sql`UPDATE prompt_templates SET content=${currentSeeds.identity}, updated_at=${now} WHERE id=${r.id}`)
    } else if (r.section === 'core-rules' && r.locked === 1) {
      stale = PRIOR_CORE_RULES_HASHES.has(h(r.content)) || r.content.includes(LEGACY_CORE_RULES_MARKER)
      if (stale) db.run(sql`UPDATE prompt_templates SET content=${currentSeeds.coreRules}, updated_at=${now} WHERE id=${r.id}`)
    } else if (r.section === 'personality') {
      stale = PRIOR_PERSONALITY_HASHES.has(h(r.content))
      if (stale) db.run(sql`UPDATE prompt_templates SET content=${currentSeeds.personality}, updated_at=${now} WHERE id=${r.id}`)
    }
  }
}
```

**Implementer note:** paste the EXACT current `CORE_RULES` string (from `core-rules.ts`, verbatim — see the Task-2 brief) into `PRIOR_CORE_RULES[0]` so its hash matches Phase-1-canonical core-rules rows.

- [ ] **Step 4: Wire the call site in `index.ts`.** Replace the `import { refreshStaleMasterSeeds }` with `import { refreshMasterSeedsFromKnownDefaults }`, and the call after the seeding loop with:

```ts
    refreshMasterSeedsFromKnownDefaults(ctx.db, { identity: master.identity, coreRules: master.coreRules, personality: master.personality })
```

- [ ] **Step 5: Add the hash-match test cases** (Phase-1-canonical body/rules/personality → refreshed; header-ful identity body match) to the test, run, and confirm the whole prompt-wizard suite green.

- [ ] **Step 6: Verify + commit.** `bun run lint`; `bun run node_modules/.bin/vitest run tests/modules/prompt-wizard/`. Commit `feat(prompt): hash-set master-seed refresh for shipped-default evolution`. Report. **No push.**

---

## Task 3: Seed-agent proactive duties + self-improvement (`agent-templates.ts`)

**Files:** Modify `src/modules/agent/agent-templates.ts`. Test: `tests/modules/agent/template-proactive-duties.test.ts`.

**Anchoring warning:** the 14 `## Ongoing proactive duties\n(none — invoked on-demand by parent agent)` blocks are BYTE-IDENTICAL. Do NOT `Edit` on that string (ambiguous). Edit each template by its unique line range (given below) or by anchoring on its unique preceding `## My mission` paragraph.

- [ ] **Step 1: Failing test** — `tests/modules/agent/template-proactive-duties.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { ALL_TEMPLATES } from '../../../src/modules/agent/agent-templates.js'

describe('seed template proactive duties + self-improvement', () => {
  it('no template still ships the placeholder "(none — invoked on-demand" duty', () => {
    for (const t of ALL_TEMPLATES) {
      const id = t.workspaceSeed?.identityMd ?? ''
      expect(id, t.id).not.toContain('(none — invoked on-demand by parent agent)')
    }
  })
  it('every template with a workspace seed has a self-improvement line', () => {
    for (const t of ALL_TEMPLATES) {
      if (!t.workspaceSeed) continue
      expect(t.workspaceSeed.identityMd.toLowerCase(), t.id).toMatch(/what would make the next run|reflect|get better/)
    }
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (placeholder still present in 14 templates).

- [ ] **Step 3: Replace each specialist's `(none …)` duty with a light, in-lane duty + append a shared self-improvement line.** For each template, the new `## Ongoing proactive duties` block is the domain duty below **plus** this shared self-improvement line as the final bullet:

`- After finishing, note in one line what would make the next run of this kind faster or better; if a tool or step repeatedly fails you, say so.`

Per-template domain duty (light, strictly in-lane — do NOT expand scope):
- **devils-advocate** (~336): `- Name the single biggest unstated assumption and one concrete failure mode the author likely hasn't considered — even if not asked.`
- **code-reviewer** (~412): `- Flag adjacent correctness/security risks within the changed code's blast radius, not only the lines you were pointed at — but stay inside the diff's scope.`
- **test-engineer** (~489): `- Surface the single highest-value missing test (an untested error path or edge case) alongside the coverage you were asked for.`
- **security-auditor** (~561): `- If you find a CRITICAL exploit path, stop and report it immediately; pair every finding with a concrete remediation.`
- **backend-developer** (~639): `- Before implementing, name any existing code you should reuse and one edge case the task left out; note it, then proceed.`
- **frontend-developer** (~712): `- Flag accessibility or responsive gaps in the UI you touch, and prefer existing design-system tokens over new CSS.`
- **technical-writer** (~778): `- Verify every code sample you write actually runs, and flag any section that contradicts current behavior.`
- **data-analyst** (~845): `- Show the query and the raw numbers behind every conclusion; say so when the data is too thin to support the ask.`
- **devops-engineer** (~916): `- Keep every change rollbackable and secrets out of source; production deploys ALWAYS need explicit owner approval.`
- **database-architect** (~987): `- State the reversibility of any schema change up front; destructive migrations require owner approval.`
- **api-designer** (~1059): `- Flag any inconsistency with existing /api/v1 conventions and any backward-incompatible change before finalizing.`
- **performance-engineer** (~1131): `- Measure before and after, change one variable at a time, and only claim a win above ~10%.`
- **product-owner** (~1203): `- Surface the unstated acceptance criterion or scope ambiguity that will bite later, before work starts.`
- **researcher** (~1227): `- Note the strongest source you found and one credible counter-point, even when the ask was narrow.`

(Primary templates `primary-assistant` and `system-engineer` already have real duties — leave those; only append the shared self-improvement line to their duty blocks for consistency.)

Also trim obviously redundant tone/style rules from each `systemPrompt` where the base personality + SOUL voice now carry them (e.g. generic "be concise", "be direct") — keep the substantive domain rubric. Light touch; if unsure, leave the rubric intact.

- [ ] **Step 4: Run — expect PASS.** Then run `bun run node_modules/.bin/vitest run tests/modules/agent/` to catch any template snapshot tests; update as needed.

- [ ] **Step 5: Verify + commit.** `bun run lint`. Commit `feat(agent): real in-lane proactive duties + self-improvement across seed templates`. Report. **No push.**

---

## Task 4: Seed-project operating brief (`board/index.ts`)

**Files:** Modify `src/modules/board/index.ts`. Test: `tests/modules/board/seed-project-prompt.test.ts`.

- [ ] **Step 1: Failing test** — assert that after running the board seed + migration against a memory DB, `projects.prompt` for `general-general` is non-null and contains the brief, and `project_types.prompt` for `general` is the richer text. (Follow `tests/modules/board/*.test.ts` for the existing board test-DB setup; extract the seed logic into a small exported `seedBoardDefaults(db, now)` if it eases testing, otherwise test via the service.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Give the default project a brief + add the `prompt` column to the INSERT.** In `seedProjects`, add to the `general-general` object:

```ts
        prompt: 'This is the owner\'s general workspace — the default home for everyday conversations and tasks. Prefer the internal board, memory, and knowledge base over external services. Keep work organized as tasks, capture decisions and findings in memory, and summarize outcomes when you finish.',
```

Add `prompt` to the projects INSERT column list and `${p.prompt ?? null}` to VALUES. Give the two project-types richer one-paragraph prompts (replace the one-liners at lines 103-122) — keep them generic/vendor-neutral.

- [ ] **Step 4: Add an UPDATE migration for existing installs** (INSERT OR IGNORE won't touch existing rows), guarded to seed source and empty/null current value so it never clobbers an owner edit:

```ts
      ctx.db.run(sql`UPDATE projects SET prompt=${GENERAL_BRIEF}, updated_at=${now} WHERE id='general-general' AND source='seed' AND (prompt IS NULL OR prompt='')`)
      ctx.db.run(sql`UPDATE project_types SET prompt=${GENERAL_TYPE_PROMPT} WHERE id='general' AND source='seed' AND prompt IN ('', 'General-purpose project for quick conversations and tasks.')`)
```

(Bind `GENERAL_BRIEF` / `GENERAL_TYPE_PROMPT` to the same literals used in the seed objects.)

- [ ] **Step 5: Run — expect PASS. Step 6: Verify + commit** `feat(board): real operating brief on the default project + richer type prompts`. Report. **No push.**

---

## Task 5: Setup wizard copy + dead-branch fixes

**Files:** Modify `src/modules/auth/index.ts`, `src/modules/setup/index.ts`, `src/modules/agent/team-bootstrap.ts`, `src/web/src/pages/setup/setup-page.tsx`, `src/web/src/pages/setup/team-agents-step.tsx`. Delete `src/web/src/pages/setup/voice-step.tsx`. Tests: `tests/modules/setup/env-autocomplete.test.ts`, extend team-templates test.

- [ ] **Step 1: Failing tests** — (a) `listTeamTemplates()[0]` includes `agentType` and `defaultEnabled`; (b) `autoCompleteFromEnv` with `EYAS_SETUP_AGENT_NAME` + `EYAS_SETUP_ENGINEER_NAME` set completes the `primary-agents` step (mock `setup.getStep`/`completeStep`, assert called with `{ assistantName, engineerName }`).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: WHY-driven primary-agents copy** (`auth/index.ts:84-94`, only title/description/labels/placeholders — leave onComplete):

```ts
      title: 'Your two always-on AI teammates',
      description: 'EYAS starts with two permanent agents you\'ll work with every day: a Personal Assistant for your general work, and a System Engineer that runs and maintains EYAS itself. Give them names — you can add optional specialists next.',
      required: true,
      order: 20,
      fields: [
        { name: 'assistantName', type: 'text', label: 'Personal Assistant — your day-to-day AI teammate', required: true, placeholder: 'e.g. Jarvis' },
        { name: 'engineerName', type: 'text', label: 'System Engineer — keeps EYAS itself healthy', required: true, placeholder: 'e.g. R2D2' },
      ],
```

- [ ] **Step 4: Fix `autoCompleteFromEnv`** (`setup/index.ts:66-77`):

```ts
  const assistantName = process.env.EYAS_SETUP_AGENT_NAME
  const engineerName = process.env.EYAS_SETUP_ENGINEER_NAME ?? assistantName
  if (assistantName) {
    const step = setup.getStep('primary-agents')
    if (step && step.status === 'pending') {
      try {
        await setup.completeStep('primary-agents', { assistantName, engineerName })
        logger.info('Setup: primary-agents auto-completed from environment variables')
      } catch (err: any) {
        logger.error(`Setup: primary-agents auto-complete failed: ${err.message}`)
      }
    }
  }
```

- [ ] **Step 5: Extend `TeamTemplateInfo` + `listTeamTemplates`** (`team-bootstrap.ts`) with `agentType: string` and `defaultEnabled: boolean` in the interface and both `.map()`s (`agentType: t.agentType, defaultEnabled: t.defaultEnabled`).

- [ ] **Step 6: Remove the dead voice-profiles branch** — delete `setup-page.tsx:7` import and the `currentStep.id === 'voice-profiles'` ternary arm (138-149); `git rm src/web/src/pages/setup/voice-step.tsx`.

- [ ] **Step 7: De-duplicate `team-agents-step.tsx`** — drop the hardcoded `RECOMMENDED`/`SPECIALISTS` consts; fetch `GET /api/v1/agents/templates` (useEffect + the app's `api.get`), map to `AgentOption` (`category = recommended ? 'recommended' : 'specialist'`), seed the initial selected Set from `defaultEnabled`. Keep the `onSubmit({ selectedAgents: ...join(',') })` CSV contract unchanged. Run `bun run --cwd src/web typecheck` (web) as well.

- [ ] **Step 8: Run — expect PASS** (backend tests). **Step 9: Verify + commit** `feat(setup): WHY-driven onboarding copy, fix env auto-complete, drop dead voice step, de-dup team list`. Report. **No push.**

---

## Task 6 (optional, may trail): Guidance docs realignment

Realign `config/skills/ai/prompting/*.md` + `config/skills/agent/agent-personas.md` to EYAS's real structures (IDENTITY.md sections, SOUL voice, blast-radius, DB-editable master sections) and add placeholder/help text on the agent-detail editor fields. Lower priority; can land after Tasks 1–5 or be deferred.

---

## Self-Review (plan vs. spec §4)

- §4.1 base text + personality prefix + static identity → Task 1. ✅
- §4.2 hash-set seed refresh → Task 2. ✅
- §4.3 seed-agent duties + self-improvement → Task 3 (all 14 duties drafted; anchoring warning included). ✅
- §4.4 seed-project brief → Task 4 (with existing-install UPDATE migration). ✅
- §4.5 setup copy + dead-branch + env + de-dup → Task 5. ✅
- §4.6 guidance docs → Task 6 (optional). ✅
- **Placeholder scan:** Task 2's `PRIOR_CORE_RULES[0]` is intentionally filled by the implementer with the verbatim current `CORE_RULES` (flagged, with the exact source) — not a vague TODO. Task 4/6 reference existing test setups by file; Task 3 gives every duty verbatim.
- **Type consistency:** `DEFAULT_PERSONALITY`, `SectionBudget.personality`, `CachePrefixInput.personality`, `resolveMasterSections … personality`, `RuntimeContext.version?/ownerName?`, `refreshMasterSeedsFromKnownDefaults`, `TeamTemplateInfo.agentType/defaultEnabled` — consistent across tasks.
- **Ordering:** Task 1 → Task 2 (needs new seeds) → 3/4/5 independent. Verify each with `bun run node_modules/.bin/vitest run` (DB tests) before its commit.
