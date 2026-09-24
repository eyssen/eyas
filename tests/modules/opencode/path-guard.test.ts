// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isUnderRoot, resolveSessionCwd } from '@modules/opencode/path-guard'

describe('opencode path-guard', () => {
  it('accepts a path inside a root', () => {
    expect(isUnderRoot('/proj/src/a.ts', ['/proj'])).toBe(true)
    expect(isUnderRoot('/proj', ['/proj'])).toBe(true)
  })

  it('rejects a path outside roots', () => {
    expect(isUnderRoot('/etc/passwd', ['/proj'])).toBe(false)
    expect(isUnderRoot('/proj-other/x', ['/proj'])).toBe(false)
  })

  it('uses the first working directory when cwd is omitted', () => {
    expect(resolveSessionCwd({ workingDirectories: ['/ws'], fallback: '/tmp/fb' })).toBe('/ws')
  })

  it('throws when requested cwd is outside working directories', () => {
    expect(() => resolveSessionCwd({
      requested: '/etc',
      workingDirectories: ['/ws'],
      fallback: '/tmp/fb',
    })).toThrow(/outside/)
  })

  it('creates the fallback when there are no roots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eyas-oc-'))
    const cwd = resolveSessionCwd({ fallback: join(dir, 'ws') })
    expect(cwd).toContain('ws')
  })
})
