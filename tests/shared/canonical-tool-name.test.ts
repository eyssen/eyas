// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { canonicalToolName, normalizeToolInput } from '@shared/canonical-tool-name.js'

describe('canonicalToolName', () => {
  it('maps Claude Code builtins onto EYAS names', () => {
    expect(canonicalToolName('Bash')).toBe('run_command')
    expect(canonicalToolName('Read')).toBe('read_file')
    expect(canonicalToolName('Write')).toBe('write_file')
    expect(canonicalToolName('Edit')).toBe('edit_file')
    expect(canonicalToolName('MultiEdit')).toBe('edit_file')
    expect(canonicalToolName('Grep')).toBe('grep')
    expect(canonicalToolName('Glob')).toBe('glob')
    expect(canonicalToolName('WebFetch')).toBe('web_fetch')
    expect(canonicalToolName('WebSearch')).toBe('web_search')
    expect(canonicalToolName('TodoWrite')).toBe('todo')
  })

  it('strips the EYAS MCP bridge prefix', () => {
    expect(canonicalToolName('mcp__eyas__save_memory')).toBe('save_memory')
  })

  it('maps ACP tool kinds, whatever the free-text title says', () => {
    expect(canonicalToolName('Editing src/app.ts', { acpKind: 'edit' })).toBe('edit_file')
    expect(canonicalToolName('Run `ls -la`', { acpKind: 'execute' })).toBe('run_command')
    expect(canonicalToolName('Reading notes.md', { acpKind: 'read' })).toBe('read_file')
    expect(canonicalToolName('x', { acpKind: 'delete' })).toBe('delete_file')
    expect(canonicalToolName('x', { acpKind: 'move' })).toBe('move_file')
    expect(canonicalToolName('x', { acpKind: 'search' })).toBe('grep')
    expect(canonicalToolName('x', { acpKind: 'fetch' })).toBe('web_fetch')
  })

  it('passes an unknown raw name through unchanged', () => {
    expect(canonicalToolName('search_memory')).toBe('search_memory')
    expect(canonicalToolName('mcp__other__tool')).toBe('mcp__other__tool')
    expect(canonicalToolName('bash')).toBe('bash')
  })

  it('never uses an ACP title as the canonical name', () => {
    expect(canonicalToolName('Thinking about the plan', { acpKind: 'think' })).toBe('think')
    expect(canonicalToolName('Something happened', { acpKind: 'other' })).toBe('other')
    expect(canonicalToolName('Something happened', { acpKind: '' })).toBe('other')
    // A machine identifier under an unmapped kind is an EYAS tool over MCP.
    expect(canonicalToolName('mcp__eyas__search_memory', { acpKind: 'other' })).toBe('search_memory')
  })
})

describe('normalizeToolInput', () => {
  it('maps file_path onto path and keeps edit payloads', () => {
    const input = { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' }
    expect(normalizeToolInput(input)).toEqual({ path: '/w/a.ts', old_string: 'a', new_string: 'b' })
    expect(input).toEqual({ file_path: '/w/a.ts', old_string: 'a', new_string: 'b' })
  })

  it('keeps an explicit path and tolerates missing input', () => {
    expect(normalizeToolInput({ path: '/w/b.ts', file_path: '/w/a.ts' })).toEqual({ path: '/w/b.ts' })
    expect(normalizeToolInput({ command: 'ls' })).toEqual({ command: 'ls' })
    expect(normalizeToolInput(undefined)).toEqual({})
    expect(normalizeToolInput(null)).toEqual({})
  })
})
