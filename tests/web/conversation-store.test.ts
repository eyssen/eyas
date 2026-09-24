// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { useConversationStore } from '../../src/web/src/stores/conversation-store'

describe('conversation-store tool calls (matched by toolUseId)', () => {
  beforeEach(() => {
    useConversationStore.getState().setAgentProgress({
      agentName: 'Agent',
      turn: 0,
      maxTurns: 10,
      toolCalls: [],
      tokensUsed: 0,
      isRunning: true,
    })
  })

  it('updateToolCall resolves the call by toolUseId, not by name', () => {
    const s = useConversationStore.getState()
    s.addToolCall({ toolUseId: 'tu1', toolName: 'read', status: 'running' })
    s.addToolCall({ toolUseId: 'tu2', toolName: 'read', status: 'running' })
    s.updateToolCall('tu2', { status: 'success', durationMs: 5 })
    const calls = useConversationStore.getState().agentProgress!.toolCalls
    expect(calls.find((c) => c.toolUseId === 'tu1')!.status).toBe('running')
    expect(calls.find((c) => c.toolUseId === 'tu2')).toMatchObject({ status: 'success', durationMs: 5 })
  })

  it('(+) updateToolCall settles a row whatever its current status (a late result is not dropped)', () => {
    const s = useConversationStore.getState()
    s.addToolCall({ toolUseId: 'tu1', toolName: 'read', status: 'running' })
    s.updateToolCall('tu1', { status: 'success' })
    s.updateToolCall('tu1', { status: 'error', error: 'late failure' })
    expect(useConversationStore.getState().agentProgress!.toolCalls[0]).toMatchObject({ status: 'error', error: 'late failure' })
  })

  it('updateToolCall with an unknown toolUseId is a harmless no-op', () => {
    const s = useConversationStore.getState()
    s.addToolCall({ toolUseId: 'tu1', toolName: 'read', status: 'running' })
    expect(() => s.updateToolCall('missing', { status: 'error', error: 'x' })).not.toThrow()
    expect(useConversationStore.getState().agentProgress!.toolCalls[0].status).toBe('running')
  })

  it('updateToolCall no-ops when no agent progress is active', () => {
    useConversationStore.getState().setAgentProgress(null)
    expect(() => useConversationStore.getState().updateToolCall('tu1', { status: 'success' })).not.toThrow()
    expect(useConversationStore.getState().agentProgress).toBeNull()
  })
})

describe('conversation-store agent progress lifecycle', () => {
  beforeEach(() => {
    useConversationStore.getState().setAgentProgress({
      agentName: 'Agent',
      turn: 0,
      maxTurns: 10,
      toolCalls: [],
      tokensUsed: 0,
      isRunning: true,
    })
  })

  it('updateAgentTurn records the turn and token usage', () => {
    useConversationStore.getState().updateAgentTurn(3, 1200)
    expect(useConversationStore.getState().agentProgress).toMatchObject({ turn: 3, tokensUsed: 1200 })
  })

  it('updateAgentTurn keeps the previous token count when the event omits it', () => {
    useConversationStore.getState().updateAgentTurn(1, 500)
    useConversationStore.getState().updateAgentTurn(2)
    expect(useConversationStore.getState().agentProgress).toMatchObject({ turn: 2, tokensUsed: 500 })
  })

  it('finishAgentProgress stops the run but keeps the collected tool calls', () => {
    const s = useConversationStore.getState()
    s.addToolCall({ toolUseId: 'tu1', toolName: 'read', status: 'running' })
    s.updateAgentTurn(2, 900)
    useConversationStore.getState().finishAgentProgress()
    const progress = useConversationStore.getState().agentProgress!
    expect(progress.isRunning).toBe(false)
    expect(progress.turn).toBe(2)
    expect(progress.tokensUsed).toBe(900)
    expect(progress.toolCalls).toHaveLength(1)
  })

  it('(+) updateAgentTurn accumulates: each turn_complete adds its own model call\'s tokens', () => {
    const s = useConversationStore.getState()
    s.updateAgentTurn(1, 1000)
    s.updateAgentTurn(2, 250)
    s.updateAgentTurn(3, 0)
    expect(useConversationStore.getState().agentProgress).toMatchObject({ turn: 3, tokensUsed: 1250 })
  })

  it('(−) finishAgentProgress marks a row nothing settled as unknown, never as success', () => {
    const s = useConversationStore.getState()
    s.addToolCall({ toolUseId: 'tu1', toolName: 'read', status: 'running' })
    s.addToolCall({ toolUseId: 'tu2', toolName: 'write', status: 'running' })
    s.updateToolCall('tu2', { status: 'denied', error: 'blocked' })
    useConversationStore.getState().finishAgentProgress()
    const calls = useConversationStore.getState().agentProgress!.toolCalls
    expect(calls[0].status).toBe('unknown')
    expect(calls[0].status).not.toBe('success')
    expect(calls[1].status).toBe('denied')
  })

  it('(+) setAgentSteps records the reported step and its budget; (−) a negative step is ignored', () => {
    const s = useConversationStore.getState()
    s.setAgentSteps(4, 30)
    s.setAgentSteps(-1, 99)
    expect(useConversationStore.getState().agentProgress).toMatchObject({ steps: 4, stepsKnown: true, maxTurns: 30 })
  })

  it('finishAgentProgress is a harmless no-op without an active agent run', () => {
    useConversationStore.getState().setAgentProgress(null)
    expect(() => useConversationStore.getState().finishAgentProgress()).not.toThrow()
    expect(useConversationStore.getState().agentProgress).toBeNull()
  })
})
