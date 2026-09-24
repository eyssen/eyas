// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K2 — a CLI reads inside its cwd without asking, so a stored folder that
// CONTAINS EYAS's data dir or a notes vault never becomes a CLI cwd or root:
// resolveCliCwd skips it (the conversation's own workspace is used instead)
// and resolveCliRoots leaves it out, whatever the CLI (Claude Code, Grok,
// Kimi, OpenCode share the resolver). Throw-away folders only.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultCliFolderCheck, resolveCliCwd, resolveCliRoots } from '@modules/model/cli-runtime/workspaces.js'

let tmp: string
let home: string
let checkout: string
let dataDir: string
let root: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-cli-cwd-k2-')))
  home = join(tmp, 'home')
  mkdirSync(home)
  vi.stubEnv('HOME', home)
  // A checkout that is also an EYAS instance: its data/ holds the vault.
  checkout = join(tmp, 'checkout')
  dataDir = join(checkout, 'data')
  mkdirSync(join(dataDir, 'vault'), { recursive: true })
  root = join(tmp, 'workspaces')
  project = join(tmp, 'project')
  mkdirSync(project)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tmp, { recursive: true, force: true })
})

describe('the CLI cwd never contains a protected place (K2)', () => {
  it('(−) a checkout holding the data dir is refused as containsEyasData; the conversation workspace is the cwd', () => {
    expect(defaultCliFolderCheck(checkout, { dataDir, root })).toEqual({ ok: false, code: 'containsEyasData' })
    const warn = vi.fn()
    const request = { metadata: { conversationId: 'conv-k2', workingDirectories: [checkout] } }
    const cwd = resolveCliCwd(request, { root, dataDir, logger: { warn } })
    expect(cwd).toBe(join(root, 'conv-k2'))
    expect(warn).toHaveBeenCalledWith({ folder: checkout, code: 'containsEyasData' }, expect.any(String))
    expect(resolveCliRoots(request, cwd, { root, dataDir })).toEqual([cwd])
  })

  it('(−) a folder holding a vault (a .obsidian marker, or a symlink into one) is refused as containsVault', () => {
    const documents = join(home, 'Documents')
    mkdirSync(join(documents, 'Vault', '.obsidian'), { recursive: true })
    expect(defaultCliFolderCheck(documents, { dataDir, root })).toEqual({ ok: false, code: 'containsVault' })
    const linked = join(tmp, 'linked')
    mkdirSync(linked)
    symlinkSync(join(documents, 'Vault'), join(linked, 'notes'))
    expect(defaultCliFolderCheck(linked, { dataDir, root })).toEqual({ ok: false, code: 'containsVault' })
  })

  it('(+) the next stored folder that holds nothing protected becomes the cwd, and the roots keep only it', () => {
    const request = { metadata: { conversationId: 'conv-k2b', workingDirectories: [checkout, project] } }
    const cwd = resolveCliCwd(request, { root, dataDir })
    expect(cwd).toBe(project)
    expect(resolveCliRoots(request, cwd, { root, dataDir })).toEqual([project])
    expect(defaultCliFolderCheck(join(checkout, 'data', '..', 'data'), { dataDir, root }).ok).toBe(false)
  })
})
