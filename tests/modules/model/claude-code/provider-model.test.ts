// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 — the model Claude Code runs: the persisted alias, else the seed's, else
// the id minus its prefix, else the id itself. Only "no model" (or the default
// id) leaves the choice to the runtime; an unknown id is never silently
// dropped, and an id naming no model fails before anything starts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as any[] }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.calls.push(args.options)
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

async function drain(gen: AsyncIterable<unknown>) { for await (const _ of gen) { /* consume */ } }
const ask = (model?: string) => ({ messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' }, ...(model ? { model } : {}) })

describe('claude-code provider — model selection', () => {
  beforeEach(() => { h.calls.length = 0 })

  it('a seeded row runs its alias (positive)', async () => {
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    await drain(provider.stream(ask('claude-code-opus')))
    expect(h.calls[0].model).toBe('opus')
  })

  it('a persisted alias wins over the seed', async () => {
    const provider = createClaudeCodeProvider({
      runtime: TEST_CLAUDE_RUNTIME,
      lookupModelMetadata: (id) => (id === 'claude-code-opus' ? { alias: 'opus[1m]', realModelId: 'claude-opus-4-8' } : null),
    })
    await drain(provider.stream(ask('claude-code-opus')))
    expect(h.calls[0].model).toBe('opus[1m]')
  })

  it('a model only discovery knows runs by its id; a full model name passes through — never silently dropped', async () => {
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    await drain(provider.stream(ask('claude-code-claude-opus-4-8')))
    await drain(provider.stream(ask('claude-sonnet-4-6')))
    expect(h.calls.map((o) => o.model)).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6'])
  })

  it('no model and the default id leave the choice to the runtime', async () => {
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    await drain(provider.stream(ask()))
    await drain(provider.stream(ask('claude-code-default')))
    expect(h.calls.every((o) => !('model' in o))).toBe(true)
  })

  it('an id naming no model throws before any query starts (negative)', async () => {
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    await expect(drain(provider.stream(ask('claude-code-')))).rejects.toThrow(/names no model/)
    await expect(drain(provider.stream(ask('claude-code---help')))).rejects.toThrow(/not a valid model name/)
    expect(h.calls).toHaveLength(0)
  })
})
