// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listDirectories } from '@modules/tools/filesystem-browse.js'

describe('listDirectories', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eyas-browse-'))
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'docs'))
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, '.ssh'))
    writeFileSync(join(root, 'README.md'), 'x')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('lists only non-sensitive directories', () => {
    const listing = listDirectories(root)
    expect(listing.path).toBe(realpathSync(root))
    const names = listing.entries.map((e) => e.name)
    expect(names).toContain('src')
    expect(names).toContain('docs')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.ssh')
    expect(names).not.toContain('README.md')
  })

  it('rejects relative paths', () => {
    expect(() => listDirectories('relative/path')).toThrow(/absolute/)
  })

  it('rejects missing directories', () => {
    expect(() => listDirectories(join(root, 'nope'))).toThrow(/does not exist/)
  })

  it('returns a parent above the listed folder', () => {
    const listing = listDirectories(join(root, 'src'))
    expect(listing.parent).toBe(realpathSync(root))
  })
})
