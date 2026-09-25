// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import {
  DELEGATION_TOOLS,
  PLATFORM_MANDATORY_TOOLS,
  nativeCapabilitiesFor,
  requestToolScope,
  resolveToolScope,
  scopeAllowlist,
  scopeAllows,
  scopedToolDefinitions,
} from '@modules/agent/tool-scope'

/** A registry fake that behaves like the real one: names filter, no names = all. */
function fakeRegistry(names: string[]) {
  const toToolDefinitions = vi.fn((filter?: string[]) =>
    names
      .filter((n) => !filter || filter.includes(n))
      .map((n) => ({ name: n, description: `${n} tool`, inputSchema: {} })),
  )
  return { toToolDefinitions }
}

const REGISTERED = [
  'read_file', 'write_file', 'grep', 'research',
  'memory_search', 'memory_expand',
  'run_specialist', 'delegate_to_agent', 'handoff_to_colleague', 'propose_team', 'assign_task',
]

describe('resolveToolScope', () => {
  it('a narrow list gains the mandatory memory tools', () => {
    const scope = resolveToolScope({ agentTools: ['read_file'] })
    expect(scope.include).toEqual(['read_file', 'memory_search', 'memory_expand'])
    expect(scope.exclude).toEqual([])
  })

  it('an empty or absent list means every tool (include undefined)', () => {
    expect(resolveToolScope({ agentTools: [] }).include).toBeUndefined()
    expect(resolveToolScope({}).include).toBeUndefined()
    expect(resolveToolScope().include).toBeUndefined()
    expect(resolveToolScope({ agentTools: null }).include).toBeUndefined()
  })

  it('a list of blanks is an empty list, not a list of nothing (negative)', () => {
    expect(resolveToolScope({ agentTools: ['', '  '] }).include).toBeUndefined()
  })

  it('removes duplicates, including a mandatory tool the agent already lists (negative)', () => {
    const scope = resolveToolScope({ agentTools: ['grep', 'memory_search', 'grep', ' grep '] })
    expect(scope.include).toEqual(['grep', 'memory_search', 'memory_expand'])
  })

  it('solo excludes the delegation family even when include is undefined', () => {
    const scope = resolveToolScope({ orchestration: 'solo' })
    expect(scope.include).toBeUndefined()
    for (const name of ['run_specialist', 'delegate_to_agent', 'handoff_to_colleague', 'propose_team']) {
      expect(scopeAllows(scope, name), name).toBe(false)
    }
    // assign_task files board work; it does not fan out inside the turn.
    expect(scopeAllows(scope, 'assign_task')).toBe(true)
    expect(scopeAllows(scope, 'read_file')).toBe(true)
  })

  it('solo also strips delegation tools the agent lists explicitly', () => {
    const scope = resolveToolScope({ agentTools: ['run_specialist', 'grep'], orchestration: 'solo' })
    expect(scopeAllows(scope, 'run_specialist')).toBe(false)
    expect(scopeAllows(scope, 'grep')).toBe(true)
  })

  it('solo never removes memory_search or memory_expand (negative)', () => {
    for (const agentTools of [undefined, [], ['grep']]) {
      const scope = resolveToolScope({ agentTools, orchestration: 'solo' })
      for (const name of PLATFORM_MANDATORY_TOOLS) expect(scopeAllows(scope, name), name).toBe(true)
    }
  })

  it('auto, deep and an unset mode exclude nothing (negative)', () => {
    for (const orchestration of ['auto', 'deep', null, undefined]) {
      expect(resolveToolScope({ orchestration }).exclude).toEqual([])
    }
  })

  it('the delegation family is disjoint from the mandatory tools', () => {
    expect(DELEGATION_TOOLS.filter((n) => PLATFORM_MANDATORY_TOOLS.includes(n))).toEqual([])
  })
})

describe('scopeAllows', () => {
  it('allows a listed tool and refuses one outside the list', () => {
    const scope = resolveToolScope({ agentTools: ['grep'] })
    expect(scopeAllows(scope, 'grep')).toBe(true)
    expect(scopeAllows(scope, 'memory_expand')).toBe(true)
    expect(scopeAllows(scope, 'write_file')).toBe(false)
  })
})

describe('scopedToolDefinitions', () => {
  it('a narrow list yields allowlist ∪ mandatory, and nothing else', () => {
    const registry = fakeRegistry(REGISTERED)
    const defs = scopedToolDefinitions(registry, resolveToolScope({ agentTools: ['read_file'] }))
    expect(defs.map((d) => d.name)).toEqual(['read_file', 'memory_search', 'memory_expand'])
    expect(registry.toToolDefinitions).toHaveBeenCalledWith(['read_file', 'memory_search', 'memory_expand'])
  })

  it('no list asks the registry for everything', () => {
    const registry = fakeRegistry(REGISTERED)
    const defs = scopedToolDefinitions(registry, resolveToolScope({}))
    expect(defs.map((d) => d.name)).toEqual(REGISTERED)
    expect(registry.toToolDefinitions.mock.calls[0]).toEqual([])
  })

  it('solo with no list drops only the delegation family', () => {
    const defs = scopedToolDefinitions(fakeRegistry(REGISTERED), resolveToolScope({ orchestration: 'solo' }))
    const names = defs.map((d) => d.name)
    expect(names).toContain('assign_task')
    expect(names).toContain('memory_search')
    for (const name of DELEGATION_TOOLS) expect(names).not.toContain(name)
  })

  it('unregistered allowlist names are simply absent (negative)', () => {
    const defs = scopedToolDefinitions(fakeRegistry(REGISTERED), resolveToolScope({ agentTools: ['no_such_tool'] }))
    expect(defs.map((d) => d.name)).toEqual(['memory_search', 'memory_expand'])
  })

  it('a missing registry offers nothing (negative)', () => {
    expect(scopedToolDefinitions(undefined, resolveToolScope({}))).toEqual([])
    expect(scopedToolDefinitions(null, resolveToolScope({ agentTools: ['grep'] }))).toEqual([])
  })
})

// H9 — an agent whose allowlist names tools nobody registered loses them, and
// the operator hears about it once per agent, not on every run.
describe('scopedToolDefinitions — unknown allowlist names', () => {
  it('(+) logs one warning naming the agent and the unknown tools', () => {
    const warn = vi.fn()
    const defs = scopedToolDefinitions(
      fakeRegistry(REGISTERED),
      resolveToolScope({ agentTools: ['grep', 'no_such_tool', 'gone_tool'] }),
      { agentId: 'agent-warn-1', logger: { warn } },
    )
    expect(defs.map((d) => d.name)).toEqual(['grep', 'memory_search', 'memory_expand'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('agent-warn-1')
    expect(warn.mock.calls[0][0]).toContain('no_such_tool, gone_tool')
  })

  it('(−) a second resolve for the same agent does not log again', () => {
    const warn = vi.fn()
    const scope = resolveToolScope({ agentTools: ['no_such_tool'] })
    scopedToolDefinitions(fakeRegistry(REGISTERED), scope, { agentId: 'agent-warn-2', logger: { warn } })
    scopedToolDefinitions(fakeRegistry(REGISTERED), scope, { agentId: 'agent-warn-2', logger: { warn } })
    expect(warn).toHaveBeenCalledTimes(1)
    // Another agent with the same mistake is its own warning.
    scopedToolDefinitions(fakeRegistry(REGISTERED), scope, { agentId: 'agent-warn-3', logger: { warn } })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('(−) no warning for a list of registered tools, an unregistered mandatory memory tool, or without an agent id', () => {
    const warn = vi.fn()
    scopedToolDefinitions(fakeRegistry(REGISTERED), resolveToolScope({ agentTools: ['grep'] }), { agentId: 'agent-warn-4', logger: { warn } })
    // Memory module off: the mandatory tools are missing, but they are not the agent's mistake.
    scopedToolDefinitions(fakeRegistry(['grep']), resolveToolScope({ agentTools: ['grep'] }), { agentId: 'agent-warn-5', logger: { warn } })
    scopedToolDefinitions(fakeRegistry(REGISTERED), resolveToolScope({ agentTools: ['no_such_tool'] }), { logger: { warn } })
    expect(warn).not.toHaveBeenCalled()
  })

  it('(−) a throwing logger never costs the run its tools', () => {
    const defs = scopedToolDefinitions(
      fakeRegistry(REGISTERED),
      resolveToolScope({ agentTools: ['grep', 'no_such_tool'] }),
      { agentId: 'agent-warn-6', logger: { warn: () => { throw new Error('log sink down') } } },
    )
    expect(defs.map((d) => d.name)).toEqual(['grep', 'memory_search', 'memory_expand'])
  })
})

describe('requestToolScope — the scope a request carries to a CLI bridge', () => {
  const def = (name: string) => ({ name, description: name, inputSchema: {} })

  it('(+) a request that names tools is scoped to exactly those names', () => {
    const scope = requestToolScope({ tools: [def('memory_search'), def('browser_navigate'), def('memory_search')] })
    expect(scope).toEqual({ include: ['memory_search', 'browser_navigate'], exclude: [] })
  })

  it('(+) a request that names none sets no allowlist', () => {
    expect(requestToolScope({})).toEqual({ exclude: [] })
    expect(requestToolScope({ tools: [] })).toEqual({ exclude: [] })
  })

  it('(−) Solo strips the delegation family, named or not; assign_task stays', () => {
    for (const tools of [undefined, [def('run_specialist'), def('assign_task'), def('memory_search')]]) {
      const scope = requestToolScope({ tools, orchestration: 'solo' })
      expect(scopeAllows(scope, 'run_specialist')).toBe(false)
      expect(scopeAllows(scope, 'propose_team')).toBe(false)
      expect(scopeAllows(scope, 'assign_task')).toBe(true)
    }
  })
})

describe('scopeAllowlist', () => {
  it('the registered names the scope allows, and nothing it does not (negative)', () => {
    const scope = resolveToolScope({ agentTools: ['grep', 'no_such_tool'], orchestration: 'solo' })
    expect([...scopeAllowlist(scope, REGISTERED)].sort()).toEqual(['grep', 'memory_expand', 'memory_search'])
    expect([...scopeAllowlist(resolveToolScope({ orchestration: 'solo' }), REGISTERED)]).not.toContain('run_specialist')
  })
})

// K3 — the same scope bounds a CLI's own built-ins (tools/cli-exposure.ts).
describe('nativeCapabilitiesFor — what a CLI\'s own tools may do under the scope', () => {
  const granted = (scope: ReturnType<typeof resolveToolScope>) => [...nativeCapabilitiesFor(scope)].sort()

  it('(+) no allowlist grants every native capability', () => {
    expect(granted(resolveToolScope({}))).toEqual(['read', 'shell', 'web', 'write'])
    expect(granted(resolveToolScope({ orchestration: 'solo' }))).toEqual(['read', 'shell', 'web', 'write'])
  })

  it('(−) an allowlist without write, shell or web tools grants reading only', () => {
    expect(granted(resolveToolScope({ agentTools: ['read_file', 'grep', 'git_status', 'create_task'] }))).toEqual(['read'])
  })

  it('(+) the listed tools bring back exactly their capabilities', () => {
    expect(granted(resolveToolScope({ agentTools: ['write_file'] }))).toEqual(['read', 'write'])
    expect(granted(resolveToolScope({ agentTools: ['run_command'] }))).toEqual(['read', 'shell'])
    expect(granted(resolveToolScope({ agentTools: ['research', 'edit_file', 'run_command'] }))).toEqual(['read', 'shell', 'web', 'write'])
  })

  it('(+) a request scope reads the same way: the names it offers decide', () => {
    const def = (name: string) => ({ name, description: name, inputSchema: {} })
    expect([...nativeCapabilitiesFor(requestToolScope({ tools: [def('memory_search')] }))]).toEqual(['read'])
    expect([...nativeCapabilitiesFor(requestToolScope({ tools: [] }))].sort()).toEqual(['read', 'shell', 'web', 'write'])
  })
})
