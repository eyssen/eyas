// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { briefToolArgs, briefToolResult, fileEditDiff } from '../../src/web/src/pages/conversations/components/tool-trace'

describe('briefToolArgs', () => {
  it('shows the file basename for edit_file', () => {
    expect(briefToolArgs('edit_file', { path: '/tmp/alpha/src/foo.ts', oldString: 'a', newString: 'b' })).toBe('foo.ts')
  })

  it('shows pattern and path for grep', () => {
    expect(briefToolArgs('grep', { pattern: 'TODO', path: 'src' })).toBe('TODO in src')
  })

  it('truncates a long shell command', () => {
    const cmd = 'echo ' + 'x'.repeat(80)
    const brief = briefToolArgs('run_command', { command: cmd })
    expect(brief.length).toBeLessThanOrEqual(64)
    expect(brief.startsWith('echo ')).toBe(true)
  })

  it('returns empty when there is no useful input', () => {
    expect(briefToolArgs('ping', {})).toBe('')
    expect(briefToolArgs('ping', undefined)).toBe('')
  })
})

describe('briefToolResult', () => {
  it('summarises an edit_file success', () => {
    expect(briefToolResult({
      toolName: 'edit_file',
      status: 'success',
      output: { path: 'foo.ts', replacements: 2, ok: true },
    })).toBe('2 replacements in foo.ts')
  })

  it('returns the first line of a string result', () => {
    expect(briefToolResult({
      toolName: 'read_file',
      status: 'success',
      output: 'line one\nline two',
    })).toBe('line one')
  })

  it('prefers the error when present', () => {
    expect(briefToolResult({
      toolName: 'edit_file',
      status: 'error',
      error: 'oldString not found in file',
    })).toBe('oldString not found in file')
  })
})

describe('fileEditDiff', () => {
  it('builds a unified-style hunk from edit_file oldString/newString', () => {
    const diff = fileEditDiff({
      toolName: 'edit_file',
      input: {
        path: 'src/alpha.ts',
        oldString: 'const x = 1',
        newString: 'const x = 2',
      },
      status: 'success',
    })
    expect(diff).not.toBeNull()
    expect(diff!.path).toBe('src/alpha.ts')
    expect(diff!.hunks).toEqual([
      { type: 'del', text: 'const x = 1' },
      { type: 'add', text: 'const x = 2' },
    ])
  })

  it('treats write_file as a new-file diff', () => {
    const diff = fileEditDiff({
      toolName: 'write_file',
      input: { path: 'src/bravo.ts', content: 'export const n = 1\n' },
      status: 'running',
    })
    expect(diff).not.toBeNull()
    expect(diff!.path).toBe('src/bravo.ts')
    expect(diff!.hunks.every((h) => h.type === 'add')).toBe(true)
    expect(diff!.hunks[0]?.text).toBe('export const n = 1')
  })

  it('returns null for non-file tools', () => {
    expect(fileEditDiff({ toolName: 'grep', input: { pattern: 'x' }, status: 'success' })).toBeNull()
  })
})
