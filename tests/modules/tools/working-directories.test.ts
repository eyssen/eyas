// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseWorkingDirectories,
  validateWorkingDirectories,
  workspaceFromContext,
  toolWorkspaceFields,
  isPathInsideRoots,
  NO_WORKING_DIR,
} from '@modules/tools/working-directories.js'
import { resolveToolPath } from '@modules/tools/builtin/path-utils.js'
import { createFileTools } from '@modules/tools/builtin/file-tools.js'
import { createToolRegistry } from '@modules/tools/tool-registry.js'
import { createToolExecutor } from '@modules/tools/tool-executor.js'
import type { ToolContext } from '@modules/tools/types.js'

function silentCtx(partial: Partial<ToolContext> = {}): ToolContext {
  const logger: any = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  }
  return { conversationId: 'c1', userId: 'u1', logger, ...partial }
}

describe('working directories', () => {
  let dir: string
  let extra: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eyas-wd-'))
    extra = mkdtempSync(join(tmpdir(), 'eyas-wd2-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(extra, { recursive: true, force: true })
  })

  it('parses JSON arrays and ignores junk', () => {
    expect(parseWorkingDirectories(null)).toEqual([])
    expect(parseWorkingDirectories(JSON.stringify([dir, extra]))).toEqual([dir, extra])
    expect(parseWorkingDirectories(['  ', dir])).toEqual([dir])
  })

  it('requires at least one existing directory for project save', () => {
    const empty = validateWorkingDirectories([], { requireNonEmpty: true })
    expect(empty.ok).toBe(false)

    const missing = validateWorkingDirectories(['/no/such/eyas-wd-xyz'], { requireNonEmpty: true })
    expect(missing.ok).toBe(false)

    const relative = validateWorkingDirectories(['relative/path'], { requireNonEmpty: true })
    expect(relative.ok).toBe(false)

    const ok = validateWorkingDirectories([dir, extra], { requireNonEmpty: true })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.paths).toHaveLength(2)
  })

  it('allows empty list on conversations', () => {
    const empty = validateWorkingDirectories([], { requireNonEmpty: false })
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.paths).toEqual([])
  })

  it('resolves relative paths against the primary root and allows extra roots', () => {
    writeFileSync(join(dir, 'a.ts'), 'a')
    writeFileSync(join(extra, 'b.ts'), 'b')
    const rel = resolveToolPath('a.ts', dir, [dir, extra])
    expect(rel.ok).toBe(true)
    const absExtra = resolveToolPath(join(extra, 'b.ts'), dir, [dir, extra])
    expect(absExtra.ok).toBe(true)
    const escape = resolveToolPath('/tmp', dir, [dir, extra])
    expect(escape.ok).toBe(false)
  })

  it('fails closed with no working directory', () => {
    const r = resolveToolPath('a.ts')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('no working directory')
    expect(workspaceFromContext(silentCtx()).ok).toBe(false)
    expect(isPathInsideRoots(dir, [])).toBe(false)
  })

  it('file tools refuse when no workspace is bound', async () => {
    const registry = createToolRegistry()
    for (const t of createFileTools()) registry.register(t)
    const exec = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await exec.execute('read_file', { path: 'a.ts' }, silentCtx())
    expect(res.output?.error).toMatch(/no working directory/i)
  })

  it('file tools read under extra roots', async () => {
    writeFileSync(join(extra, 'note.md'), 'hello')
    const registry = createToolRegistry()
    for (const t of createFileTools()) registry.register(t)
    const exec = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await exec.execute(
      'read_file',
      { path: join(extra, 'note.md') },
      silentCtx({ workingDirectory: dir, workingDirectories: [dir, extra] }),
    )
    expect(res.success).toBe(true)
    expect(String((res.output as any).content)).toContain('hello')
  })

  it('toolWorkspaceFields maps first path to primary', () => {
    expect(toolWorkspaceFields(null)).toEqual({})
    expect(toolWorkspaceFields([dir, extra])).toEqual({
      workingDirectory: dir,
      workingDirectories: [dir, extra],
    })
  })
})
