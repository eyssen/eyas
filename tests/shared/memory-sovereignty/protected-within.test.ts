// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K2 — PathPolicy.protectedWithin: the first protected place strictly below
// a folder, with the same reach a search of the whole folder is judged by
// (K1). Folder validation refuses a folder it answers for. Throw-away layout
// only (tests/helpers/memory-sovereignty-fixture.ts).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'

let f: SovereigntyFixture

beforeEach(() => {
  f = createSovereigntyFixture()
})
afterEach(() => f.cleanup())

describe('PathPolicy.protectedWithin (K2)', () => {
  it('(−) the data dir below a checkout, by name', () => {
    const hit = f.policy.protectedWithin(f.repo)
    expect(hit).toMatchObject({ kind: 'eyas-data', path: f.dataDir, searchRoot: f.repo, field: 'path' })
  })

  it('(−) a vault found by its marker and a tool memory folder found by its shape', () => {
    const documents = join(f.home, 'Documents')
    mkdirSync(join(documents, 'Vault', '.obsidian'), { recursive: true })
    expect(f.policy.protectedWithin(documents)).toMatchObject({ kind: 'foreign-memory', rule: 'obsidian-vault', path: join(documents, 'Vault') })
    const repo = join(f.root, 'repo')
    mkdirSync(join(repo, 'pkg', '.codex', 'memories'), { recursive: true })
    expect(f.policy.protectedWithin(repo)).toMatchObject({ kind: 'foreign-memory', rule: 'memory-segment', ruleId: 'tool-memory' })
  })

  it('(−) a symlink below the folder that lands in a protected place', () => {
    const project = join(f.root, 'project')
    mkdirSync(project)
    symlinkSync(f.vault, join(project, 'notes'))
    expect(f.policy.protectedWithin(project)?.kind).toBe('foreign-memory')
  })

  it("(−) another conversation's workspace below the folder; the folder's own workspace is its own", () => {
    const hit = f.policy.protectedWithin(join(f.root, 'app-data'), { workingDirectories: [join(f.root, 'app-data')] })
    expect(hit).toMatchObject({ kind: 'eyas-data', rule: 'other-workspace' })
    mkdirSync(join(f.ownWorkspace, 'sub'), { recursive: true })
    expect(f.policy.protectedWithin(f.ownWorkspace, { workingDirectories: [f.ownWorkspace] })).toBeNull()
  })

  it('(+) nothing protected below: null — also for a missing folder, a file and a relative path', () => {
    const project = join(f.root, 'project')
    mkdirSync(join(project, '.claude'), { recursive: true })
    writeFileSync(join(project, '.claude', 'settings.json'), '{}\n')
    writeFileSync(join(project, 'MEMORY.md'), '# index\n')
    expect(f.policy.protectedWithin(project)).toBeNull()
    expect(f.policy.protectedWithin(join(f.root, 'missing'))).toBeNull()
    expect(f.policy.protectedWithin(join(f.repo, 'src', 'a.ts'))).toBeNull()
    expect(f.policy.protectedWithin('relative/dir')).toBeNull()
  })

  it('(+) a folder that is itself protected is classify\'s answer, not this one', () => {
    expect(f.policy.protectedWithin(f.vault)).toBeNull()
    expect(f.policy.classify(f.vault).kind).toBe('foreign-memory')
    expect(f.policy.protectedWithin(f.dataDir)).toBeNull()
  })
})
