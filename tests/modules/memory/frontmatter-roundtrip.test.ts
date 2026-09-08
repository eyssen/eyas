// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import matter from 'gray-matter'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createVaultService } from '../../../src/modules/memory/vault/vault-service.js'
import { parseVaultFile, serializeVaultFile } from '../../../src/modules/memory/vault/frontmatter.js'
import type { VaultFrontmatter } from '../../../src/modules/memory/types.js'

/** `matter.cache` is real but undeclared in gray-matter's types. */
const cacheSize = () =>
  Object.keys((matter as unknown as { cache?: Record<string, unknown> }).cache ?? {}).length

const fm = (over: Partial<VaultFrontmatter> = {}): VaultFrontmatter => ({
  title: 'Alpha Note',
  tags: ['imported'],
  tier: 'semantic',
  links: [],
  created: '2026-05-01',
  updated: '2026-08-01',
  ...over,
})

describe('vault frontmatter round-trip', () => {
  let vaultPath: string
  let vault: ReturnType<typeof createVaultService>

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), 'eyas-fm-'))
    vault = createVaultService(vaultPath)
  })

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true })
  })

  it('keeps a body that itself starts with a --- block byte-for-byte', () => {
    const body = '---\nnot frontmatter\n---\nrest'
    vault.write('semantic/dashed.md', fm(), body)
    const back = vault.read('semantic/dashed.md')
    // The writer's single appended newline is its one documented normalisation
    // (R11.5); nothing else about the body changes on the round trip.
    expect(back?.content).toBe(`${body}\n`)
    expect(back?.frontmatter.title).toBe('Alpha Note')
    expect(back?.frontmatter.tags).toEqual(['imported'])
  })

  it('keeps a verbatim imported note with its own frontmatter-looking preamble', () => {
    const body = ['---', 'type: reference', 'tags: [a, b]', '---', '', '# Heading', '', 'Text.'].join('\n')
    vault.write('semantic/preamble.md', fm({ kind: 'reference' }), body)
    expect(vault.read('semantic/preamble.md')?.content).toBe(`${body}\n`)
  })

  it('gives a body back byte for byte, blank lines at both ends included', () => {
    // R11.5 end to end: the importer writes what the source file held, and the
    // reader hands back what is on disk — so an identity check can be exact and
    // a whitespace-only edit is visible instead of invisible.
    const body = '\n\n  indented first line\n\nlast line\n\n\n'
    vault.write('semantic/blanks.md', fm(), body)
    expect(vault.read('semantic/blanks.md')?.content).toBe(body)
  })

  it('is stable across a second round trip', () => {
    const body = '\n\nBody.\n\n\n'
    vault.write('semantic/stable.md', fm(), body)
    const first = vault.read('semantic/stable.md')!
    vault.write('semantic/stable.md', first.frontmatter, first.content)
    expect(vault.read('semantic/stable.md')?.content).toBe(body)
  })

  it('drops undefined frontmatter values instead of throwing', () => {
    expect(() => serializeVaultFile(fm({ aliases: undefined, summary: undefined }), 'Body.')).not.toThrow()
    const serialized = serializeVaultFile(fm({ aliases: undefined }), 'Body.')
    expect(serialized).not.toContain('aliases')
    expect(parseVaultFile(serialized).frontmatter.aliases).toBeUndefined()
    expect(parseVaultFile(serialized).content).toBe('Body.\n')
  })

  it('writes declared aliases when they are present', () => {
    const serialized = serializeVaultFile(fm({ aliases: ['alpha_note'] }), 'Body.')
    expect(parseVaultFile(serialized).frontmatter.aliases).toEqual(['alpha_note'])
  })

  it('does not add every parsed note to gray-matter\'s process-global cache', () => {
    // The cache is keyed on the whole raw string and is never evicted, so a
    // vault-wide reindex would otherwise pin every note in memory for the
    // lifetime of the process.
    const before = cacheSize()
    for (let i = 0; i < 3; i++) {
      parseVaultFile(serializeVaultFile(fm({ title: `Note ${i}` }), `unique body ${i} ${Math.random()}`))
    }
    expect(cacheSize()).toBe(before)
  })

  it('keeps import provenance across a write, a read and a rewrite', () => {
    const source = {
      profile: 'claude-code',
      path: 'ai-memory/alpha_note.md',
      frontmatter: { type: 'reference', tags: ['a'] },
    }
    vault.write('semantic/provenance.md', fm({ source }), 'Body.')

    const back = vault.read('semantic/provenance.md')
    expect(back?.frontmatter.source).toEqual(source)

    // A later rewrite spreads the parsed frontmatter; provenance must survive it.
    vault.write('semantic/provenance.md', { ...back!.frontmatter, updated: '2026-09-06' }, 'Body two.')
    const again = vault.read('semantic/provenance.md')
    expect(again?.frontmatter.source).toEqual(source)
    expect(again?.frontmatter.updated).toBe('2026-09-06')
  })

  it('ignores a source that is not an object', () => {
    const serialized = serializeVaultFile(fm(), 'Body.').replace('title:', 'source: "not-an-object"\ntitle:')
    expect(parseVaultFile(serialized).frontmatter.source).toBeUndefined()
  })
})
