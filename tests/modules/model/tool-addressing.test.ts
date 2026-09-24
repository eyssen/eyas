// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  NATIVE_TOOL_ADDRESSING,
  renderToolRef,
  toolAddressingNote,
  toolAddressingOf,
} from '@modules/model/tool-addressing'
import type { ToolAddressing } from '@modules/model/types'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider'
import { createKimiProvider } from '@modules/model/submodules/kimi/provider'

const CLAUDE_CODE: ToolAddressing = { kind: 'mcp-prefix', prefix: 'mcp__eyas__' }
const GROK: ToolAddressing = { kind: 'meta-tool', via: 'use_tool', qualify: 'eyas__' }
const KIMI: ToolAddressing = { kind: 'mcp-server', server: 'eyas' }

/** A call instruction naming the canonical tool bare, i.e. not as eyas__memory_search. */
function namesBareMemorySearch(text: string): boolean {
  return text.replaceAll('eyas__memory_search', '').includes('memory_search')
}

describe('renderToolRef', () => {
  it('native → the canonical name', () => {
    expect(renderToolRef(NATIVE_TOOL_ADDRESSING, 'memory_search')).toBe('`memory_search`')
  })

  it('absent addressing is native', () => {
    expect(renderToolRef(undefined, 'memory_search')).toBe('`memory_search`')
    expect(renderToolRef(null, 'memory_expand')).toBe('`memory_expand`')
  })

  it('mcp-prefix → the host-listed MCP name', () => {
    expect(renderToolRef(CLAUDE_CODE, 'memory_search')).toBe('`mcp__eyas__memory_search`')
  })

  it('grok → use_tool with the eyas__-qualified name', () => {
    const ref = renderToolRef(GROK, 'memory_search')
    expect(ref).toBe('`use_tool` with tool_name `eyas__memory_search`')
  })

  it('kimi → names the eyas MCP server, not a guessed qualified name', () => {
    const ref = renderToolRef(KIMI, 'memory_search')
    expect(ref).toBe('`memory_search` on the `eyas` MCP server')
    expect(ref).not.toContain('eyas__')
    expect(ref).not.toContain('mcp__')
  })

  it('the grok rendering never contains a bare memory_search call instruction', () => {
    expect(namesBareMemorySearch(renderToolRef(GROK, 'memory_search'))).toBe(false)
    expect(namesBareMemorySearch(toolAddressingNote(GROK))).toBe(false)
  })

  it('an unknown kind (malformed provider object) falls back to the canonical name', () => {
    const bogus = { kind: 'something-else' } as unknown as ToolAddressing
    expect(renderToolRef(bogus, 'memory_search')).toBe('`memory_search`')
    expect(toolAddressingNote(bogus)).toBe('')
  })
})

describe('toolAddressingNote', () => {
  it('is empty for native and absent addressing', () => {
    expect(toolAddressingNote(NATIVE_TOOL_ADDRESSING)).toBe('')
    expect(toolAddressingNote(undefined)).toBe('')
    expect(toolAddressingNote(null)).toBe('')
  })

  it('mcp-prefix gives the pattern and a concrete example', () => {
    const note = toolAddressingNote(CLAUDE_CODE)
    expect(note).toContain('`mcp__eyas__<name>`')
    expect(note).toContain('`mcp__eyas__memory_search`')
  })

  it('grok explains search_tool, use_tool, tool_input and the eyas__ prefix', () => {
    const note = toolAddressingNote(GROK)
    expect(note).toContain('`search_tool`')
    expect(note).toContain('`use_tool` with tool_name `eyas__<name>`')
    expect(note).toContain('tool_input')
    expect(note).toContain('`eyas__memory_search`')
    expect(note).toContain('without the `eyas__` prefix is not an EYAS tool')
  })

  it('kimi names the server and warns off same-named built-ins', () => {
    const note = toolAddressingNote(KIMI)
    expect(note).toContain('MCP server named `eyas`')
    expect(note).toContain('not a built-in tool of the same name')
  })

  it('is one line for every kind', () => {
    for (const a of [CLAUDE_CODE, GROK, KIMI]) {
      const note = toolAddressingNote(a)
      expect(note.length).toBeGreaterThan(0)
      expect(note).not.toContain('\n')
    }
  })
})

describe('provider declarations', () => {
  it('grok-cli declares use_tool meta-tool addressing', () => {
    expect(toolAddressingOf(createGrokCliProvider())).toEqual(GROK)
  })

  it('kimi-cli declares the neutral eyas-server addressing', () => {
    expect(toolAddressingOf(createKimiCliProvider())).toEqual(KIMI)
  })

  it('an API provider declares nothing and resolves to native', () => {
    const api = createKimiProvider('test-key')
    expect(api.toolAddressing).toBeUndefined()
    expect(toolAddressingOf(api)).toEqual({ kind: 'native' })
  })

  it('no provider resolves to native', () => {
    expect(toolAddressingOf(undefined)).toEqual({ kind: 'native' })
    expect(toolAddressingOf(null)).toEqual({ kind: 'native' })
  })
})
