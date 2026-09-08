// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EpisodicMemoryService } from '../tiers/episodic-memory.js'
import type { ArchiveMemoryService } from '../tiers/archive-memory.js'
import type { WorkingMemoryService } from '../tiers/working-memory.js'
import type { EpisodicMemory } from '../types.js'

interface DecayConfig {
  decayRate: number
  promotionThreshold: number
  promotionMinAccess: number
  demotionThreshold: number
  demotionAgeDays: number
  /** Min access count for working→episodic auto-promotion */
  workingPromotionMinAccess: number
}

export function createDecayService(
  episodic: EpisodicMemoryService,
  archive: ArchiveMemoryService,
  config: DecayConfig,
  working?: WorkingMemoryService,
) {
  return {
    /**
     * Apply time-based decay to episodic memories.
     * Conversation-aware: memories used across multiple conversations decay slower.
     * Formula: effectiveRate = decayRate ^ (1 / conversationCount)
     * A memory used in 3 conversations decays at rate^0.33 instead of rate^1.
     */
    runDecay() {
      episodic.applyDecay(config.decayRate)
    },

    runDemotion(): { demoted: number } {
      const candidates = episodic.findDemotionCandidates(config.demotionThreshold, config.demotionAgeDays)
      let demoted = 0
      for (const mem of candidates) {
        // Protect memories used across many conversations — they're cross-cutting knowledge
        if (mem.conversationCount >= 3) continue
        archive.archive({
          originalId: mem.id, content: mem.content,
          sourceType: mem.sourceType, tags: mem.tags,
          originalCreatedAt: mem.createdAt,
        })
        episodic.delete(mem.id)
        demoted++
      }
      return { demoted }
    },

    findPromotionCandidates(): EpisodicMemory[] {
      return episodic.findPromotionCandidates(config.promotionThreshold, config.promotionMinAccess)
    },

    /**
     * Promote frequently-accessed working memory blocks to episodic tier.
     * Blocks accessed >= workingPromotionMinAccess times are clearly important
     * beyond their 24h TTL, so they get persisted as episodic memories.
     */
    promoteHotBlocks(): { promoted: number } {
      if (!working) return { promoted: 0 }
      const candidates = working.findPromotionCandidates(config.workingPromotionMinAccess)
      let promoted = 0
      for (const block of candidates) {
        episodic.create({
          content: block.content,
          sourceType: 'system',
          sourceId: `working:${block.key}`,
          tags: ['auto-promoted', 'from-working'],
        })
        working.delete(block.key)
        promoted++
      }
      return { promoted }
    },
  }
}

export type DecayService = ReturnType<typeof createDecayService>
