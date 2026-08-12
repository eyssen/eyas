// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { runCheapModelPass } from '@modules/model/cheap-pass.js'

describe('runCheapModelPass', () => {
  it('returns the extracted text from a real ModelResponse (ContentBlock[]) shape', async () => {
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'HELLO' }] })) as any
    const ctx = { model: { complete } }

    const result = await runCheapModelPass(ctx, { system: 'sys', user: 'usr', fallback: 'FALLBACK' })

    expect(result).toBe('HELLO')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('falls back when ctx.model is absent', async () => {
    const ctx = {}

    const result = await runCheapModelPass(ctx, { system: 'sys', user: 'usr', fallback: 'FALLBACK' })

    expect(result).toBe('FALLBACK')
  })

  it('falls back when model.complete throws', async () => {
    const complete = vi.fn(async () => { throw new Error('model down') }) as any
    const ctx = { model: { complete } }

    const result = await runCheapModelPass(ctx, { system: 'sys', user: 'usr', fallback: 'FALLBACK' })

    expect(result).toBe('FALLBACK')
  })

  it('falls back on empty model output', async () => {
    const complete = vi.fn(async () => ({ content: [] })) as any
    const ctx = { model: { complete } }

    const result = await runCheapModelPass(ctx, { system: 'sys', user: 'usr', fallback: 'FALLBACK' })

    expect(result).toBe('FALLBACK')
  })

  it('is fail-open even when decisionEngine.resolveForTier throws', async () => {
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'OK' }] })) as any
    const decisionEngine = { resolveForTier: () => { throw new Error('no tier configured') } }
    const ctx = { model: { complete }, decisionEngine }

    const result = await runCheapModelPass(ctx, { system: 'sys', user: 'usr', fallback: 'FALLBACK' })

    expect(result).toBe('OK')
  })

  it('forwards the resolved provider/model from decisionEngine.resolveForTier', async () => {
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'OK' }] })) as any
    const decisionEngine = { resolveForTier: () => ({ provider: 'anthropic', model: 'haiku' }) }
    const ctx = { model: { complete }, decisionEngine }

    await runCheapModelPass(ctx, { system: 'sys', user: 'usr', maxTokens: 50, temperature: 0.1, fallback: 'FALLBACK' })

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      model: 'haiku',
      maxTokens: 50,
      temperature: 0.1,
    }))
  })
})
