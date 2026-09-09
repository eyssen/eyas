# F0 — Foundation Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every model-call entry point in EYAS go through the prompt assembler, and make the HTTP layer capable of accepting and serving the payloads the Design and Brand modules will need.

**Architecture:** Four of roughly ten system-prompt entry points call `buildForPrimary`; the rest hand-roll a `system` string. F0 introduces one shared fail-soft assembly helper and routes the two highest-value bypass paths (`executeAgent`, `channel-run-agent`) through it, hardens the assembler against a single throwing resolver, propagates `projectId` where it is currently lost, and adds route-scoped body limits plus a public static asset route. No new user-facing feature ships in F0.

**Tech Stack:** TypeScript 5.9 strict ESM, Bun 1.x, Hono, Drizzle + SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-design-and-brand-system-design.md` (§3.1–§3.6, §6 F0)

## Global Constraints

- Every source file starts with `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- Test files with a jsdom environment put `// @vitest-environment jsdom` on the **first** line, above the licence header.
- Imports use the `@core/*`, `@modules/*`, `@shared/*` aliases; relative ESM imports carry an explicit `.js` extension.
- Logging via the injected pino logger. Never `console.log`.
- New dependencies must be MIT, BSD-2, BSD-3, ISC or Apache-2.0. GPL, LGPL, AGPL, SSPL and CC-BY-SA are forbidden.
- **Do not change any version number** — `version.json`, `package.json` versions, HTML version strings are frozen.
- **Do not commit and do not push** unless the operator explicitly asks. Steps below that say "Commit" are staged for the operator's decision; run the tests, then stop at the commit boundary and report.
- Run `bun run test` for the suite and `bun run lint` (`tsc --noEmit`, excludes `src/web`) before declaring a task done.
- Never create HTTP routes in a module's `onRegister` — `tests/contracts/api-auth-coverage.contract.test.ts:127` regex-scans for it.
- New budget added to `SectionBudget` must be carved out of an existing allocation. The total must stay at 8400. See spec §3.3.

---

## File structure

| File | Responsibility |
|---|---|
| `src/modules/prompt-wizard/active-voice-adapter.ts` | **new** — the assembler's voice resolver adapter, extracted from `index.ts` so it is unit-testable and fail-soft |
| `src/modules/prompt-wizard/assemble-system.ts` | **new** — the one fail-soft "assemble and flatten to a string" helper every entry point uses |
| `src/modules/prompt-wizard/index.ts` | modified — consume the extracted adapter |
| `src/modules/conversations/system-prompt.ts` | modified — delegate to the shared helper, keep the `bodySystem` override |
| `src/modules/agent/delegated-system-prompt.ts` | **new** — composes the delegated-agent system prompt (assembled prefix + the agent definition's own prompt) |
| `src/modules/agent/index.ts` | modified — `executeAgent` uses the composer |
| `src/modules/communication/channel-run-agent.ts` | modified — channel replies use the composer |
| `src/modules/communication/index.ts` | modified — pass `promptAssembler` into `createChannelRunAgent` |
| `src/modules/agent/orchestrator.ts` | modified — set `projectId` on child conversations |
| `src/modules/tools/types.ts` | modified — `projectId` on `ToolContext` |
| `src/core/http/server.ts` | modified — `createApp` accepts route-scoped body-limit overrides |
| `src/cli/utils/public-assets.ts` | **new** — serve `<dataDir>/public/**` with cross-origin CORP |
| `src/main.ts` | modified — mount the public asset route above `tryServeWebSpa` |

The spec's F0 bullet list also names the **iframe/CSP policy** and the
**sanitizer decision**. Both are written decisions, recorded in spec §5.6; the
only F0 code they require is adding the DOMPurify dependency (Task 9). No CSP
or security-header change ships in F0 — `tests/core/http/security-headers.test.ts:41-52`
pins DEFAULT_CSP, and the artboard preview iframe that needs the carve-out does
not exist until F2.

---

## Task 1: Fail-soft active-voice adapter

`active-voice-resolver.ts:47` throws when an agent has no `SOUL.style.json`.
`buildForPrimary` awaits it inside `Promise.all`, and the interactive path's
catch then sends `system: ''` — one missing file deletes the entire prompt.
The adapter that wraps the resolver is currently defined inline inside
`onStart`, so it cannot be tested. Extract it and make it soft.

**Files:**
- Create: `src/modules/prompt-wizard/active-voice-adapter.ts`
- Modify: `src/modules/prompt-wizard/index.ts:93-128`
- Test: `tests/modules/prompt-wizard/active-voice-adapter.test.ts`

**Interfaces:**
- Produces: `createActiveVoiceAdapter(getResolver: () => ActiveVoiceFn | undefined, logger?: { warn?: (o: unknown, m: string) => void }): (params: { agentId: string; channelContext: unknown; conversationId: string | null }) => Promise<{ scope: VoiceScope; reason: string; profile: VoiceProfile }>` and `FALLBACK_VOICE_PROFILE: VoiceProfile`.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createActiveVoiceAdapter, FALLBACK_VOICE_PROFILE } from '@modules/prompt-wizard/active-voice-adapter'

describe('createActiveVoiceAdapter', () => {
  it('falls back when no resolver is wired yet', async () => {
    const adapter = createActiveVoiceAdapter(() => undefined)
    const res = await adapter({ agentId: 'a1', channelContext: null, conversationId: null })
    expect(res.scope).toBe('internal')
    expect(res.profile).toEqual(FALLBACK_VOICE_PROFILE)
    expect(res.reason).toContain('not ready')
  })

  it('falls back instead of throwing when the resolver throws', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('agent a1 has no SOUL.style.json'))
    const warn = vi.fn()
    const adapter = createActiveVoiceAdapter(() => boom, { warn })
    const res = await adapter({ agentId: 'a1', channelContext: null, conversationId: 'c1' })
    expect(res.scope).toBe('internal')
    expect(res.profile).toEqual(FALLBACK_VOICE_PROFILE)
    expect(res.reason).toContain('SOUL.style.json')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('passes the resolver result through when it succeeds', async () => {
    const profile = { ...FALLBACK_VOICE_PROFILE, tone: 'lelkes' as const }
    const ok = vi.fn().mockResolvedValue({ scope: 'external', reason: 'auto', source: 'auto', profile })
    const adapter = createActiveVoiceAdapter(() => ok)
    const res = await adapter({ agentId: 'a1', channelContext: null, conversationId: 'c1' })
    expect(res).toEqual({ scope: 'external', reason: 'auto', profile })
  })

  it('supplies an owner-dm channel context when the caller passes none', async () => {
    const ok = vi.fn().mockResolvedValue({ scope: 'internal', reason: 'auto', source: 'auto', profile: FALLBACK_VOICE_PROFILE })
    const adapter = createActiveVoiceAdapter(() => ok)
    await adapter({ agentId: 'a1', channelContext: null, conversationId: 'c1' })
    expect(ok.mock.calls[0][0].channelContext).toMatchObject({ conversationKind: 'owner-dm', channelType: 'web' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run tests/modules/prompt-wizard/active-voice-adapter.test.ts`
Expected: FAIL — `Cannot find module '@modules/prompt-wizard/active-voice-adapter'`.

- [ ] **Step 3: Write the implementation**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/active-voice-adapter.ts
//
// Adapts the communication module's active-voice resolver to the assembler's
// resolveActiveVoice dep. Two things make this its own file: it must be
// unit-testable, and it must be FAIL-SOFT. buildForPrimary awaits every
// resolver inside a single Promise.all, so a resolver that throws takes the
// whole prompt with it — the interactive path's catch then sends system: ''.
// A missing SOUL.style.json must cost the caller its voice profile, nothing
// more.

import type { VoiceProfile, VoiceScope } from './types.js'

export type ActiveVoiceFn = (input: {
  agentId: string
  conversationId: string | null
  channelId: string | null
  channelContext: unknown
}) => Promise<{ scope: VoiceScope; reason: string; profile: VoiceProfile }>

export interface AdapterLogger {
  warn?: (obj: unknown, msg: string) => void
}

/** Neutral profile used whenever a real one cannot be resolved. */
export const FALLBACK_VOICE_PROFILE: VoiceProfile = {
  address: 'tegező',
  tone: 'kiegyensúlyozott',
  verbosity: 'lényegre törő',
  directness: 'direkt + udvarias',
  humor: 'nincs',
  emoji: 'soha',
  blockedPhrases: [],
  signature: '',
}

const FALLBACK_CHANNEL_CONTEXT = {
  channelType: 'web',
  conversationKind: 'owner-dm' as const,
  participants: [{ id: 'owner', type: 'owner' as const }],
  origin: 'inbound' as const,
}

export function createActiveVoiceAdapter(
  getResolver: () => ActiveVoiceFn | undefined,
  logger?: AdapterLogger,
) {
  return async function resolveActiveVoice(params: {
    agentId: string
    channelContext: unknown
    conversationId: string | null
  }): Promise<{ scope: VoiceScope; reason: string; profile: VoiceProfile }> {
    const activeVoice = getResolver()
    if (!activeVoice) {
      // communication module has not started yet — prompt-wizard boots first.
      return {
        scope: 'internal',
        reason: 'fallback (communication module not ready)',
        profile: FALLBACK_VOICE_PROFILE,
      }
    }
    try {
      const result = await activeVoice({
        agentId: params.agentId,
        conversationId: params.conversationId,
        channelId: null,
        channelContext: params.channelContext ?? FALLBACK_CHANNEL_CONTEXT,
      })
      return { scope: result.scope, reason: result.reason, profile: result.profile }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger?.warn?.({ err, agentId: params.agentId }, 'Active voice resolution failed; using fallback profile')
      return {
        scope: 'internal',
        reason: `fallback (${message})`,
        profile: FALLBACK_VOICE_PROFILE,
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run tests/modules/prompt-wizard/active-voice-adapter.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Replace the inline adapter in `index.ts`**

In `src/modules/prompt-wizard/index.ts`, add the import next to the existing
`createPromptAssembler` import:

```ts
import { createActiveVoiceAdapter } from './active-voice-adapter.js'
```

Delete the inline `const resolveActiveVoiceAdapter = async (params: …) => { … }`
block (currently lines 93-128) and replace it with:

```ts
    // Pull resolveActiveVoice lazily from communication module (started after
    // prompt-wizard) and never let it throw — see active-voice-adapter.ts.
    const resolveActiveVoiceAdapter = createActiveVoiceAdapter(
      () => (ctx as any).activeVoiceResolver,
      ctx.logger,
    )
```

The `resolveActiveVoice: resolveActiveVoiceAdapter,` line in the
`createPromptAssembler({ … })` call is unchanged.

- [ ] **Step 6: Run the full suite and the type check**

Run: `bun run test && bun run lint`
Expected: no new failures. The `VoiceProfile` literal union values in
`FALLBACK_VOICE_PROFILE` must type-check against `prompt-wizard/types.ts`; if
`tsc` rejects one, copy the exact literal from the deleted inline block rather
than inventing a new value.

- [ ] **Step 7: Commit boundary — report, do not commit**

```bash
git add src/modules/prompt-wizard/active-voice-adapter.ts \
        src/modules/prompt-wizard/index.ts \
        tests/modules/prompt-wizard/active-voice-adapter.test.ts
# STOP — do not run git commit. Report the staged change to the operator.
```

---

## Task 2: The shared fail-soft assembly helper

`conversations/system-prompt.ts` already does the right thing: call
`buildForPrimary`, flatten prefix + suffix + reminders, never throw, and report
the failure as `assemblerError` instead of swallowing it. Every other entry
point needs exactly that. Extract it.

**Files:**
- Create: `src/modules/prompt-wizard/assemble-system.ts`
- Modify: `src/modules/conversations/system-prompt.ts`
- Test: `tests/modules/prompt-wizard/assemble-system.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces:
  ```ts
  interface AssembleSystemArgs {
    assembler?: { buildForPrimary(o: BuildOptions): Promise<AssembledPrompt> }
    agentId: string | null
    conversationId: string | null
    projectId: string | null
    channelContext?: unknown
    fallbackAgentId?: () => string | null
  }
  interface AssembledSystem {
    system: string
    sections: ContextSection[]
    entryPoint: 'assembled' | 'unassembled'
    assemblerError?: string
  }
  function assembleSystemPrompt(args: AssembleSystemArgs): Promise<AssembledSystem>
  function flattenAssembled(a: AssembledPrompt): string
  function rawSection(key: string, content: string): ContextSection
  ```
  Task 3 and Task 4 both call `assembleSystemPrompt`. Task 3 also imports
  `rawSection`.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { assembleSystemPrompt, flattenAssembled, rawSection } from '@modules/prompt-wizard/assemble-system'

function assembled(over: Partial<any> = {}) {
  return {
    prefix: 'PREFIX',
    suffix: 'SUFFIX',
    reminders: ['R1'],
    sections: [{ zone: 'prefix', key: 'core-identity', content: 'PREFIX', chars: 6, estimatedTokens: 2, truncated: false, droppedChars: 0 }],
    ...over,
  }
}

describe('flattenAssembled', () => {
  it('joins prefix, suffix and reminders with blank lines, skipping empties', () => {
    expect(flattenAssembled(assembled() as any)).toBe('PREFIX\n\nSUFFIX\n\nR1')
    expect(flattenAssembled(assembled({ suffix: '   ', reminders: [] }) as any)).toBe('PREFIX')
  })
})

describe('rawSection', () => {
  it('produces an append-zone section with measured length', () => {
    const s = rawSection('raw-system', 'hello')
    expect(s.zone).toBe('append')
    expect(s.key).toBe('raw-system')
    expect(s.chars).toBe(5)
    expect(s.truncated).toBe(false)
  })
})

describe('assembleSystemPrompt', () => {
  it('returns unassembled when no assembler is available', async () => {
    const r = await assembleSystemPrompt({ agentId: 'a1', conversationId: 'c1', projectId: null })
    expect(r).toMatchObject({ system: '', entryPoint: 'unassembled', assemblerError: 'no assembler available' })
    expect(r.sections).toEqual([])
  })

  it('returns unassembled when no agent can be resolved', async () => {
    const buildForPrimary = vi.fn()
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: null, conversationId: 'c1', projectId: null,
    })
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('no agent resolved')
    expect(buildForPrimary).not.toHaveBeenCalled()
  })

  it('uses fallbackAgentId when agentId is null', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled())
    await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: null, conversationId: 'c1', projectId: 'p1',
      fallbackAgentId: () => 'fallback-agent',
    })
    expect(buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'fallback-agent', projectId: 'p1' }))
  })

  it('flattens a successful assembly and reports entryPoint assembled', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled())
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: 'p1',
    })
    expect(r.system).toBe('PREFIX\n\nSUFFIX\n\nR1')
    expect(r.entryPoint).toBe('assembled')
    expect(r.sections).toHaveLength(1)
    expect(r.assemblerError).toBeUndefined()
  })

  it('never throws — a failing assembler becomes assemblerError', async () => {
    const buildForPrimary = vi.fn().mockRejectedValue(new Error('workspace missing'))
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
    })
    expect(r.system).toBe('')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('workspace missing')
  })

  it('passes conversationId and channelContext through', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled())
    await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c9', projectId: null,
      channelContext: { channelType: 'telegram' },
    })
    expect(buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c9', channelContext: { channelType: 'telegram' },
    }))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run tests/modules/prompt-wizard/assemble-system.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/assemble-system.ts
//
// THE assemble-and-flatten helper. Every system-prompt entry point in EYAS
// goes through this function, so that whatever the assembler learns to inject
// (a project brand, a design reference) reaches all of them at once instead of
// only the four that happened to call buildForPrimary directly.
//
// It never throws. A missing assembler, a missing agent and a failing
// assembler all return an empty system with `entryPoint: 'unassembled'` and a
// populated `assemblerError`, so the caller can record the failure rather than
// have it vanish into a bare catch.

import type { AssembledPrompt, ContextSection } from './types.js'
import { estimateTokens } from './token-budget.js'

export interface AssemblerLike {
  buildForPrimary(opts: {
    agentId: string
    agentName: string
    conversationId: string | null
    projectId: string | null
    channelContext: unknown
  }): Promise<AssembledPrompt>
}

export interface AssembleSystemArgs {
  assembler?: AssemblerLike
  agentId: string | null
  conversationId: string | null
  projectId: string | null
  channelContext?: unknown
  /** Used when agentId is null — e.g. the conversation has no bound agent. */
  fallbackAgentId?: () => string | null
}

export interface AssembledSystem {
  system: string
  sections: ContextSection[]
  entryPoint: 'assembled' | 'unassembled'
  assemblerError?: string
}

/** Build a ContextSection for text that did not come from the assembler. */
export function rawSection(key: string, content: string): ContextSection {
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

/** Compose an AssembledPrompt into the single string providers take. */
export function flattenAssembled(a: AssembledPrompt): string {
  return [a.prefix, a.suffix, ...a.reminders].filter((s) => s.trim()).join('\n\n')
}

export async function assembleSystemPrompt(args: AssembleSystemArgs): Promise<AssembledSystem> {
  if (!args.assembler) {
    return { system: '', sections: [], entryPoint: 'unassembled', assemblerError: 'no assembler available' }
  }
  try {
    // Resolving the agent id happens INSIDE the try on purpose: fallbackAgentId
    // is a caller-supplied lookup that can hit the database, and a throw from
    // it must degrade like any other assembly failure rather than escape.
    // tests/modules/conversations/system-prompt.test.ts asserts this.
    const agentId = args.agentId ?? args.fallbackAgentId?.() ?? null
    if (!agentId) {
      return { system: '', sections: [], entryPoint: 'unassembled', assemblerError: 'no agent resolved' }
    }
    const built = await args.assembler.buildForPrimary({
      agentId,
      agentName: agentId, // buildForPrimary does not read agentName; the id is a safe label
      conversationId: args.conversationId,
      projectId: args.projectId,
      channelContext: args.channelContext ?? null,
    })
    return { system: flattenAssembled(built), sections: built.sections, entryPoint: 'assembled' }
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run tests/modules/prompt-wizard/assemble-system.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Delegate from `conversations/system-prompt.ts`**

Replace the whole body of `src/modules/conversations/system-prompt.ts` with the
delegating version. The public name, the `bodySystem` override and the
`entryPoint: 'conversation'` value are preserved — callers and the context
inspector depend on that exact string.

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/system-prompt.ts
// Resolves the interactive-chat system prompt: body.system override wins;
// otherwise delegate to the shared fail-soft assembler helper. Kept as a thin
// named wrapper because the interactive path reports its own entryPoint label
// ('conversation') and the context inspector keys off it.
import type { PromptAssembler } from '@modules/prompt-wizard/assembler'
import type { ContextSection } from '@modules/prompt-wizard/types'
import { assembleSystemPrompt, rawSection } from '@modules/prompt-wizard/assemble-system'

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

export async function resolveConversationSystemPrompt(args: ResolveArgs): Promise<ResolvedSystemPrompt> {
  if (args.bodySystem) {
    return {
      system: args.bodySystem,
      sections: [rawSection('body-system-override', args.bodySystem)],
      entryPoint: 'unassembled',
    }
  }
  const r = await assembleSystemPrompt({
    assembler: args.assembler,
    agentId: args.agentId,
    conversationId: args.conversationId,
    projectId: args.projectId,
    fallbackAgentId: args.fallbackAgentId,
  })
  return {
    system: r.system,
    sections: r.sections,
    entryPoint: r.entryPoint === 'assembled' ? 'conversation' : 'unassembled',
    assemblerError: r.assemblerError,
  }
}
```

- [ ] **Step 6: Run the existing conversation tests**

Run: `bun run vitest run tests/modules/conversations`
Expected: PASS with no changes to those files. If a test asserts on
`entryPoint`, it must still see `'conversation'` on the success path and
`'unassembled'` on every failure path.

- [ ] **Step 7: Run the full suite and the type check**

Run: `bun run test && bun run lint`
Expected: no new failures.

- [ ] **Step 8: Commit boundary — report, do not commit**

```bash
git add src/modules/prompt-wizard/assemble-system.ts \
        src/modules/conversations/system-prompt.ts \
        tests/modules/prompt-wizard/assemble-system.test.ts
# STOP — report the staged change to the operator.
```

---

## Task 3: `executeAgent` goes through the assembler

`agent/index.ts:495-512` sends `system: agentDef.systemPrompt || ''` and
self-records `entryPoint: 'unassembled'`. That is the path for every
`delegate_to_agent` subagent.

The change is **additive**: the assembled prompt is prepended to the agent
definition's own prompt, never replacing it. A delegated agent whose persona
lives only in `agentDef.systemPrompt` must keep behaving as before.

**Files:**
- Create: `src/modules/agent/delegated-system-prompt.ts`
- Modify: `src/modules/agent/index.ts:493-513`
- Test: `tests/modules/agent/delegated-system-prompt.test.ts`

**Interfaces:**
- Consumes: `assembleSystemPrompt`, `rawSection` from Task 2.
- Produces: `buildDelegatedSystemPrompt(args: DelegatedPromptArgs): Promise<AssembledSystem>` where `DelegatedPromptArgs = AssembleSystemArgs & { agentSystemPrompt?: string | null }`. Task 4 calls it too.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { buildDelegatedSystemPrompt } from '@modules/agent/delegated-system-prompt'

const assembled = {
  prefix: 'CORE', suffix: 'RUNTIME', reminders: [],
  sections: [{ zone: 'prefix', key: 'core-identity', content: 'CORE', chars: 4, estimatedTokens: 1, truncated: false, droppedChars: 0 }],
}

describe('buildDelegatedSystemPrompt', () => {
  it('prepends the assembled prompt to the agent definition prompt', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled)
    const r = await buildDelegatedSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: 'p1',
      agentSystemPrompt: 'You are a bug triager.',
    })
    expect(r.system).toBe('CORE\n\nRUNTIME\n\nYou are a bug triager.')
    expect(r.entryPoint).toBe('assembled')
  })

  it('records the agent prompt as its own section so the inspector sees it', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled)
    const r = await buildDelegatedSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
      agentSystemPrompt: 'You are a bug triager.',
    })
    const keys = r.sections.map((s) => s.key)
    expect(keys).toContain('core-identity')
    expect(keys).toContain('agent-definition-prompt')
  })

  it('falls back to the agent prompt alone when the assembler fails', async () => {
    const buildForPrimary = vi.fn().mockRejectedValue(new Error('nope'))
    const r = await buildDelegatedSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
      agentSystemPrompt: 'You are a bug triager.',
    })
    expect(r.system).toBe('You are a bug triager.')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('nope')
    expect(r.sections.map((s) => s.key)).toEqual(['agent-definition-prompt'])
  })

  it('produces an empty system and no sections when both sources are empty', async () => {
    const r = await buildDelegatedSystemPrompt({
      agentId: 'a1', conversationId: 'c1', projectId: null, agentSystemPrompt: '',
    })
    expect(r.system).toBe('')
    expect(r.sections).toEqual([])
    expect(r.entryPoint).toBe('unassembled')
  })

  it('works with no agent prompt at all', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled)
    const r = await buildDelegatedSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
      agentSystemPrompt: null,
    })
    expect(r.system).toBe('CORE\n\nRUNTIME')
    expect(r.sections.map((s) => s.key)).toEqual(['core-identity'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run tests/modules/agent/delegated-system-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/agent/delegated-system-prompt.ts
//
// executeAgent's system prompt. Historically this path sent the agent
// definition's raw systemPrompt and nothing else, which meant delegated
// subagents never saw the project cascade, the workspace files, or anything
// else the assembler contributes.
//
// The composition is ADDITIVE on purpose: assembled prompt first, the agent
// definition's own prompt last. An agent whose persona lives only in the DB
// keeps working exactly as before, and a failing assembler degrades to the old
// behaviour instead of emptying the prompt.

import {
  assembleSystemPrompt,
  rawSection,
  type AssembleSystemArgs,
  type AssembledSystem,
} from '@modules/prompt-wizard/assemble-system'

export interface DelegatedPromptArgs extends AssembleSystemArgs {
  /** The agent definition's own system prompt, appended after the assembly. */
  agentSystemPrompt?: string | null
}

export async function buildDelegatedSystemPrompt(args: DelegatedPromptArgs): Promise<AssembledSystem> {
  const { agentSystemPrompt, ...assembleArgs } = args
  const assembled = await assembleSystemPrompt(assembleArgs)

  const own = (agentSystemPrompt ?? '').trim()
  if (!own) return assembled

  const ownSection = rawSection('agent-definition-prompt', own)
  return {
    system: [assembled.system, own].filter((s) => s.trim()).join('\n\n'),
    sections: [...assembled.sections, ownSection],
    entryPoint: assembled.entryPoint,
    assemblerError: assembled.assemblerError,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run tests/modules/agent/delegated-system-prompt.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Widen `ContextEntryPoint`**

`ContextEntryPoint` (`src/modules/observability/context-recorder.ts:10`) is a
closed union: `'conversation' | 'background' | 'orchestrator-member' | 'unassembled'`.
Recording `'delegated'` without widening it fails `bun run lint`.

```ts
export type ContextEntryPoint =
  | 'conversation'
  | 'background'
  | 'orchestrator-member'
  | 'delegated'      // executeAgent — every delegate_to_agent subagent
  | 'channel'        // channel-run-agent — inbound email / Telegram / Slack replies
  | 'unassembled'
```

Both new members are used in this plan: `'delegated'` in Step 6 below,
`'channel'` in Task 4.

- [ ] **Step 6: Wire it into `executeAgent`**

In `src/modules/agent/index.ts`, add the import beside the other module imports:

```ts
import { buildDelegatedSystemPrompt } from './delegated-system-prompt.js'
```

Replace the block that currently reads (around lines 493-505):

```ts
        // Task 11 — executeAgent has no assembler in its path, only the
        // agent definition's raw system string: record it as one section.
        const raw = agentDef.systemPrompt || ''
        const compositionId = (ctx as any).contextRecorder?.record({
          sections: raw ? [{
            zone: 'append', key: 'raw-system', content: raw,
            chars: raw.length, estimatedTokens: estimateTokens(raw),
            truncated: false, droppedChars: 0,
          }] : [],
          entryPoint: 'unassembled',
          conversationId,
          agentId,
          provider,
          model,
        }) ?? null
```

with:

```ts
        // F0 — executeAgent now goes through the assembler. The agent
        // definition's own prompt is APPENDED, never replaced, so an agent
        // whose persona lives only in the DB is unaffected.
        const delegated = await buildDelegatedSystemPrompt({
          assembler: (ctx as any).promptAssembler,
          agentId,
          conversationId,
          projectId: conv?.projectId ?? null,
          agentSystemPrompt: agentDef.systemPrompt,
        })
        const compositionId = (ctx as any).contextRecorder?.record({
          sections: delegated.sections,
          entryPoint: delegated.entryPoint === 'assembled' ? 'delegated' : 'unassembled',
          assemblerError: delegated.assemblerError,
          conversationId,
          agentId,
          provider,
          model,
        }) ?? null
```

and change the `runner.run({ … })` call's system line from

```ts
          system: agentDef.systemPrompt || '',
```

to

```ts
          system: delegated.system,
```

If `estimateTokens` becomes unused in `index.ts` after this edit, remove the
import — `bun run lint` will flag it.

- [ ] **Step 7: Verify `conv` is in scope at that point**

Run: `grep -n "const conv" src/modules/agent/index.ts | head`
Expected: a `conv` binding earlier in `executeAgent` (it is already used for
`conv?.workingDirectories` in the `toolContext` a few lines below). If the
binding is named differently, use that name — do **not** add a second lookup.

- [ ] **Step 8: Run the agent tests, the full suite and the type check**

Run: `bun run vitest run tests/modules/agent && bun run test && bun run lint`
Expected: no new failures.

Two files are known to be sensitive to this change:

- `tests/modules/agent/context-coverage.test.ts:239-241` asserts the exact
  DISTINCT set `['background', 'orchestrator-member', 'unassembled']`. That
  suite mocks the module context minimally, so `(ctx as any).promptAssembler`
  is normally absent and `executeAgent` still stamps `'unassembled'` — the set
  should be unchanged. **If it now reports `'delegated'`, the mock does supply
  an assembler**: add `'delegated'` to the expected array in sorted position
  and say so in your report. Do not delete the assertion.
- `tests/modules/agent/execute-agent.test.ts`, if it asserts on the recorded
  `entryPoint` or on the exact `system` string passed to the runner. The system
  string now has the assembled prefix prepended when an assembler is present.

- [ ] **Step 9: Commit boundary — report, do not commit**

```bash
git add src/modules/agent/delegated-system-prompt.ts \
        src/modules/agent/index.ts \
        src/modules/observability/context-recorder.ts \
        tests/modules/agent/delegated-system-prompt.test.ts
# STOP — report the staged change to the operator.
```

---

## Task 4: Channel replies go through the assembler

`communication/channel-run-agent.ts:53-56` joins the agent's raw systemPrompt
with its constraints. This is every inbound email, Telegram, Slack, WhatsApp
and Signal reply — the literal "email in the brand" case.

**Files:**
- Modify: `src/modules/communication/channel-run-agent.ts:13-26, 45-56`
- Modify: `src/modules/communication/index.ts` (the `createChannelRunAgent({…})` call)
- Test: `tests/modules/communication/channel-run-agent-assembly.test.ts`

**Interfaces:**
- Consumes: `buildDelegatedSystemPrompt` from Task 3.
- Produces: `ChannelRunAgentDeps` gains `promptAssembler?: AssemblerLike`.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createChannelRunAgent } from '@modules/communication/channel-run-agent'

function deps(over: Record<string, any> = {}) {
  const captured: any = {}
  return {
    captured,
    deps: {
      agentRegistry: { get: () => ({ id: 'a1', name: 'A', enabled: true, systemPrompt: 'You are support.', constraints: ['Be brief'], maxTurns: 5 }) },
      conversations: { get: () => ({ id: 'c1', projectId: 'p1', messages: [{ role: 'user', content: 'hi' }] }), addMessage: vi.fn() },
      toolRegistry: { toToolDefinitions: () => [] },
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      agentRunner: {
        run: async function* (input: any) {
          captured.input = input
          yield { type: 'text', text: 'ok' }
        },
      },
      ...over,
    } as any,
  }
}

describe('createChannelRunAgent — prompt assembly', () => {
  it('sends the assembled prompt with the agent prompt appended', async () => {
    const { captured, deps: d } = deps({
      promptAssembler: {
        buildForPrimary: vi.fn().mockResolvedValue({ prefix: 'CORE', suffix: '', reminders: [], sections: [] }),
      },
    })
    const run = createChannelRunAgent(d)
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.system).toContain('CORE')
    expect(captured.input.system).toContain('You are support.')
    expect(captured.input.system).toContain('Be brief')
  })

  it('passes the conversation projectId to the assembler', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue({ prefix: 'CORE', suffix: '', reminders: [], sections: [] })
    const { deps: d } = deps({ promptAssembler: { buildForPrimary } })
    const run = createChannelRunAgent(d)
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', conversationId: 'c1' }))
  })

  it('degrades to the previous behaviour when no assembler is wired', async () => {
    const { captured, deps: d } = deps()
    const run = createChannelRunAgent(d)
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.system).toContain('You are support.')
    expect(captured.input.system).toContain('Be brief')
    expect(captured.input.system).not.toContain('CORE')
  })

  it('degrades to the previous behaviour when the assembler throws', async () => {
    const { captured, deps: d } = deps({
      promptAssembler: { buildForPrimary: vi.fn().mockRejectedValue(new Error('boom')) },
    })
    const run = createChannelRunAgent(d)
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.system).toContain('You are support.')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run tests/modules/communication/channel-run-agent-assembly.test.ts`
Expected: FAIL — the first two tests fail because `system` contains no `CORE`.

- [ ] **Step 3: Change `channel-run-agent.ts`**

Add the import at the top, after the existing `toolWorkspaceFields` import:

```ts
import { buildDelegatedSystemPrompt } from '@modules/agent/delegated-system-prompt.js'
import type { AssemblerLike } from '@modules/prompt-wizard/assemble-system.js'
```

Add one field to `ChannelRunAgentDeps`, after `budgetEngine`:

```ts
  /**
   * F0 — routes channel replies through the prompt assembler so a channel
   * answer carries the same project/workspace context an interactive answer
   * does. Absent (or throwing) falls back to the agent's own systemPrompt,
   * which is exactly the pre-F0 behaviour.
   */
  promptAssembler?: AssemblerLike
```

Replace the `const system = [ … ].join('\n')` block with:

```ts
    const constraints = agent.constraints?.length
      ? `\nConstraints:\n${agent.constraints.map((c: string) => `- ${c}`).join('\n')}`
      : ''
    const composed = await buildDelegatedSystemPrompt({
      assembler: deps.promptAssembler,
      agentId,
      conversationId,
      projectId: conv?.projectId ?? null,
      agentSystemPrompt: [agent.systemPrompt ?? '', constraints].join('\n'),
    })
    const system = composed.system
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run tests/modules/communication/channel-run-agent-assembly.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Record the composition**

The channel path records nothing today, so there is no way to see whether a
brand reached an email reply. Add the recorder as a second optional dep and
stamp the `'channel'` entry point widened into `ContextEntryPoint` in Task 3.

Add to `ChannelRunAgentDeps`, after `promptAssembler`:

```ts
  /** Optional — records what the channel reply's prompt was actually made of. */
  contextRecorder?: { record(input: any): string | null }
```

Immediately after the `const system = composed.system` line:

```ts
    const compositionId = deps.contextRecorder?.record({
      sections: composed.sections,
      entryPoint: composed.entryPoint === 'assembled' ? 'channel' : 'unassembled',
      assemblerError: composed.assemblerError,
      conversationId,
      agentId,
      model: agent.model,
    }) ?? null
```

and add `compositionId: compositionId ?? undefined,` to the existing
`metadata: { … }` object passed to `deps.agentRunner.run({ … })`, next to
`conversationId`.

- [ ] **Step 6: Extend the test for recording**

Append to `tests/modules/communication/channel-run-agent-assembly.test.ts`:

```ts
describe('createChannelRunAgent — context recording', () => {
  it('records a channel composition when the assembler succeeded', async () => {
    const record = vi.fn().mockReturnValue('comp-1')
    const { deps: d } = deps({
      promptAssembler: { buildForPrimary: vi.fn().mockResolvedValue({ prefix: 'CORE', suffix: '', reminders: [], sections: [{ zone: 'prefix', key: 'core-identity', content: 'CORE', chars: 4, estimatedTokens: 1, truncated: false, droppedChars: 0 }] }) },
      contextRecorder: { record },
    })
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ entryPoint: 'channel', conversationId: 'c1' }))
  })

  it('records unassembled when the assembler is absent', async () => {
    const record = vi.fn().mockReturnValue('comp-2')
    const { deps: d } = deps({ contextRecorder: { record } })
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ entryPoint: 'unassembled' }))
  })

  it('does not fail when no recorder is wired', async () => {
    const { deps: d } = deps()
    await expect(createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })).resolves.toBeDefined()
  })
})
```

Run: `bun run vitest run tests/modules/communication/channel-run-agent-assembly.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Wire both deps at the construction site**

Run: `grep -n "createChannelRunAgent(" src/modules/communication/index.ts`

Add both to that call's dependency object as **lazy getters**, so they pick up
whatever `prompt-wizard.onStart` and `observability.onStart` published:

```ts
      get promptAssembler() { return (ctx as any).promptAssembler },
      get contextRecorder() { return (ctx as any).contextRecorder },
```

A plain `promptAssembler: (ctx as any).promptAssembler` is **wrong** here if the
call happens in `onRegister` — it would capture `undefined` forever. Use getters
regardless of which lifecycle hook the call site is in.

- [ ] **Step 8: Run the full suite and the type check**

Run: `bun run test && bun run lint`
Expected: no new failures.

- [ ] **Step 9: Commit boundary — report, do not commit**

```bash
git add src/modules/communication/channel-run-agent.ts \
        src/modules/communication/index.ts \
        tests/modules/communication/channel-run-agent-assembly.test.ts
# STOP — report the staged change to the operator.
```

---

## Task 5: `projectId` on orchestrator child conversations

`orchestrator.ts` creates team-member conversations with plain
`conversations.create({ userId: 'system', title })`, whose INSERT
(`conversation-service.ts:381-382`) has no `project_id` column. The follow-up
`conversations.update(...)` already sets five other fields, and `projectId` is
a valid key in `UPDATE_FIELD_MAP` (`conversation-service.ts:167`). One line.

**Files:**
- Modify: `src/modules/agent/orchestrator.ts:743-758`
- Test: `tests/modules/agent/orchestrator-child-project.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: nothing new; child conversations simply carry `projectId`.

- [ ] **Step 1: Confirm the update payload shape**

Run: `sed -n '740,762p' src/modules/agent/orchestrator.ts`
Expected: a `conversations.create({ userId: 'system', title: … })` followed by a
`const parentConv = … conversations.get(parentConversationId)` and a
`conversations.update(childConv.id, { parentConversationId, agentId, mode: 'managed', goalDescription, workingDirectories, … })`.

- [ ] **Step 2: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'

/**
 * Guards the orchestrator's child-conversation contract at the service level:
 * `projectId` must be an accepted update key, so the one-line orchestrator fix
 * actually lands in the column rather than being silently dropped by
 * UPDATE_FIELD_MAP.
 */
function conversationsTable(db: any) {
  db.run(sql`CREATE TABLE conversations (
    id TEXT PRIMARY KEY, task_id TEXT, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
    provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0,
    project_id TEXT, stage_id TEXT, priority TEXT NOT NULL DEFAULT 'normal',
    pinned INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, due_date TEXT,
    prompt TEXT, sdk_session_id TEXT, assignees TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]', mode TEXT NOT NULL DEFAULT 'simple', agent_id TEXT,
    parent_conversation_id TEXT, goal_description TEXT, complexity TEXT,
    total_cost_usd REAL NOT NULL DEFAULT 0, team_session_id TEXT,
    thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT,
    orchestration TEXT NOT NULL DEFAULT 'auto', voice_scope_override TEXT,
    search_context TEXT, working_directories TEXT, god_mode INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
}

describe('child conversation project inheritance', () => {
  it('accepts projectId through update() and persists it', () => {
    const db = createMemoryDb()
    conversationsTable(db)
    const svc = createConversationService(db)

    const child = svc.create({ userId: 'system', title: 'Member: reviewer' })
    expect(child.projectId).toBeNull()

    svc.update(child.id, { parentConversationId: 'parent-1', agentId: 'a1', mode: 'managed', projectId: 'p-42' })

    const rows = db.all(sql`SELECT project_id FROM conversations WHERE id = ${child.id}`) as any[]
    expect(rows[0].project_id).toBe('p-42')
    expect(svc.get(child.id)?.projectId).toBe('p-42')
  })
})
```

- [ ] **Step 3: Run the test to verify it passes already**

Run: `bun run vitest run tests/modules/agent/orchestrator-child-project.test.ts`
Expected: PASS. This test documents the mechanism the orchestrator fix relies
on; it is a guard, not a red test. If it FAILS, `projectId` is missing from
`UPDATE_FIELD_MAP` and Task 5 must add it before continuing.

- [ ] **Step 4: Accept `projectId` at create time too**

`CreateConversationInput` has no `projectId`, and `create()`'s INSERT
(`conversation-service.ts:381-382`) has no `project_id` column, so a caller
that knows its project cannot say so. F1's brand resolver falls back to a
conversation lookup, but callers that DO know should be able to set it in one
statement.

In `src/modules/conversations/conversation-service.ts`, add to
`CreateConversationInput`:

```ts
  /** The project this conversation belongs to, when the caller knows it. */
  projectId?: string | null
```

Change the INSERT to carry the column:

```ts
          db.run(sql`INSERT INTO conversations (id, task_id, title, status, provider_id, model_id, user_id, tokens_used, project_id, created_at, updated_at)
            VALUES (${id}, ${taskId}, ${input.title ?? null}, 'idle', ${input.providerId ?? null}, ${input.modelId ?? null}, ${input.userId}, 0, ${input.projectId ?? null}, ${now}, ${now})`)
```

and in the returned object literal on the next line change `projectId: null,`
to `projectId: input.projectId ?? null,`.

Add to the test file from Step 2:

```ts
  it('persists projectId supplied at create time', () => {
    const db = createMemoryDb()
    conversationsTable(db)
    const svc = createConversationService(db)
    const c = svc.create({ userId: 'system', title: 'x', projectId: 'p-7' })
    expect(c.projectId).toBe('p-7')
    expect(svc.get(c.id)?.projectId).toBe('p-7')
  })

  it('leaves projectId null when the caller omits it', () => {
    const db = createMemoryDb()
    conversationsTable(db)
    const svc = createConversationService(db)
    expect(svc.create({ userId: 'system', title: 'x' }).projectId).toBeNull()
  })
```

Run: `bun run vitest run tests/modules/agent/orchestrator-child-project.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Make the orchestrator set it**

In `src/modules/agent/orchestrator.ts`, inside the
`conversations.update(childConv.id, { … })` object, add one property after
`workingDirectories`:

```ts
        projectId: parentConv?.projectId ?? null,
```

- [ ] **Step 6: Run the full suite and the type check**

Run: `bun run test && bun run lint`
Expected: no new failures. `createSubConversation` already inherits
`projectId` from the parent (`conversation-service.ts:419-420`) — do not change
it, and do not switch the orchestrator over to it in F0. That swap would also
change `userId`, `providerId` and `modelId` inheritance and belongs in its own
review.

- [ ] **Step 7: Commit boundary — report, do not commit**

```bash
git add src/modules/agent/orchestrator.ts \
        src/modules/conversations/conversation-service.ts \
        tests/modules/agent/orchestrator-child-project.test.ts
# STOP — report the staged change to the operator.
```

---

## Task 6: `projectId` on `ToolContext`

A brand tool must be able to answer "which brand applies here" without a
conversation lookup on every call. `ToolContext` carries `conversationId` and
`agentId` but not `projectId`.

**Files:**
- Modify: `src/modules/tools/types.ts:47-68`
- Modify: `src/modules/agent/index.ts` (the `toolContext:` literal in `executeAgent`)
- Modify: `src/modules/communication/channel-run-agent.ts` (the `toolContext:` literal)
- Test: `tests/modules/tools/tool-context-project.test.ts`

**Interfaces:**
- Produces: `ToolContext.projectId?: string | null`. F1's `brand_get` reads it.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import type { ToolContext } from '@modules/tools/types'

/**
 * Type-level guard. `projectId` is what lets a tool resolve the active brand
 * without a conversation round-trip; if the field is dropped from ToolContext
 * this file stops compiling under `bun run lint`.
 */
describe('ToolContext', () => {
  it('carries an optional projectId', () => {
    const ctx: ToolContext = {
      conversationId: 'c1',
      userId: 'u1',
      projectId: 'p1',
      logger: { warn() {}, info() {}, error() {}, debug() {} } as any,
    }
    expect(ctx.projectId).toBe('p1')
  })

  it('permits a null projectId for conversations with no project', () => {
    const ctx: ToolContext = {
      conversationId: 'c1',
      userId: 'u1',
      projectId: null,
      logger: { warn() {}, info() {}, error() {}, debug() {} } as any,
    }
    expect(ctx.projectId).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run tests/modules/tools/tool-context-project.test.ts && bun run lint`
Expected: `bun run lint` FAILS with "Object literal may only specify known
properties, and 'projectId' does not exist in type 'ToolContext'". Vitest alone
may pass because types are stripped — the type check is the real gate here.

- [ ] **Step 3: Add the field**

In `src/modules/tools/types.ts`, inside `interface ToolContext`, after
`agentRole?: string`:

```ts
  /**
   * The project the conversation belongs to, when it has one. Present so a
   * tool can resolve project-scoped configuration (the active brand) without a
   * conversation lookup on every call. Null for channel, scheduler and
   * orphaned conversations.
   */
  projectId?: string | null
```

- [ ] **Step 4: Run the type check to verify it passes**

Run: `bun run lint`
Expected: PASS.

- [ ] **Step 5: Populate it at the two call sites changed in this plan**

In `src/modules/agent/index.ts`, the `toolContext:` object literal inside
`executeAgent` gains `projectId: conv?.projectId ?? null,` next to
`conversationId`.

In `src/modules/communication/channel-run-agent.ts`, the `toolContext:` object
literal gains `projectId: conv?.projectId ?? null,` next to `conversationId`.

Leave every other `toolContext` construction site alone — an absent
`projectId` is valid and F1's resolver falls back to the conversation lookup.

- [ ] **Step 6: Run the full suite and the type check**

Run: `bun run test && bun run lint`
Expected: no new failures.

- [ ] **Step 7: Commit boundary — report, do not commit**

```bash
git add src/modules/tools/types.ts src/modules/agent/index.ts \
        src/modules/communication/channel-run-agent.ts \
        tests/modules/tools/tool-context-project.test.ts
# STOP — report the staged change to the operator.
```

---

## Task 7: Route-scoped body limits

`src/core/http/server.ts:23` mounts a 1 MiB cap on `'*'`. Its own doc-comment
tells upload routes to mount their own instance first, but there are zero call
sites of `createBodyLimitMiddleware` outside the middleware file, and a second
instance would not help anyway: both middlewares run, so the global would still
reject at 1 MiB.

The fix is a **prefix table inside the single middleware**, resolved by longest
match. One middleware, no ordering trap.

**Files:**
- Modify: `src/core/http/middleware/body-limit.ts`
- Modify: `src/core/http/server.ts:12-26`
- Test: `tests/core/http/body-limit.test.ts` (append)

**Interfaces:**
- Produces: `BodyLimitOptions.overrides?: Array<{ prefix: string; limit: number }>` and `createApp(allowedOrigins?: string[], options?: { bodyLimitOverrides?: Array<{ prefix: string; limit: number }> })`.

- [ ] **Step 1: Write the failing tests (append to the existing file)**

```ts
describe('body-limit middleware — route-scoped overrides', () => {
  function appWithOverrides() {
    const app = new Hono()
    app.use('*', createBodyLimitMiddleware({
      limit: 100,
      overrides: [
        { prefix: '/api/v1/design/', limit: 5000 },
        { prefix: '/api/v1/design/tiny/', limit: 10 },
      ],
    }))
    app.post('/api/v1/design/import', async (c) => c.json({ ok: true, body: await c.req.json().catch(() => null) }))
    app.post('/api/v1/design/tiny/x', async (c) => c.json({ ok: true }))
    app.post('/api/v1/other', async (c) => c.json({ ok: true }))
    return app
  }

  it('raises the cap for a matching prefix', async () => {
    const res = await appWithOverrides().request('https://eyas.test/api/v1/design/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ big: 'x'.repeat(500) }),
    })
    expect(res.status).toBe(200)
  })

  it('keeps the global cap for a non-matching path', async () => {
    const res = await appWithOverrides().request('https://eyas.test/api/v1/other', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ big: 'x'.repeat(500) }),
    })
    expect(res.status).toBe(413)
  })

  it('prefers the longest matching prefix', async () => {
    const res = await appWithOverrides().request('https://eyas.test/api/v1/design/tiny/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ big: 'x'.repeat(500) }),
    })
    expect(res.status).toBe(413)
  })

  it('reports the effective limit in the 413 body', async () => {
    const res = await appWithOverrides().request('https://eyas.test/api/v1/design/tiny/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ big: 'x'.repeat(500) }),
    })
    expect((await res.json() as any).limit).toBe(10)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run tests/core/http/body-limit.test.ts`
Expected: the four new tests FAIL — `overrides` is not a known option, so every
request is capped at 100 and the first test gets 413.

- [ ] **Step 3: Implement the prefix table**

In `src/core/http/middleware/body-limit.ts`, extend the options interface:

```ts
export interface BodyLimitOverride {
  /** Path prefix this limit applies to, e.g. '/api/v1/design/'. */
  prefix: string
  /** Max body size in bytes for paths under `prefix`. */
  limit: number
}
```

Add to `BodyLimitOptions`:

```ts
  /**
   * Per-prefix caps. Resolved by LONGEST matching prefix, so a narrower rule
   * beats a broader one. Kept inside this middleware rather than mounted as a
   * second instance: two instances both run, and the global one would still
   * reject the request the narrower one just allowed.
   */
  overrides?: BodyLimitOverride[]
```

Inside `createBodyLimitMiddleware`, replace `const limit = options.limit ?? DEFAULT_LIMIT`
with:

```ts
  const baseLimit = options.limit ?? DEFAULT_LIMIT
  // Longest prefix first so the first match is the most specific one.
  const overrides = [...(options.overrides ?? [])].sort((a, b) => b.prefix.length - a.prefix.length)

  function limitFor(pathname: string): number {
    for (const o of overrides) {
      if (pathname.startsWith(o.prefix)) return o.limit
    }
    return baseLimit
  }
```

Then, as the first statement inside the returned handler after the method
check, resolve the effective limit and use it everywhere `limit` was used:

```ts
    const limit = limitFor(new URL(c.req.url).pathname)
```

Every remaining reference to `limit` in the handler and in the
`wrapWithLimit(raw.body, limit)` call now reads the per-request value. The
exported `bodyLimitMiddleware` const stays as-is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run vitest run tests/core/http/body-limit.test.ts`
Expected: PASS, all tests including the four new ones.

- [ ] **Step 5: Let `createApp` pass overrides, and fix documents**

In `src/core/http/server.ts`, change the import and the signature:

```ts
import { createBodyLimitMiddleware, type BodyLimitOverride } from './middleware/body-limit.js'

export interface CreateAppOptions {
  /**
   * Per-prefix body-size caps. The 1 MiB global default is right for JSON
   * APIs and wrong for uploads; a module cannot raise it from its own routes
   * because this middleware is mounted first, on '*'.
   */
  bodyLimitOverrides?: BodyLimitOverride[]
}

export function createApp(allowedOrigins?: string[], options: CreateAppOptions = {}) {
```

Replace the `app.use('*', bodyLimitMiddleware)` line and its comment with:

```ts
  // 1 MiB global body cap, raised per prefix for routes that legitimately
  // accept larger bodies (document uploads, brand assets, design imports).
  app.use('*', createBodyLimitMiddleware({
    overrides: [
      { prefix: '/api/v1/documents/', limit: 25 * 1024 * 1024 },
      { prefix: '/api/v1/brands/', limit: 8 * 1024 * 1024 },
      { prefix: '/api/v1/designs/', limit: 8 * 1024 * 1024 },
      ...(options.bodyLimitOverrides ?? []),
    ],
  }))
```

The `bodyLimitMiddleware` import is now unused in this file — remove it. Caller
overrides come last so they win ties at equal prefix length.

- [ ] **Step 6: Add a regression test for the documents cap**

Append to `tests/core/http/body-limit.test.ts`:

```ts
describe('createApp default overrides', () => {
  it('accepts a 4 MiB body on the documents prefix', async () => {
    const { createApp } = await import('@core/http/server')
    const app = createApp()
    app.post('/api/v1/documents/upload', (c) => c.json({ ok: true }))
    const res = await app.request('https://eyas.test/api/v1/documents/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024) },
      body: JSON.stringify({ pad: 'x' }),
    })
    expect(res.status).not.toBe(413)
  })

  it('still rejects a 4 MiB body on a plain API path', async () => {
    const { createApp } = await import('@core/http/server')
    const app = createApp()
    app.post('/api/v1/plain', (c) => c.json({ ok: true }))
    const res = await app.request('https://eyas.test/api/v1/plain', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024) },
      body: JSON.stringify({ pad: 'x' }),
    })
    expect(res.status).toBe(413)
  })
})
```

- [ ] **Step 7: Run the full suite and the type check**

Run: `bun run test && bun run lint`
Expected: no new failures. `tests/core/http/security-headers.test.ts` pins
DEFAULT_CSP and must be untouched by this task.

- [ ] **Step 8: Commit boundary — report, do not commit**

```bash
git add src/core/http/middleware/body-limit.ts src/core/http/server.ts \
        tests/core/http/body-limit.test.ts
# STOP — report the staged change to the operator.
```

---

## Task 8: Public asset serving

Brand logos must load in an email client and in an exported HTML page. Today
`documents` forces `Content-Disposition: attachment`, `getUrl()` returns null
unconditionally, and `Cross-Origin-Resource-Policy` is `same-origin`, so no
EYAS-hosted image can be embedded anywhere.

A new static route under `<dataDir>/public/` solves it. It is mounted in
`main.ts`'s `Bun.serve` handler **above** `tryServeWebSpa`, which is an
unconditional catch-all. That position also means it bypasses Hono and
therefore every security header — so this file sets its own.

**Files:**
- Create: `src/cli/utils/public-assets.ts`
- Modify: `src/main.ts` (import + one branch in the fetch handler)
- Test: `tests/cli/public-assets.test.ts`

**Interfaces:**
- Produces: `tryServePublicAsset(pathname: string, publicRoot: string): Response | null` and `PUBLIC_ASSET_PREFIX = '/assets/'`.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { tryServePublicAsset, PUBLIC_ASSET_PREFIX } from '../../src/cli/utils/public-assets'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-public-'))
  mkdirSync(join(root, 'brand', 'b1'), { recursive: true })
  writeFileSync(join(root, 'brand', 'b1', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(root, 'brand', 'b1', 'evil.html'), '<script>alert(1)</script>')
  writeFileSync(join(root, 'secret.txt'), 'nope')
})

afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('tryServePublicAsset', () => {
  it('returns null for paths outside the prefix', () => {
    expect(tryServePublicAsset('/api/v1/health', root)).toBeNull()
    expect(tryServePublicAsset('/', root)).toBeNull()
  })

  it('serves an existing image with its mime type', async () => {
    const res = tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1/logo.png`, root)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    expect(res!.headers.get('content-type')).toBe('image/png')
  })

  it('sets cross-origin CORP so the asset can load in an email or export', () => {
    const res = tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1/logo.png`, root)!
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('max-age=')
  })

  it('refuses extensions that are not in the asset allow-list', () => {
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1/evil.html`, root)).toBeNull()
  })

  it('refuses path traversal out of the root', () => {
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}../secret.txt`, root)).toBeNull()
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/../../secret.txt`, root)).toBeNull()
  })

  it('returns null for a missing file rather than throwing', () => {
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1/absent.png`, root)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run tests/cli/public-assets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/cli/utils/public-assets.ts
//
// Serves brand assets (logos, favicons, later fonts) from <dataDir>/public/.
//
// Three things make this its own route rather than a documents endpoint:
// documents forces Content-Disposition: attachment, its local provider's
// getUrl() returns null, and every Hono response carries
// Cross-Origin-Resource-Policy: same-origin — so a documents-hosted logo can
// load in neither an email client nor an exported HTML page.
//
// This route is mounted in main.ts's Bun.serve handler, ABOVE the SPA
// catch-all and therefore OUTSIDE Hono. It gets none of the app's security
// middleware, so it sets its own headers and serves an allow-listed set of
// binary types only. Never add .html, .js or .svg here: this origin holds the
// session cookie, and an inline-served document from it is a stored-XSS
// vector.

import { existsSync, statSync } from 'fs'
import { extname, resolve } from 'path'

export const PUBLIC_ASSET_PREFIX = '/assets/'

/** Binary asset types only — nothing the browser will execute or parse as markup. */
const ASSET_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

function isUnderRoot(candidate: string, root: string): boolean {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root
  return candidate === normalizedRoot || candidate.startsWith(normalizedRoot + '/')
}

/**
 * Resolve `pathname` under `publicRoot` and return a Response, or null when
 * the path is not an asset request, escapes the root, has a disallowed
 * extension, or does not exist.
 */
export function tryServePublicAsset(pathname: string, publicRoot: string): Response | null {
  if (!pathname.startsWith(PUBLIC_ASSET_PREFIX)) return null

  const relative = decodeURIComponent(pathname.slice(PUBLIC_ASSET_PREFIX.length)).replace(/^\/+/, '')
  if (!relative) return null

  const ext = extname(relative).toLowerCase()
  const mime = ASSET_MIME_TYPES[ext]
  if (!mime) return null

  const root = resolve(publicRoot)
  const candidate = resolve(root, relative)
  if (!isUnderRoot(candidate, root)) return null
  if (!existsSync(candidate)) return null

  try {
    if (!statSync(candidate).isFile()) return null
  } catch {
    return null
  }

  return new Response(Bun.file(candidate), {
    headers: {
      'Content-Type': mime,
      // Deliberate: this is the one EYAS origin an email client or an exported
      // page may pull from.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      // Asset filenames are content-hashed by the brand module, so a long
      // immutable cache is safe.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run tests/cli/public-assets.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Mount it in `main.ts`**

Extend the existing import:

```ts
import { tryServeDocs, tryServeWebSpa } from './cli/utils/static-files.js'
import { tryServePublicAsset } from './cli/utils/public-assets.js'
```

Add a `publicAssetDir` next to the other resolved directories, after
`const instance = resolveInstance({ ensureDirs: false })`:

```ts
  const publicAssetDir = join(instance.dataDir, 'public')
```

with `join` imported from `node:path` at the top of the file if it is not
already.

In the `Bun.serve({ fetch(req, server) { … } })` handler, insert the branch
immediately after the `/api/` + `/.well-known/` branch and **before** the docs
and SPA branches:

```ts
      const assetRes = tryServePublicAsset(url.pathname, publicAssetDir)
      if (assetRes) return assetRes
```

Position matters: `tryServeWebSpa` is an unconditional catch-all, so anything
below it never runs.

- [ ] **Step 6: Manually verify the route**

```bash
mkdir -p "$(node -e "console.log(process.env.EYAS_DATA_DIR || require('os').homedir()+'/.eyas/data')")/public/brand/test"
# drop any small PNG at that path as logo.png, start the server, then:
curl -sI http://127.0.0.1:3000/assets/brand/test/logo.png
```

Expected: `HTTP/1.1 200`, `content-type: image/png`,
`cross-origin-resource-policy: cross-origin`. If the exact data dir is unclear,
read it from the startup log line `Instance home: …`.

- [ ] **Step 7: Run the full suite and the type check**

Run: `bun run test && bun run lint`
Expected: no new failures.

- [ ] **Step 8: Commit boundary — report, do not commit**

```bash
git add src/cli/utils/public-assets.ts src/main.ts tests/cli/public-assets.test.ts
# STOP — report the staged change to the operator.
```

---

## Task 9: Reach contract test and the sanitizer dependency

F0's acceptance criterion is that the assembler reaches every entry point. A
structural contract test freezes that, in the same style as
`tests/contracts/api-auth-coverage.contract.test.ts`, which regex-scans source
rather than booting the app. Entry points F0 deliberately does not fix go in a
frozen debt baseline so they cannot grow silently.

DOMPurify is added here, unused, because F2 and F3 both need it and the licence
check belongs with the foundation work.

**Files:**
- Create: `tests/contracts/prompt-assembly-reach.contract.test.ts`
- Modify: `package.json` (dependency)

**Interfaces:**
- Consumes: the entry points changed in Tasks 3 and 4.

- [ ] **Step 1: Write the contract test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Prompt-assembly reach contract.
 *
 * Before F0, four of roughly ten system-prompt entry points called the
 * assembler and the rest hand-rolled a `system` string, so anything the
 * assembler contributes — the project cascade, and from F1 the project brand —
 * silently missed delegated subagents and every channel reply.
 *
 * This test freezes the repair: each covered entry point must reach the
 * assembler, directly or through the shared helper. The debt baseline lists
 * the paths F0 knowingly leaves unassembled; shrinking it is welcome, growing
 * it must be a deliberate edit to this file.
 */

const root = resolve(__dirname, '../..')

/** Files that must reach the assembler. */
const COVERED_ENTRY_POINTS = [
  'src/modules/conversations/system-prompt.ts',
  'src/modules/agent/conversation-runner.ts',
  'src/modules/agent/orchestrator.ts',
  'src/modules/agent/delegated-system-prompt.ts',
  'src/modules/communication/channel-run-agent.ts',
]

/**
 * Known-unassembled paths. Each entry names why it is still hand-rolled.
 * FROZEN — do not add to this list without a written decision in the spec.
 */
const UNASSEMBLED_DEBT_BASELINE: Record<string, string> = {
  'src/modules/research/report-generator.ts': 'passes no system prompt at all; F3 changes the call site',
  'src/modules/model/submodules/claude-code/provider.ts': 'maps EYAS agents onto the SDK options.agents array; the SDK owns the subagent prompt',
}

const ASSEMBLY_MARKERS = [
  'buildForPrimary',
  'assembleSystemPrompt',
  'buildDelegatedSystemPrompt',
  'resolveConversationSystemPrompt',
]

function readIfPresent(rel: string): string | null {
  const p = resolve(root, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

describe('prompt assembly reach', () => {
  for (const rel of COVERED_ENTRY_POINTS) {
    it(`${rel} reaches the prompt assembler`, () => {
      const src = readIfPresent(rel)
      expect(src, `${rel} is missing — update COVERED_ENTRY_POINTS if it moved`).not.toBeNull()
      const hit = ASSEMBLY_MARKERS.some((m) => src!.includes(m))
      expect(hit, `${rel} builds a system prompt without touching the assembler. Route it through assembleSystemPrompt / buildDelegatedSystemPrompt.`).toBe(true)
    })
  }

  it('the unassembled debt baseline has not grown', () => {
    expect(Object.keys(UNASSEMBLED_DEBT_BASELINE).sort()).toEqual([
      'src/modules/model/submodules/claude-code/provider.ts',
      'src/modules/research/report-generator.ts',
    ])
  })

  it('every debt entry still exists and still lacks assembly', () => {
    for (const rel of Object.keys(UNASSEMBLED_DEBT_BASELINE)) {
      const src = readIfPresent(rel)
      if (src === null) continue // file moved or was deleted; the baseline shrinks on the next edit
      const hit = ASSEMBLY_MARKERS.some((m) => src.includes(m))
      expect(hit, `${rel} now reaches the assembler — remove it from UNASSEMBLED_DEBT_BASELINE.`).toBe(false)
    }
  })

  it('the shared helper never throws by construction', () => {
    const src = readIfPresent('src/modules/prompt-wizard/assemble-system.ts')
    expect(src).not.toBeNull()
    expect(src!).toContain('catch')
    expect(src!).toContain('assemblerError')
  })

  it('the active-voice adapter swallows resolver failures', () => {
    const src = readIfPresent('src/modules/prompt-wizard/active-voice-adapter.ts')
    expect(src).not.toBeNull()
    expect(src!).toContain('catch')
    expect(src!).toContain('FALLBACK_VOICE_PROFILE')
  })
})
```

- [ ] **Step 2: Run the contract test**

Run: `bun run vitest run tests/contracts/prompt-assembly-reach.contract.test.ts`
Expected: PASS once Tasks 1-4 are done. If
`src/modules/agent/conversation-runner.ts` fails, confirm with
`grep -n "buildForPrimary" src/modules/agent/conversation-runner.ts` — the spec
records it as already calling the assembler at lines 398-404. If the path is
different in the tree, correct `COVERED_ENTRY_POINTS`, do not weaken the
markers.

- [ ] **Step 3: Add the sanitizer dependency**

```bash
bun add dompurify
bun add -d @types/dompurify
```

- [ ] **Step 4: Verify the licence**

Run: `node -e "console.log(require('./node_modules/dompurify/package.json').license)"`
Expected: a string containing `Apache-2.0` (DOMPurify is dual-licensed
Apache-2.0 / MPL-2.0). Apache-2.0 satisfies the project rule. If the field
reports only MPL-2.0, **stop and report** — MPL is not on the allowed list in
`CLAUDE.md` and the choice needs a decision.

- [ ] **Step 5: Confirm nothing else changed in package.json**

Run: `git diff package.json`
Expected: only the new dependency lines. The `version` field must be untouched.

- [ ] **Step 6: Run the full suite and the type check**

Run: `bun run test && bun run lint`
Expected: no new failures.

- [ ] **Step 7: Commit boundary — report, do not commit**

```bash
git add tests/contracts/prompt-assembly-reach.contract.test.ts package.json bun.lock
# STOP — report the staged change to the operator.
```

---

## F0 exit criteria

All of these must hold before F1 starts:

1. `bun run test` and `bun run lint` are green.
2. `tests/contracts/prompt-assembly-reach.contract.test.ts` passes with a
   two-entry debt baseline.
3. A conversation reply produced through a channel records a
   `context_compositions` row whose `entry_point` is not `unassembled`.
4. A delegated subagent run records sections including
   `agent-definition-prompt`.
5. `POST` of a 4 MiB body to `/api/v1/documents/*` is not rejected with 413.
6. `GET /assets/<something>.png` returns 200 with
   `Cross-Origin-Resource-Policy: cross-origin`.
7. An agent with no `SOUL.style.json` still receives a non-empty system prompt.
8. No version number changed anywhere.
