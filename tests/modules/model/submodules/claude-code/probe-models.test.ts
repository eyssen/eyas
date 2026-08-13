import { describe, it, expect, vi } from 'vitest'

// Mock child_process.execFile so promisify(execFile) rejects — simulating the
// `claude` CLI being unavailable. We never invoke the real CLI in tests.
vi.mock('child_process', () => ({
  execFile: (_file: string, _args: string[], options: unknown, callback?: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (err: Error) => void
    cb(new Error('ENOENT: claude not found'))
  },
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider'

describe('claude-code fetchModels() — async, non-blocking probe (H0)', () => {
  it('resolves to the known models when the CLI probe fails', async () => {
    const provider = createClaudeCodeProvider()
    // Must resolve (not throw, not block) even though every probe rejects.
    const models = await provider.fetchModels!()
    const ids = models.map((m) => m.id).sort()
    expect(ids).toEqual(['claude-code-fable', 'claude-code-haiku', 'claude-code-opus', 'claude-code-sonnet'])
    // Failed probe keeps the accurate known caps.
    const sonnet = models.find((m) => m.id === 'claude-code-sonnet')!
    expect(sonnet.contextWindow).toBe(1_000_000)
    expect((sonnet.metadata as any).alias).toBe('sonnet')
  })

  it('returns a promise (probe is asynchronous, so `void fetchModels()` truly backgrounds)', () => {
    const provider = createClaudeCodeProvider()
    expect(provider.fetchModels!()).toBeInstanceOf(Promise)
  })
})
