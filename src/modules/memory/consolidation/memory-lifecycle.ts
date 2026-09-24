// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EpisodicMemoryService } from '../tiers/episodic-memory.js'
import type { ConversationMemoryHooks } from '@modules/conversations/routes.js'

/**
 * Memory lifecycle hooks — wired into conversation routes. A provider's own
 * context compaction is not one of them: it reaches the chat as a
 * contextCompacted notice and writes nothing to memory (no model-authored
 * summary is ever stored; EYAS keeps every raw turn itself).
 */
export function createMemoryLifecycle(deps: {
  episodic: EpisodicMemoryService
}): ConversationMemoryHooks {
  // Track which conversations have accessed which memories (in-memory, per-process)
  const conversationMemoryMap = new Map<string, Set<string>>()

  return {
    /**
     * Post-turn: extract implicit facts from a user↔assistant exchange.
     *
     * The original regex-based extractor produced a high false-positive rate
     * (matched "always" inside code samples, sarcasm, hedged statements, etc.),
     * flooding the episodic store with low-quality rows. We intentionally
     * DISABLED regex extraction here. What a turn leaves in memory comes from
     * the paths that own it instead:
     *   1. Every stored message is captured raw (L0) at the persistence layer
     *      (conversations/l0-capture.ts) and mined by the v2 extraction.
     *   2. The durable-memory capture pass runs once after each delivered
     *      turn (the chat route's turn sink → memory/capture).
     *   3. Explicit intent — a /remember style command, or the agent calling
     *      a memory write tool.
     * So this hook stays a no-op.
     */
    onTurnComplete(_conversationId: string, _userMessage: string, _assistantMessage: string) {
      // no-op — intentional; see block comment above.
    },

    /**
     * Track which memories are accessed from which conversations.
     * When a memory is accessed from a new conversation, increment its
     * conversation_count — used by decay to protect cross-cutting knowledge.
     */
    onMemoryAccessed(conversationId: string, memoryIds: string[]) {
      for (const memId of memoryIds) {
        let convSet = conversationMemoryMap.get(memId)
        if (!convSet) {
          convSet = new Set()
          conversationMemoryMap.set(memId, convSet)
        }
        if (!convSet.has(conversationId)) {
          convSet.add(conversationId)
          deps.episodic.touchConversation(memId)
        }
      }
    },
  }
}

export type MemoryLifecycle = ReturnType<typeof createMemoryLifecycle>
