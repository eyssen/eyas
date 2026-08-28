// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner.js'

describe('agent-runner v2 entry point', () => {
  it('flattens AssembledPrompt to system string', async () => {
    const captured: any[] = []
    const gateway = {
      stream: vi.fn(async function* (req: any) {
        captured.push(req)
        yield { type: 'done', response: { id: 'r1', provider: 'mock', model: 'm', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } }
      }),
    }
    const toolExecutor = { execute: vi.fn() }
    const runner = createAgentRunner({ gateway: gateway as never, toolExecutor: toolExecutor as never })

    const events: any[] = []
    for await (const ev of runner.run({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: {
        prefix: 'PREFIX',
        suffix: 'SUFFIX',
        reminders: ['REM1', 'REM2'],
        cacheBoundaryHint: 0,
        prefixHash: 'x',
        tokenEstimate: { prefix: 1, suffix: 1, reminders: 1 },
        sections: [],
      },
      maxTurns: 1,
    })) {
      events.push(ev)
    }

    expect(captured[0].system).toBe('PREFIX\n\nSUFFIX\n\nREM1\n\nREM2')
  })

  it('omits whitespace-only sections from the flattened string', async () => {
    const captured: any[] = []
    const gateway = {
      stream: vi.fn(async function* (req: any) {
        captured.push(req)
        yield { type: 'done', response: { id: 'r1', provider: 'mock', model: 'm', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } }
      }),
    }
    const toolExecutor = { execute: vi.fn() }
    const runner = createAgentRunner({ gateway: gateway as never, toolExecutor: toolExecutor as never })

    for await (const _ of runner.run({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: {
        prefix: '',
        suffix: '   ',
        reminders: ['ONLY'],
        cacheBoundaryHint: 0,
        prefixHash: 'x',
        tokenEstimate: { prefix: 0, suffix: 0, reminders: 1 },
        sections: [],
      },
      maxTurns: 1,
    })) { /* drain */ }

    expect(captured[0].system).toBe('ONLY')
  })

  it('falls back to system string when systemPrompt is absent', async () => {
    const captured: any[] = []
    const gateway = {
      stream: vi.fn(async function* (req: any) {
        captured.push(req)
        yield { type: 'done', response: { id: 'r1', provider: 'mock', model: 'm', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } }
      }),
    }
    const toolExecutor = { execute: vi.fn() }
    const runner = createAgentRunner({ gateway: gateway as never, toolExecutor: toolExecutor as never })

    for await (const _ of runner.run({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      system: 'LEGACY SYSTEM',
      maxTurns: 1,
    })) { /* drain */ }

    expect(captured[0].system).toBe('LEGACY SYSTEM')
  })

  it('systemPrompt takes precedence over system when both are set', async () => {
    const captured: any[] = []
    const gateway = {
      stream: vi.fn(async function* (req: any) {
        captured.push(req)
        yield { type: 'done', response: { id: 'r1', provider: 'mock', model: 'm', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } }
      }),
    }
    const toolExecutor = { execute: vi.fn() }
    const runner = createAgentRunner({ gateway: gateway as never, toolExecutor: toolExecutor as never })

    for await (const _ of runner.run({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      system: 'LEGACY',
      systemPrompt: {
        prefix: 'V2PREFIX',
        suffix: '',
        reminders: [],
        cacheBoundaryHint: 0,
        prefixHash: 'x',
        tokenEstimate: { prefix: 1, suffix: 0, reminders: 0 },
        sections: [],
      },
      maxTurns: 1,
    })) { /* drain */ }

    expect(captured[0].system).toBe('V2PREFIX')
  })
})
