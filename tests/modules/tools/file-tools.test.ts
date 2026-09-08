// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
