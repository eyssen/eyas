// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'
import type { MemoryBlockService, MemoryBlockScope } from '@modules/memory/blocks/memory-blocks.js'

const SCOPES: MemoryBlockScope[] = ['company', 'agent', 'team', 'run']

export function createMemoryBlockTools(getBlocks: () => MemoryBlockService | null | undefined): ToolImplementation[] {
  const blocks = () => getBlocks() ?? null

  return [
    {
      name: 'memory_block_read',
      description:
        'Read a shared memory block (company/agent/team/run scope). Prefer this for durable org facts over ad-hoc notes.',
      category: 'memory',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: SCOPES },
          scopeId: {
            type: 'string',
            description: 'company|agentId|teamSessionId|runId — use "default" for company',
          },
          key: { type: 'string', description: 'Block key (omit to list all keys)' },
        },
        required: ['scope', 'scopeId'],
      },
      execute: async (input) => {
        const svc = blocks()
        if (!svc) return { error: 'Memory blocks not available' }
        const scope = input.scope as MemoryBlockScope
        const scopeId = String(input.scopeId)
        if (input.key) {
          const b = svc.get(scope, scopeId, String(input.key))
          return b ? { block: b } : { error: 'Block not found' }
        }
        return { blocks: svc.list(scope, scopeId) }
      },
    },
    {
      name: 'memory_block_write',
      description:
        'Create or replace a memory block. Company-scope writes are yellow (approval when gated). Append with mode=append.',
      category: 'memory',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: SCOPES },
          scopeId: { type: 'string' },
          key: { type: 'string' },
          content: { type: 'string' },
          mode: { type: 'string', enum: ['replace', 'append'], description: 'Default replace' },
        },
        required: ['scope', 'scopeId', 'key', 'content'],
      },
      execute: async (input, ctx) => {
        const svc = blocks()
        if (!svc) return { error: 'Memory blocks not available' }
        const scope = input.scope as MemoryBlockScope
        // Company writes from agents require approval via risk tier + gate.
        const payload = {
          scope,
          scopeId: String(input.scopeId),
          key: String(input.key),
          content: String(input.content),
          updatedBy: ctx?.agentId ?? ctx?.userId,
        }
        const block =
          input.mode === 'append' ? svc.append(payload) : svc.upsert(payload)
        return { block, ok: true }
      },
    },
  ]
}
