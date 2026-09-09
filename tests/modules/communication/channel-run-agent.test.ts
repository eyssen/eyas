// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// createChannelRunAgent turns a (conversation, agent) into one agent run for the
// inbound coordinator: it streams the runner's events, accumulates the assistant
// reply, persists it, and — critically — maps the conversation mode to the
// `autonomous` flag that decides whether the autonomy ladder gates the run.

import { describe, it, expect } from 'vitest'
import { createChannelRunAgent } from '@modules/communication/channel-run-agent.js'

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} } as any

function fakeDeps(over: { agent?: any; run?: (opts: any) => AsyncGenerator<any> } = {}) {
  const calls = {
    run: [] as any[],
    addMessage: [] as any[],
    addTokenUsage: [] as any[],
  }
  const defaultAgent = { enabled: true, systemPrompt: 'SYS', constraints: [], tools: ['a'], maxTurns: 5, model: 'm' }
  const agentVal = 'agent' in over ? over.agent : defaultAgent
  const deps = {
    agentRegistry: {
      get: (_id: string) => agentVal,
      addTokenUsage: (id: string, n: number) => calls.addTokenUsage.push([id, n]),
    },
    agentRunner: {
      run:
        over.run ??
        (async function* (opts: any) {
          calls.run.push(opts)
          yield { type: 'text', text: 'hel' }
          yield { type: 'text', text: 'lo' }
          yield { type: 'turn_complete', tokensUsed: 7 }
          yield { type: 'done', response: { content: [] } }
        }),
    },
    conversations: {
      get: (_id: string) => ({ messages: [{ role: 'user', content: '<untrusted-input>hi</untrusted-input>' }] }),
      addMessage: (id: string, m: any) => calls.addMessage.push({ id, ...m }),
    },
    toolRegistry: {
      toToolDefinitions: (names?: string[]) =>
        names && names.length > 0
          ? names.map((n) => ({ name: n }))
          : [{ name: 'a' }, { name: 'b' }],
    },
    logger: noopLogger,
  }
  return { deps, calls }
}

describe('createChannelRunAgent', () => {
  it('accumulates reply text, persists the assistant message, tracks tokens', async () => {
    const { deps, calls } = fakeDeps()
    const runAgent = createChannelRunAgent(deps)
    const res = await runAgent({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(res.replyText).toBe('hello')
    expect(calls.addMessage).toEqual([{ id: 'c1', role: 'assistant', content: 'hello' }])
    expect(calls.addTokenUsage).toEqual([['a1', 7]])
    expect(calls.run[0].messages).toEqual([{ role: 'user', content: '<untrusted-input>hi</untrusted-input>' }])
  })

  it('maps mode=managed to a non-autonomous run (security-gate governs)', async () => {
    const { deps, calls } = fakeDeps()
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(calls.run[0].autonomous).toBe(false)
    expect(calls.run[0].metadata).toMatchObject({ origin: 'channel', autonomous: false })
  })

  it('maps mode=autonomous to an autonomous run (autonomy ladder gates)', async () => {
    const { deps, calls } = fakeDeps()
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'autonomous' })
    expect(calls.run[0].autonomous).toBe(true)
    expect(calls.run[0].metadata).toMatchObject({ origin: 'channel', autonomous: true })
  })

  it('returns null and does not run when the agent is missing', async () => {
    const { deps, calls } = fakeDeps({ agent: null })
    const res = await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'missing', mode: 'managed' })
    expect(res.replyText).toBeNull()
    expect(calls.run).toHaveLength(0)
  })

  it('returns null when the agent is disabled', async () => {
    const { deps, calls } = fakeDeps({ agent: { enabled: false, systemPrompt: '', constraints: [], tools: [] } })
    const res = await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(res.replyText).toBeNull()
    expect(calls.run).toHaveLength(0)
  })

  it('expands empty agent.tools to the full tool registry (same as executeAgent)', async () => {
    const { deps, calls } = fakeDeps({
      agent: { enabled: true, systemPrompt: 'S', constraints: [], tools: [], maxTurns: 3, model: 'm' },
    })
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(calls.run[0].tools.map((t: any) => t.name)).toEqual(['a', 'b'])
  })

  it('returns null (no assistant message) when the run produced no text', async () => {
    const { deps, calls } = fakeDeps({
      run: async function* () {
        yield { type: 'tool_use_start', name: 'x' }
        yield { type: 'done', response: { content: [] } }
      },
    })
    const res = await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(res.replyText).toBeNull()
    expect(calls.addMessage).toHaveLength(0)
  })

  // F1 Task 5 (R7): a channel conversation bound to a team session threads
  // its id onto both the tool context and the run metadata.
  it('threads conv.teamSessionId onto toolContext (teamSessionId + sessionId) and metadata', async () => {
    const { deps, calls } = fakeDeps()
    deps.conversations.get = (_id: string) => ({
      messages: [{ role: 'user', content: 'hi' }],
      teamSessionId: 'ts-7',
    })
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })

    expect(calls.run[0].toolContext).toEqual(expect.objectContaining({ teamSessionId: 'ts-7', sessionId: 'ts-7' }))
    expect(calls.run[0].metadata).toMatchObject({ teamSessionId: 'ts-7' })
  })

  it('leaves teamSessionId undefined when the conversation has none', async () => {
    const { deps, calls } = fakeDeps()
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })

    expect(calls.run[0].toolContext.teamSessionId).toBeUndefined()
    expect(calls.run[0].toolContext.sessionId).toBeUndefined()
    expect(calls.run[0].metadata.teamSessionId).toBeUndefined()
  })
})
