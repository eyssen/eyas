// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * In-flight interactive chat runs. The Stop button POSTs /conversations/:id/cancel
 * which aborts the controller this module handed the agent runner. Client SSE
 * disconnect does NOT cancel — a dropped tab must not kill a long tool run.
 */

const runs = new Map<string, AbortController>()

export function beginConversationRun(conversationId: string): AbortSignal {
  const previous = runs.get(conversationId)
  if (previous && !previous.signal.aborted) previous.abort()
  const controller = new AbortController()
  runs.set(conversationId, controller)
  return controller.signal
}

/** Returns true when a live run was aborted. */
export function cancelConversationRun(conversationId: string): boolean {
  const controller = runs.get(conversationId)
  if (!controller) return false
  if (!controller.signal.aborted) controller.abort()
  runs.delete(conversationId)
  return true
}

export function endConversationRun(conversationId: string, signal: AbortSignal): void {
  const controller = runs.get(conversationId)
  if (controller && controller.signal === signal) runs.delete(conversationId)
}

export function hasConversationRun(conversationId: string): boolean {
  const controller = runs.get(conversationId)
  return Boolean(controller && !controller.signal.aborted)
}

export function resetConversationRunsForTests(): void {
  for (const controller of runs.values()) {
    if (!controller.signal.aborted) controller.abort()
  }
  runs.clear()
}
