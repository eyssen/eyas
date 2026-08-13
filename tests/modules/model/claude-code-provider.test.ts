import { describe, it, expect } from 'vitest'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider'

describe('Claude Code Provider', () => {
  it('has correct id and name', () => {
    const provider = createClaudeCodeProvider()
    expect(provider.id).toBe('claude-code')
    expect(provider.name).toBe('Claude Code CLI')
  })

  it('lists available models', async () => {
    const provider = createClaudeCodeProvider()
    const models = await provider.listModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].provider).toBe('claude-code')
  })
})

describe('claude-code listModels caps + metadata', () => {
  it('returns current caps and concrete-id metadata', async () => {
    const p = createClaudeCodeProvider()
    const models = await p.listModels()
    const sonnet = models.find((m) => m.id === 'claude-code-sonnet')!
    expect(sonnet.contextWindow).toBe(1_000_000)
    expect(sonnet.maxOutputTokens).toBe(64_000)
    expect((sonnet.metadata as any).realModelId).toBe('claude-sonnet-4-6')
    expect((sonnet.metadata as any).alias).toBe('sonnet')
    const opus = models.find((m) => m.id === 'claude-code-opus')!
    expect(opus.maxOutputTokens).toBe(128_000)
    const fable = models.find((m) => m.id === 'claude-code-fable')!
    expect(fable.contextWindow).toBe(1_000_000)
    expect(fable.maxOutputTokens).toBe(128_000)
    expect((fable.metadata as any).realModelId).toBe('claude-fable-5')
    expect((fable.metadata as any).alias).toBe('fable')
  })
})
