# Effective-Context Inspector & Skill Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record what actually reached the model on every assembly, and turn that record into a skill inventory with a propose-only dead-skill detector.

**Architecture:** The prompt assembler stops discarding what it already computes. `clipToBudget` gains `droppedChars`; a `sectionCollector` captures each section as it is clipped and tagged, so the builders return `{ content, sections }` instead of a bare string. The manifest travels on `AssembledPrompt.sections`, is persisted once per assembly by an `observability` recorder, and each `ai_traces` row stores only an FK. Skill usage falls out of the same record — one write site, no second counter.

**Tech Stack:** Bun + TypeScript (strict, ESM), Drizzle over bun:sqlite, Hono, Zod, CASL, Vitest, React 19 + shadcn/ui + Tailwind, i18next.

**Spec:** `docs/superpowers/specs/2026-08-24-context-inspector-skill-inventory-design.md`

## Global Constraints

- **License:** MIT-compatible dependencies only. This plan adds **no** new dependency.
- **File headers:** every new `.ts`/`.tsx` file starts with `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- **Language:** code and comments in English.
- **i18n:** every new user-facing string exists in **all six** locales — `en`, `hu`, `de`, `es`, `fr`, `tlh`. CI fails on a missing key.
- **Logging:** Pino via `ctx.logger`. Never `console.log`.
- **API:** all routes under `/api/v1`, Zod-validated, `requirePermission(...)`, registered in the deny-by-default matcher in `src/modules/auth/routes.ts`.
- **CSS:** CSS variables only, never hardcoded colors.
- **DDL convention:** raw `CREATE TABLE IF NOT EXISTS` + idempotent `try { ALTER TABLE ... } catch {}` in `onRegister`, mirrored by a Drizzle `schema.ts` for typing. Follow `src/modules/skills/index.ts:19-50`.
- **Git:** do NOT commit, branch, or push. The `Commit` steps below are deliberately omitted from every task; the owner commits.
- **Tests:** Vitest, in-memory SQLite with the real DDL. Run with `bun run test`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/modules/prompt-wizard/section-collector.ts` | Clip + tag + record a section as one operation. The only place a section is born. |
| `src/modules/observability/context-recorder.ts` | Persist a composition + its sections; bump skill counters. Single write site. |
| `src/modules/observability/context-schema.ts` | DDL for `context_compositions`, `context_sections`, `context_section_daily`. |
| `src/modules/observability/context-routes.ts` | Composition read APIs. |
| `src/modules/skills/skill-inventory.ts` | Precedence resolution, shadowing, orphan detection, inventory query. |
| `src/modules/skills/classify-skill.ts` | **Owner-reviewable policy.** Category decision from usage + provenance. |
| `src/modules/skills/dead-skill-detector.ts` | Runs `classifySkill` over the inventory, enqueues approvals. |
| `src/web/src/pages/conversations/composition-panel.tsx` | ContextBar drill-down. |
| `src/web/src/pages/observability/context-tab.tsx` | Section trend / truncation / estimate-vs-actual. |
| `src/web/src/pages/skills/inventory-view.tsx` | Resolution table. |

**Modified:**

| File | Change |
|---|---|
| `src/modules/prompt-wizard/token-budget.ts:72-76` | `clipToBudget` returns `droppedChars`. |
| `src/modules/prompt-wizard/types.ts:87-94` | `ContextSection`; `AssembledPrompt.sections`. |
| `src/modules/prompt-wizard/cache-prefix-builder.ts` | Returns `{ content, sections }` via the collector. |
| `src/modules/prompt-wizard/cache-suffix-builder.ts` | Same. |
| `src/modules/prompt-wizard/assembler.ts:59-93` | Merges prefix + suffix sections onto the result. |
| `src/modules/conversations/system-prompt.ts` | Returns `{ system, sections, entryPoint, assemblerError }`. |
| `src/modules/conversations/routes.ts:639,665-668,689,730-734` | Append sites register sections. |
| `src/modules/observability/index.ts` | Creates tables, exposes `contextRecorder`, mounts routes. |
| `src/modules/observability/trace-collector.ts:45-50,399-417,454-472` | Stores `composition_id`. |
| `src/modules/skills/index.ts:19-50` | Provenance columns, new tables, indexes. |
| `src/modules/skills/schema.ts` | Drizzle mirror of the new columns. |
| `src/modules/skills/skill-loader.ts:30-86,144-149` | Hardening, provenance, precedence, `setEnabled`. |
| `src/modules/skills/routes.ts` | Inventory + dead-candidates + PATCH enabled. |
| `src/web/src/pages/conversations/context-bar.tsx` | Clickable, correct numerator. |
| `src/web/src/pages/skills/skills-page.tsx` | Inventory view mode. |
| locales ×6 in `observability/`, `skills/`, `conversations/` | New keys. |

---

# Phase 1 — Record

### Task 1: `clipToBudget` reports what it dropped

**Files:**
- Modify: `src/modules/prompt-wizard/token-budget.ts:72-76`
- Test: `tests/modules/prompt-wizard/token-budget.test.ts`

**Interfaces:**
- Produces: `clipToBudget(text: string, tokenBudget: number): { content: string; truncated: boolean; droppedChars: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { clipToBudget } from '@modules/prompt-wizard/token-budget'

describe('clipToBudget droppedChars', () => {
  it('reports zero when the text fits', () => {
    const r = clipToBudget('short', 100)
    expect(r).toEqual({ content: 'short', truncated: false, droppedChars: 0 })
  })

  it('reports the number of source characters cut', () => {
    const text = 'x'.repeat(500)
    const r = clipToBudget(text, 100) // charBudget = 400
    expect(r.truncated).toBe(true)
    expect(r.droppedChars).toBe(100)
    expect(r.content.startsWith('x'.repeat(400))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/prompt-wizard/token-budget.test.ts`
Expected: FAIL — `droppedChars` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

```ts
export function clipToBudget(
  text: string,
  tokenBudget: number,
): { content: string; truncated: boolean; droppedChars: number } {
  const charBudget = tokenBudget * APPROX_CHARS_PER_TOKEN
  if (text.length <= charBudget) return { content: text, truncated: false, droppedChars: 0 }
  return {
    content: text.slice(0, charBudget) + '\n\n[truncated — section budget]',
    truncated: true,
    droppedChars: text.length - charBudget,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/modules/prompt-wizard/token-budget.test.ts`
Expected: PASS. `droppedChars` counts **source** characters removed, not the net length change — the truncation marker is added on purpose and is not a "dropped" character.

---

### Task 2: The section collector

**Files:**
- Create: `src/modules/prompt-wizard/section-collector.ts`
- Modify: `src/modules/prompt-wizard/types.ts` (append `ContextSection`)
- Test: `tests/modules/prompt-wizard/section-collector.test.ts`

**Interfaces:**
- Consumes: `clipToBudget`, `estimateTokens` from Task 1's file.
- Produces:
  - `interface ContextSection { zone: 'prefix'|'suffix'|'reminder'|'append'; key: string; sourceRef?: string; content: string; chars: number; estimatedTokens: number; budgetTokens?: number; truncated: boolean; droppedChars: number }`
  - `createSectionCollector(zone): { sections: ContextSection[]; push(tagName, raw, budgetTokens?, sourceRef?): string }`

- [ ] **Step 1: Add the type to `types.ts`**

Append to `src/modules/prompt-wizard/types.ts`:

```ts
/** One context section as it appears in the assembled prompt. */
export interface ContextSection {
  zone: 'prefix' | 'suffix' | 'reminder' | 'append'
  /** Tag name as it appears in the prompt, e.g. 'core-identity', 'skill'. */
  key: string
  /** Skill id, file path, project id — whatever identifies the concrete source. */
  sourceRef?: string
  /** The FINAL rendered text, tags included, exactly as concatenated into the prompt. */
  content: string
  chars: number
  estimatedTokens: number
  /** The cap that applied; undefined for unbudgeted appends. */
  budgetTokens?: number
  truncated: boolean
  droppedChars: number
}
```

Then extend `AssembledPrompt` (currently `types.ts:87-94`) with one field:

```ts
export interface AssembledPrompt {
  prefix: string
  suffix: string
  reminders: string[]
  cacheBoundaryHint: number
  prefixHash: string
  tokenEstimate: { prefix: number; suffix: number; reminders: number }
  /** Per-section manifest of everything above. Concatenating `content` in order
   *  reproduces `prefix` and `suffix` byte-for-byte. */
  sections: ContextSection[]
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { createSectionCollector } from '@modules/prompt-wizard/section-collector'

describe('createSectionCollector', () => {
  it('returns the rendered tag and records the section', () => {
    const c = createSectionCollector('prefix')
    const out = c.push('core-identity', 'I am EYAS.', 200)
    expect(out).toBe('<core-identity>\nI am EYAS.\n</core-identity>\n\n')
    expect(c.sections).toHaveLength(1)
    expect(c.sections[0]).toMatchObject({
      zone: 'prefix', key: 'core-identity', content: out,
      chars: out.length, truncated: false, droppedChars: 0, budgetTokens: 200,
    })
  })

  it('records nothing and returns empty string for blank content', () => {
    const c = createSectionCollector('prefix')
    expect(c.push('agent-notes', '   ', 100)).toBe('')
    expect(c.sections).toHaveLength(0)
  })

  it('carries truncation through', () => {
    const c = createSectionCollector('suffix')
    c.push('memory-context', 'y'.repeat(500), 100)
    expect(c.sections[0].truncated).toBe(true)
    expect(c.sections[0].droppedChars).toBe(100)
  })

  it('treats an undefined budget as unbudgeted', () => {
    const c = createSectionCollector('append')
    c.push('skill', 'z'.repeat(5000), undefined, 'my-skill-id')
    expect(c.sections[0]).toMatchObject({
      truncated: false, droppedChars: 0, budgetTokens: undefined, sourceRef: 'my-skill-id',
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test tests/modules/prompt-wizard/section-collector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/section-collector.ts
// Clipping, tagging and recording a context section is ONE operation. Keeping
// them together is what stops the manifest from drifting from the prompt: the
// recorded `content` is literally the string returned into the prompt.
import type { ContextSection } from './types.js'
import { clipToBudget, estimateTokens } from './token-budget.js'

export interface SectionCollector {
  sections: ContextSection[]
  /**
   * Clip `raw` to `budgetTokens` (or leave it alone when undefined), wrap it in
   * `<tagName>`, record it, and return the rendered string for the prompt.
   * Blank content records nothing and returns '' — matching the previous
   * `tag()` behaviour so concatenation stays byte-identical.
   */
  push(tagName: string, raw: string, budgetTokens?: number, sourceRef?: string): string
}

export function createSectionCollector(zone: ContextSection['zone']): SectionCollector {
  const sections: ContextSection[] = []

  function push(tagName: string, raw: string, budgetTokens?: number, sourceRef?: string): string {
    const clipped =
      budgetTokens === undefined
        ? { content: raw, truncated: false, droppedChars: 0 }
        : clipToBudget(raw, budgetTokens)

    if (!clipped.content.trim()) return ''

    const rendered = `<${tagName}>\n${clipped.content.trim()}\n</${tagName}>\n\n`
    sections.push({
      zone,
      key: tagName,
      sourceRef,
      content: rendered,
      chars: rendered.length,
      estimatedTokens: estimateTokens(rendered),
      budgetTokens,
      truncated: clipped.truncated,
      droppedChars: clipped.droppedChars,
    })
    return rendered
  }

  return { sections, push }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test tests/modules/prompt-wizard/section-collector.test.ts`
Expected: PASS.

---

### Task 3: Prefix builder returns a manifest

**Files:**
- Modify: `src/modules/prompt-wizard/cache-prefix-builder.ts` (whole file)
- Test: `tests/modules/prompt-wizard/cache-prefix-builder.test.ts`

**Interfaces:**
- Consumes: `createSectionCollector` (Task 2).
- Produces: `buildCachePrefix(input: CachePrefixInput): { content: string; sections: ContextSection[] }`

- [ ] **Step 1: Write the failing byte-equality test**

This is the load-bearing test of the whole feature. It proves the manifest cannot lie.

```ts
import { describe, it, expect } from 'vitest'
import { buildCachePrefix } from '@modules/prompt-wizard/cache-prefix-builder'
import { DEFAULT_BUDGET_FULL } from '@modules/prompt-wizard/token-budget'

function workspace(over: Record<string, string> = {}) {
  const file = (body: string) => ({ body, truncated: false, path: '', exists: true })
  return {
    identity: file(over.identity ?? 'Identity body'),
    soulMd: file(over.soul ?? 'Soul body'),
    agentsMd: file(over.agents ?? 'Agent notes'),
    toolsMd: file(over.tools ?? 'Tool notes'),
  } as any
}

const baseInput = {
  coreIdentity: 'Core identity text',
  coreRules: 'Core rules text',
  personality: 'Personality text',
  workspace: workspace(),
  cascade: { projectTypeAgents: 'PT body', projectAgents: 'P body', projectTypeId: 'pt1', projectId: 'p1' } as any,
  skillsList: [{ name: 'alpha', oneLine: 'does alpha' }],
  toolsList: [{ name: 'bash', oneLine: 'runs commands' }],
  budget: DEFAULT_BUDGET_FULL,
}

describe('buildCachePrefix manifest', () => {
  it('sections concatenate back to the prompt byte-for-byte', () => {
    const { content, sections } = buildCachePrefix(baseInput)
    const rebuilt = sections.map((s) => s.content).join('').trimEnd() + '\n'
    expect(rebuilt).toBe(content)
  })

  it('records every emitted section in prompt order', () => {
    const { sections } = buildCachePrefix(baseInput)
    expect(sections.map((s) => s.key)).toEqual([
      'core-identity', 'core-rules', 'default-personality', 'project-context',
      'agent-identity', 'agent-voice', 'agent-notes', 'agent-env-notes',
      'available-skills', 'available-tools',
    ])
    expect(sections.every((s) => s.zone === 'prefix')).toBe(true)
  })

  it('omits blank optional sections from the manifest', () => {
    const { sections } = buildCachePrefix({ ...baseInput, workspace: workspace({ agents: '', tools: '' }) })
    expect(sections.map((s) => s.key)).not.toContain('agent-notes')
    expect(sections.map((s) => s.key)).not.toContain('agent-env-notes')
  })

  it('flags a truncated section and reports the loss', () => {
    const { sections } = buildCachePrefix({ ...baseInput, coreRules: 'r'.repeat(4000) })
    const rules = sections.find((s) => s.key === 'core-rules')!
    expect(rules.truncated).toBe(true)
    expect(rules.droppedChars).toBe(4000 - DEFAULT_BUDGET_FULL.coreRules * 4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/prompt-wizard/cache-prefix-builder.test.ts`
Expected: FAIL — `buildCachePrefix` returns a string, so destructuring yields `undefined`.

- [ ] **Step 3: Rewrite the builder**

Replace the body of `buildCachePrefix` (`cache-prefix-builder.ts:24-72`) and delete the now-unused local `tag()` (`:19-22`):

```ts
import type { ContextSection } from './types.js'
import { createSectionCollector } from './section-collector.js'

export function buildCachePrefix(input: CachePrefixInput): { content: string; sections: ContextSection[] } {
  const c = createSectionCollector('prefix')
  const parts: string[] = []

  parts.push(c.push('core-identity', input.coreIdentity, input.budget.coreIdentity))
  parts.push(c.push('core-rules', input.coreRules, input.budget.coreRules))
  parts.push(c.push('default-personality', input.personality, input.budget.personality))

  if (input.cascade.projectTypeAgents || input.cascade.projectAgents) {
    const cascadeParts: string[] = []
    if (input.cascade.projectTypeAgents) {
      cascadeParts.push(`<source name="project-type" id="${input.cascade.projectTypeId ?? ''}">`)
      cascadeParts.push(input.cascade.projectTypeAgents.trim())
      cascadeParts.push('</source>')
    }
    if (input.cascade.projectAgents) {
      cascadeParts.push(`<source name="project" id="${input.cascade.projectId ?? ''}">`)
      cascadeParts.push(input.cascade.projectAgents.trim())
      cascadeParts.push('</source>')
    }
    parts.push(
      c.push('project-context', cascadeParts.join('\n'), input.budget.projectCascade, input.cascade.projectId ?? undefined),
    )
  }

  parts.push(c.push('agent-identity', input.workspace.identity.body, input.budget.identityMd))
  parts.push(c.push('agent-voice', input.workspace.soulMd.body, input.budget.soulMd))
  parts.push(c.push('agent-notes', input.workspace.agentsMd.body, input.budget.agentsMd))
  parts.push(c.push('agent-env-notes', input.workspace.toolsMd.body, input.budget.toolsMd))

  if (input.skillsList.length > 0) {
    const skillsLines = ['The following skills are available to invoke:']
    for (const s of input.skillsList) skillsLines.push(`- ${s.name}: ${s.oneLine}`)
    skillsLines.push('Full skill content is loaded on-demand via `skill_load(name)`.')
    parts.push(c.push('available-skills', skillsLines.join('\n'), input.budget.skillsList))
  }

  if (input.toolsList.length > 0) {
    const toolsLines = ['The following tools are available:']
    for (const t of input.toolsList) toolsLines.push(`- ${t.name}: ${t.oneLine}`)
    toolsLines.push('Full tool schemas are delivered via the provider native tool API.')
    parts.push(c.push('available-tools', toolsLines.join('\n'), input.budget.toolsList))
  }

  return { content: parts.join('').trimEnd() + '\n', sections: c.sections }
}
```

Note: the `if (body.trim())` guards that used to wrap `agent-notes` and `agent-env-notes` (`:50-55`) are gone because `push` already returns `''` for blank content — same output, one less branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/modules/prompt-wizard/cache-prefix-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full prompt-wizard suite for regressions**

Run: `bun run test tests/modules/prompt-wizard/`
Expected: any failure here is a caller still expecting a string — fix it in Task 5, not now. Note which tests fail.

---

### Task 4: Suffix builder returns a manifest

**Files:**
- Modify: `src/modules/prompt-wizard/cache-suffix-builder.ts:80-164`
- Test: `tests/modules/prompt-wizard/cache-suffix-builder.test.ts`

**Interfaces:**
- Produces: `buildCacheSuffix(input: CacheSuffixInput): { content: string; sections: ContextSection[] }`

- [ ] **Step 1: Write the failing byte-equality test**

```ts
import { describe, it, expect } from 'vitest'
import { buildCacheSuffix } from '@modules/prompt-wizard/cache-suffix-builder'
import { DEFAULT_BUDGET_FULL } from '@modules/prompt-wizard/token-budget'

const voice = {
  scope: 'internal' as const,
  reason: 'default',
  profile: {
    address: 'tegező', tone: 'kiegyensúlyozott', verbosity: 'lényegre törő',
    directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha',
    blockedPhrases: [], signature: '',
  } as any,
}

const baseInput = {
  team: null, memory: null, codeSearch: null, workingDirectories: null,
  runtime: { date: '2026-08-24', time: '10:00', channel: 'web', os: 'darwin' } as any,
  activeVoice: voice,
  budget: DEFAULT_BUDGET_FULL,
}

describe('buildCacheSuffix manifest', () => {
  it('sections concatenate back to the prompt byte-for-byte', () => {
    const { content, sections } = buildCacheSuffix(baseInput)
    expect(sections.map((s) => s.content).join('').trimEnd() + '\n').toBe(content)
  })

  it('always emits runtime and active-voice', () => {
    const { sections } = buildCacheSuffix(baseInput)
    expect(sections.map((s) => s.key)).toEqual(['runtime', 'active-voice'])
    expect(sections.every((s) => s.zone === 'suffix')).toBe(true)
  })

  it('includes optional sections when present, in order', () => {
    const { content, sections } = buildCacheSuffix({
      ...baseInput,
      memory: { workingMemory: [{ content: 'remember this' }], goalAncestry: 'root > child' } as any,
      workingDirectories: { primary: '/repo', extra: ['/other'] } as any,
    })
    expect(sections.map((s) => s.key)).toEqual(['memory-context', 'working-directories', 'runtime', 'active-voice'])
    expect(sections.map((s) => s.content).join('').trimEnd() + '\n').toBe(content)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/prompt-wizard/cache-suffix-builder.test.ts`
Expected: FAIL — returns a string.

- [ ] **Step 3: Rewrite `buildCacheSuffix`**

Same transformation as Task 3: create `const c = createSectionCollector('suffix')`, replace every `parts.push(tag(NAME, clipToBudget(RAW, BUDGET).content))` with `parts.push(c.push(NAME, RAW, BUDGET))`, and return `{ content: parts.join('').trimEnd() + '\n', sections: c.sections }`.

Mapping, in the file's existing order:

| Line | Old | New |
|---|---|---|
| `:88` | `tag('team-context', clipToBudget(lines.join('\n'), input.budget.teamContext).content)` | `c.push('team-context', lines.join('\n'), input.budget.teamContext, input.team.teamSessionId)` |
| `:98` | `tag('memory-context', …memoryContext…)` | `c.push('memory-context', lines.join('\n'), input.budget.memoryContext)` |
| `:127` | `tag('code-search-context', …budget…)` | `c.push('code-search-context', lines.join('\n'), budget)` — keep the `(input.budget as any).codeSearchContext ?? input.budget.memoryContext` fallback at `:126` |
| `:144` | `tag('working-directories', …budget…)` | `c.push('working-directories', lines.join('\n'), budget)` — keep the `:143` fallback |
| `:159` | `tag('runtime', …runtime…)` | `c.push('runtime', runtimeLines.join('\n'), input.budget.runtime)` |
| `:161` | `tag('active-voice', …activeVoice…)` | `c.push('active-voice', renderActiveVoice(...), input.budget.activeVoice)` |

Delete the local `tag()` helper once unused.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/modules/prompt-wizard/cache-suffix-builder.test.ts`
Expected: PASS.

---

### Task 5: Assembler carries the manifest

**Files:**
- Modify: `src/modules/prompt-wizard/assembler.ts:59-93`
- Test: `tests/modules/prompt-wizard/assembler.test.ts`

**Interfaces:**
- Produces: `AssembledPrompt.sections` populated with prefix sections followed by suffix sections.

- [ ] **Step 1: Write the failing test**

```ts
it('carries a manifest that rebuilds prefix and suffix', async () => {
  const assembled = await assembler.buildForPrimary({
    agentId: 'a1', agentName: 'a1', conversationId: null, projectId: null, channelContext: null,
  })
  const prefixSections = assembled.sections.filter((s) => s.zone === 'prefix')
  const suffixSections = assembled.sections.filter((s) => s.zone === 'suffix')
  expect(prefixSections.map((s) => s.content).join('').trimEnd() + '\n').toBe(assembled.prefix)
  expect(suffixSections.map((s) => s.content).join('').trimEnd() + '\n').toBe(assembled.suffix)
  expect(assembled.sections).toBe(
    [...prefixSections, ...suffixSections] as any,
  ) // order: all prefix, then all suffix
})
```

Replace the last assertion with an order check that does not compare identity:

```ts
  expect(assembled.sections.map((s) => s.zone)).toEqual([
    ...prefixSections.map(() => 'prefix'), ...suffixSections.map(() => 'suffix'),
  ])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/prompt-wizard/assembler.test.ts`
Expected: FAIL — `sections` undefined.

- [ ] **Step 3: Update the assembler**

In `assembler.ts`, change lines 59-93:

```ts
    const prefixResult = buildCachePrefix({
      coreIdentity: master.identity,
      coreRules: master.coreRules,
      personality: master.personality,
      workspace: ws,
      cascade,
      skillsList: skills,
      toolsList: tools,
      budget,
    })

    const suffixResult = buildCacheSuffix({
      team,
      memory,
      codeSearch,
      workingDirectories,
      runtime: deps.resolveRuntime(),
      activeVoice: voice,
      budget,
    })

    const prefix = prefixResult.content
    const suffix = suffixResult.content
    const prefixHash = createHash('sha256').update(prefix).digest('hex')

    return {
      prefix,
      suffix,
      reminders: [],
      cacheBoundaryHint: prefix.length,
      prefixHash,
      tokenEstimate: {
        prefix: estimateTokens(prefix),
        suffix: estimateTokens(suffix),
        reminders: 0,
      },
      sections: [...prefixResult.sections, ...suffixResult.sections],
    }
```

Add `import type { ContextSection } from './types.js'` if the file needs it for typing.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/modules/prompt-wizard/`
Expected: PASS, including the tests noted as failing in Task 3 Step 5.

---

### Task 6: The conversation path stops throwing the manifest away

**Files:**
- Modify: `src/modules/conversations/system-prompt.ts` (whole file)
- Test: `tests/modules/conversations/system-prompt.test.ts`

**Interfaces:**
- Produces: `resolveConversationSystemPrompt(args): Promise<{ system: string; sections: ContextSection[]; entryPoint: 'conversation' | 'unassembled'; assemblerError?: string }>`

This partially delivers the already-approved decision at `eyas-prompt-system-design.md:144` (the `AssembledPrompt` must not be silently flattened).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolveConversationSystemPrompt } from '@modules/conversations/system-prompt'

const assembled = {
  prefix: '<core-identity>\nI am EYAS.\n</core-identity>\n',
  suffix: '<runtime>\n- Current date: 2026-08-24\n</runtime>\n',
  reminders: [],
  cacheBoundaryHint: 0, prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 },
  sections: [
    { zone: 'prefix', key: 'core-identity', content: 'c', chars: 1, estimatedTokens: 1, truncated: false, droppedChars: 0 },
    { zone: 'suffix', key: 'runtime', content: 'r', chars: 1, estimatedTokens: 1, truncated: false, droppedChars: 0 },
  ],
} as any

const okAssembler = { buildForPrimary: async () => assembled } as any

describe('resolveConversationSystemPrompt', () => {
  it('returns the flattened system plus the manifest', async () => {
    const r = await resolveConversationSystemPrompt({
      assembler: okAssembler, agentId: 'a1', projectId: null, conversationId: 'c1',
    })
    expect(r.system).toBe([assembled.prefix, assembled.suffix].join('\n\n'))
    expect(r.sections).toHaveLength(2)
    expect(r.entryPoint).toBe('conversation')
    expect(r.assemblerError).toBeUndefined()
  })

  it('records a body.system override as one section', async () => {
    const r = await resolveConversationSystemPrompt({
      bodySystem: 'OVERRIDE', assembler: okAssembler, agentId: 'a1', projectId: null, conversationId: 'c1',
    })
    expect(r.system).toBe('OVERRIDE')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.sections).toEqual([
      expect.objectContaining({ zone: 'append', key: 'body-system-override', content: 'OVERRIDE' }),
    ])
  })

  it('surfaces an assembler failure instead of swallowing it', async () => {
    const boom = { buildForPrimary: async () => { throw new Error('resolver exploded') } } as any
    const r = await resolveConversationSystemPrompt({
      assembler: boom, agentId: 'a1', projectId: null, conversationId: 'c1',
    })
    expect(r.system).toBe('')          // still fails soft
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toContain('resolver exploded')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/conversations/system-prompt.test.ts`
Expected: FAIL — the function returns a string.

- [ ] **Step 3: Rewrite the resolver**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/system-prompt.ts
// Resolves the interactive-chat system prompt: body.system override wins;
// otherwise assemble via the prompt assembler (with a fallback agentId) and
// compose the AssembledPrompt into a single string. Fails soft — never throws —
// so a missing agent/assembler degrades gracefully, but the failure is now
// RECORDED (assemblerError) instead of vanishing into a bare catch.
import type { PromptAssembler } from '@modules/prompt-wizard/assembler'
import type { ContextSection } from '@modules/prompt-wizard/types'
import { estimateTokens } from '@modules/prompt-wizard/token-budget'

interface ResolveArgs {
  bodySystem?: string
  assembler?: PromptAssembler
  agentId: string | null
  projectId: string | null
  conversationId: string
  fallbackAgentId?: () => string | null
}

export interface ResolvedSystemPrompt {
  system: string
  sections: ContextSection[]
  entryPoint: 'conversation' | 'unassembled'
  assemblerError?: string
}

function rawSection(key: string, content: string): ContextSection {
  return {
    zone: 'append',
    key,
    content,
    chars: content.length,
    estimatedTokens: estimateTokens(content),
    truncated: false,
    droppedChars: 0,
  }
}

export async function resolveConversationSystemPrompt(args: ResolveArgs): Promise<ResolvedSystemPrompt> {
  if (args.bodySystem) {
    return {
      system: args.bodySystem,
      sections: [rawSection('body-system-override', args.bodySystem)],
      entryPoint: 'unassembled',
    }
  }
  if (!args.assembler) {
    return { system: '', sections: [], entryPoint: 'unassembled', assemblerError: 'no assembler available' }
  }
  try {
    const agentId = args.agentId ?? args.fallbackAgentId?.() ?? null
    if (!agentId) {
      return { system: '', sections: [], entryPoint: 'unassembled', assemblerError: 'no agent resolved' }
    }
    const assembled = await args.assembler.buildForPrimary({
      agentId,
      agentName: agentId, // buildForPrimary does not read agentName today; id is a safe label
      conversationId: args.conversationId,
      projectId: args.projectId,
      channelContext: null,
    })
    const system = [assembled.prefix, assembled.suffix, ...assembled.reminders]
      .filter((s) => s.trim())
      .join('\n\n')
    return { system, sections: assembled.sections, entryPoint: 'conversation' }
  } catch (err) {
    return {
      system: '',
      sections: [],
      entryPoint: 'unassembled',
      assemblerError: err instanceof Error ? err.message : String(err),
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/modules/conversations/system-prompt.test.ts`
Expected: PASS.

---

### Task 7: Append sites register themselves

**Files:**
- Modify: `src/modules/conversations/routes.ts:639-647` (call site), `:649-672` (skill), `:687-690` (directive), `:696-736` (team nudge)
- Test: `tests/modules/conversations/routes.test.ts`

**Interfaces:**
- Consumes: `ResolvedSystemPrompt` (Task 6), `estimateTokens`.
- Produces: a local `sections: ContextSection[]` accumulated through the turn, handed to the recorder in Task 10.

- [ ] **Step 1: Update the call site**

Replace `routes.ts:639-647`:

```ts
    const resolved = await resolveConversationSystemPrompt({
      bodySystem: body.system,
      assembler: getAssembler?.(),
      agentId: (conv as any).agentId ?? null,
      projectId: (conv as any).projectId ?? null,
      conversationId: id,
      fallbackAgentId: () =>
        getBoard?.()?.projects.getWithStages((conv as any).projectId ?? '')?.defaultAgentId ?? null,
    })
    let system = resolved.system
    const contextSections: ContextSection[] = [...resolved.sections]
    const appendSection = (key: string, content: string, sourceRef?: string): void => {
      contextSections.push({
        zone: 'append',
        key,
        sourceRef,
        content,
        chars: content.length,
        estimatedTokens: estimateTokens(content),
        truncated: false,
        droppedChars: 0,
      })
    }
```

- [ ] **Step 2: Register the skill append**

Inside the `if (matches.length > 0 && matches[0].matchScore > 0.1)` block (`routes.ts:663`), after `system` is extended:

```ts
          activeSkill = true
          const skillBlock = `## Active Skill: ${matches[0].skill.name}\n\n${matches[0].skill.content}`
          system = system ? `${system}\n\n${skillBlock}` : skillBlock
          appendSection('skill', skillBlock, (matches[0].skill as any).id)
```

The matcher's `skill` object must carry `id`. Widen the `getSkills` type at `routes.ts:206` from `{ skill: { content: string; name: string }; matchScore: number }[]` to `{ skill: { id: string; content: string; name: string }; matchScore: number }[]`.

- [ ] **Step 3: Register the orchestration directive**

At `routes.ts:687-690`:

```ts
    const orchestrationDirective = buildOrchestrationDirective(orchestrationMode, providerId)
    if (orchestrationDirective) {
      system = system ? `${system}\n\n${orchestrationDirective}` : orchestrationDirective
      appendSection('orchestration-directive', orchestrationDirective, orchestrationMode)
    }
```

- [ ] **Step 4: Register the team nudge**

At each of the two nudge concatenation sites (`routes.ts:730` and `:734`), call `appendSection('team-nudge', <the appended text>, id)` immediately after the concatenation, using the same string that was appended.

- [ ] **Step 5: Write the test**

```ts
it('records the injected skill as an append section carrying its id', async () => {
  // Arrange a conversation whose message matches a seeded skill, POST a message,
  // then assert the recorded composition has a section { key: 'skill', sourceRef: <skill id> }.
  const rows = db.all(sql`SELECT key, source_ref FROM context_sections WHERE key = 'skill'`) as any[]
  expect(rows).toHaveLength(1)
  expect(rows[0].source_ref).toBe('test-skill')
})
```

This test can only pass after Task 10 wires the recorder. Mark it `it.skip` here and un-skip it in Task 10 Step 5.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: clean. The only expected breakages are callers of `resolveConversationSystemPrompt` — there is exactly one.

---

### Task 8: Composition tables

**Files:**
- Create: `src/modules/observability/context-schema.ts`
- Modify: `src/modules/observability/schema.ts:10-35` (add `composition_id`), `src/modules/observability/index.ts` (call the new DDL)
- Test: `tests/modules/observability/context-schema.test.ts`

**Interfaces:**
- Produces: `createContextTables(db: EyasDb): void`

- [ ] **Step 1: Write the implementation**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/observability/context-schema.ts
// Detail layer (context_compositions + context_sections) is short-retention and
// purged by the scheduler job; context_section_daily is the long-lived rollup.
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createContextTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS context_compositions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    conversation_id TEXT,
    run_id TEXT,
    agent_id TEXT,
    entry_point TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    context_window INTEGER NOT NULL DEFAULT 0,
    budget_total_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_tokens INTEGER NOT NULL DEFAULT 0,
    prefix_hash TEXT,
    section_count INTEGER NOT NULL DEFAULT 0,
    assembler_error TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS context_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    composition_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    zone TEXT NOT NULL,
    section_key TEXT NOT NULL,
    source_ref TEXT,
    chars INTEGER NOT NULL DEFAULT 0,
    estimated_tokens INTEGER NOT NULL DEFAULT 0,
    budget_tokens INTEGER,
    truncated INTEGER NOT NULL DEFAULT 0,
    dropped_chars INTEGER NOT NULL DEFAULT 0,
    content TEXT,
    content_hash TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS context_section_daily (
    day TEXT NOT NULL,
    section_key TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    sum_tokens INTEGER NOT NULL DEFAULT 0,
    max_tokens INTEGER NOT NULL DEFAULT 0,
    truncated_count INTEGER NOT NULL DEFAULT 0,
    sum_dropped_chars INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, section_key)
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_compositions_created ON context_compositions(created_at)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_compositions_conversation ON context_compositions(conversation_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_compositions_run ON context_compositions(run_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sections_composition ON context_sections(composition_id, ord)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sections_key ON context_sections(section_key)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sections_source_ref ON context_sections(source_ref)`)
}
```

In `observability/schema.ts`, after the `ai_traces` DDL, add the idempotent migration:

```ts
  try { db.run(sql`ALTER TABLE ai_traces ADD COLUMN composition_id TEXT`) } catch { /* already exists */ }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_traces_composition ON ai_traces(composition_id)`)
```

Call `createContextTables(ctx.db)` from `observability/index.ts` next to the existing `createObservabilityTables(ctx.db)` call.

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createContextTables } from '@modules/observability/context-schema'

describe('createContextTables', () => {
  let db: any
  beforeEach(() => { db = drizzle(new Database(':memory:')); createContextTables(db) })

  it('is idempotent', () => { expect(() => createContextTables(db)).not.toThrow() })

  it('creates all three tables', () => {
    const names = (db.all(sql`SELECT name FROM sqlite_master WHERE type='table'`) as any[]).map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['context_compositions', 'context_sections', 'context_section_daily']))
  })
})
```

- [ ] **Step 3: Run test**

Run: `bun run test tests/modules/observability/context-schema.test.ts`
Expected: PASS.

---

### Task 9: The context recorder

**Files:**
- Create: `src/modules/observability/context-recorder.ts`
- Test: `tests/modules/observability/context-recorder.test.ts`

**Interfaces:**
- Consumes: `ContextSection` (Task 2), `createContextTables` (Task 8).
- Produces: `createContextRecorder(db, logger): { record(input: RecordInput): string | null }` where

```ts
interface RecordInput {
  sections: ContextSection[]
  entryPoint: 'conversation' | 'background' | 'orchestrator-member' | 'unassembled'
  conversationId?: string | null
  runId?: string | null
  agentId?: string | null
  provider?: string | null
  model?: string | null
  contextWindow?: number
  budgetTotalTokens?: number
  prefixHash?: string | null
  assemblerError?: string | null
}
```
Returns the new `compositionId`, or `null` if recording failed (fail-open).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createContextTables } from '@modules/observability/context-schema'
import { createContextRecorder } from '@modules/observability/context-recorder'

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any

function section(over: Partial<any> = {}) {
  return {
    zone: 'prefix', key: 'core-identity', content: 'body', chars: 4,
    estimatedTokens: 1, truncated: false, droppedChars: 0, ...over,
  }
}

describe('createContextRecorder', () => {
  let db: any, recorder: any
  beforeEach(() => {
    db = drizzle(new Database(':memory:'))
    createContextTables(db)
    db.run(sql`CREATE TABLE skills (id TEXT PRIMARY KEY, use_count INTEGER DEFAULT 0, last_used_at TEXT)`)
    db.run(sql`CREATE TABLE skill_usage_daily (day TEXT, skill_id TEXT, injected_count INTEGER DEFAULT 0, PRIMARY KEY (day, skill_id))`)
    recorder = createContextRecorder(db, logger)
  })

  it('writes one composition and one row per section, in order', () => {
    const id = recorder.record({
      sections: [section(), section({ key: 'runtime', zone: 'suffix' })],
      entryPoint: 'conversation', conversationId: 'c1',
    })
    expect(id).toBeTruthy()
    const comp = (db.all(sql`SELECT * FROM context_compositions`) as any[])[0]
    expect(comp).toMatchObject({ entry_point: 'conversation', conversation_id: 'c1', section_count: 2 })
    const rows = db.all(sql`SELECT ord, section_key FROM context_sections ORDER BY ord`) as any[]
    expect(rows).toEqual([{ ord: 0, section_key: 'core-identity' }, { ord: 1, section_key: 'runtime' }])
  })

  it('sums estimated tokens onto the composition', () => {
    recorder.record({ sections: [section({ estimatedTokens: 10 }), section({ estimatedTokens: 5 })], entryPoint: 'conversation' })
    const comp = (db.all(sql`SELECT estimated_tokens FROM context_compositions`) as any[])[0]
    expect(comp.estimated_tokens).toBe(15)
  })

  it('updates the daily rollup', () => {
    recorder.record({ sections: [section({ estimatedTokens: 7, truncated: true, droppedChars: 20 })], entryPoint: 'conversation' })
    recorder.record({ sections: [section({ estimatedTokens: 3 })], entryPoint: 'conversation' })
    const r = (db.all(sql`SELECT * FROM context_section_daily WHERE section_key = 'core-identity'`) as any[])[0]
    expect(r).toMatchObject({ count: 2, sum_tokens: 10, max_tokens: 7, truncated_count: 1, sum_dropped_chars: 20 })
  })

  it('bumps skill counters for injected skills only', () => {
    db.run(sql`INSERT INTO skills (id, use_count) VALUES ('s1', 0)`)
    recorder.record({
      sections: [
        section({ key: 'available-skills' }),            // listing — NOT usage
        section({ zone: 'append', key: 'skill', sourceRef: 's1' }),
      ],
      entryPoint: 'conversation',
    })
    const s = (db.all(sql`SELECT use_count, last_used_at FROM skills WHERE id = 's1'`) as any[])[0]
    expect(s.use_count).toBe(1)
    expect(s.last_used_at).toBeTruthy()
    const usage = db.all(sql`SELECT * FROM skill_usage_daily`) as any[]
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ skill_id: 's1', injected_count: 1 })
  })

  it('fails open and returns null when the write throws', () => {
    const broken = { run() { throw new Error('db gone') }, all() { throw new Error('db gone') } } as any
    expect(createContextRecorder(broken, logger).record({ sections: [section()], entryPoint: 'conversation' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/observability/context-recorder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/observability/context-recorder.ts
// The ONLY write site for context composition data — and therefore the only
// write site for skill usage counters. One source of truth means the counter
// cannot drift from the composition record it is derived from.
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { ContextSection } from '@modules/prompt-wizard/types'

export type ContextEntryPoint = 'conversation' | 'background' | 'orchestrator-member' | 'unassembled'

export interface RecordInput {
  sections: ContextSection[]
  entryPoint: ContextEntryPoint
  conversationId?: string | null
  runId?: string | null
  agentId?: string | null
  provider?: string | null
  model?: string | null
  contextWindow?: number
  budgetTotalTokens?: number
  prefixHash?: string | null
  assemblerError?: string | null
}

export interface ContextRecorder {
  record(input: RecordInput): string | null
}

export function createContextRecorder(db: any, logger: any): ContextRecorder {
  function record(input: RecordInput): string | null {
    try {
      const id = generateId()
      const now = new Date().toISOString()
      const day = now.slice(0, 10)
      const estimated = input.sections.reduce((sum, s) => sum + s.estimatedTokens, 0)

      db.run(sql`INSERT INTO context_compositions
        (id, created_at, conversation_id, run_id, agent_id, entry_point, provider, model,
         context_window, budget_total_tokens, estimated_tokens, prefix_hash, section_count, assembler_error)
        VALUES (${id}, ${now}, ${input.conversationId ?? null}, ${input.runId ?? null},
                ${input.agentId ?? null}, ${input.entryPoint}, ${input.provider ?? null}, ${input.model ?? null},
                ${input.contextWindow ?? 0}, ${input.budgetTotalTokens ?? 0}, ${estimated},
                ${input.prefixHash ?? null}, ${input.sections.length}, ${input.assemblerError ?? null})`)

      input.sections.forEach((s, ord) => {
        const hash = createHash('sha256').update(s.content).digest('hex')
        db.run(sql`INSERT INTO context_sections
          (composition_id, ord, zone, section_key, source_ref, chars, estimated_tokens,
           budget_tokens, truncated, dropped_chars, content, content_hash)
          VALUES (${id}, ${ord}, ${s.zone}, ${s.key}, ${s.sourceRef ?? null}, ${s.chars},
                  ${s.estimatedTokens}, ${s.budgetTokens ?? null}, ${s.truncated ? 1 : 0},
                  ${s.droppedChars}, ${s.content}, ${hash})`)

        db.run(sql`INSERT INTO context_section_daily
          (day, section_key, count, sum_tokens, max_tokens, truncated_count, sum_dropped_chars)
          VALUES (${day}, ${s.key}, 1, ${s.estimatedTokens}, ${s.estimatedTokens},
                  ${s.truncated ? 1 : 0}, ${s.droppedChars})
          ON CONFLICT(day, section_key) DO UPDATE SET
            count = count + 1,
            sum_tokens = sum_tokens + ${s.estimatedTokens},
            max_tokens = MAX(max_tokens, ${s.estimatedTokens}),
            truncated_count = truncated_count + ${s.truncated ? 1 : 0},
            sum_dropped_chars = sum_dropped_chars + ${s.droppedChars}`)

        // Skill USAGE is injection only. The <available-skills> listing is not
        // usage: the model cannot act on it (no skill_load tool exists), so
        // counting it would keep every skill permanently "alive".
        if (s.key === 'skill' && s.sourceRef) {
          db.run(sql`UPDATE skills SET use_count = COALESCE(use_count, 0) + 1, last_used_at = ${now} WHERE id = ${s.sourceRef}`)
          db.run(sql`INSERT INTO skill_usage_daily (day, skill_id, injected_count)
            VALUES (${day}, ${s.sourceRef}, 1)
            ON CONFLICT(day, skill_id) DO UPDATE SET injected_count = injected_count + 1`)
        }
      })

      return id
    } catch (err) {
      logger.debug({ err }, 'context recording failed — continuing without a composition record')
      return null
    }
  }

  return { record }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/modules/observability/context-recorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Expose the recorder on the module context**

In `src/modules/observability/index.ts`, after `createContextTables(ctx.db)`:

```ts
    const contextRecorder = createContextRecorder(ctx.db, ctx.logger)
    ;(ctx as any).contextRecorder = contextRecorder
```

---

### Task 10: Wire the recorder and correlate traces

**Files:**
- Modify: `src/modules/conversations/routes.ts` (record + metadata), `src/modules/agent/agent-runner.ts:404` (metadata passthrough), `src/modules/observability/trace-collector.ts:45-50,399-417,454-472`
- Test: `tests/modules/conversations/routes.test.ts` (un-skip Task 7's test), `tests/modules/observability/trace-collector.test.ts`

**Interfaces:**
- Consumes: `contextRecorder.record` (Task 9).
- Produces: `request.metadata.compositionId: string | undefined`; `ai_traces.composition_id` populated.

- [ ] **Step 1: Record in the conversation path**

In `conversations/routes.ts`, immediately before building `runOptions` (`:791`):

```ts
    const compositionId = getContextRecorder?.()?.record({
      sections: contextSections,
      entryPoint: resolved.entryPoint,
      conversationId: id,
      agentId: (conv as any).agentId ?? null,
      provider: providerId,
      model: modelId,
      assemblerError: resolved.assemblerError ?? null,
    }) ?? null
```

Thread `getContextRecorder` in the same way `getSkills` is threaded (`conversations/index.ts:106`): `const getContextRecorder = () => (ctx as any).contextRecorder`.

Then add `compositionId` into the metadata passed to the runner, alongside the existing `conversationId`/`runId` metadata keys.

- [ ] **Step 2: Store the FK on the trace**

In `trace-collector.ts`, extend `resolveAttribution` (`:45-50`) to also read `request.metadata?.compositionId`, and pass it into both `insert` call sites (`:399-417`, `:454-472`) as `compositionId`. Add the column to the INSERT in `trace-collector.ts:143-160`.

- [ ] **Step 3: Write the correlation test**

```ts
it('stores the composition id from request metadata on the trace', async () => {
  await wrapped.complete({ ...baseRequest, metadata: { conversationId: 'c1', compositionId: 'comp-1' } })
  const row = (db.all(sql`SELECT composition_id FROM ai_traces`) as any[])[0]
  expect(row.composition_id).toBe('comp-1')
})
```

- [ ] **Step 4: Run the tests**

Run: `bun run test tests/modules/observability/ tests/modules/conversations/`
Expected: PASS.

- [ ] **Step 5: Un-skip Task 7 Step 5's test**

Change `it.skip` to `it` and run: `bun run test tests/modules/conversations/routes.test.ts`
Expected: PASS — the injected skill's id now reaches `context_sections.source_ref`.

---

### Task 11: Background, orchestrator and unassembled paths

**Files:**
- Modify: `src/modules/agent/conversation-runner.ts` (entryPoint `background`), `src/modules/agent/orchestrator.ts` (entryPoint `orchestrator-member`), `src/modules/agent/index.ts:490-508` (`executeAgent`), `src/modules/agent/god-mode/orchestrator.ts:271-280`
- Test: `tests/modules/agent/context-coverage.test.ts`

**Interfaces:**
- Consumes: `contextRecorder.record`, `estimateTokens`.

- [ ] **Step 1: Record assembled background/orchestrator paths**

Both already build an `AssembledPrompt`. Pass `assembled.sections` to `record()` with `entryPoint: 'background'` and `'orchestrator-member'` respectively, plus `prefixHash: assembled.prefixHash`, and thread the returned id into the request metadata as in Task 10.

- [ ] **Step 2: Record unassembled paths**

For `executeAgent` (`agent/index.ts:493`, raw `agentDef.systemPrompt`) and God Mode (`god-mode/orchestrator.ts:271-280`), record a single section:

```ts
const raw = agentDef.systemPrompt ?? ''
const compositionId = deps.contextRecorder?.record({
  sections: raw ? [{
    zone: 'append', key: 'raw-system', content: raw,
    chars: raw.length, estimatedTokens: estimateTokens(raw),
    truncated: false, droppedChars: 0,
  }] : [],
  entryPoint: 'unassembled',
  agentId: agentDef.id,
}) ?? null
```

- [ ] **Step 3: Write the coverage test**

```ts
it('records a composition for every entry point', () => {
  const rows = db.all(sql`SELECT DISTINCT entry_point FROM context_compositions`) as any[]
  expect(rows.map((r) => r.entry_point).sort()).toEqual(
    ['background', 'conversation', 'orchestrator-member', 'unassembled'],
  )
})
```

- [ ] **Step 4: Run the suite**

Run: `bun run test tests/modules/agent/ tests/modules/observability/`
Expected: PASS.

---

# Phase 2 — Inventory

### Task 12: Loader hardening

**Files:**
- Modify: `src/modules/skills/skill-loader.ts:30-86`
- Test: `tests/modules/skills/skill-loader.test.ts`

**Interfaces:**
- Produces: `loadFromDirectory(dir: string): Promise<ScanResult>` where
  `interface ScanResult { inserted: number; updated: number; shadowed: number; complete: boolean; error?: string }`

`complete` is the load-bearing field: **orphan detection (Task 15) must never run on `complete: false`.** One transient read error would otherwise mark every unseen skill as orphaned.

- [ ] **Step 1: Write the failing test**

```ts
it('reports a missing directory as complete with no work', async () => {
  const r = await loader.loadFromDirectory('/does/not/exist')
  expect(r).toMatchObject({ inserted: 0, updated: 0, shadowed: 0, complete: true })
})

it('marks the scan incomplete when a read fails mid-way', async () => {
  // one valid .md plus one unreadable path
  const r = await loader.loadFromDirectory(dirWithUnreadableFile)
  expect(r.complete).toBe(false)
  expect(r.error).toBeTruthy()
})

it('counts inserted and updated separately', async () => {
  const first = await loader.loadFromDirectory(dir)
  expect(first).toMatchObject({ inserted: 2, updated: 0 })
  const second = await loader.loadFromDirectory(dir)
  expect(second).toMatchObject({ inserted: 0, updated: 2 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/skills/skill-loader.test.ts`
Expected: FAIL — returns a number.

- [ ] **Step 3: Restructure the scan**

Split the single `try{}catch{}` (`:34-84`). Wrap only the `readdir` in its own try/catch that distinguishes `ENOENT`:

```ts
      let files: string[]
      try {
        files = (await readdir(dir, { recursive: true })).map((f) => (typeof f === 'string' ? f : String(f)))
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          logger.debug(`No skills directory at ${dir}`)
          return { inserted: 0, updated: 0, shadowed: 0, complete: true }
        }
        logger.error({ err, dir }, 'Skill scan failed to list directory')
        return { inserted: 0, updated: 0, shadowed: 0, complete: false, error: String(err?.message ?? err) }
      }
```

Then wrap each per-file body in its own try/catch that records the failure and sets `complete = false`, rather than aborting the whole loop. Replace the single `count++` with `inserted++` (`:68`) and `updated++` (`:79`).

- [ ] **Step 4: Update the caller**

`skills/index.ts:65-68`:

```ts
    const scan = await services.loader.loadFromDirectory('config/skills')
    ctx.logger.info(
      { inserted: scan.inserted, updated: scan.updated, shadowed: scan.shadowed, complete: scan.complete },
      'Scanned bundled skills from config/skills/',
    )
```

Also update `extensions/index.ts:51`, which uses the return value as a number.

- [ ] **Step 5: Run tests**

Run: `bun run test tests/modules/skills/ tests/modules/extensions/`
Expected: PASS.

---

### Task 13: Provenance columns

**Files:**
- Modify: `src/modules/skills/index.ts:19-50`, `src/modules/skills/schema.ts`, `src/modules/skills/skill-loader.ts`
- Test: `tests/modules/skills/skill-loader.test.ts`

**Interfaces:**
- Produces: `skills.source_path`, `skills.source_root`, `skills.last_seen_at`; `loadFromDirectory` accepts a second arg `rootId: string` (default `'config/skills'`).

- [ ] **Step 1: Add the DDL**

In `skills/index.ts` after the existing ALTERs (`:41-45`):

```ts
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN source_path TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN source_root TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN last_seen_at TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN disabled_reason TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN disabled_at TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN disabled_by TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN last_used_at TEXT`) } catch { /* already exists */ }

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS skill_shadowed_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL,
      path TEXT NOT NULL,
      root TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      UNIQUE(skill_id, path, root)
    )`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS skill_usage_daily (
      day TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      injected_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, skill_id)
    )`)

    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_last_used ON skills(last_used_at)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_shadowed_skill ON skill_shadowed_sources(skill_id)`)
```

Mirror all new columns in `skills/schema.ts` (Drizzle typing only).

- [ ] **Step 2: Record provenance during the scan**

In `skill-loader.ts`, set `source_path = relativePath + '.md'`, `source_root = rootId`, `last_seen_at = now` on both INSERT (`:62-67`) and UPDATE (`:71-78`).

- [ ] **Step 3: Write the test**

```ts
it('records where each skill came from', async () => {
  await loader.loadFromDirectory(dir, 'config/skills')
  const row = (db.all(sql`SELECT source_path, source_root, last_seen_at FROM skills WHERE id = 'alpha'`) as any[])[0]
  expect(row.source_path).toBe('alpha.md')
  expect(row.source_root).toBe('config/skills')
  expect(row.last_seen_at).toBeTruthy()
})
```

- [ ] **Step 4: Run tests**

Run: `bun run test tests/modules/skills/`
Expected: PASS.

---

### Task 14: Deterministic precedence and recorded shadowing

**Files:**
- Create: `src/modules/skills/skill-inventory.ts`
- Modify: `src/modules/skills/skill-loader.ts:58-80`
- Test: `tests/modules/skills/skill-precedence.test.ts`

**Interfaces:**
- Produces:
  - `SOURCE_RANK: Record<'user'|'generated'|'extension-bundled'|'core-bundled', number>`
  - `wins(candidate: { source: string; root: string; path: string }, incumbent: { source: string; root: string; path: string }): boolean`

- [ ] **Step 1: Write the failing test using the two real collisions**

```ts
import { describe, it, expect } from 'vitest'
import { wins } from '@modules/skills/skill-inventory'

describe('precedence ladder', () => {
  const core = (path: string) => ({ source: 'bundled', root: 'config/skills', path })

  it('is deterministic for the live websocket-patterns collision', () => {
    const a = core('api/websocket-patterns.md')
    const b = core('web/realtime/websocket-patterns.md')
    // lexicographic tie-break within one root: 'api/...' < 'web/...'
    expect(wins(a, b)).toBe(true)
    expect(wins(b, a)).toBe(false)
  })

  it('is deterministic for the live slack-integration collision', () => {
    const a = core('communication/messaging/slack-integration.md')
    const b = core('integrations/slack.md')
    expect(wins(a, b)).toBe(true)
    expect(wins(b, a)).toBe(false)
  })

  it('ranks user above generated above extension above core', () => {
    expect(wins({ source: 'user', root: 'db', path: 'z' }, core('a'))).toBe(true)
    expect(wins({ source: 'generated', root: 'db', path: 'z' }, core('a'))).toBe(true)
    expect(wins(core('a'), { source: 'user', root: 'db', path: 'z' })).toBe(false)
  })

  it('is antisymmetric — no pair where both win', () => {
    const pairs = [[core('a'), core('b')], [{ source: 'user', root: 'db', path: 'x' }, core('a')]]
    for (const [x, y] of pairs) expect(wins(x, y) && wins(y, x)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/skills/skill-precedence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the ladder**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/skills/skill-inventory.ts
// Skill identity collides across roots (222 files → 220 ids today). Before this,
// readdir order decided the winner, which is filesystem-dependent. The ladder
// below makes it explicit and reproducible, and losers are recorded rather than
// silently overwritten.
export type SkillOrigin = { source: string; root: string; path: string }

const CORE_ROOT = 'config/skills'

/** Higher wins. */
export function originRank(o: SkillOrigin): number {
  if (o.source === 'user') return 40
  if (o.source === 'generated') return 30
  if (o.source === 'bundled' && o.root !== CORE_ROOT) return 20 // extension pack
  return 10 // core bundled
}

/** True when `candidate` should replace `incumbent`. Total and antisymmetric. */
export function wins(candidate: SkillOrigin, incumbent: SkillOrigin): boolean {
  const rc = originRank(candidate)
  const ri = originRank(incumbent)
  if (rc !== ri) return rc > ri
  if (candidate.root !== incumbent.root) return candidate.root < incumbent.root
  return candidate.path < incumbent.path
}
```

- [ ] **Step 4: Apply it in the loader**

Replace the upsert branch at `skill-loader.ts:58-80`. On collision (`existing.length > 0`), build both origins and call `wins()`. The loser's path is recorded:

```ts
            db.run(sql`INSERT OR IGNORE INTO skill_shadowed_sources (skill_id, path, root, seen_at)
              VALUES (${id}, ${loserPath}, ${loserRoot}, ${now})`)
            shadowed++
```

Only the winner updates the `skills` row.

- [ ] **Step 5: Run tests**

Run: `bun run test tests/modules/skills/`
Expected: PASS. Re-running a scan twice must produce identical `skills` rows — add that assertion if not already present.

---

### Task 15: Orphan detection (guarded)

**Files:**
- Modify: `src/modules/skills/skill-inventory.ts`
- Test: `tests/modules/skills/skill-orphan.test.ts`

**Interfaces:**
- Produces: `findOrphans(db, rootId: string, scanStartedAt: string): string[]` — ids of `bundled` rows in `rootId` whose `last_seen_at < scanStartedAt`.

- [ ] **Step 1: Write the failing tests, negative case first**

```ts
it('does NOT run when the scan was incomplete', async () => {
  // loadFromDirectory returned { complete: false }
  const result = await runSkillScan(db, loader, dirWithUnreadableFile, 'config/skills')
  expect(result.orphans).toEqual([])
  expect(result.orphanDetectionSkipped).toBe(true)
})

it('finds a skill whose file disappeared', async () => {
  await runSkillScan(db, loader, dir, 'config/skills')
  await rm(`${dir}/beta.md`)
  const result = await runSkillScan(db, loader, dir, 'config/skills')
  expect(result.orphans).toEqual(['beta'])
})

it('never reports a user-created skill as orphaned', async () => {
  loader.create({ name: 'hand-made', content: 'x' })
  const result = await runSkillScan(db, loader, dir, 'config/skills')
  expect(result.orphans).not.toContain('hand-made')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test tests/modules/skills/skill-orphan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export function findOrphans(db: any, rootId: string, scanStartedAt: string): string[] {
  const rows = db.all(sql`SELECT id FROM skills
    WHERE source = 'bundled' AND source_root = ${rootId}
      AND (last_seen_at IS NULL OR last_seen_at < ${scanStartedAt})`) as any[]
  return rows.map((r) => r.id)
}

export async function runSkillScan(db: any, loader: any, dir: string, rootId: string) {
  const scanStartedAt = new Date().toISOString()
  const scan = await loader.loadFromDirectory(dir, rootId)
  if (!scan.complete) {
    return { ...scan, orphans: [] as string[], orphanDetectionSkipped: true }
  }
  return { ...scan, orphans: findOrphans(db, rootId, scanStartedAt), orphanDetectionSkipped: false }
}
```

- [ ] **Step 4: Run tests**

Run: `bun run test tests/modules/skills/`
Expected: PASS.

---

### Task 16: `setEnabled` with a reason

**Files:**
- Modify: `src/modules/skills/skill-loader.ts:144-149`, `src/modules/skills/routes.ts`
- Test: `tests/modules/skills/skill-loader.test.ts`

**Interfaces:**
- Produces: `setEnabled(id: string, enabled: boolean, reason?: string, by?: string): void` — idempotent. `toggle(id)` remains as a wrapper.

- [ ] **Step 1: Write the failing test**

```ts
it('is idempotent', () => {
  loader.setEnabled('alpha', false, 'dormant', 'detector')
  const first = loader.get('alpha')
  loader.setEnabled('alpha', false, 'dormant', 'detector')
  expect(loader.get('alpha')!.enabled).toBe(false)
  expect(loader.get('alpha')!.disabledReason).toBe('dormant')
  expect(first!.enabled).toBe(false)
})

it('clears disable metadata on re-enable', () => {
  loader.setEnabled('alpha', false, 'orphan', 'detector')
  loader.setEnabled('alpha', true)
  const s = loader.get('alpha')!
  expect(s.enabled).toBe(true)
  expect(s.disabledReason).toBeUndefined()
})

it('toggle still flips', () => {
  const before = loader.get('alpha')!.enabled
  loader.toggle('alpha')
  expect(loader.get('alpha')!.enabled).toBe(!before)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test tests/modules/skills/skill-loader.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
    setEnabled(id: string, enabled: boolean, reason?: string, by?: string): void {
      const now = new Date().toISOString()
      if (enabled) {
        db.run(sql`UPDATE skills SET enabled = 1, disabled_reason = NULL, disabled_at = NULL,
          disabled_by = NULL, updated_at = ${now} WHERE id = ${id}`)
        return
      }
      db.run(sql`UPDATE skills SET enabled = 0, disabled_reason = ${reason ?? 'user'},
        disabled_at = ${now}, disabled_by = ${by ?? 'user'}, updated_at = ${now} WHERE id = ${id}`)
    },

    toggle(id: string): void {
      const skill = this.get(id)
      if (!skill) return
      this.setEnabled(id, !skill.enabled, skill.enabled ? 'user' : undefined, 'user')
    },
```

Extend `toSkill` (`skill-loader.ts:7-26`) with `disabledReason: raw.disabled_reason ?? undefined`, `disabledAt`, `disabledBy`, `useCount: raw.use_count ?? 0`, `lastUsedAt: raw.last_used_at ?? undefined`, and mirror them on the `Skill` interface in `skills/types.ts`.

- [ ] **Step 4: Add the HTTP endpoint**

In `skills/routes.ts`, next to the existing toggle:

```ts
  api.patch('/skills/:id/enabled', requirePermission('update', 'Skill'), zValidator('json',
    z.object({ enabled: z.boolean(), reason: z.string().max(64).optional() })), (c) => {
    const id = c.req.param('id')
    const { enabled, reason } = c.req.valid('json')
    if (!services.loader.get(id)) return c.json({ error: 'not found' }, 404)
    services.loader.setEnabled(id, enabled, reason, 'owner')
    return c.json({ ok: true, enabled })
  })
```

- [ ] **Step 5: Run tests**

Run: `bun run test tests/modules/skills/`
Expected: PASS.

---

### Task 17: Retention purge job

**Files:**
- Modify: `src/modules/observability/index.ts`
- Test: `tests/modules/observability/context-retention.test.ts`

**Interfaces:**
- Produces: scheduler handler `observability.context.purge`, default cron `15 3 * * *`, config key `observability.contextRetentionDays` (default `7`).

- [ ] **Step 1: Write the failing test**

```ts
it('purges compositions older than the retention window and their sections', () => {
  // seed one 30-day-old and one fresh composition, each with 2 sections
  const removed = purgeContextDetail(db, 7)
  expect(removed).toEqual({ compositions: 1, sections: 2 })
  expect((db.all(sql`SELECT id FROM context_compositions`) as any[])).toHaveLength(1)
})

it('leaves the daily rollup untouched', () => {
  purgeContextDetail(db, 7)
  expect((db.all(sql`SELECT * FROM context_section_daily`) as any[]).length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Implement**

```ts
export function purgeContextDetail(db: any, retentionDays: number): { compositions: number; sections: number } {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString()
  const doomed = (db.all(sql`SELECT id FROM context_compositions WHERE created_at < ${cutoff}`) as any[]).map((r) => r.id)
  if (doomed.length === 0) return { compositions: 0, sections: 0 }
  const sections = (db.all(sql`SELECT COUNT(*) AS n FROM context_sections
    WHERE composition_id IN (SELECT id FROM context_compositions WHERE created_at < ${cutoff})`) as any[])[0].n as number
  db.run(sql`DELETE FROM context_sections WHERE composition_id IN
    (SELECT id FROM context_compositions WHERE created_at < ${cutoff})`)
  db.run(sql`DELETE FROM context_compositions WHERE created_at < ${cutoff}`)
  return { compositions: doomed.length, sections }
}
```

Register it following the pattern at `scheduler/index.ts:171-174` + `:203-212`, and log the returned counts.

- [ ] **Step 3: Run tests**

Run: `bun run test tests/modules/observability/`
Expected: PASS.

---

# Phase 3 — Detector

### Task 18: `classifySkill` — the policy

**Files:**
- Create: `src/modules/skills/classify-skill.ts`
- Modify: `config/default.yaml` (thresholds)
- Test: `tests/modules/skills/classify-skill.test.ts`

**Interfaces:**
- Produces:
  - `type SkillCategory = 'healthy' | 'new' | 'shadowed' | 'orphan' | 'never-used' | 'dormant'`
  - `classifySkill(input: ClassifyInput, cfg: ClassifyConfig, now: Date): { category: SkillCategory; reason: string; proposeDisable: boolean }`

> **OWNER REVIEW POINT.** The spec assigned this rule to the owner (§6.5, OQ1). It is
> implemented here with a documented default so the work is not blocked. The thresholds live in
> `config/default.yaml` and can be changed without touching code; the *shape* of the rule is what
> to review.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { classifySkill, DEFAULT_CLASSIFY_CONFIG as cfg } from '@modules/skills/classify-skill'

const now = new Date('2026-08-24T00:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
const base = { source: 'bundled', createdAt: daysAgo(400), useCount: 0, lastUsedAt: null, isShadowed: false, isOrphan: false, situational: false }

describe('classifySkill', () => {
  it('calls a recently used skill healthy', () => {
    const r = classifySkill({ ...base, useCount: 5, lastUsedAt: daysAgo(2) }, cfg, now)
    expect(r).toMatchObject({ category: 'healthy', proposeDisable: false })
  })

  it('exempts a skill inside the grace period even with zero use', () => {
    const r = classifySkill({ ...base, createdAt: daysAgo(3) }, cfg, now)
    expect(r).toMatchObject({ category: 'new', proposeDisable: false })
  })

  it('proposes disabling an orphan', () => {
    const r = classifySkill({ ...base, isOrphan: true, useCount: 9, lastUsedAt: daysAgo(1) }, cfg, now)
    expect(r).toMatchObject({ category: 'orphan', proposeDisable: true })
  })

  it('proposes disabling a permanently shadowed duplicate', () => {
    const r = classifySkill({ ...base, isShadowed: true }, cfg, now)
    expect(r).toMatchObject({ category: 'shadowed', proposeDisable: true })
  })

  it('proposes disabling a never-used skill past the grace period', () => {
    const r = classifySkill({ ...base, createdAt: daysAgo(200) }, cfg, now)
    expect(r).toMatchObject({ category: 'never-used', proposeDisable: true })
  })

  it('proposes disabling a long-dormant skill', () => {
    const r = classifySkill({ ...base, useCount: 3, lastUsedAt: daysAgo(200) }, cfg, now)
    expect(r).toMatchObject({ category: 'dormant', proposeDisable: true })
  })

  it('NEVER proposes disabling a situational skill on time alone', () => {
    const r = classifySkill({ ...base, situational: true, useCount: 1, lastUsedAt: daysAgo(400) }, cfg, now)
    expect(r.proposeDisable).toBe(false)
  })

  it('still proposes disabling a situational skill that is orphaned', () => {
    const r = classifySkill({ ...base, situational: true, isOrphan: true }, cfg, now)
    expect(r.proposeDisable).toBe(true)
  })

  it('never proposes disabling a user-authored skill on time alone', () => {
    const r = classifySkill({ ...base, source: 'user', createdAt: daysAgo(500) }, cfg, now)
    expect(r.proposeDisable).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test tests/modules/skills/classify-skill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the policy**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/skills/classify-skill.ts
//
// OWNER-REVIEWABLE POLICY. Everything here is a judgement call, not mechanics.
// Two traps this rule exists to avoid:
//   1. A newly added skill has zero usage BY DEFINITION. A naive "unused for N
//      days" rule would disable every new skill on sight — hence graceDays.
//   2. A situational skill (disaster recovery, a migration) legitimately sleeps
//      for months. It is insurance; disabling it would fail at exactly the worst
//      moment — hence `situational`, which exempts a skill from TIME-based
//      proposals but NOT from evidence-based ones (orphan/shadowed).
//
// Evidence-based categories (orphan, shadowed) are facts: the file is gone, or
// another source always wins. Time-based categories (never-used, dormant) are
// inferences and are therefore the ones the exemptions guard.
import type { SkillCategory } from './types.js'

export interface ClassifyInput {
  source: string
  createdAt: string
  useCount: number
  lastUsedAt: string | null
  isShadowed: boolean
  isOrphan: boolean
  /** Marked situational via frontmatter `situational: true` or a configured category prefix. */
  situational: boolean
}

export interface ClassifyConfig {
  /** A skill younger than this is never proposed on time-based grounds. */
  graceDays: number
  /** Never used and older than this → proposed. */
  neverUsedDays: number
  /** Used once, but not since this many days → proposed. */
  dormantDays: number
  /** Sources exempt from time-based proposals (the owner made these deliberately). */
  timeExemptSources: string[]
}

export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = {
  graceDays: 30,
  neverUsedDays: 90,
  dormantDays: 180,
  timeExemptSources: ['user'],
}

export interface ClassifyResult {
  category: SkillCategory
  reason: string
  proposeDisable: boolean
}

function daysBetween(from: string, to: Date): number {
  return (to.getTime() - new Date(from).getTime()) / 86_400_000
}

export function classifySkill(input: ClassifyInput, cfg: ClassifyConfig, now: Date): ClassifyResult {
  // ── Evidence first. These are facts about the world, not inferences about
  //    intent, so no exemption applies to them.
  if (input.isOrphan) {
    return { category: 'orphan', reason: 'source file no longer exists', proposeDisable: true }
  }
  if (input.isShadowed) {
    return { category: 'shadowed', reason: 'another source always wins this id', proposeDisable: true }
  }

  const ageDays = daysBetween(input.createdAt, now)
  if (ageDays < cfg.graceDays) {
    return { category: 'new', reason: `within ${cfg.graceDays}-day grace period`, proposeDisable: false }
  }

  // ── Inference from here down. Exemptions guard this half only.
  const timeExempt = input.situational || cfg.timeExemptSources.includes(input.source)

  if (input.useCount === 0) {
    if (ageDays < cfg.neverUsedDays) {
      return { category: 'never-used', reason: 'never used, still young enough to wait', proposeDisable: false }
    }
    return {
      category: 'never-used',
      reason: `never used in ${Math.floor(ageDays)} days`,
      proposeDisable: !timeExempt,
    }
  }

  const idleDays = input.lastUsedAt ? daysBetween(input.lastUsedAt, now) : ageDays
  if (idleDays >= cfg.dormantDays) {
    return {
      category: 'dormant',
      reason: `last used ${Math.floor(idleDays)} days ago`,
      proposeDisable: !timeExempt,
    }
  }

  return { category: 'healthy', reason: `used ${input.useCount}×, last ${Math.floor(idleDays)} days ago`, proposeDisable: false }
}
```

Add `SkillCategory` to `skills/types.ts`. Add to `config/default.yaml`:

```yaml
skills:
  classify:
    graceDays: 30
    neverUsedDays: 90
    dormantDays: 180
    timeExemptSources: ['user']
```

- [ ] **Step 4: Run tests**

Run: `bun run test tests/modules/skills/classify-skill.test.ts`
Expected: PASS — all nine cases.

---

### Task 19: Inventory query and detector endpoints

**Files:**
- Create: `src/modules/skills/dead-skill-detector.ts`
- Modify: `src/modules/skills/skill-inventory.ts` (add `buildInventory`), `src/modules/skills/routes.ts`, `src/modules/skills/index.ts` (widen `SkillsServices`)
- Test: `tests/modules/skills/dead-skill-detector.test.ts`, `tests/modules/skills/routes.test.ts`

**Interfaces:**
- Consumes: `classifySkill`, `DEFAULT_CLASSIFY_CONFIG`, `ClassifyConfig` (Task 18); `findOrphans` (Task 15).
- Produces:
  - `interface InventoryRow { id: string; name: string; category?: string; source: string; sourcePath?: string; sourceRoot?: string; enabled: boolean; disabledReason?: string; useCount: number; lastUsedAt?: string; createdAt: string; shadowedSources: { path: string; root: string }[]; isOrphan: boolean; situational: boolean }`
  - `buildInventory(db: any, orphanIds?: string[]): InventoryRow[]`
  - `findDeadCandidates(db: any, cfg: ClassifyConfig, now: Date, orphanIds?: string[]): (InventoryRow & ClassifyResult)[]`
- **Widens `SkillsServices`** (`skills/routes.ts:8`) from `{ loader, matcher }` to `{ loader, matcher, db, classifyConfig }`. `skills/index.ts:55` constructs it as
  `const services: SkillsServices = { loader, matcher, db: ctx.db, classifyConfig: resolveClassifyConfig(ctx.config) }`.
  Every existing consumer destructures only `loader`/`matcher`, so this is additive.

- [ ] **Step 1: Write the failing test**

```ts
it('returns only enabled skills the policy proposes disabling', () => {
  // seed: one healthy, one orphan (enabled), one orphan (already disabled)
  const out = findDeadCandidates(db, DEFAULT_CLASSIFY_CONFIG, new Date(), ['orphan-enabled', 'orphan-disabled'])
  expect(out.map((r) => r.id)).toEqual(['orphan-enabled'])
  expect(out[0]).toMatchObject({ category: 'orphan', proposeDisable: true })
})

it('joins shadowed sources onto the inventory row', () => {
  const inv = buildInventory(db)
  const row = inv.find((r) => r.id === 'websocket-patterns')!
  expect(row.shadowedSources).toEqual([{ path: 'web/realtime/websocket-patterns.md', root: 'config/skills' }])
})

it('reports zero shadowed sources as an empty array, not null', () => {
  const row = buildInventory(db).find((r) => r.id === 'alpha')!
  expect(row.shadowedSources).toEqual([])
})
```

- [ ] **Step 2: Implement the inventory query**

Append to `src/modules/skills/skill-inventory.ts`:

```ts
export interface InventoryRow {
  id: string
  name: string
  category?: string
  source: string
  sourcePath?: string
  sourceRoot?: string
  enabled: boolean
  disabledReason?: string
  useCount: number
  lastUsedAt?: string
  createdAt: string
  shadowedSources: { path: string; root: string }[]
  isOrphan: boolean
  situational: boolean
}

/** A skill is situational when its category sits under one of these prefixes. */
const SITUATIONAL_PREFIXES = ['disaster-recovery', 'migration', 'incident']

export function buildInventory(db: any, orphanIds: string[] = []): InventoryRow[] {
  const orphans = new Set(orphanIds)
  const skills = db.all(sql`SELECT * FROM skills ORDER BY name`) as any[]
  const shadows = db.all(sql`SELECT skill_id, path, root FROM skill_shadowed_sources`) as any[]

  const bySkill = new Map<string, { path: string; root: string }[]>()
  for (const s of shadows) {
    const list = bySkill.get(s.skill_id) ?? []
    list.push({ path: s.path, root: s.root })
    bySkill.set(s.skill_id, list)
  }

  return skills.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category ?? undefined,
    source: r.source,
    sourcePath: r.source_path ?? undefined,
    sourceRoot: r.source_root ?? undefined,
    enabled: r.enabled === 1,
    disabledReason: r.disabled_reason ?? undefined,
    useCount: r.use_count ?? 0,
    lastUsedAt: r.last_used_at ?? undefined,
    createdAt: r.created_at,
    shadowedSources: bySkill.get(r.id) ?? [],
    isOrphan: orphans.has(r.id),
    situational: SITUATIONAL_PREFIXES.some((p) => (r.category ?? '').startsWith(p)),
  }))
}
```

- [ ] **Step 3: Implement the detector**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/skills/dead-skill-detector.ts
// Reads the inventory, applies the owner-reviewable policy, and returns
// candidates. It never mutates a skill — see runDeadSkillScan (Task 20) for the
// propose-only apply path.
import { buildInventory, type InventoryRow } from './skill-inventory.js'
import { classifySkill, type ClassifyConfig, type ClassifyResult } from './classify-skill.js'

export function findDeadCandidates(
  db: any,
  cfg: ClassifyConfig,
  now: Date,
  orphanIds: string[] = [],
): (InventoryRow & ClassifyResult)[] {
  return buildInventory(db, orphanIds)
    .filter((row) => row.enabled)
    .map((row) => ({
      ...row,
      ...classifySkill(
        {
          source: row.source,
          createdAt: row.createdAt,
          useCount: row.useCount,
          lastUsedAt: row.lastUsedAt ?? null,
          isShadowed: row.shadowedSources.length > 0,
          isOrphan: row.isOrphan,
          situational: row.situational,
        },
        cfg,
        now,
      ),
    }))
    .filter((row) => row.proposeDisable)
}
```

- [ ] **Step 4: Add the routes**

```ts
  api.get('/skills/inventory', requirePermission('read', 'Skill'), (c) =>
    c.json({ items: buildInventory(services.db) }))

  api.get('/skills/dead-candidates', requirePermission('read', 'Skill'), (c) =>
    c.json({ items: findDeadCandidates(services.db, services.classifyConfig, new Date()) }))
```

- [ ] **Step 5: Run tests**

Run: `bun run test tests/modules/skills/`
Expected: PASS.

---

### Task 20: Route proposals through the approval ladder

**Files:**
- Modify: `src/modules/skills/dead-skill-detector.ts`, `src/modules/skills/index.ts`
- Test: `tests/modules/skills/dead-skill-approval.test.ts`

**Interfaces (VERIFIED against source — the earlier draft of this task invented fields that do not exist):**
- Consumes `(ctx as any).securityGate.autonomyPolicy` (set at `security-gate/index.ts:177`). Its
  `createApproval(input): number` is **synchronous** and returns the new row id
  (`security-gate/autonomy-policy.ts:505-545`). Its real input shape is
  `{ category, toolName?, agentId?, conversationId?, inputJson?, preview?, reason?, expiresAt?, argHash?, runId?, kind? }`
  — there is **no** `action` and **no** `targetId`. The skill id travels in `inputJson`.
- Autonomy category `skill.adopt` already exists (`autonomy-policy.ts:65`).
- Produces: scheduler handler `skills.deadScan` (weekly, `0 6 * * 1`) enqueuing one approval per
  candidate, plus a bus subscriber that applies an approved proposal.

**Three facts the implementer must not rediscover the hard way:**

1. **The built-in enqueue dedup does not protect us.** It only fires for `kind === 'tool_call'`
   *with* `argHash` *and* `conversationId` *and* `toolName` (`autonomy-policy.ts:530-538`). A
   scheduled scan supplies none of those, so it would insert a fresh duplicate row every week. The
   detector must run its own pending check before inserting.
2. **The apply path is a bus subscription, not a callback.** `autonomyPolicy.decide(id, status, actor)`
   (`security-gate/routes.ts:247`) emits `autonomy:approval-resolved` `{ approvalId, status, decidedBy }`.
   Subscribe to it; on `status === 'approved'` for a `skill_disable` row, call `loader.setEnabled`.
3. **Visibility caveat.** Approvals with no `conversation_id` are admin-only and never enter the
   normal approvals list (`security-gate/routes.ts:235-238`). A scheduled scan has no conversation,
   so these proposals surface to an admin only. Acceptable for single-owner EYAS — a known property,
   not a bug to "fix" by faking a conversation id.

Honors prior decision A2 (`eyas-prompt-phase3-autonomy-design.md:31`): propose, never apply.

- [ ] **Step 1: Write the failing test**

```ts
it('enqueues one approval per candidate and applies nothing', () => {
  const r = runDeadSkillScan(deps)
  expect(r).toEqual({ proposed: 1, skipped: 0 })
  expect(created).toHaveLength(1)
  expect(created[0]).toMatchObject({ category: 'skill.adopt', kind: 'skill_disable' })
  expect(JSON.parse(created[0].inputJson)).toEqual({ skillId: 'orphan-enabled', classification: 'orphan' })
  expect(loader.get('orphan-enabled')!.enabled).toBe(true)  // NOT applied
})

it('does not re-enqueue a candidate that already has a pending approval', () => {
  runDeadSkillScan(deps)
  const second = runDeadSkillScan(deps)
  expect(second).toEqual({ proposed: 0, skipped: 1 })
  expect(created).toHaveLength(1)
})

it('proposes nothing when no autonomy policy is available', () => {
  const r = runDeadSkillScan({ ...deps, autonomyPolicy: undefined })
  expect(r.proposed).toBe(0)
  expect(loader.get('orphan-enabled')!.enabled).toBe(true)
})

it('applies only through setEnabled, and only on an approved decision', () => {
  runDeadSkillScan(deps)
  const id = (db.all(sql`SELECT id FROM autonomy_approvals`) as any[])[0].id
  expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'rejected' })).toBeNull()
  expect(loader.get('orphan-enabled')!.enabled).toBe(true)
  expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'approved' })).toBe('orphan-enabled')
  const s = loader.get('orphan-enabled')!
  expect(s.enabled).toBe(false)
  expect(s.disabledReason).toBe('orphan')
})

it('ignores approvals of a different kind', () => {
  db.run(sql`INSERT INTO autonomy_approvals (category, kind, status, input_json, requested_at)
    VALUES ('tool.exec', 'tool_call', 'approved', '{}', '2026-08-24')`)
  const id = (db.all(sql`SELECT id FROM autonomy_approvals ORDER BY id DESC LIMIT 1`) as any[])[0].id
  expect(applyDeadSkillApproval({ db, loader }, { approvalId: id, status: 'approved' })).toBeNull()
})
```

- [ ] **Step 2: Implement the scan**

Append to `src/modules/skills/dead-skill-detector.ts`:

```ts
export const SKILL_DISABLE_KIND = 'skill_disable'

export interface DeadScanDeps {
  db: any
  loader: { setEnabled(id: string, enabled: boolean, reason?: string, by?: string): void }
  classifyConfig: ClassifyConfig
  /**
   * security-gate autonomyPolicy — absent means the detector is inert and proposes nothing.
   * createApproval is SYNCHRONOUS and returns the new row id.
   */
  autonomyPolicy?: {
    createApproval(input: {
      category: string
      inputJson?: string
      preview?: string
      reason?: string
      kind?: string
    }): number
  }
  logger: { info(o: unknown, m?: string): void; debug(o: unknown, m?: string): void }
  now?: () => Date
}

/** Skill ids that already have an un-actioned skill_disable proposal waiting. */
function pendingSkillIds(db: any): Set<string> {
  const rows = db.all(sql`SELECT input_json FROM autonomy_approvals
    WHERE kind = ${SKILL_DISABLE_KIND} AND status = 'pending'`) as { input_json: string | null }[]
  const ids = new Set<string>()
  for (const r of rows) {
    try { const parsed = JSON.parse(r.input_json ?? '{}'); if (parsed.skillId) ids.add(parsed.skillId) } catch { /* ignore */ }
  }
  return ids
}

export function runDeadSkillScan(deps: DeadScanDeps): { proposed: number; skipped: number } {
  const now = deps.now?.() ?? new Date()
  const candidates = findDeadCandidates(deps.db, deps.classifyConfig, now)
  if (!deps.autonomyPolicy) {
    deps.logger.debug({ candidates: candidates.length }, 'dead-skill scan: no autonomy policy, nothing proposed')
    return { proposed: 0, skipped: candidates.length }
  }

  // The built-in enqueue dedup only covers tool_call rows carrying argHash +
  // conversationId + toolName, which a scheduled scan has none of — so without
  // this check the scan would add a duplicate row every week.
  const pending = pendingSkillIds(deps.db)

  let proposed = 0
  let skipped = 0
  for (const c of candidates) {
    if (pending.has(c.id)) { skipped++; continue }
    deps.autonomyPolicy.createApproval({
      category: 'skill.adopt',
      kind: SKILL_DISABLE_KIND,
      inputJson: JSON.stringify({ skillId: c.id, classification: c.category }),
      preview: `Disable skill "${c.name}" — ${c.category}`,
      reason: c.reason,
    })
    proposed++
  }
  deps.logger.info({ proposed, skipped }, 'dead-skill scan complete — proposals only, nothing applied')
  return { proposed, skipped }
}

/**
 * The ONLY apply path. Driven by the `autonomy:approval-resolved` bus event, never by the scan.
 * Returns the skill id it disabled, or null when the event is not ours / not an approval.
 */
export function applyDeadSkillApproval(
  deps: Pick<DeadScanDeps, 'db' | 'loader'>,
  event: { approvalId: number; status: string },
): string | null {
  if (event.status !== 'approved') return null
  const row = (deps.db.all(sql`SELECT input_json, kind FROM autonomy_approvals
    WHERE id = ${event.approvalId}`) as { input_json: string | null; kind: string }[])[0]
  if (!row || row.kind !== SKILL_DISABLE_KIND) return null
  let parsed: { skillId?: string; classification?: string }
  try { parsed = JSON.parse(row.input_json ?? '{}') } catch { return null }
  if (!parsed.skillId) return null
  deps.loader.setEnabled(parsed.skillId, false, parsed.classification ?? 'dormant', 'detector')
  return parsed.skillId
}
```

- [ ] **Step 3: Register the weekly job**

In `skills/index.ts` `onStart`, follow the seeding pattern at `skill-generation/index.ts:276-282`:

```ts
    const scheduler = (ctx as any).scheduler
    if (scheduler) {
      scheduler.registerHandler('skills.deadScan', () => runDeadSkillScan({
        db: ctx.db, loader: services.loader, classifyConfig: services.classifyConfig,
        autonomyPolicy: (ctx as any).securityGate?.autonomyPolicy, logger: ctx.logger,
      }))
      if (!scheduler.list().some((j: any) => j.handler === 'skills.deadScan')) {
        scheduler.create({
          name: 'Dead skill scan',
          description: 'Proposes disabling unused, shadowed or orphaned skills. Applies nothing.',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 6 * * 1' }),
          handler: 'skills.deadScan',
          source: 'system',
          kind: 'handler',
        })
      }
    }
```

Subscribe to the bus event that carries approval decisions:

```ts
    ctx.bus.on('autonomy:approval-resolved', (e: any) => {
      const disabled = applyDeadSkillApproval({ db: ctx.db, loader: services.loader }, e)
      if (disabled) ctx.logger.info({ skillId: disabled }, 'skill disabled via approved proposal')
    })
```

- [ ] **Step 4: Run tests**

Run: `bun run test tests/modules/skills/`
Expected: PASS.

---

### Task 21: Retire the two superseded half-builds

Spec §6.6. Leaving these beside a working detector guarantees a future reader wires the wrong one.

**Files:**
- Delete: `src/modules/skill-generation/rollback.ts`, `tests/modules/skill-generation/rollback.test.ts` (if present)
- Modify: `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/automation/skills.md`
- Test: existing `tests/modules/skill-generation/`

- [ ] **Step 1: Verify `rollback.ts` is genuinely unreferenced**

Run: `grep -rn "rollback" src/modules/skill-generation/ src/ --include='*.ts' | grep -v 'rollback.ts:'`
Expected: no call sites for `checkAndRollback` / `createRollback`. If any exist, STOP and report — the deletion premise is wrong.

- [ ] **Step 2: Delete it**

Its stated intent (auto-disable) is superseded by D5/A2 propose-only, and its mechanism is a hard DELETE, which spec §6.3 forbids.

- [ ] **Step 3: Correct the curator-gate documentation**

`curator-gate.ts` stays unwired (a different concern: adoption quality, not dead-skill detection). In all six `automation/skills.md` locales, change the text that describes the auto-adoption curator gate as active to state that it is not currently wired, and describe the dead-skill detector as the live mechanism.

- [ ] **Step 4: Verify**

Run: `bun run test && bun run typecheck`
Expected: clean.

---

# Phase 4 — Surfaces

### Task 22: Composition read APIs

**Files:**
- Create: `src/modules/observability/context-routes.ts`
- Modify: `src/modules/observability/index.ts`, `src/modules/auth/routes.ts` (matcher)
- Test: `tests/modules/observability/context-routes.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/observability/compositions`, `/compositions/:id`, `/context-sections/daily`

- [ ] **Step 1: Write the failing authz test**

```ts
it('rejects an unauthenticated request', async () => {
  const res = await app.request('/api/v1/observability/compositions')
  expect(res.status).toBe(401)
})

it('returns sections in prompt order for a composition', async () => {
  const res = await authed(`/api/v1/observability/compositions/${compId}`)
  const body = await res.json()
  expect(body.sections.map((s: any) => s.ord)).toEqual([0, 1, 2])
})

it('returns daily rollup rows in the requested window', async () => {
  const res = await authed('/api/v1/observability/context-sections/daily?from=2026-08-01&to=2026-08-31')
  expect((await res.json()).items.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Implement, register in the auth matcher, run tests**

Run: `bun run test tests/modules/observability/`
Expected: PASS.

---

### Task 23: ContextBar drill-down and numerator fix

**Files:**
- Create: `src/web/src/pages/conversations/composition-panel.tsx`
- Modify: `src/web/src/pages/conversations/context-bar.tsx`, `conversation-page.tsx:351-372`
- Test: manual + `bun run typecheck`

- [ ] **Step 1: Make the bar clickable and fix the denominator source**

`ContextBar` gains `estimatedTokens?: number` and `onClick?: () => void`. When `estimatedTokens` is present it becomes the numerator (composed context size); `tokensUsed` remains only as the tooltip's cumulative figure, explicitly labelled as such — it is a conversation total, not context occupancy.

- [ ] **Step 2: Build the panel**

Fetches `GET /observability/compositions?conversationId=<id>&limit=1`, then `/compositions/:id`. Renders sections in `ord` order: key, zone, estimated tokens, a truncation badge with `dropped_chars`, and a collapsible raw `content`. Uses CSS variables only.

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun run lint`
Expected: clean.

---

### Task 24: Observability Context tab

**Files:**
- Create: `src/web/src/pages/observability/context-tab.tsx`
- Modify: `src/web/src/pages/observability/*-page.tsx` (add the tab)

- [ ] **Step 1: Implement**

Three panels from `/context-sections/daily`: average tokens per section (`sum_tokens / count`), truncation frequency (`truncated_count / count`), and estimate-vs-actual — the latter joining a composition's `estimated_tokens` against its earliest trace's `context_tokens`.

- [ ] **Step 2: Verify**

Run: `bun run typecheck && bun run lint`

---

### Task 25: Skills inventory view

**Files:**
- Create: `src/web/src/pages/skills/inventory-view.tsx`
- Modify: `src/web/src/pages/skills/skills-page.tsx`

- [ ] **Step 1: Implement the resolution table**

Columns: name, category, source, winning path, shadowed sources (count + tooltip), enabled, disabled reason, use count, last used, category badge from the detector. Sortable by last-used ascending — that ordering *is* the dead-skill report. A row proposed for disabling is marked and offers the `PATCH /skills/:id/enabled` action.

- [ ] **Step 2: Verify**

Run: `bun run typecheck && bun run lint`

---

### Task 26: i18n for all six locales

**Files:**
- Modify: `src/web/src/pages/{observability,skills,conversations}/locales/{en,hu,de,es,fr,tlh}.json`

- [ ] **Step 1: Add every new key to `en.json` first**, then translate into `hu`, `de`, `es`, `fr`, `tlh`. Key parity across all six is mandatory.

- [ ] **Step 2: Verify**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: all green, including the i18n completeness check.

---

## Final verification

- [ ] `bun run test` — full suite green
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint` — clean
- [ ] The byte-equality invariant (Tasks 3, 4, 5) passes — the manifest provably cannot lie
- [ ] `entry_point` coverage test (Task 11) shows all four values
- [ ] The interrupted-scan negative test (Task 15) passes — no orphan detection on a partial scan
- [ ] Do **not** commit. Report status to the owner.
