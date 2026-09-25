// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J9 — memory the model can WRITE is gone from the tool surface: the shared
// memory blocks (memory_block_read / memory_block_write) are retired and
// their rows migrated into L0. The always-on memory list is read-only, and
// every name on it is a tool that really exists.

import { describe, it, expect } from 'vitest'
import { MEMORY_ALWAYS_ON_TOOLS } from '@modules/tools/builtin/memory-tools'
import { PLATFORM_MANDATORY_TOOLS } from '@modules/agent/tool-scope'
import { buildProductionToolRegistry } from '../../../helpers/production-tool-registry'

describe('memory tools on the model surface', () => {
  it('lists only registered, read-only memory tools as always-on (positive)', async () => {
    const registry = await buildProductionToolRegistry()
    expect(MEMORY_ALWAYS_ON_TOOLS).toEqual(['memory_search', 'memory_expand'])
    for (const name of MEMORY_ALWAYS_ON_TOOLS) {
      const tool = registry.get(name)
      expect(tool, `${name} is registered`).toBeDefined()
      expect(tool!.riskTier, `${name} is read-only`).toBe('green')
      expect(tool!.memoryBearing, `${name}.memoryBearing`).toBe(true)
    }
  })

  it('is the tool scope\'s mandatory list, not a second copy', () => {
    expect(PLATFORM_MANDATORY_TOOLS).toBe(MEMORY_ALWAYS_ON_TOOLS)
  })

  it('no longer registers the memory block tools (negative)', async () => {
    const registry = await buildProductionToolRegistry()
    expect(registry.get('memory_block_read')).toBeUndefined()
    expect(registry.get('memory_block_write')).toBeUndefined()
    expect(registry.list().filter((t) => t.name.startsWith('memory_block'))).toEqual([])
  })

  it('offers a custom allowlist that still names a retired block tool without it (negative)', async () => {
    const registry = await buildProductionToolRegistry()
    const offered = registry.toToolDefinitions(['memory_block_write', 'memory_search']).map((d) => d.name)
    expect(offered).toEqual(['memory_search'])
  })
})
