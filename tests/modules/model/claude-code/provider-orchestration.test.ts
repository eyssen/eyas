// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'

const h = vi.hoisted(() => ({
  captured: { options: undefined as any },
  script: [] as any[],
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      for (const msg of h.script) yield msg
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'
import { stripComments } from '../../../helpers/strip-comments.js'

const toolDeps = {
  runtime: TEST_CLAUDE_RUNTIME,
  toolExecutor: { execute: vi.fn() } as any,
  toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
}

/**
 * A governance object that still hands the provider a sink, as a pre-G6
 * manifest did: the provider must ignore it — the run tree is the runner's.
 */
function governanceWithSink(sink: (e: OrchestrationEvent) => void) {
  return {
    securityGate: {
      validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }),
    },
    orchestrationSink: sink,
  }
}

const resultMsg = { type: 'result', subtype: 'success', result: 'MAIN', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 } }

async function collect(gen: AsyncIterable<any>) {
  const out: any[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

describe('claude-code provider — no orchestration of its own (G6: the agent runner emits the run tree)', () => {
  beforeEach(() => {
    h.captured.options = undefined
    h.script = [resultMsg]
  })

  for (const [label, metadata] of [
    ['plain run', { conversationId: 'c1', userId: 'u1' }],
    ['team run', { conversationId: 'c1', userId: 'u1', teamSessionId: 'ts1' }],
  ] as const) {
    it(`${label}: emits no orchestration frame, even when handed a sink (negative)`, async () => {
      const events: OrchestrationEvent[] = []
      const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governanceWithSink((e) => events.push(e)) as any })
      h.script = [
        { type: 'assistant', session_id: 's1', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/x' } }] } },
        resultMsg,
      ]
      const out = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata } as any))
      expect(events).toHaveLength(0)
      expect(out.find((e) => e.type === 'done')).toBeTruthy()
    })
  }

  it('installs only the memory-policy hook and F5\'s effort readback, and asks for no hook lifecycle messages', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governanceWithSink(() => {}) as any })
    const out = await collect(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1' },
    } as any))
    // B4: the policy hook is on every query with tools; F5's readback reads
    // the effective effort (a PreToolUse and a Stop matcher); no
    // orchestration observers and so no hook lifecycle messages.
    expect(Object.keys(h.captured.options.hooks).sort()).toEqual(['PreToolUse', 'Stop'])
    expect(h.captured.options.hooks.PreToolUse).toHaveLength(2)
    expect(h.captured.options.hooks.Stop).toHaveLength(1)
    expect(h.captured.options.includeHookEvents).toBeUndefined()
    expect(out.find((e) => e.type === 'done')).toBeTruthy()
  })

  it('the provider source no longer knows the orchestration observer', () => {
    const src = stripComments(readFileSync(join(process.cwd(), 'src/modules/model/submodules/claude-code/provider.ts'), 'utf-8'))
    expect(src).not.toMatch(/orchestration-hooks/)
    expect(src).not.toMatch(/run_started|run_completed/)
    expect(existsSync(join(process.cwd(), 'src/modules/model/submodules/claude-code/orchestration-hooks.ts'))).toBe(false)
  })

  it('subagent-originated messages (parent_tool_use_id) never leak into the main stream', async () => {
    h.script = [
      { type: 'assistant', session_id: 's1', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'MAIN-1 ' }] } },
      { type: 'assistant', session_id: 's1', parent_tool_use_id: 'task-1', message: { content: [{ type: 'text', text: 'SUBTEXT ' }, { type: 'tool_use', id: 'tu9', name: 'Read' }] } },
      { type: 'assistant', session_id: 's1', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'MAIN-2' }] } },
      { type: 'result', subtype: 'success', result: '', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 } },
    ]
    const provider = createClaudeCodeProvider({ ...toolDeps })
    const out = await collect(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1' },
    } as any))

    const text = out.filter((e) => e.type === 'text').map((e) => e.text).join('')
    expect(text).toBe('MAIN-1 MAIN-2')
    expect(out.some((e) => e.type === 'tool_use_start' && e.name === 'Read')).toBe(false)
    const done = out.find((e) => e.type === 'done')
    expect(done.response.content[0].text).toBe('MAIN-1 MAIN-2')
  })
})
