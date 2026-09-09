// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * D14 — shared ownership resolution for team/orchestration WS topics and
 * their REST replay twin. Both the WS topic ACL resolvers (wired in
 * agent/index.ts) and routes-orchestration.ts call through this SAME logic
 * so the parent-chain walk exists in exactly one place.
 */
export interface OrchestrationOwnershipDeps {
  /** Does `userId` own this conversation (walks past 'system'-owned hops to the nearest human)? */
  ownsConversation(conversationId: string, userId: string): boolean
  /** Team session lookup — null/undefined for an unknown id. */
  getTeamSession(teamSessionId: string): { parentConversationId: string } | null | undefined
}

export interface OrchestrationOwnership {
  ownsTeamEvent(teamSessionId: string, userId: string): boolean
  ownsTeamProposed(conversationId: string, userId: string): boolean
  /** `runId` is EITHER a teamSessionId OR a conversationId (T10/S1) — try both; unresolvable denies. */
  ownsOrchestrationRun(runId: string, userId: string): boolean
}

export function createOrchestrationOwnership(deps: OrchestrationOwnershipDeps): OrchestrationOwnership {
  return {
    ownsTeamEvent(teamSessionId, userId) {
      const session = deps.getTeamSession(teamSessionId)
      if (!session) return false
      return deps.ownsConversation(session.parentConversationId, userId)
    },

    ownsTeamProposed(conversationId, userId) {
      return deps.ownsConversation(conversationId, userId)
    },

    ownsOrchestrationRun(runId, userId) {
      const session = deps.getTeamSession(runId)
      if (session) return deps.ownsConversation(session.parentConversationId, userId)
      // Not a team session — try it directly as a conversationId (a plain
      // single-agent/pipeline run reports its orchestration events under its
      // own conversationId, no team session involved).
      return deps.ownsConversation(runId, userId)
    },
  }
}
