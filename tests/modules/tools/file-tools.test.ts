// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import { createFileTools } from '@modules/tools/builtin/file-tools'
import { createReviewTools } from '@modules/tools/builtin/review-tools'
import { resolveToolPath } from '@modules/tools/builtin/path-utils'
import {
  createToolHookRegistry,
  createDefaultPreToolUseHooks,
} from '@modules/tools/hooks'
import type { ToolContext } from '@modules/tools/types'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'

function silentCtx(cwd: string): ToolContext {
  const logger: any = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  }
  return {
    conversationId: 'c1',
    userId: 'u1',
    workingDirectory: cwd,
    logger,
  }
}

describe('path-utils', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eyas-path-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('resolves relative paths inside workspace', () => {
    writeFileSync(join(dir, 'a.ts'), 'x')
    const r = resolveToolPath('a.ts', dir)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.relative).toBe('a.ts')
  })

  it('rejects path traversal', () => {
    const r = resolveToolPath('../outside', dir)
    expect(r.ok).toBe(false)
  })

  it('rejects sensitive basenames', () => {
    const r = resolveToolPath('.env', dir)
    expect(r.ok).toBe(false)
  })
})

describe('file tools (coding surface)', () => {
  let dir: string
  let exec: ReturnType<typeof createToolExecutor>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eyas-files-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'hello.ts'), 'export const n = 1\nexport const m = 2\n')
    writeFileSync(join(dir, 'src', 'other.ts'), 'const foo = "bar"\n')

    const registry = createToolRegistry()
    for (const t of createFileTools()) registry.register(t)
    for (const t of createReviewTools()) registry.register(t)
    exec = createToolExecutor(registry, { authorization: 'disabled' })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('read_file returns numbered lines', async () => {
    const r = await exec.execute('read_file', { path: 'src/hello.ts' }, silentCtx(dir))
    expect(r.success).toBe(true)
    expect(String(r.output?.content)).toContain('1|export const n = 1')
  })

  it('edit_file replaces exact string once', async () => {
    const r = await exec.execute(
      'edit_file',
      { path: 'src/hello.ts', oldString: 'export const n = 1', newString: 'export const n = 42' },
      silentCtx(dir),
    )
    expect(r.success).toBe(true)
    expect(r.output?.replacements).toBe(1)
    const body = readFileSync(join(dir, 'src', 'hello.ts'), 'utf8')
    expect(body).toContain('n = 42')
  })

  it('edit_file fails when oldString is not unique', async () => {
    writeFileSync(join(dir, 'src', 'dup.ts'), 'aa\naa\n')
    const r = await exec.execute(
      'edit_file',
      { path: 'src/dup.ts', oldString: 'aa', newString: 'bb' },
      silentCtx(dir),
    )
    expect(r.success).toBe(true) // tool returns error object, not executor failure
    expect(r.output?.error).toMatch(/times/)
  })

  it('write_file creates nested path', async () => {
    const r = await exec.execute(
      'write_file',
      { path: 'nested/x/y.ts', content: 'export {}\n' },
      silentCtx(dir),
    )
    expect(r.success).toBe(true)
    expect(readFileSync(join(dir, 'nested/x/y.ts'), 'utf8')).toContain('export')
  })

  it('grep finds matches', async () => {
    const r = await exec.execute('grep', { pattern: 'export const', path: 'src' }, silentCtx(dir))
    expect(r.success).toBe(true)
    expect((r.output?.matchCount as number) ?? 0).toBeGreaterThan(0)
  })

  it('glob finds ts files', async () => {
    const r = await exec.execute('glob', { pattern: '**/*.ts' }, silentCtx(dir))
    expect(r.success).toBe(true)
    expect((r.output?.count as number) ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('denies escape via read_file', async () => {
    const r = await exec.execute('read_file', { path: '../secret' }, silentCtx(dir))
    expect(r.success).toBe(true)
    expect(r.output?.error).toMatch(/escape|sensitive|required|cannot/i)
  })
})

describe('tool hooks (P4)', () => {
  it('PreToolUse can deny .git paths', async () => {
    const hooks = createToolHookRegistry(createDefaultPreToolUseHooks())
    const result = await hooks.runPreToolUse({
      toolName: 'read_file',
      input: { path: '.git/config' },
      tool: {
        name: 'read_file',
        description: '',
        category: 'shell',
        riskTier: 'green',
        inputSchema: {},
        execute: async () => ({}),
      },
    })
    expect(result.decision).toBe('deny')
  })

  it('PostToolUse runs without throwing on hook error', async () => {
    const hooks = createToolHookRegistry([])
    hooks.addPostToolUse(() => {
      throw new Error('boom')
    })
    await expect(
      hooks.runPostToolUse({
        toolName: 'x',
        input: {},
        tool: {
          name: 'x',
          description: '',
          category: 'custom',
          riskTier: 'green',
          inputSchema: {},
          execute: async () => ({}),
        },
        success: true,
        durationMs: 1,
      }),
    ).resolves.toBeUndefined()
  })
})

// B12: grep/glob never descend into a folder the memory-sovereignty policy
// protects, so a walk over a repository holding data/ or a nested vault
// neither reads nor lists them.
describe('file tools skip protected subtrees (B12)', () => {
  let f: SovereigntyFixture
  let exec: ReturnType<typeof createToolExecutor>
  const SENTINEL = 'sovereign-sentinel-b12'

  const ctxFor = (roots: string[]): ToolContext => ({
    ...silentCtx(roots[0]),
    workingDirectories: roots,
  })

  beforeEach(() => {
    f = createSovereigntyFixture()
    installPathPolicy(f.policy)
    // Protected: EYAS's own vault in the repo's data dir, and an Obsidian vault nested in the repo.
    writeFileSync(join(f.dataDir, 'vault', 'semantic', 'sentinel.md'), `${SENTINEL} eyas vault\n`)
    mkdirSync(join(f.repo, 'notes', '.obsidian'), { recursive: true })
    writeFileSync(join(f.repo, 'notes', 'secret.md'), `${SENTINEL} nested vault\n`)
    // Ordinary files.
    writeFileSync(join(f.repo, 'docs', 'readme.md'), `${SENTINEL} ordinary\n`)
    writeFileSync(f.otherFile, `${SENTINEL} other conversation\n`)
    writeFileSync(f.ownFile, `${SENTINEL} own workspace\n`)

    const registry = createToolRegistry()
    for (const t of createFileTools()) registry.register(t)
    exec = createToolExecutor(registry, { authorization: 'disabled' })
  })

  afterEach(() => {
    resetPathPolicyForTests()
    f.cleanup()
  })

  it('grep over the repo root returns no match from data/vault or a nested vault; ordinary matches stay', async () => {
    const r = await exec.execute('grep', { pattern: SENTINEL }, ctxFor([f.repo]))
    expect(r.success).toBe(true)
    const paths = ((r.output?.matches as Array<{ path: string }>) ?? []).map((m) => m.path)
    expect(paths).toEqual(['docs/readme.md'])
    expect(String(r.output?.text)).not.toContain('eyas vault')
    expect(String(r.output?.text)).not.toContain('nested vault')
  })

  it("glob '**/*.md' over the repo root excludes the protected subtrees", async () => {
    const r = await exec.execute('glob', { pattern: '**/*.md' }, ctxFor([f.repo]))
    expect(r.success).toBe(true)
    const files = (r.output?.files as string[]) ?? []
    expect(files).toEqual(expect.arrayContaining(['CLAUDE.md', 'docs/MEMORY.md', 'docs/readme.md']))
    expect(files.some((p) => p.startsWith('data/'))).toBe(false)
    expect(files.some((p) => p.startsWith('notes/'))).toBe(false)
  })

  it("a walk over a folder holding the workspaces root skips other conversations' workspaces; its own is searched", async () => {
    const appData = dirname(f.workspacesRoot)
    const r = await exec.execute('grep', { pattern: SENTINEL }, ctxFor([f.ownWorkspace, appData]))
    expect(r.success).toBe(true)
    const text = String(r.output?.text)
    expect(text).toContain('own workspace')
    expect(text).not.toContain('other conversation')
  })

  it('a stored folder that is itself protected yields nothing', async () => {
    const r = await exec.execute('grep', { pattern: SENTINEL }, ctxFor([join(f.dataDir, 'vault')]))
    expect(r.success).toBe(true)
    expect(r.output?.matchCount).toBe(0)
    const g = await exec.execute('glob', { pattern: '**/*.md' }, ctxFor([f.vault]))
    expect(g.output?.count).toBe(0)
  })

  it('without protected folders a walk is unchanged (negative)', async () => {
    const r = await exec.execute('glob', { pattern: '**/*.ts' }, ctxFor([f.repo]))
    expect(r.output?.files).toEqual(['src/a.ts'])
  })

  // K1: EYAS's own grep/glob are never refused for a folder that contains a
  // protected place, because the walk leaves protected files out too — a
  // file named in security.foreignMemoryPaths, a database kept in the folder.
  it('a protected FILE inside the searched folder is neither grepped nor listed, also when named directly', async () => {
    const journal = join(f.repo, 'docs', 'journal.md')
    const localDb = join(f.repo, 'local.db')
    writeFileSync(journal, `${SENTINEL} journal\n`)
    writeFileSync(localDb, `${SENTINEL} database\n`)
    const { createPathPolicy, workAreaRootsOf } = await import('@shared/memory-sovereignty/path-policy.js')
    installPathPolicy(createPathPolicy({
      homeDir: f.home,
      env: {},
      dataDir: f.dataDir,
      databasePath: localDb,
      extraForeignPaths: [journal],
      workspacesRoot: f.workspacesRoot,
      workAreaRoots: workAreaRootsOf({ dataDir: f.dataDir, workspacesDir: f.workspacesRoot }),
      providerHomes: [join(f.dataDir, 'cli-homes')],
      obsidianRegistryPaths: [],
    }))
    const r = await exec.execute('grep', { pattern: SENTINEL }, ctxFor([f.repo]))
    expect(r.success).toBe(true)
    expect(((r.output?.matches as Array<{ path: string }>) ?? []).map((m) => m.path)).toEqual(['docs/readme.md'])
    const g = await exec.execute('glob', { pattern: '**/*' }, ctxFor([f.repo]))
    const files = (g.output?.files as string[]) ?? []
    expect(files).toContain('docs/readme.md')
    expect(files).not.toContain('docs/journal.md')
    expect(files).not.toContain('local.db')
    const direct = await exec.execute('grep', { pattern: SENTINEL, path: 'docs/journal.md' }, ctxFor([f.repo]))
    expect(String(direct.output?.text ?? '')).not.toContain('journal')
  })
})
