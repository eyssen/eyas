// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface DelegationDeps {
  maxDepth: number
  getAncestry: (conversationId: string) => { agentId: string | null }[]
  createChildConversation: (parentId: string, agentId: string, task: string) => string
  // F2 T4 — executeAgent's honest result: the run may not have completed
  // (thrown provider error → 'failed'; turn cap hit → 'max_turns'). delegate()
  // below must not report fabricated success in either case.
  // F2 T5 — 'parked' joins them: the delegated run hit an escalation and now
  // waits on an operator decision (approvalId), to be resumed by Task 6.
  executeAgent: (
    conversationId: string,
    agentId: string,
    task: string,
  ) => Promise<{ text: string; status: 'completed' | 'failed' | 'max_turns' | 'parked'; sessionId: string; approvalId?: number }>
  /**
   * Run a synchronous unit of work atomically. Used to close the TOCTOU window
   * between validating the delegation chain and creating the child conversation.
   * Implementations typically wrap the callback in `db.transaction(fn)()`.
   */
  runTransaction: <T>(fn: () => T) => T
}

export function createDelegationService(deps: DelegationDeps) {
  function validateInternal(targetAgentId: string, conversationId: string): void {
    const ancestry = deps.getAncestry(conversationId)
    if (ancestry.length >= deps.maxDepth) {
      throw new Error(`Maximum delegation depth (${deps.maxDepth}) exceeded`)
    }
    const agentChain = ancestry.map(c => c.agentId).filter(Boolean)
    if (agentChain.includes(targetAgentId)) {
      throw new Error(`Circular delegation detected: ${targetAgentId} is already in the chain`)
    }
  }

  return {
    // Kept for backward-compatibility with any external caller / test.
    // Prefer `delegate()` in new code — it validates atomically with the child creation.
    validate: validateInternal,

    async delegate(
      fromConversationId: string,
      targetAgentId: string,
      task: string,
    ): Promise<{ conversationId: string; result: string }> {
      // Atomic validate + create: any concurrent delegation that would change the
      // ancestry (and thus invalidate the check) must wait for the transaction to
      // commit. SQLite serializes writers, so `BEGIN IMMEDIATE` (drizzle's default
      // for sync transactions) is sufficient to close the TOCTOU window.
      const childId = deps.runTransaction(() => {
        validateInternal(targetAgentId, fromConversationId)
        return deps.createChildConversation(fromConversationId, targetAgentId, task)
      })

      // Execution happens OUTSIDE the transaction — long-running LLM calls must
      // never hold a write lock. The child conversation row is already committed.
      const outcome = await deps.executeAgent(childId, targetAgentId, task)
      // Public shape stays { conversationId, result: string } — but `result` is
      // no longer fabricated success prose when the run didn't complete (F2 T4).
      // The delegating agent reads this string as its tool result, so a parked
      // delegation has to say plainly that the work is paused (not failed) and
      // name the approval a human has to action.
      const result = outcome.status === 'completed'
        ? outcome.text
        : outcome.status === 'parked'
          ? `Delegation to ${targetAgentId} is parked pending approval #${outcome.approvalId ?? '?'} — an operator must approve it before the delegated run can continue. Do not retry this delegation.`
          : `Delegation to ${targetAgentId} did not complete (status: ${outcome.status}).${outcome.text ? ` Partial output: ${outcome.text}` : ''}`
      return { conversationId: childId, result }
    },
  }
}
