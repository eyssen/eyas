// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A7 — a Grok/Kimi turn on a CLI whose EYAS home is not signed in fails at
// once with the one localized 'cliSignIn' error (nothing is spawned), and an
// auth failure the CLI itself reports maps to the same error. Any other
// failure passes through unchanged.

import { describe, it, expect, vi } from 'vitest'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import { classifyModelError } from '@shared/classify-model-error.js'
import type { AIProvider, StreamEvent } from '@modules/model/types.js'

type Factory = (opts: { runPrompt: any; isSignedIn?: () => boolean }) => AIProvider

const PROVIDERS: Array<[string, Factory]> = [
  ['grok-cli', (opts) => createGrokCliProvider(opts)],
  ['kimi-cli', (opts) => createKimiCliProvider(opts)],
]

async function drain(provider: AIProvider): Promise<{ events: StreamEvent[]; thrown: unknown }> {
  const events: StreamEvent[] = []
  let thrown: unknown
  try {
    for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) events.push(ev)
  } catch (err) {
    thrown = err
  }
  return { events, thrown }
}

describe.each(PROVIDERS)('%s sign-in', (providerId, create) => {
  it('signed out: fails with cliSignIn before the runner starts (positive)', async () => {
    const runPrompt = vi.fn()
    const { events, thrown } = await drain(create({ runPrompt, isSignedIn: () => false }))
    expect(runPrompt).not.toHaveBeenCalled()
    expect(classifyModelError(thrown)).toEqual({ kind: 'auth', retryable: false, code: 'cliSignIn', params: { provider: providerId } })
    expect(events.some((e) => e.type === 'error' && e.error === thrown)).toBe(true)
  })

  it('an auth failure the CLI reports becomes cliSignIn (positive)', async () => {
    async function* authFails(): AsyncGenerator<StreamEvent, never> {
      throw new Error('Authentication required')
    }
    const { thrown } = await drain(create({ runPrompt: authFails, isSignedIn: () => true }))
    expect(classifyModelError(thrown).code).toBe('cliSignIn')
  })

  it('signed in: other failures pass through unchanged, and a turn runs (negative)', async () => {
    const boom = new Error(`${providerId} exited (code 1)`)
    async function* fails(): AsyncGenerator<StreamEvent, never> {
      throw boom
    }
    const failed = await drain(create({ runPrompt: fails, isSignedIn: () => true }))
    expect(failed.thrown).toBe(boom)

    async function* ok(): AsyncGenerator<StreamEvent, { text: string; inputTokens: number; outputTokens: number; usageReported: boolean; stopReason: 'end' }> {
      yield { type: 'text', text: 'hello' }
      return { text: 'hello', inputTokens: 1, outputTokens: 1, usageReported: true, stopReason: 'end' }
    }
    const done = await drain(create({ runPrompt: ok, isSignedIn: () => true }))
    expect(done.thrown).toBeUndefined()
    expect(done.events.some((e) => e.type === 'done')).toBe(true)
  })
})
