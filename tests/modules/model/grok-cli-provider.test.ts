// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider'
import type { StreamEvent } from '@modules/model/types.js'

describe('Grok CLI Provider', () => {
  it('has correct id and name', () => {
    const provider = createGrokCliProvider()
    expect(provider.id).toBe('grok-cli')
    expect(provider.name).toBe('Grok CLI')
  })

  it('lists known models without CLI', async () => {
    const provider = createGrokCliProvider()
    const models = await provider.listModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].provider).toBe('grok-cli')
    expect(models[0].id).toBe('grok-cli-default')
    expect((models[0].metadata as any).realModelId).toBe('grok-4.5')
  })

  it('streams text and done from a mocked ACP runner', async () => {
    async function* fakeRun() {
      yield { type: 'text', text: 'Hello' } satisfies StreamEvent
      yield { type: 'thinking', text: '…' } satisfies StreamEvent
      return {
        text: 'Hello',
        sessionId: 'sess-1',
        inputTokens: 10,
        outputTokens: 5,
        stopReason: 'end' as const,
      }
    }

    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    const events: StreamEvent[] = []
    for await (const ev of provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'grok-cli-default',
    })) {
      events.push(ev)
    }

    expect(events.some((e) => e.type === 'text' && e.text === 'Hello')).toBe(true)
    expect(events.some((e) => e.type === 'thinking')).toBe(true)
    const done = events.find((e) => e.type === 'done')
    expect(done?.type).toBe('done')
    if (done?.type === 'done') {
      expect(done.response.sessionId).toBe('sess-1')
      expect(done.response.provider).toBe('grok-cli')
      expect(done.response.usage.inputTokens).toBe(10)
    }
  })

  it('starts the ACP session in the conversation working directory, not process.cwd()', async () => {
    const seen: string[] = []
    async function* fakeRun(opts: { cwd: string }) {
      seen.push(opts.cwd)
      yield { type: 'text', text: 'ok' } satisfies StreamEvent
      return {
        text: 'ok',
        sessionId: null,
        inputTokens: 1,
        outputTokens: 1,
        stopReason: 'end' as const,
      }
    }
    const provider = createGrokCliProvider({
      cwd: '/Users/eyssen/GitHub/eyas',
      runPrompt: fakeRun as any,
    })
    for await (const _ of provider.stream({
      messages: [{ role: 'user', content: 'hány modul van?' }],
      model: 'grok-cli-default',
      metadata: { workingDirectory: '/Users/eyssen/GitHub/owl/eyssen-erp' },
    })) { /* drain */ }
    expect(seen).toEqual(['/Users/eyssen/GitHub/owl/eyssen-erp'])
  })

  it('complete() aggregates stream into a response', async () => {
    async function* fakeRun() {
      yield { type: 'text', text: 'ok' } satisfies StreamEvent
      return {
        text: 'ok',
        sessionId: null,
        inputTokens: 1,
        outputTokens: 1,
        stopReason: 'end' as const,
      }
    }
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    const res = await provider.complete({ messages: [{ role: 'user', content: 'x' }] })
    expect(res.content[0]).toEqual({ type: 'text', text: 'ok' })
    expect(res.provider).toBe('grok-cli')
  })

  // D9: a failed ACP run must reach the caller as a THROW. Yielding an error
  // event and returning normally let the gateway record the call as healthy and
  // the run as successful, which is how a dead CLI looked like a working one.
  it('stream() yields the error frame AND throws when the ACP run fails', async () => {
    const boom = new Error('grok CLI exited with code 1')
    async function* failingRun(): AsyncGenerator<StreamEvent, never> {
      yield { type: 'text', text: 'partial' }
      throw boom
    }

    const provider = createGrokCliProvider({ runPrompt: failingRun as any })
    const events: StreamEvent[] = []
    let thrown: unknown
    try {
      for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'x' }] })) {
        events.push(ev)
      }
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBe(boom)
    expect(events.some((e) => e.type === 'error' && e.error === boom)).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('complete() rejects when the ACP run fails', async () => {
    async function* failingRun(): AsyncGenerator<StreamEvent, never> {
      throw new Error('grok CLI unavailable')
    }
    const provider = createGrokCliProvider({ runPrompt: failingRun as any })
    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('grok CLI unavailable')
  })
})
