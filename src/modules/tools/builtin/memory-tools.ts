// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolContext, ToolImplementation } from '../types.js'
import { effectiveProjectId } from '@modules/memory/types.js'

/** `getService` resolves `ctx.memory`, which only exists after memory.onStart. */
export function createMemoryTools(getService: () => any): ToolImplementation[] {
  const NOT_READY = { error: 'Memory module not ready yet — try again shortly' }

  return [
    {
      name: 'search_memory',
      description:
        'Search episodic and vault memory for relevant context. ' +
        'Default scope is the current project, its type, and global user/feedback/reference notes. ' +
        'Pass scope=all to include other projects.',
      category: 'memory',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          tier: {
            type: 'string',
            // Working memory is a short-lived per-conversation scratchpad and
            // is not part of the hybrid search index — offering it here would
            // only produce empty results.
            enum: ['episodic', 'semantic', 'procedural', 'archive'],
            description: 'Memory tier to search. If omitted, searches all tiers.',
          },
          limit: { type: 'number', description: 'Maximum number of results to return (default: 10)' },
          scope: {
            type: 'string',
            enum: ['current', 'all'],
            description:
              'current (default): this project + its type + global notes. ' +
              'all: include notes from other projects too.',
          },
        },
        required: ['query'],
      },
      execute: async (input, toolCtx?: ToolContext) => {
        const service = getService()
        if (!service) return NOT_READY

        const tier = input.tier as string | undefined
        const results = await service.search({
          query: input.query as string,
          tiers: tier ? [tier] : undefined,
          limit: (input.limit as number) ?? 10,
          scope: input.scope === 'all' ? 'all' : 'current',
          projectId: effectiveProjectId(toolCtx?.projectId ?? null),
        })
        return { results }
      },
    },
    {
      name: 'save_memory',
      description: 'Save a new entry to episodic memory. Use for important observations, decisions, or facts worth remembering.',
      category: 'memory',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The memory content to store' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization',
          },
        },
        required: ['content'],
      },
      execute: async (input, toolCtx?: ToolContext) => {
        const service = getService()
        if (!service?.episodic) return NOT_READY

        // Salience is not an input: the episodic tier assigns and then decays
        // it, so an agent-supplied value would be overwritten anyway.
        const entry = service.episodic.create({
          content: input.content as string,
          sourceType: 'agent-memory',
          tags: (input.tags as string[]) ?? [],
          conversationId: toolCtx?.conversationId ?? null,
          projectId: effectiveProjectId(toolCtx?.projectId ?? null),
          // Kept alongside the typed column for pre-F1 readers of source_id.
          sourceId: toolCtx?.conversationId ?? null,
        })
        return { saved: true, id: entry.id }
      },
    },
  ]
}
