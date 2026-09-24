// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H9 + K3 — the one table of what a host CLI's own built-ins may do
// (CLI_NATIVE_CAPABILITIES) and which EYAS tools it is offered over its EYAS
// bridge: every tool except the ones its granted built-ins stand in for,
// intersected with the turn's scope.

import { describe, it, expect } from 'vitest'
import {
  ALL_NATIVE_CAPABILITIES,
  CLAUDE_CODE_BUILTIN_TOOLS,
  CLI_NATIVE_CAPABILITIES,
  HOST_NATIVE_TOOL_NAMES,
  acpToolCapabilities,
  claudeCodeBuiltins,
  grantedNativeCapabilities,
  nativeCapabilityCovering,
  nativeCapabilityDenial,
  selectBridgeTools,
  type NativeCapability,
} from '@modules/tools/cli-exposure'

const tool = (name: string) => ({ name })
const names = (tools: Array<{ name: string }>) => tools.map((t) => t.name)
const caps = (...list: NativeCapability[]) => new Set<NativeCapability>(list)
const grantedBy = (...tools: string[]) => [...grantedNativeCapabilities((n) => tools.includes(n))].sort()

const REGISTRY = [
  'memory_search', 'memory_expand', 'create_task', 'assign_task', 'run_specialist',
  'browser_navigate', 'browser_totp', 'agent_browser_run', 'agent_browser_status', 'browser_use_exec',
  'opencode_run', 'opencode_status',
  'run_command', 'read_file', 'write_file', 'edit_file', 'grep', 'glob', 'git_status', 'git_diff',
].map(tool)

describe('selectBridgeTools', () => {
  it('(+) keeps the EYAS browser, agent-browser and OpenCode tools', () => {
    const offered = names(selectBridgeTools(REGISTRY))
    for (const name of ['browser_navigate', 'browser_totp', 'agent_browser_run', 'agent_browser_status', 'browser_use_exec', 'opencode_run', 'opencode_status']) {
      expect(offered, name).toContain(name)
    }
    expect(offered).toContain('memory_search')
  })

  it('(+) intersects with the allowlist, in registry order', () => {
    const allowed = new Set(['opencode_run', 'memory_search', 'browser_navigate', 'no_such_tool'])
    expect(names(selectBridgeTools(REGISTRY, allowed))).toEqual(['memory_search', 'browser_navigate', 'opencode_run'])
  })

  it('(−) with every capability granted, read_file, run_command and git_diff are excluded, even when allowed', () => {
    const allowed = new Set(['read_file', 'run_command', 'git_diff', 'memory_search'])
    expect(names(selectBridgeTools(REGISTRY, allowed))).toEqual(['memory_search'])
    const all = names(selectBridgeTools(REGISTRY))
    for (const name of HOST_NATIVE_TOOL_NAMES) expect(all, name).not.toContain(name)
  })

  it('(−) an empty allowlist offers nothing; no allowlist means no scope limit', () => {
    expect(selectBridgeTools(REGISTRY, new Set())).toEqual([])
    expect(selectBridgeTools(REGISTRY, null)).toHaveLength(REGISTRY.length - HOST_NATIVE_TOOL_NAMES.size)
  })

  it('(+) a tool whose covering capability is not granted is offered over the bridge instead (git_status without the shell)', () => {
    const allowed = new Set(['memory_search', 'git_status', 'git_diff', 'read_file'])
    expect(names(selectBridgeTools(REGISTRY, allowed, caps('read')))).toEqual(['memory_search', 'git_status', 'git_diff'])
  })

  it('(−) reading is never bridged while granted: read_file stays with the CLI\'s own Read', () => {
    expect(names(selectBridgeTools(REGISTRY, new Set(['read_file']), caps('read')))).toEqual([])
  })
})

describe('HOST_NATIVE_TOOL_NAMES (derived from the table)', () => {
  it('names exactly the shell, file and git tools a CLI has natively', () => {
    expect([...HOST_NATIVE_TOOL_NAMES].sort()).toEqual(
      ['edit_file', 'git_diff', 'git_status', 'glob', 'grep', 'read_file', 'run_command', 'write_file'],
    )
    expect(nativeCapabilityCovering('grep')).toBe('read')
    expect(nativeCapabilityCovering('git_status')).toBe('shell')
    expect(nativeCapabilityCovering('write_file')).toBe('write')
    expect(nativeCapabilityCovering('opencode_run')).toBeNull()
    expect(nativeCapabilityCovering('browser_navigate')).toBeNull()
  })
})

describe('grantedNativeCapabilities', () => {
  it('(+) every capability when every tool is allowed', () => {
    expect([...grantedNativeCapabilities(() => true)].sort()).toEqual([...ALL_NATIVE_CAPABILITIES].sort())
  })

  it('(−) nothing allowed still grants reading, and only reading', () => {
    expect(grantedBy()).toEqual(['read'])
  })

  it('(+) write needs write_file or edit_file; shell needs run_command; web needs a web tool', () => {
    expect(grantedBy('edit_file')).toEqual(['read', 'write'])
    expect(grantedBy('write_file')).toEqual(['read', 'write'])
    expect(grantedBy('run_command')).toEqual(['read', 'shell'])
    expect(grantedBy('research')).toEqual(['read', 'web'])
    expect(grantedBy('browser_navigate')).toEqual(['read', 'web'])
  })

  it('(−) the git review tools, read_file and the browser helpers grant no native write, shell or web', () => {
    expect(grantedBy('git_status', 'git_diff', 'read_file', 'grep', 'glob', 'browser_totp', 'opencode_run')).toEqual(['read'])
  })
})

describe('claudeCodeBuiltins', () => {
  it('(+) every capability: all nine built-ins, nothing disallowed, no subagent spawner', () => {
    const { tools, disallowed } = claudeCodeBuiltins(ALL_NATIVE_CAPABILITIES)
    expect([...tools].sort()).toEqual(['Bash', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'Read', 'WebFetch', 'WebSearch', 'Write'])
    expect(disallowed).toEqual([])
    expect(tools).not.toContain('Task')
    expect(tools).not.toContain('Agent')
    expect([...CLAUDE_CODE_BUILTIN_TOOLS].sort()).toEqual([...tools].sort())
  })

  it('(−) reading only: Write, Edit, NotebookEdit, Bash, WebFetch and WebSearch are disallowed; Read, Glob and Grep stay', () => {
    const { tools, disallowed } = claudeCodeBuiltins(caps('read'))
    expect([...tools].sort()).toEqual(['Glob', 'Grep', 'Read'])
    expect([...disallowed].sort()).toEqual(['Bash', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Write'])
  })

  it('(+) the shell alone brings back Bash and nothing else', () => {
    const { tools, disallowed } = claudeCodeBuiltins(caps('read', 'shell'))
    expect(tools).toContain('Bash')
    expect(tools).not.toContain('Write')
    expect(disallowed).toContain('Write')
    expect(disallowed).not.toContain('Bash')
  })
})

describe('acpToolCapabilities', () => {
  it('(+) maps the ACP kinds onto capabilities', () => {
    expect(acpToolCapabilities({ kind: 'read' })).toEqual(['read'])
    expect(acpToolCapabilities({ kind: 'search' })).toEqual(['read'])
    expect(acpToolCapabilities({ kind: 'edit' })).toEqual(['write'])
    expect(acpToolCapabilities({ kind: 'move' })).toEqual(['write'])
    expect(acpToolCapabilities({ kind: 'execute' })).toEqual(['shell'])
    expect(acpToolCapabilities({ kind: 'delete' })).toEqual(['shell'])
    expect(acpToolCapabilities({ kind: 'fetch' })).toEqual(['web'])
  })

  it('(+) grok\'s own tool names classify a call whose kind is generic', () => {
    expect(acpToolCapabilities({ kind: 'other', names: ['list_dir'] })).toEqual(['read'])
    expect(acpToolCapabilities({ names: ['run_terminal_command'] })).toEqual(['shell'])
    expect(acpToolCapabilities({ names: [undefined, 'write'] })).toEqual(['write'])
  })

  it('(−) a web search reported as a search needs the web too, not only reading', () => {
    expect(acpToolCapabilities({ kind: 'search', names: ['web_search'] })).toEqual(['read', 'web'])
  })

  it('(−) kinds and names no row describes need nothing (the gate decides alone)', () => {
    expect(acpToolCapabilities({ kind: 'other', names: ['search_tool'] })).toEqual([])
    expect(acpToolCapabilities({ kind: 'think' })).toEqual([])
    expect(acpToolCapabilities({})).toEqual([])
    expect(acpToolCapabilities({ kind: null, names: [null, ''] })).toEqual([])
  })
})

describe('nativeCapabilityDenial', () => {
  it('reads like the toolset refusal and names the tools that would grant it', () => {
    expect(nativeCapabilityDenial('shell', 'Bash')).toBe("'Bash' is not in this agent's toolset: its tool list has none of run_command")
    expect(nativeCapabilityDenial('write', 'Write')).toContain('write_file, edit_file')
    expect(nativeCapabilityDenial('read', 'Read')).toBe("'Read' is not in this agent's toolset")
  })
})

describe('CLI_NATIVE_CAPABILITIES', () => {
  it('no ACP kind, Claude built-in or covered EYAS tool belongs to two capabilities', () => {
    for (const field of ['acpKinds', 'claudeCode', 'covers'] as const) {
      const seen = Object.values(CLI_NATIVE_CAPABILITIES).flatMap((row) => [...row[field]])
      expect(new Set(seen).size, field).toBe(seen.length)
    }
  })
})
