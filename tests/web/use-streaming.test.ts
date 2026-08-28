// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { processStreamEvent } from '../../src/web/src/hooks/use-streaming'
import { useConversationStore } from '../../src/web/src/stores/conversation-store'
import { planAutoTitle } from '../../src/shared/conversation-title'

function seedConversation(title: string | null = null) {
  useConversationStore.getState().setActiveConversation({
    id: 'c1',
    title,
    status: 'working',
    providerId: null,
    modelId: null,
    tokensUsed: 0,
    sdkSessionId: null,
    mode: 'simple',
    agentId: null,
    parentConversationId: null,
    complexity: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
  })
}

describe('optimistic first-turn title', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
  })

  it('names an untitled conversation from the first request', () => {
    seedConversation(null)
    const title = planAutoTitle(useConversationStore.getState().activeConversation?.title, 'Hány modul van a könyvtárban?')
    useConversationStore.getState().updateConversation({ title })
    expect(useConversationStore.getState().activeConversation?.title).toBe('Hány modul van a könyvtárban?')
  })

  it('does not overwrite a user-set title', () => {
    seedConversation('Már van neve')
    const title = planAutoTitle(useConversationStore.getState().activeConversation?.title, 'Hány modul van a könyvtárban?')
    expect(title).toBe('')
  })
})

describe('processStreamEvent title', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
  })

  it('applies a generated title to the active conversation', () => {
    seedConversation(null)
    processStreamEvent({ type: 'title', title: 'Fix the indexer' }, useConversationStore.getState())
    expect(useConversationStore.getState().activeConversation?.title).toBe('Fix the indexer')
  })

  it('replaces a placeholder title when the SSE title event arrives', () => {
    seedConversation('Névtelen')
    processStreamEvent({ type: 'title', title: 'Odoo 18 indexer' }, useConversationStore.getState())
    expect(useConversationStore.getState().activeConversation?.title).toBe('Odoo 18 indexer')
  })
})

describe('processStreamEvent god_started', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
  })

  it('keeps the conversation working with a live progress strip', () => {
    seedConversation('Calc')
    processStreamEvent({ type: 'god_started' }, useConversationStore.getState())
    const state = useConversationStore.getState()
    expect(state.activeConversation?.status).toBe('working')
    expect(state.agentProgress?.isRunning).toBe(true)
    expect(state.agentProgress?.agentName).toBe('God Mode')
  })
})

describe('a tool call has to stop spinning', () => {
  // Observed: a completed grok-cli run left all seven tool rows spinning
  // forever. The ACP client knows the tool id when the call STARTS and threw
  // it away when the call ENDED, so nothing could ever be matched up — and the
  // panel's only "finished" signal is a per-call status.
  const store = () => useConversationStore.getState()

  function startRun() {
    seedConversation('T')
    store().setAgentProgress({
      agentName: 'Jarvis', agentAvatar: null, turn: 1, maxTurns: 10,
      toolCalls: [], tokensUsed: 0, isRunning: true,
    } as any)
  }

  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
    startRun()
  })

  it('settles the call named by a tool_use_end that carries its id', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'read_file', input: {} } as any, store())
    expect(store().agentProgress!.toolCalls[0].status).toBe('running')

    processStreamEvent({ type: 'tool_use_end', id: 't1', status: 'success' } as any, store())
    expect(store().agentProgress!.toolCalls[0].status).toBe('success')
  })

  it('records a failure as a failure, not as a finished call', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'write', input: {} } as any, store())
    processStreamEvent({ type: 'tool_use_end', id: 't1', status: 'error' } as any, store())
    expect(store().agentProgress!.toolCalls[0].status).toBe('error')
  })

  it('settles the oldest running call when the end carries no id', () => {
    // Nine providers emit a bare `tool_use_end`. These CLIs run their tools one
    // at a time, so the oldest still-running call is the one that just ended —
    // and a wrong-but-settled row beats a row that spins for ever.
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'grep', input: {} } as any, store())
    processStreamEvent({ type: 'tool_use', id: 't2', name: 'write', input: {} } as any, store())
    processStreamEvent({ type: 'tool_use_end' } as any, store())

    const calls = store().agentProgress!.toolCalls
    expect(calls[0].status).not.toBe('running')
    expect(calls[1].status).toBe('running')
  })

  it('does not resurrect a call that already reported', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'grep', input: {} } as any, store())
    processStreamEvent({ type: 'tool_result', toolUseId: 't1', output: 'ok' } as any, store())
    processStreamEvent({ type: 'tool_use_end', id: 't1', status: 'error' } as any, store())
    // The first outcome stands; a late end must not turn a success into an error.
    expect(store().agentProgress!.toolCalls[0].status).toBe('success')
  })

  it('leaves nothing running once the run is done', () => {
    // The last line of defence: a provider that reports nothing at all must
    // still not leave a permanent spinner on a finished run.
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'search_tool', input: {} } as any, store())
    processStreamEvent({ type: 'done', response: { usage: {} } } as any, store())
    expect(store().agentProgress?.toolCalls.every((c) => c.status !== 'running') ?? true).toBe(true)
  })
})
