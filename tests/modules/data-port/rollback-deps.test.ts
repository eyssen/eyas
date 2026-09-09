// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The wiring an undo is handed at run time. Two of its parts are walls rather
// than plumbing — the asset-directory containment check and the project-type
// snapshot — and neither could be reached while they lived inside the module's
// `onStart` closure. Both are exercised here against a real directory.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildRollbackDeps,
  PROJECT_TYPE_PREFIX,
  removeImportedAssetDir,
  snapshotProjectTypePrompt,
  type RollbackDepsHost,
} from '@modules/data-port/rollback-deps'

let root: string
let dataDir: string

beforeEach(() => {
  root = join(tmpdir(), `eyas-rbdeps-${process.pid}-${Math.random().toString(36).slice(2)}`)
  dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A directory of bundled files, as an import would have written it. */
function makeAssetDir(name: string): string {
  const dir = resolve(dataDir, 'skills', 'imported', name)
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'deploy.sh'), '#!/bin/sh\necho ship\n')
  return dir
}

describe('removeImportedAssetDir', () => {
  it('removes a directory the import wrote, and says it did', () => {
    const dir = makeAssetDir('alpha-deploy-ab12cd34')
    expect(removeImportedAssetDir(dataDir, dir)).toBe(true)
    expect(existsSync(dir)).toBe(false)
  })

  it('reports a directory that is already gone rather than claiming a removal', () => {
    const dir = resolve(dataDir, 'skills', 'imported', 'never-written')
    expect(removeImportedAssetDir(dataDir, dir)).toBe(false)
  })

  it('refuses a path outside the imported-skills root, and leaves it standing', () => {
    const outside = join(root, 'precious')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'keep.txt'), 'owner data')
    const warned: unknown[] = []

    expect(() =>
      removeImportedAssetDir(dataDir, outside, { warn: (o) => warned.push(o) }),
    ).toThrow(/outside the imported skills root/i)
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
    expect(warned).toHaveLength(1)
  })

  it('refuses a traversal that climbs back out of the root', () => {
    const climb = resolve(dataDir, 'skills', 'imported', '..', '..', 'vault')
    mkdirSync(climb, { recursive: true })
    writeFileSync(join(climb, 'note.md'), 'a real note')

    expect(() => removeImportedAssetDir(dataDir, climb)).toThrow(/outside the imported skills root/i)
    expect(existsSync(join(climb, 'note.md'))).toBe(true)
  })

  it('refuses the imported-skills root itself — that is every skill, not one', () => {
    const importedRoot = resolve(dataDir, 'skills', 'imported')
    makeAssetDir('alpha-deploy-ab12cd34')
    expect(() => removeImportedAssetDir(dataDir, importedRoot)).toThrow(
      /outside the imported skills root/i,
    )
    expect(existsSync(importedRoot)).toBe(true)
  })

  it('unlinks a dangling link instead of reporting nothing to remove', () => {
    const dir = resolve(dataDir, 'skills', 'imported', 'linked')
    mkdirSync(resolve(dataDir, 'skills', 'imported'), { recursive: true })
    symlinkSync(join(root, 'no-such-target'), dir)

    // `existsSync` answers false for a broken link; there is still a name to remove.
    expect(existsSync(dir)).toBe(false)
    expect(removeImportedAssetDir(dataDir, dir)).toBe(true)
  })
})

describe('snapshotProjectTypePrompt', () => {
  it('keeps the current prompt where the workspace history lives', () => {
    const written = snapshotProjectTypePrompt(
      dataDir,
      `${PROJECT_TYPE_PREFIX}alpha-type`,
      'The prompt as it stood before the undo.',
    )
    expect(written).toBeTruthy()
    expect(readFileSync(written!, 'utf-8')).toBe('The prompt as it stood before the undo.')
    expect(written!).toContain('.history')
    expect(written!).toContain('project-type-alpha-type')
  })

  it('never lets a hostile type id name a file outside the history directory', () => {
    const written = snapshotProjectTypePrompt(
      dataDir,
      `${PROJECT_TYPE_PREFIX}../../escape`,
      'body',
    )
    expect(written).toBeTruthy()
    // Every separator is flattened into the file NAME, so the dots that are
    // left are ordinary characters in one path segment, not a way up the tree.
    const history = resolve(dataDir, 'agents', '-', '.history')
    expect(written!.startsWith(history + '/')).toBe(true)
    expect(written!.slice(history.length + 1)).not.toContain('/')
    expect(readdirSync(history).some((f) => f.startsWith('project-type-'))).toBe(true)
  })

  it('reports a snapshot it could not write instead of stopping the undo', () => {
    const warned: unknown[] = []
    // A file where the data directory should be: every write below it fails.
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'not a directory')

    const written = snapshotProjectTypePrompt(blocked, `${PROJECT_TYPE_PREFIX}alpha`, 'body', {
      warn: (o) => warned.push(o),
    })
    expect(written).toBeNull()
    expect(warned).toHaveLength(1)
  })
})

describe('buildRollbackDeps', () => {
  const host = (over: Partial<RollbackDepsHost> = {}): RollbackDepsHost =>
    ({ db: {} as never, ...over }) as RollbackDepsHost

  const build = (h: RollbackDepsHost) =>
    buildRollbackDeps({
      host: h,
      dataDir,
      readWorkspaceFile: () => 'seed',
      writeWorkspaceFile: async () => {},
    })

  it('leaves a service slot undefined when the module is not running', () => {
    const deps = build(host())
    expect(deps.vault).toBeUndefined()
    expect(deps.indexer).toBeUndefined()
    expect(deps.episodic).toBeUndefined()
    expect(deps.skills).toBeUndefined()
    expect(deps.agents).toBeUndefined()
    expect(deps.dataDir).toBe(dataDir)
  })

  it('sees a module that registered after the importer did', () => {
    const late: RollbackDepsHost = host()
    const deps = build(late)
    expect(deps.episodic).toBeUndefined()

    const deleted: string[] = []
    late.memory = { episodic: { delete: (id: string) => deleted.push(id) } }
    // Read through a getter, so the slot is answered at call time, not at build time.
    deps.episodic!.delete('e1')
    expect(deleted).toEqual(['e1'])
  })

  it('offers the vault reader only when the vault has one', () => {
    expect(build(host({ memory: { vault: { delete: () => {} } } })).vault!.read).toBeUndefined()
    const withRead = build(
      host({ memory: { vault: { delete: () => {}, read: () => ({ content: 'body' }) } } }),
    )
    expect(withRead.vault!.read!('semantic/a.md')).toEqual({ content: 'body' })
  })

  it('reads a vault note off disk, verbatim, so the edited-note guard can see its bytes', () => {
    // The vault's own reader trims what it returns, so it cannot answer whether
    // a note is byte-for-byte what the import wrote (R11.5). This one can.
    const notePath = join(dataDir, 'vault', 'semantic', 'alpha.md')
    mkdirSync(join(dataDir, 'vault', 'semantic'), { recursive: true })
    const raw = '---\ntitle: Alpha\n---\n\n  indented first line\n\n\n'
    writeFileSync(notePath, raw, 'utf-8')

    const deps = build(host({ memory: { vault: { delete: () => {} } } }))
    expect(deps.vault!.readRaw!('semantic/alpha.md')).toBe(raw)
    // A note that is not there answers null; the parsed reader then decides.
    expect(deps.vault!.readRaw!('semantic/missing.md')).toBeNull()
  })

  it('carries a skill and an agent provenance through, and reports a missing one as null', () => {
    const deps = build(
      host({
        skills: {
          loader: {
            delete: () => {},
            get: (id: string) =>
              id === 'sk1' ? { id, name: 'alpha-deploy', source: 'bundled' } : null,
          },
        },
        agents: {
          registry: {
            delete: () => {},
            get: (id: string) => (id === 'a1' ? { id, source: 'user' } : undefined),
          },
        },
      }),
    )
    // Provenance is what stops an undo from deleting a shipped skill (A15.1).
    expect(deps.skills!.get('sk1')).toEqual({ id: 'sk1', name: 'alpha-deploy', source: 'bundled' })
    expect(deps.skills!.get('gone')).toBeNull()
    expect(deps.agents!.get('a1')).toEqual({ id: 'a1', source: 'user' })
    expect(deps.agents!.get('gone')).toBeNull()
  })

  it('measures the asset guard against the data directory it was built with', () => {
    const dir = makeAssetDir('alpha-deploy-ab12cd34')
    const deps = build(host())
    expect(deps.removeAssetDir!(dir)).toBe(true)
    expect(existsSync(dir)).toBe(false)
    expect(() => deps.removeAssetDir!(join(root, 'precious'))).toThrow(
      /outside the imported skills root/i,
    )
  })
})
