// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { realpathBestEffort } from '@shared/fs-realpath.js'

describe('realpathBestEffort', () => {
  let root: string
  let real: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eyas-realpath-'))
    real = realpathSync(root)
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('returns the realpath of an existing file', () => {
    mkdirSync(join(root, 'a'))
    writeFileSync(join(root, 'a', 'f.txt'), 'x')
    expect(realpathBestEffort(join(root, 'a', 'f.txt'))).toBe(join(real, 'a', 'f.txt'))
  })

  it('resolves a new file under a symlinked folder to where it would land', () => {
    mkdirSync(join(root, 'target'))
    symlinkSync(join(root, 'target'), join(root, 'link'))
    expect(realpathBestEffort(join(root, 'link', 'new', 'deep.md'))).toBe(join(real, 'target', 'new', 'deep.md'))
  })

  it('follows a dangling symlink to its (missing) target', () => {
    mkdirSync(join(root, 'elsewhere'))
    symlinkSync(join(root, 'elsewhere', 'not-yet.md'), join(root, 'dangling.md'))
    expect(realpathBestEffort(join(root, 'dangling.md'))).toBe(join(real, 'elsewhere', 'not-yet.md'))
  })

  it('follows a relative symlink target', () => {
    mkdirSync(join(root, 'dir'))
    symlinkSync('dir', join(root, 'rel'))
    expect(realpathBestEffort(join(root, 'rel', 'x.md'))).toBe(join(real, 'dir', 'x.md'))
  })

  it('takes a relative path against the process cwd', () => {
    const rel = relative(process.cwd(), join(root, 'missing', 'x'))
    expect(realpathBestEffort(rel)).toBe(join(real, 'missing', 'x'))
  })

  it('keeps a plain missing path lexical below the real ancestor', () => {
    expect(realpathBestEffort(join(root, 'no', 'such', '..', 'thing'))).toBe(join(real, 'no', 'thing'))
  })

  it('(−) a link target with ".." after another link is resolved physically, not as text', () => {
    // ws/sub -> <root>/elsewhere/deep ; ws/evil -> 'sub/../x'
    // A write to ws/evil/newfile lands in <root>/elsewhere/x/newfile.
    mkdirSync(join(root, 'ws'))
    mkdirSync(join(root, 'elsewhere', 'deep'), { recursive: true })
    symlinkSync(join(root, 'elsewhere', 'deep'), join(root, 'ws', 'sub'))
    symlinkSync('sub/../x', join(root, 'ws', 'evil'))
    expect(realpathBestEffort(join(root, 'ws', 'evil', 'newfile'))).toBe(join(real, 'elsewhere', 'x', 'newfile'))
    // The same once the folder exists (realpathSync path) — both agree.
    mkdirSync(join(root, 'elsewhere', 'x'))
    expect(realpathBestEffort(join(root, 'ws', 'evil', 'newfile'))).toBe(join(real, 'elsewhere', 'x', 'newfile'))
  })

  it('(−) a ".." in the given path after a link steps back from the link target', () => {
    mkdirSync(join(root, 'ws'))
    mkdirSync(join(root, 'elsewhere', 'deep'), { recursive: true })
    symlinkSync(join(root, 'elsewhere', 'deep'), join(root, 'ws', 'sub'))
    expect(realpathBestEffort(`${join(root, 'ws', 'sub')}/../new/file`)).toBe(join(real, 'elsewhere', 'new', 'file'))
  })

  it('(−) a link reached after ".." past a missing folder is still followed', () => {
    mkdirSync(join(root, 'ws'))
    mkdirSync(join(root, 'target'))
    symlinkSync(join(root, 'target'), join(root, 'ws', 'link'))
    expect(realpathBestEffort(`${join(root, 'ws', 'missing')}/../link/new.md`)).toBe(join(real, 'target', 'new.md'))
  })

  it('throws on a symlink loop instead of guessing', () => {
    symlinkSync(join(root, 'b'), join(root, 'a'))
    symlinkSync(join(root, 'a'), join(root, 'b'))
    expect(() => realpathBestEffort(join(root, 'a', 'x'))).toThrow()
  })
})
