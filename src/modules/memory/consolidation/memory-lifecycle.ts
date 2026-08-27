// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EpisodicMemoryService } from '../tiers/episodic-memory.js'
import type { ConversationMemoryHooks } from '@modules/conversations/routes.js'

/**
 * Memory lifecycle hooks — wired into conversation routes to automatically
 * capture knowledge from conversation turns and SDK events.
 */
export function createMemoryLifecycle(deps: {
  episodic: EpisodicMemoryService
}): ConversationMemoryHooks {
  // Track which conversations have accessed which memories (in-memory, per-process)
  const conversationMemoryMap = new Map<string, Set<string>>()

  return {
    /**
     * PreCompact: Claude Code SDK is about to compress context.
     * Save the compaction summary as an episodic memory so the information
     * survives beyond the compressed session.
     */
    onContextCompact(conversationId: string, summary: string) {
      if (!summary || summary.trim().length < 20) return
      deps.episodic.create({
        content: summary.trim(),
        sourceType: 'system',
        sourceId: conversationId,
        tags: ['pre-compact', 'auto-summary'],
      })
    },

    /**
     * Post-turn: extract implicit facts from a user↔assistant exchange.
     *
     * The original regex-based extractor produced a high false-positive rate
     * (matched "always" inside code samples, sarcasm, hedged statements, etc.),
     * flooding the episodic store with low-quality rows. We intentionally
     * DISABLED regex extraction and rely on two higher-signal paths instead:
     *   1. PreCompact summaries (onContextCompact) — a proper LLM digest
     *      already captures stable facts at session boundary.
     *   2. Explicit user intent — when the user uses a /remember style command
     *      or the agent calls write_team_memory.
     *
     * A dedicated ImplicitFactExtractor (future Phase 3K) will use an LLM
     * classifier to score candidate facts and store only high-confidence items,
     * then dedup via embedding similarity. Until that lands, we no-op here.
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
