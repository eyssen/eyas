// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createChannelRunAgent } from '@modules/communication/channel-run-agent'

function deps(over: Record<string, any> = {}) {
  const captured: any = {}
  return {
    captured,
    deps: {
      agentRegistry: {
        get: () => ({ id: 'a1', name: 'A', enabled: true, systemPrompt: 'You are support.', constraints: ['Be brief'], maxTurns: 5 }),
        addTokenUsage: vi.fn(),
      },
      conversations: {
        get: () => ({ id: 'c1', projectId: 'p1', messages: [{ role: 'user', content: 'hi' }] }),
        addMessage: vi.fn(),
      },
      toolRegistry: { toToolDefinitions: () => [] },
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      agentRunner: {
        run: async function* (input: any) {
          captured.input = input
          yield { type: 'text', text: 'ok' }
        },
      },
      ...over,
    } as any,
  }
}

const okAssembler = () => ({
  buildForPrimary: vi.fn().mockResolvedValue({
    prefix: 'CORE', suffix: '', reminders: [],
    sections: [{ zone: 'prefix', key: 'core-identity', content: 'CORE', chars: 4, estimatedTokens: 1, truncated: false, droppedChars: 0 }],
  }),
})

describe('createChannelRunAgent — prompt assembly', () => {
  it('sends the assembled prompt with the agent prompt appended', async () => {
    const { captured, deps: d } = deps({ promptAssembler: okAssembler() })
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.system).toContain('CORE')
    expect(captured.input.system).toContain('You are support.')
    expect(captured.input.system).toContain('Be brief')
  })

  it('passes the conversation projectId to the assembler', async () => {
    const assembler = okAssembler()
    const { deps: d } = deps({ promptAssembler: assembler })
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(assembler.buildForPrimary).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', conversationId: 'c1' }),
    )
  })

  it('puts projectId on the tool context', async () => {
    const { captured, deps: d } = deps({ promptAssembler: okAssembler() })
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.toolContext.projectId).toBe('p1')
  })

  it('degrades to the previous behaviour when no assembler is wired', async () => {
    const { captured, deps: d } = deps()
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.system).toContain('You are support.')
    expect(captured.input.system).toContain('Be brief')
    expect(captured.input.system).not.toContain('CORE')
  })

  it('degrades to the previous behaviour when the assembler throws', async () => {
    const { captured, deps: d } = deps({
      promptAssembler: { buildForPrimary: vi.fn().mockRejectedValue(new Error('boom')) },
    })
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.system).toContain('You are support.')
  })
})

describe('createChannelRunAgent — context recording', () => {
  it('records a channel composition when the assembler succeeded', async () => {
    const record = vi.fn().mockReturnValue('comp-1')
    const { deps: d } = deps({ promptAssembler: okAssembler(), contextRecorder: { record } })
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ entryPoint: 'channel', conversationId: 'c1' }))
  })

  it('correlates the composition id into the run metadata', async () => {
    const record = vi.fn().mockReturnValue('comp-1')
    const { captured, deps: d } = deps({ promptAssembler: okAssembler(), contextRecorder: { record } })
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.metadata.compositionId).toBe('comp-1')
  })

  it('records unassembled when the assembler is absent', async () => {
    const record = vi.fn().mockReturnValue('comp-2')
    const { deps: d } = deps({ contextRecorder: { record } })
    await createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ entryPoint: 'unassembled' }))
  })

  it('does not fail when no recorder is wired', async () => {
    const { deps: d } = deps()
    await expect(
      createChannelRunAgent(d)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' }),
    ).resolves.toBeDefined()
  })
})
