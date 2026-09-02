// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/memory-hooks.ts
//
// Memory lifecycle hooks, resolved LAZILY at call time.
//
// The old wiring checked (ctx as any).memory at conversations' own onStart.
// The loader orders modules by hard `dependencies` only; conversations starts
// before memory on every boot, so ctx.memory was always undefined and the
// hooks were wired 0 times in 68 recorded start cycles. Same failure class as
// the lazy getters directly above the old site — this file is that pattern.

import type { ConversationMemoryHooks } from './routes.js'

type Lifecycle = ConversationMemoryHooks

export function createLazyMemoryHooks(
  getMemory: () => { episodic: unknown } | undefined,
  logger: { info: (msg: string) => void; warn: (obj: unknown, msg?: string) => void },
  resolveProjectId?: (conversationId: string) => string | null,
): ConversationMemoryHooks {
  let lifecycle: Lifecycle | undefined

  const resolve = async (): Promise<Lifecycle | undefined> => {
    if (lifecycle) return lifecycle
    const memory = getMemory() as { episodic?: unknown } | undefined
    if (!memory?.episodic) return undefined
    const { createMemoryLifecycle } = await import('@modules/memory/consolidation/memory-lifecycle.js')
    lifecycle = createMemoryLifecycle({
      episodic: memory.episodic as import('@modules/memory/tiers/episodic-memory.js').EpisodicMemoryService,
      resolveProjectId,
    })
    logger.info('Memory lifecycle hooks wired into conversations (lazy)')
    return lifecycle
  }

  // Every hook is fire-and-forget: a memory failure is a missing memory,
  // never a failed conversation — but fail-SOFT still means logged, not
  // fail-SILENT (see memory/index.ts's memoryIndex accessor for the same
  // contract).
  return {
    onContextCompact: (conversationId, summary) => {
      void resolve()
        .then((l) => l?.onContextCompact?.(conversationId, summary))
        .catch((err) => logger.warn({ err }, 'Memory hook onContextCompact failed; this event goes unrecorded'))
    },
    onTurnComplete: (conversationId, userMessage, assistantMessage) => {
      void resolve()
        .then((l) => l?.onTurnComplete?.(conversationId, userMessage, assistantMessage))
        .catch((err) => logger.warn({ err }, 'Memory hook onTurnComplete failed; this event goes unrecorded'))
    },
    onMemoryAccessed: (conversationId, memoryIds) => {
      void resolve()
        .then((l) => l?.onMemoryAccessed?.(conversationId, memoryIds))
        .catch((err) => logger.warn({ err }, 'Memory hook onMemoryAccessed failed; this event goes unrecorded'))
    },
  }
}
