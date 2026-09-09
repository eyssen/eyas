// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildContext } from '../../../src/modules/memory/search/context-builder.js'
import type { WorkingMemoryBlock, MemorySearchResult } from '../../../src/modules/memory/types.js'

describe('ContextBuilder', () => {
  it('includes working blocks and respects token budget', () => {
    const blocks: WorkingMemoryBlock[] = [
      { key: 'user_context', content: 'User is a DevOps engineer', maxTokens: 100, createdAt: '', updatedAt: '', expiresAt: '', accessCount: 0 },
    ]
    const memories: MemorySearchResult[] = [
      { source: 'episodic', id: '1', content: 'Fact A about K8s', score: 0.9, metadata: {} },
      { source: 'vault', id: '2', content: 'Long vault content '.repeat(500), score: 0.8, metadata: {} },
    ]

    const result = buildContext(blocks, memories, 200)
    expect(result.workingBlocks).toHaveLength(1)
    expect(result.totalTokens).toBeLessThanOrEqual(200)
    expect(result.sources.length).toBeGreaterThan(0)
  })

  it('prioritizes highest score memories', () => {
    const memories: MemorySearchResult[] = [
      { source: 'episodic', id: 'low', content: 'Low priority', score: 0.1, metadata: {} },
      { source: 'vault', id: 'high', content: 'High priority', score: 0.9, metadata: {} },
    ]

    const result = buildContext([], memories, 1000)
    expect(result.relevantMemories[0].id).toBe('high')
  })

  it('returns empty when no memories', () => {
    const result = buildContext([], [], 1000)
    expect(result.relevantMemories).toHaveLength(0)
    expect(result.totalTokens).toBe(0)
  })
})
