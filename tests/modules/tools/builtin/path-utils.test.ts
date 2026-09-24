// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The tool path jail judges where a path really lands (shared realpath
// helper), including paths that do not exist yet.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getWorkspaceRoot, resolveToolPath } from '@modules/tools/builtin/path-utils.js'

describe('resolveToolPath — symlink-aware jail', () => {
  let root: string
  let ws: string
  let outside: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eyas-jail-'))
    ws = join(root, 'ws')
    outside = join(root, 'outside')
    mkdirSync(ws)
    mkdirSync(outside)
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('refuses a new file under a symlinked folder that leads out', () => {
    symlinkSync(outside, join(ws, 'link'))
    const r = resolveToolPath('link/new.md', ws)
    expect(r.ok).toBe(false)
  })

  it('refuses a dangling symlink whose target lies outside', () => {
    symlinkSync(join(outside, 'not-yet.md'), join(ws, 'dangling.md'))
    const r = resolveToolPath('dangling.md', ws)
    expect(r).toMatchObject({ ok: false })
  })

  it('accepts a new file inside the workspace and a symlink that stays inside', () => {
    mkdirSync(join(ws, 'real'))
    symlinkSync(join(ws, 'real'), join(ws, 'inner-link'))
    const created = resolveToolPath('sub/new.md', ws)
    expect(created).toMatchObject({ ok: true, relative: 'sub/new.md' })
    const viaLink = resolveToolPath('inner-link/x.md', ws)
    expect(viaLink).toMatchObject({ ok: true, relative: 'real/x.md' })
  })

  it('accepts a workspace root that does not exist yet', () => {
    const fresh = join(root, 'fresh-ws')
    const r = resolveToolPath('a.md', fresh)
    expect(r).toMatchObject({ ok: true, relative: 'a.md' })
  })

  it('getWorkspaceRoot returns the real location', () => {
    writeFileSync(join(ws, 'f'), 'x')
    expect(getWorkspaceRoot(ws)).toBe(realpathSync(ws))
    expect(getWorkspaceRoot(undefined)).toBe('')
  })
})
