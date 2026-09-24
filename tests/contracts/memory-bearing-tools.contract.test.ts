// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// memoryBearing contract (D4). A tool whose output is EYAS memory carries
// `memoryBearing: true` on its implementation, and the privacy egress filter
// (gateway) and the executor's renderForModel (CLI bridges, external MCP)
// mask exactly those results on their way to a remote model — the same
// masking the same memory gets when it is injected into the system prompt.
// There is no second list: the flag lives on the tool, so this contract is
// what stops a renamed or newly added memory tool from silently losing it.
//
// Workspace tools (files, shell, browser, documents, code search) never carry
// the flag: their results stay raw, because CLI-native tools cannot be masked
// and masking would write placeholders back into edited files.

import { describe, it, expect } from 'vitest'
import type { ToolCategory, ToolImplementation } from '@modules/tools/types'
import { PLATFORM_MANDATORY_TOOLS } from '@modules/agent/tool-scope'
import { buildProductionToolRegistry } from '../helpers/production-tool-registry'

/**
 * The memory tools every run path must offer: the tool scope's mandatory set,
 * so a rename there cannot leave this contract checking stale names.
 */
const MANDATORY_MEMORY_TOOLS = PLATFORM_MANDATORY_TOOLS

/** Memory-reading tools outside the memory/knowledge categories. */
const OTHER_MEMORY_READERS = ['read_team_memory']

const WORKSPACE_CATEGORIES: ReadonlySet<ToolCategory> = new Set(['shell', 'browser', 'documents', 'search'])

/** Every violation of the contract in `tools`, as readable lines. */
function memoryBearingViolations(tools: readonly Pick<ToolImplementation, 'name' | 'category' | 'riskTier' | 'memoryBearing'>[]): string[] {
  const out: string[] = []
  for (const tool of tools) {
    const readsMemory = (tool.category === 'memory' || tool.category === 'knowledge') && tool.riskTier === 'green'
    if (readsMemory && tool.memoryBearing !== true) {
      out.push(`${tool.name}: a read-only ${tool.category} tool must set memoryBearing: true`)
    }
    if (WORKSPACE_CATEGORIES.has(tool.category) && tool.memoryBearing) {
      out.push(`${tool.name}: a workspace (${tool.category}) tool must not be memoryBearing`)
    }
  }
  return out
}

describe('memoryBearing tools contract', () => {
  it('every mandatory memory tool is registered and memoryBearing', async () => {
    const registry = await buildProductionToolRegistry()
    for (const name of [...MANDATORY_MEMORY_TOOLS, ...OTHER_MEMORY_READERS]) {
      const tool = registry.get(name)
      expect(tool, `${name} is registered`).toBeDefined()
      expect(tool!.memoryBearing, `${name}.memoryBearing`).toBe(true)
    }
  })

  it('every read-only memory/knowledge tool carries the flag, and no workspace tool does', async () => {
    const registry = await buildProductionToolRegistry()
    expect(memoryBearingViolations(registry.list())).toEqual([])
    // The sweep sees real tools on both sides, so a rename cannot empty it.
    const flagged = registry.list().filter((t) => t.memoryBearing).map((t) => t.name).sort()
    expect(flagged).toEqual(expect.arrayContaining(['get_page', 'memory_expand', 'memory_search', 'search_knowledge', 'search_memory']))
  })

  it('workspace tools stay raw', async () => {
    const registry = await buildProductionToolRegistry()
    for (const name of ['read_file', 'write_file', 'edit_file', 'run_command', 'grep', 'browser_navigate', 'browser_get_content', 'read_document', 'search_indexed']) {
      const tool = registry.get(name)
      expect(tool, `${name} is registered`).toBeDefined()
      expect(tool!.memoryBearing, name).toBeFalsy()
    }
  })

  it('fails for a registered memory tool without the flag (negative)', () => {
    const unflagged = { name: 'memory_recall', category: 'memory' as const, riskTier: 'green' as const }
    const flaggedShell = { name: 'read_file', category: 'shell' as const, riskTier: 'green' as const, memoryBearing: true }
    expect(memoryBearingViolations([unflagged, flaggedShell])).toEqual([
      'memory_recall: a read-only memory tool must set memoryBearing: true',
      'read_file: a workspace (shell) tool must not be memoryBearing',
    ])
  })
})
