// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EpisodicMemoryService } from '../tiers/episodic-memory.js'

export function createImplicitExtractor(episodic: EpisodicMemoryService) {
  return {
    saveExtractedFacts(conversationId: string, facts: string[]) {
      for (const fact of facts) {
        if (fact.trim().length === 0) continue
        episodic.create({
          content: fact.trim(),
          sourceType: 'extraction',
          sourceId: conversationId,
          tags: ['auto-extracted'],
        })
      }
    },
  }
}

export type ImplicitExtractor = ReturnType<typeof createImplicitExtractor>
