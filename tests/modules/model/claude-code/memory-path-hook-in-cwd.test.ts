// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K2 (R2A-07) — Claude Code reads inside its working directory without
// asking: those calls never reach canUseTool. The memory-policy PreToolUse
// hook sees them anyway, so a protected place that shows up INSIDE an
// allowed cwd after the folder was validated (a vault created there, a
// symlink into EYAS's data) is still refused — by absolute path, by a path
// relative to the cwd, by a search of the cwd and by a shell read. Folder
// validation then refuses the folder itself on the next turn. Throw-away
// layout only (tests/helpers/memory-sovereignty-fixture.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import { buildMemoryPathHook, memoryPathHookCheckFor } from '@modules/model/submodules/claude-code/memory-path-hook.js'
import { validateWorkingDirectories } from '@modules/tools/working-directories.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../../helpers/memory-sovereignty-fixture.js'

let f: SovereigntyFixture
let project: string

async function call(hook: HookCallbackMatcher, toolName: string, toolInput: Record<string, unknown>, cwd: string): Promise<any> {
  const input = { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, tool_use_id: 'tu-1', session_id: 's', transcript_path: '', cwd }
  return hook.hooks[0](input as any, 'tu-1', { signal: new AbortController().signal })
}

const denied = (out: any): boolean => out?.hookSpecificOutput?.permissionDecision === 'deny'
const passed = (out: any): boolean => out?.continue === true && out.hookSpecificOutput === undefined

/** The hook as the provider builds it with no gate wired: the process-wide policy. */
const hookFor = (cwd: string) => buildMemoryPathHook({ check: memoryPathHookCheckFor(), ctx: { workingDirectories: [cwd], conversationId: 'conv-k2' } })

beforeEach(() => {
  f = createSovereigntyFixture()
  installPathPolicy(f.policy)
  vi.stubEnv('HOME', f.home)
  project = join(f.root, 'projects', 'app')
  mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, 'src', 'a.ts'), 'export const a = 1\n')
})
afterEach(() => {
  resetPathPolicyForTests()
  vi.unstubAllEnvs()
  f.cleanup()
})

describe('memory-policy hook — protected places inside an allowed cwd (K2)', () => {
  it('the project validated as a folder before anything protected was in it', () => {
    expect(validateWorkingDirectories([project], { homeDir: f.home, eyasHome: join(f.root, 'nowhere') }).ok).toBe(true)
  })

  it('(−) a vault created in the cwd later: absolute, relative, search and shell reads are all denied', async () => {
    mkdirSync(join(project, 'notes', '.obsidian'), { recursive: true })
    writeFileSync(join(project, 'notes', 'journal.md'), 'private\n')
    const hook = hookFor(project)
    expect(denied(await call(hook, 'Read', { file_path: join(project, 'notes', 'journal.md') }, project))).toBe(true)
    expect(denied(await call(hook, 'Read', { file_path: 'notes/journal.md' }, project))).toBe(true)
    expect(denied(await call(hook, 'Grep', { pattern: 'private' }, project))).toBe(true)
    expect(denied(await call(hook, 'Glob', { pattern: '**/*.md' }, project))).toBe(true)
    expect(denied(await call(hook, 'Bash', { command: 'cat notes/journal.md', description: 'read' }, project))).toBe(true)
    // And the folder itself is refused from now on.
    const again = validateWorkingDirectories([project], { homeDir: f.home, eyasHome: join(f.root, 'nowhere') })
    expect(again.ok === false && again.code).toBe('containsVault')
  })

  it('(−) a symlink in the cwd into the EYAS vault: reading through it is denied', async () => {
    symlinkSync(join(f.dataDir, 'vault'), join(project, 'kb'))
    const hook = hookFor(project)
    expect(denied(await call(hook, 'Read', { file_path: join(project, 'kb', 'semantic', 'fact.md') }, project))).toBe(true)
    expect(denied(await call(hook, 'Read', { file_path: 'kb/semantic/fact.md' }, project))).toBe(true)
    expect(denied(await call(hook, 'Grep', { pattern: 'fact', path: 'kb' }, project))).toBe(true)
  })

  it('(−) with a checkout holding data/ as the cwd, data/ is still denied — reads, relative reads and searches', async () => {
    const hook = hookFor(f.repo)
    expect(denied(await call(hook, 'Read', { file_path: f.eyasVaultNote }, f.repo))).toBe(true)
    expect(denied(await call(hook, 'Read', { file_path: 'data/vault/semantic/fact.md' }, f.repo))).toBe(true)
    expect(denied(await call(hook, 'Grep', { pattern: 'fact', glob: 'data/vault/**' }, f.repo))).toBe(true)
    expect(denied(await call(hook, 'LS', { path: join(f.repo, 'data') }, f.repo))).toBe(true)
  })

  it('(+) ordinary in-cwd reads and searches pass (continue, never an allow)', async () => {
    const hook = hookFor(project)
    expect(passed(await call(hook, 'Read', { file_path: join(project, 'src', 'a.ts') }, project))).toBe(true)
    expect(passed(await call(hook, 'Read', { file_path: 'src/a.ts' }, project))).toBe(true)
    expect(passed(await call(hook, 'Grep', { pattern: 'const' }, project))).toBe(true)
    expect(passed(await call(hook, 'Glob', { pattern: '**/*.ts' }, project))).toBe(true)
    expect(passed(await call(hook, 'Read', { file_path: join(f.repo, 'src', 'a.ts') }, f.repo))).toBe(true)
  })
})
