// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createOrchestrationOwnership } from '@modules/agent/orchestration-ownership'

function makeDeps(opts: {
  owners?: Record<string, string>
  sessions?: Record<string, { parentConversationId: string }>
} = {}) {
  const owners = opts.owners ?? {}
  const sessions = opts.sessions ?? {}
  return {
    ownsConversation: vi.fn((conversationId: string, userId: string) => owners[conversationId] === userId),
    getTeamSession: vi.fn((id: string) => sessions[id] ?? null),
  }
}

describe('createOrchestrationOwnership', () => {
  describe('ownsTeamEvent', () => {
    it('resolves through the team session to its parent conversation owner', () => {
      const deps = makeDeps({ owners: { 'conv-1': 'user-1' }, sessions: { 'team-1': { parentConversationId: 'conv-1' } } })
      const ownership = createOrchestrationOwnership(deps)

      expect(ownership.ownsTeamEvent('team-1', 'user-1')).toBe(true)
      expect(ownership.ownsTeamEvent('team-1', 'user-2')).toBe(false)
    })

    it('denies an unknown team session', () => {
      const deps = makeDeps()
      const ownership = createOrchestrationOwnership(deps)
      expect(ownership.ownsTeamEvent('does-not-exist', 'user-1')).toBe(false)
      expect(deps.ownsConversation).not.toHaveBeenCalled()
    })
  })

  describe('ownsTeamProposed', () => {
    it('resolves the conversationId directly', () => {
      const deps = makeDeps({ owners: { 'conv-1': 'user-1' } })
      const ownership = createOrchestrationOwnership(deps)
      expect(ownership.ownsTeamProposed('conv-1', 'user-1')).toBe(true)
      expect(ownership.ownsTeamProposed('conv-1', 'user-2')).toBe(false)
    })
  })

  describe('ownsOrchestrationRun', () => {
    it('resolves a runId that is a team session id', () => {
      const deps = makeDeps({ owners: { 'conv-1': 'user-1' }, sessions: { 'team-1': { parentConversationId: 'conv-1' } } })
      const ownership = createOrchestrationOwnership(deps)
      expect(ownership.ownsOrchestrationRun('team-1', 'user-1')).toBe(true)
      expect(ownership.ownsOrchestrationRun('team-1', 'user-2')).toBe(false)
    })

    it('falls back to treating the runId as a conversationId directly (plain single-agent run)', () => {
      const deps = makeDeps({ owners: { 'conv-1': 'user-1' } })
      const ownership = createOrchestrationOwnership(deps)
      expect(ownership.ownsOrchestrationRun('conv-1', 'user-1')).toBe(true)
      expect(ownership.ownsOrchestrationRun('conv-1', 'user-2')).toBe(false)
    })

    it('denies a runId that resolves neither as a team session nor a conversation', () => {
      const deps = makeDeps()
      const ownership = createOrchestrationOwnership(deps)
      expect(ownership.ownsOrchestrationRun('mystery-run', 'user-1')).toBe(false)
    })
  })
})
