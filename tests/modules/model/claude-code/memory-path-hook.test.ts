// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B4 — Claude Code's single memory-policy PreToolUse hook. It sees every tool
// call before it runs, including the reads the CLI would allow on its own
// (which never reach canUseTool). A violation is a 'deny' with the policy's
// reason; a clean path is `continue` and never 'allow' (an allow would skip
// canUseTool and the gate); anything that goes wrong inside the hook denies.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import {
  createPathPolicy,
  installPathPolicy,
  resetPathPolicyForTests,
  workAreaRootsOf,
  type PathPolicy,
} from '@shared/memory-sovereignty/path-policy.js'
import {
  buildMemoryPathHook,
  memoryPathHookCheckFor,
  policyMemoryPathHookCheck,
  type MemoryPathHookCheck,
  type MemoryPathHookContext,
} from '@modules/model/submodules/claude-code/memory-path-hook.js'
import { createMemoryDb } from '../../../helpers/test-db'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { securityGateModule } from '@modules/security-gate/index.js'

let root: string
let home: string
let dataDir: string
let workspacesRoot: string
let ownWs: string
let otherWs: string
let vault: string
let vaultNote: string
let policy: PathPolicy

function mk(...parts: string[]): string {
  const dir = join(...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-cc-hook-')))
  home = mk(root, 'home')
  dataDir = mk(root, 'eyas', 'data')
  mk(dataDir, 'vault', 'semantic')
  // A relocated workspaces root, outside the data dir.
  workspacesRoot = mk(root, 'app-support', 'eyas', 'workspaces')
  ownWs = mk(workspacesRoot, 'conv-own')
  otherWs = mk(workspacesRoot, 'conv-other')
  vault = mk(home, 'Notes', 'SomeVault')
  mk(vault, '.obsidian')
  vaultNote = join(mk(vault, 'journal'), 'note.md')
  writeFileSync(vaultNote, 'private note\n')
  mk(home, '.claude')
  mk(home, '.grok', 'memory')
  ownCtx = { workingDirectories: [ownWs], conversationId: 'conv-own', agentId: 'a1' }
  policy = createPathPolicy({
    homeDir: home,
    env: {},
    dataDir,
    databasePath: join(dataDir, 'sqlite', 'eyas.db'),
    extraForeignPaths: [],
    workspacesRoot,
    workAreaRoots: workAreaRootsOf({ dataDir, workspacesDir: workspacesRoot }),
    providerHomes: [join(dataDir, 'cli-homes')],
  })
})

afterAll(() => {
  resetPathPolicyForTests()
  rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  resetPathPolicyForTests()
})

/** The injected policy as a gate-shaped check (the hook's contract). */
const policyCheck: MemoryPathHookCheck = (toolName, input, ctx) => {
  const v = policy.evaluateToolInput(toolName, input, { workingDirectories: ctx.workingDirectories })
  return v ? { decision: 'deny', reason: `denied: ${v.label}` } : null
}

/** The turn's context: its own workspace as the only working directory (set in beforeAll). */
let ownCtx: MemoryPathHookContext

async function run(matcher: HookCallbackMatcher, toolName: unknown, toolInput: unknown, event = 'PreToolUse'): Promise<any> {
  const input = { hook_event_name: event, tool_name: toolName, tool_input: toolInput, tool_use_id: 'tu-1', session_id: 's', transcript_path: '', cwd: ownWs }
  expect(matcher.hooks).toHaveLength(1)
  return matcher.hooks[0](input as any, 'tu-1', { signal: new AbortController().signal })
}

function expectDeny(out: any, reason?: RegExp): void {
  expect(out.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
  expect(out.hookSpecificOutput?.permissionDecision).toBe('deny')
  if (reason) expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(reason)
}

function expectPass(out: any): void {
  expect(out).toEqual({ continue: true })
  // Never an allow: that would skip canUseTool and the gate.
  expect(out.hookSpecificOutput).toBeUndefined()
}

describe('buildMemoryPathHook — denies (policy violations)', () => {
  const hook = () => buildMemoryPathHook({ check: policyCheck, ctx: ownCtx })

  it('runs for every tool: no matcher pattern', () => {
    expect(hook().matcher).toBeUndefined()
  })

  it('Read ~/.claude/CLAUDE.md', async () => {
    expectDeny(await run(hook(), 'Read', { file_path: '~/.claude/CLAUDE.md' }), /Claude Code/)
  })

  it('Glob pattern ~/.grok/**', async () => {
    expectDeny(await run(hook(), 'Glob', { pattern: '~/.grok/**' }), /Grok CLI/)
  })

  it('Bash cat of a vault note (vault found by its .obsidian marker)', async () => {
    expectDeny(await run(hook(), 'Bash', { command: `cat "${vaultNote}"` }))
  })

  it('mcp__eyas__read_file of <dataDir>/vault (prefix stripped before the check)', async () => {
    const check = vi.fn(policyCheck)
    const out = await run(buildMemoryPathHook({ check, ctx: ownCtx }), 'mcp__eyas__read_file', { path: join(dataDir, 'vault', 'semantic', 'x.md') })
    expectDeny(out)
    expect(check).toHaveBeenCalledWith('read_file', { path: join(dataDir, 'vault', 'semantic', 'x.md') }, ownCtx)
  })

  it('Read of another conversation\'s workspace under a relocated workspaces root', async () => {
    expectDeny(await run(hook(), 'Read', { file_path: join(otherWs, 'out.md') }))
  })
})

describe('buildMemoryPathHook — passes (clean paths)', () => {
  const hook = () => buildMemoryPathHook({ check: policyCheck, ctx: ownCtx })

  it('a Read inside the turn\'s own workspace', async () => {
    expectPass(await run(hook(), 'Read', { file_path: join(ownWs, 'out.md') }))
  })

  it('git status', async () => {
    expectPass(await run(hook(), 'Bash', { command: 'git status' }))
  })

  it('a tool with no input at all', async () => {
    const check = vi.fn(policyCheck)
    expectPass(await run(buildMemoryPathHook({ check, ctx: ownCtx }), 'TodoWrite', undefined))
    expect(check).toHaveBeenCalledWith('TodoWrite', {}, ownCtx)
  })

  it('an event other than PreToolUse is not judged', async () => {
    const check = vi.fn(policyCheck)
    expectPass(await run(buildMemoryPathHook({ check, ctx: ownCtx }), 'Read', { file_path: vaultNote }, 'PostToolUse'))
    expect(check).not.toHaveBeenCalled()
  })
})

describe('buildMemoryPathHook — verdict shapes', () => {
  it('an explicit allow verdict passes, still without an allow decision', async () => {
    expectPass(await run(buildMemoryPathHook({ check: () => ({ decision: 'allow', reason: 'fine' }), ctx: ownCtx }), 'Read', { file_path: '/x' }))
  })

  it('a deny verdict carries its reason to the model; a reasonless one gets a generic reason', async () => {
    expectDeny(await run(buildMemoryPathHook({ check: async () => ({ decision: 'deny', reason: 'Memory outside EYAS (Obsidian vault)' }), ctx: ownCtx }), 'Read', { file_path: '/x' }), /^Memory outside EYAS \(Obsidian vault\)$/)
    expectDeny(await run(buildMemoryPathHook({ check: () => ({ decision: 'deny' }), ctx: ownCtx }), 'Read', { file_path: '/x' }), /Memory-path policy/)
  })

  it('logs a deny with the call\'s ids, never the path', async () => {
    const logger = { warn: vi.fn() }
    await run(buildMemoryPathHook({ check: () => ({ decision: 'deny', reason: 'r' }), ctx: ownCtx, logger }), 'Read', { file_path: '/secret/path' })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logger.warn.mock.calls[0])).not.toContain('/secret/path')
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ toolName: 'Read', conversationId: 'conv-own', agentId: 'a1' })
  })
})

describe('buildMemoryPathHook — fail-closed', () => {
  it('a check that throws denies', async () => {
    const logger = { warn: vi.fn() }
    const hook = buildMemoryPathHook({ check: () => { throw new Error('policy exploded') }, ctx: ownCtx, logger })
    expectDeny(await run(hook, 'Read', { file_path: join(ownWs, 'ok.md') }), /fail-closed.*policy exploded/)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('a check that rejects denies', async () => {
    const hook = buildMemoryPathHook({ check: async () => { throw new Error('async boom') }, ctx: ownCtx })
    expectDeny(await run(hook, 'Read', { file_path: join(ownWs, 'ok.md') }), /fail-closed/)
  })

  it('an input that is not an object denies without asking the check', async () => {
    const check = vi.fn(policyCheck)
    expectDeny(await run(buildMemoryPathHook({ check, ctx: ownCtx }), 'Read', 'cat ~/.claude/CLAUDE.md'), /fail-closed/)
    expectDeny(await run(buildMemoryPathHook({ check, ctx: ownCtx }), 'Read', [vaultNote]), /fail-closed/)
    expect(check).not.toHaveBeenCalled()
  })

  it('a call without a tool name denies', async () => {
    expectDeny(await run(buildMemoryPathHook({ check: policyCheck, ctx: ownCtx }), undefined, { file_path: join(ownWs, 'ok.md') }), /fail-closed/)
  })
})

// G2 — the provider settles a hook-refused call's tool row as 'denied'.
describe('buildMemoryPathHook — onDeny observer', () => {
  it('reports every deny with the call id, the stripped tool name and the reason', async () => {
    const onDeny = vi.fn()
    const hook = buildMemoryPathHook({ check: () => ({ decision: 'deny', reason: 'Memory outside EYAS' }), ctx: ownCtx, onDeny })
    expectDeny(await run(hook, 'mcp__eyas__read_file', { path: '/x' }))
    expect(onDeny).toHaveBeenCalledWith({ toolUseId: 'tu-1', toolName: 'read_file', reason: 'Memory outside EYAS' })
  })

  it('also reports a fail-closed deny (a check that throws)', async () => {
    const onDeny = vi.fn()
    const hook = buildMemoryPathHook({ check: () => { throw new Error('boom') }, ctx: ownCtx, onDeny })
    expectDeny(await run(hook, 'Read', { file_path: join(ownWs, 'ok.md') }))
    expect(onDeny).toHaveBeenCalledWith(expect.objectContaining({ toolUseId: 'tu-1', toolName: 'Read', reason: expect.stringMatching(/fail-closed.*boom/) }))
  })

  it('is never called for a clean path or another event', async () => {
    const onDeny = vi.fn()
    expectPass(await run(buildMemoryPathHook({ check: () => null, ctx: ownCtx, onDeny }), 'Read', { file_path: join(ownWs, 'ok.md') }))
    expectPass(await run(buildMemoryPathHook({ check: () => ({ decision: 'deny', reason: 'r' }), ctx: ownCtx, onDeny }), 'Read', { file_path: '/x' }, 'PostToolUse'))
    expect(onDeny).not.toHaveBeenCalled()
  })

  it('an observer that throws never changes the deny', async () => {
    const hook = buildMemoryPathHook({ check: () => ({ decision: 'deny', reason: 'r' }), ctx: ownCtx, onDeny: () => { throw new Error('observer broke') } })
    expectDeny(await run(hook, 'Read', { file_path: '/x' }), /^r$/)
  })
})

describe('memoryPathHookCheckFor — the gate when wired, else the process-wide policy', () => {
  it('a wired gate check is used as is', () => {
    const gateCheck: MemoryPathHookCheck = () => null
    expect(memoryPathHookCheckFor(gateCheck)).toBe(gateCheck)
  })

  it('without a gate the process-wide policy answers, with the gate\'s wording', async () => {
    installPathPolicy(policy)
    expect(memoryPathHookCheckFor(undefined)).toBe(policyMemoryPathHookCheck)
    const hook = buildMemoryPathHook({ check: memoryPathHookCheckFor(undefined), ctx: ownCtx })
    expectDeny(await run(hook, 'Read', { file_path: '~/.claude/CLAUDE.md' }), /^Memory outside EYAS \(Claude Code \(~\/\.claude\)\) — use memory_search \/ memory_expand from EYAS$/)
    expectDeny(await run(hook, 'Read', { file_path: join(otherWs, 'x.md') }), /^Not this conversation's workspace/)
    expectPass(await run(hook, 'Read', { file_path: join(ownWs, 'x.md') }))
  })
})

describe('with the real security gate — one audited row per deny', () => {
  const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }

  async function realGate() {
    const db = createMemoryDb()
    const ctx = { db, model: {}, permissions: createPermissionRegistry(), logger: noopLogger, bus: { emit() {} } } as any
    await securityGateModule.onRegister!(ctx)
    // The gate installs the instance policy on register; the test's layout replaces it.
    installPathPolicy(policy)
    return { db, gate: ctx.securityGate }
  }

  it('a denied Read writes one deterministic security_events row; a clean one writes none', async () => {
    const { db, gate } = await realGate()
    const validate = vi.spyOn(gate, 'validateToolCall')
    const hook = buildMemoryPathHook({ check: memoryPathHookCheckFor((t, i, c) => gate.checkMemoryPath(t, i, c)), ctx: ownCtx })

    expectDeny(await run(hook, 'Read', { file_path: vaultNote }), /Memory outside EYAS/)
    expectPass(await run(hook, 'Read', { file_path: join(ownWs, 'out.md') }))

    const rows = db.all(sql`SELECT tool_name, decision, checkpoint, conversation_id, agent_id FROM security_events`) as any[]
    expect(rows).toEqual([{ tool_name: 'Read', decision: 'deny', checkpoint: 'deterministic', conversation_id: 'conv-own', agent_id: 'a1' }])
    // Deterministic only: the hook never asks the full gate (and so never the judge).
    expect(validate).not.toHaveBeenCalled()
  })

  // K1: the CLI's own searches, which it runs without asking, are judged by
  // what they can reach below their folder — not only by the folder.
  it('Grep, Glob and a recursive Bash search rooted at the home are denied with the coded search reason and audited; the same searches in the workspace pass', async () => {
    const { db, gate } = await realGate()
    const hook = buildMemoryPathHook({ check: memoryPathHookCheckFor((t, i, c) => gate.checkMemoryPath(t, i, c)), ctx: ownCtx })
    const searchTooBroad = /^Search too broad \[memory-path:search-scope:foreign-memory\]: .*search a narrower folder/

    expectDeny(await run(hook, 'Grep', { pattern: 'token', path: home, glob: '**/memory/*.md', output_mode: 'content' }), searchTooBroad)
    expectDeny(await run(hook, 'Glob', { pattern: '**/MEMORY.md', path: home }), searchTooBroad)
    expectDeny(await run(hook, 'Bash', { command: 'grep -r token ~', description: 'search' }), searchTooBroad)
    expectDeny(await run(hook, 'Grep', { pattern: 'note', path: join(home, 'Notes') }), searchTooBroad)

    expectPass(await run(hook, 'Grep', { pattern: 'token', path: ownWs, glob: '**/*.md', output_mode: 'content' }))
    expectPass(await run(hook, 'Glob', { pattern: '**/*.md' }))
    expectPass(await run(hook, 'Bash', { command: 'grep -rn token .', description: 'search' }))

    const rows = db.all(sql`SELECT tool_name, decision, checkpoint, reason FROM security_events ORDER BY id`) as any[]
    expect(rows.map((r) => [r.tool_name, r.decision, r.checkpoint])).toEqual([
      ['Grep', 'deny', 'deterministic'],
      ['Glob', 'deny', 'deterministic'],
      ['Bash', 'deny', 'deterministic'],
      ['Grep', 'deny', 'deterministic'],
    ])
    for (const row of rows) expect(row.reason).toMatch(searchTooBroad)
  })
})
