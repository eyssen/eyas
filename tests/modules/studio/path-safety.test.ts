// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertAllowedWrite, resolveProjectPath } from '@modules/studio/path-safety'

describe('studio path safety', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-path-'))

  it('resolves a relative file inside the project', () => {
    expect(resolveProjectPath(root, 'index.html')).toBe(join(root, 'index.html'))
    expect(resolveProjectPath(root, 'assets/theme.css')).toBe(join(root, 'assets/theme.css'))
  })

  it('rejects absolute paths and parent traversal', () => {
    expect(() => resolveProjectPath(root, '/etc/passwd')).toThrow(/relative/)
    expect(() => resolveProjectPath(root, '../escape.html')).toThrow(/escapes/)
    expect(() => resolveProjectPath(root, 'ok/../../escape.html')).toThrow(/escapes/)
    expect(() => resolveProjectPath(root, 'x\0.html')).toThrow(/Invalid/)
  })

  it('allows composition text types and rejects others', () => {
    expect(() => assertAllowedWrite('index.html')).not.toThrow()
    expect(() => assertAllowedWrite('edit/master.srt')).not.toThrow()
    expect(() => assertAllowedWrite('clip.js')).not.toThrow()
    expect(() => assertAllowedWrite('out.mp4')).toThrow(/not allowed/)
    expect(() => assertAllowedWrite('shell.sh')).toThrow(/not allowed/)
  })
})
