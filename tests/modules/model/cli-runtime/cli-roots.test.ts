// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// resolveCliRoots — the folders a CLI turn works in, for every CLI provider:
// the stored folders that still pass the folder check, plus the cwd once.
// Claude Code's memory-policy hook and permission bridge and the ACP fs jail
// (resolveAcpRoots is the same function) all judge against this list.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCliCwd, resolveCliRoots } from '@modules/model/cli-runtime/workspaces.js'
import { resolveAcpRoots } from '@modules/model/submodules/grok-cli/acp-governance.js'

let tmp: string
let dataDir: string
let root: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-cli-roots-')))
  dataDir = join(tmp, 'data')
  root = join(tmp, 'workspaces')
  mkdirSync(dataDir, { recursive: true })
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('resolveCliRoots', () => {
  it('no stored folders: the cwd alone', () => {
    const cwd = resolveCliCwd({ metadata: { conversationId: 'conv-1' } }, { root, dataDir })
    expect(resolveCliRoots({ metadata: { conversationId: 'conv-1' } }, cwd, { root, dataDir })).toEqual([cwd])
  })

  it('every stored folder that validates, primary first, with the cwd once (positive)', () => {
    const a = join(tmp, 'project-a')
    const b = join(tmp, 'project-b')
    mkdirSync(a)
    mkdirSync(b)
    const request = { metadata: { workingDirectories: [a, b], conversationId: 'conv-2' } }
    const cwd = resolveCliCwd(request, { root, dataDir })
    expect(cwd).toBe(a)
    expect(resolveCliRoots(request, cwd, { root, dataDir })).toEqual([a, b])
  })

  it('a stored folder the check refuses never becomes a root (negative)', () => {
    const gone = join(tmp, 'deleted-project')
    const insideData = join(dataDir, 'vault')
    mkdirSync(insideData)
    const valid = join(tmp, 'valid')
    mkdirSync(valid)
    const request = { metadata: { workingDirectories: [gone, insideData, valid] } }
    const cwd = resolveCliCwd(request, { root, dataDir })
    expect(resolveCliRoots(request, cwd, { root, dataDir })).toEqual([valid])
  })

  it('falls back to the singular workingDirectory', () => {
    const single = join(tmp, 'single')
    mkdirSync(single)
    expect(resolveCliRoots({ metadata: { workingDirectory: single } }, single, { root, dataDir })).toEqual([single])
  })

  it('delegates validation to the injected folder check', () => {
    const checkFolder = vi.fn((p: string) => (p === '/home/me' ? { ok: false as const, code: 'home' } : { ok: true as const, path: p }))
    expect(resolveCliRoots({ metadata: { workingDirectories: ['/home/me', '/w/a'] } }, '/w/run', { root, dataDir, checkFolder }))
      .toEqual(['/w/a', '/w/run'])
    expect(checkFolder).toHaveBeenCalledWith('/home/me', { dataDir, root })
  })

  it('is the one resolver: the ACP roots are the same function', () => {
    expect(resolveAcpRoots).toBe(resolveCliRoots)
  })
})
