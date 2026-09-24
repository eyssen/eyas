// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolDefinition } from '@modules/model/types.js'
import type { ToolImplementation, ToolFilter } from './types.js'

export interface ToolRegistry {
  register(tool: ToolImplementation): void
  unregister(name: string): boolean
  get(name: string): ToolImplementation | undefined
  list(filter?: ToolFilter): ToolImplementation[]
  toToolDefinitions(names?: string[]): ToolDefinition[]
  has(name: string): boolean
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolImplementation>()

  return {
    register(tool: ToolImplementation) {
      if (tools.has(tool.name)) {
        throw new Error(`Tool already registered: ${tool.name}`)
      }
      tools.set(tool.name, tool)
    },

    unregister(name: string) {
      return tools.delete(name)
    },

    get(name: string) {
      return tools.get(name)
    },

    has(name: string) {
      return tools.has(name)
    },

    list(filter?: ToolFilter) {
      let result = Array.from(tools.values())
      if (filter?.category) result = result.filter(t => t.category === filter.category)
      if (filter?.riskTier) result = result.filter(t => t.riskTier === filter.riskTier)
      if (filter?.names) result = result.filter(t => filter.names!.includes(t.name))
      return result
    },

    toToolDefinitions(names?: string[]) {
      const subset = names ? this.list({ names }) : this.list()
      return subset.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
    },
  }
}
