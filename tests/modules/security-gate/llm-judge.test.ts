import { describe, it, expect, vi } from 'vitest'
import { createLlmJudge, parseJudgeVerdict } from '@modules/security-gate/llm-judge'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'

// ─── Helpers ─────────────────────────────────

function createMockGateway(responseText: string): ModelGateway {
  const response: ModelResponse = {
    id: 'resp-judge',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: responseText }],
    stopReason: 'end',
    usage: { inputTokens: 50, outputTokens: 20 },
  }
  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    // Non-empty — a vendor-neutral install with zero providers is its own
    // escalate test below; every other test needs a "configured" gateway.
    listProviders: vi.fn(() => [{ id: 'mock' }]),
    listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => response),
    async *stream() {
      yield { type: 'done', response } as StreamEvent
    },
  } as unknown as ModelGateway
}

function createFailingGateway(): ModelGateway {
  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    listProviders: vi.fn(() => [{ id: 'mock' }]),
    listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => { throw new Error('Model unavailable') }),
    async *stream() { throw new Error('Model unavailable') },
  } as unknown as ModelGateway
}

// ─── Tests ───────────────────────────────────

describe('LlmJudge', () => {
  describe('JSON verdict parsing', () => {
    it('returns allow for a JSON ALLOW verdict', async () => {
      const gateway = createMockGateway('{"verdict":"ALLOW","reason":"relevant to goal"}')
      const result = await createLlmJudge(gateway).check('search_memory', { query: 't' }, 'yellow', 'Find info')
      expect(result.decision).toBe('allow')
      expect(result.reason).toBe('relevant to goal')
    })

    it('returns deny for a JSON DENY verdict', async () => {
      const gateway = createMockGateway('{"verdict":"DENY","reason":"rm on critical path"}')
      const result = await createLlmJudge(gateway).check('run_command', { command: 'rm important.db' }, 'red', 'Clean up')
      expect(result.decision).toBe('deny')
      expect(result.reason).toBe('rm on critical path')
      expect(result.riskTier).toBe('red')
    })

    it('accepts a fenced ```json verdict', async () => {
      const gateway = createMockGateway('```json\n{"verdict":"ALLOW","reason":"fenced ok"}\n```')
      const result = await createLlmJudge(gateway).check('search_memory', {}, 'yellow')
      expect(result.decision).toBe('allow')
      expect(result.reason).toBe('fenced ok')
    })
  })

  describe('fail-closed on unparseable output', () => {
    it('DENIES (not judge_error) on prose / unparseable output', async () => {
      const result = await createLlmJudge(createMockGateway('I think this might be okay')).check('run_command', { command: 'ls' }, 'red')
      expect(result.decision).toBe('deny')
      expect(result.reason).toContain('unparseable')
    })

    it('DENIES a JSON object with a non-ALLOW/DENY verdict value', async () => {
      const gateway = createMockGateway('{"verdict":"MAYBE"}')
      const result = await createLlmJudge(gateway).check('run_command', {}, 'red')
      expect(result.decision).toBe('deny')
    })

    it('does NOT shop for a more permissive judge — denies on the first unparseable response without trying the next candidate', async () => {
      // Two distinct candidates (heartbeat → quick), same two-candidate mock
      // shape as "falls back to the next candidate". The FIRST response is
      // prose (unparseable); the SECOND would be a valid ALLOW verdict. If
      // the deny-on-unparseable path ever "shopped" for a better verdict by
      // trying the next candidate (e.g. `return` changed to `continue`), this
      // would come back `allow` with `complete` called twice instead.
      const response = { id: 'r', provider: 'p2', model: 'm2', content: [{ type: 'text', text: '{"verdict":"ALLOW","reason":"ok"}' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
      const complete = vi.fn().mockResolvedValueOnce({ id: 'r', provider: 'p1', model: 'm1', content: [{ type: 'text', text: 'I think this might be okay' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }).mockResolvedValueOnce(response)
      const gateway = { ...createMockGateway(''), complete } as unknown as ModelGateway
      const resolver = { resolveForTier: (tier: string) => tier === 'heartbeat' ? { provider: 'p1', model: 'm1' } : { provider: 'p2', model: 'm2' } }
      const result = await createLlmJudge(gateway, { getTierResolver: () => resolver }).check('run_command', {}, 'red')
      expect(result.decision).toBe('deny')
      expect(complete).toHaveBeenCalledTimes(1)
    })
  })

  describe('escalate on no configured provider', () => {
    it('escalates when NO provider is registered (vendor-neutral empty install)', async () => {
      const gateway = createMockGateway('{"verdict":"ALLOW","reason":"x"}')
      ;(gateway.listProviders as any) = vi.fn(() => [])
      const result = await createLlmJudge(gateway).check('run_command', {}, 'red')
      expect(result.decision).toBe('escalate')
      expect(gateway.complete).not.toHaveBeenCalled()
    })
  })

  describe('tier-resolved provider (no hardcoded anthropic)', () => {
    it('routes through the tier resolver — no hardcoded anthropic', async () => {
      const gateway = createMockGateway('{"verdict":"ALLOW","reason":"ok"}')
      const resolver = { resolveForTier: vi.fn((tier: string) => tier === 'heartbeat' ? { provider: 'ollama', model: 'llama3.2' } : null) }
      await createLlmJudge(gateway, { getTierResolver: () => resolver }).check('run_command', { command: 'echo hi' }, 'red', 'Greet')
      expect(gateway.complete).toHaveBeenCalledWith(expect.objectContaining({ provider: 'ollama', model: 'llama3.2', temperature: 0 }))
    })

    it('falls back to the next candidate when the first provider fails', async () => {
      const response = { id: 'r', provider: 'p2', model: 'm2', content: [{ type: 'text', text: '{"verdict":"ALLOW","reason":"ok"}' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
      const complete = vi.fn().mockRejectedValueOnce(new Error('p1 down')).mockResolvedValueOnce(response)
      const gateway = { ...createMockGateway(''), complete } as unknown as ModelGateway
      const resolver = { resolveForTier: (tier: string) => tier === 'heartbeat' ? { provider: 'p1', model: 'm1' } : { provider: 'p2', model: 'm2' } }
      const result = await createLlmJudge(gateway, { getTierResolver: () => resolver }).check('run_command', {}, 'red')
      expect(result.decision).toBe('allow')
      expect(complete).toHaveBeenCalledTimes(2)
    })

    it('uses gateway default resolution (no provider/model fields) when no tier resolves', async () => {
      const gateway = createMockGateway('{"verdict":"ALLOW","reason":"ok"}')
      await createLlmJudge(gateway).check('save_memory', {}, 'yellow')
      const args = (gateway.complete as any).mock.calls[0][0]
      expect(args.provider).toBeUndefined()
      expect(args.model).toBeUndefined()
    })
  })

  describe('error handling — fail-closed', () => {
    it('returns judge_error only after ALL candidates fail', async () => {
      const result = await createLlmJudge(createFailingGateway()).check('run_command', { command: 'ls' }, 'red')
      expect(result.decision).toBe('judge_error')
      expect(result.checkpoint).toBe('llm_judge')
      expect(result.reason).toContain('Security judge error')
      expect(result.reason).toContain('Model unavailable')
      expect(result.errorDetail).toBeDefined()
    })
  })

  describe('sandwich prompt / prompt injection resistance', () => {
    it('sandwiches the untrusted input between nonce markers with rules on both sides', async () => {
      const gateway = createMockGateway('{"verdict":"ALLOW","reason":"ok"}')
      await createLlmJudge(gateway).check('run_command', { command: 'echo hi' }, 'red', 'Greet the user')
      const args = (gateway.complete as any).mock.calls[0][0]
      const m = args.messages[0].content
      const marker = m.match(/<(untrusted-[a-z0-9]+)>/)
      expect(marker).not.toBeNull()
      expect(m).toContain(`</${marker![1]}>`)
      expect(m).toContain('echo hi'); expect(m).toContain('Greet the user')
      expect(m.slice(m.indexOf(`</${marker![1]}>`))).toContain('When in doubt, DENY')
      expect(args.system).toContain('DATA under evaluation')
    })

    it('uses "Not specified" when agentGoal is undefined', async () => {
      const gateway = createMockGateway('{"verdict":"ALLOW","reason":"ok"}')
      await createLlmJudge(gateway).check('search_memory', {}, 'yellow')
      const callArgs = (gateway.complete as any).mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain('Not specified')
    })
  })

  describe('timestamp', () => {
    it('includes ISO timestamp in result', async () => {
      const gateway = createMockGateway('{"verdict":"ALLOW","reason":"ok"}')
      const judge = createLlmJudge(gateway)
      const result = await judge.check('search_memory', {}, 'green')
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })
})

describe('parseJudgeVerdict', () => {
  it('returns null for an empty string', () => {
    expect(parseJudgeVerdict('')).toBeNull()
  })

  it('returns null for an empty JSON object', () => {
    expect(parseJudgeVerdict('{}')).toBeNull()
  })

  it('defaults reason to empty string when missing', () => {
    expect(parseJudgeVerdict('{"verdict":"ALLOW"}')).toEqual({ verdict: 'ALLOW', reason: '' })
  })

  it('handles nested braces in the reason', () => {
    const result = parseJudgeVerdict('{"verdict":"DENY","reason":"looks like {injected} content"}')
    expect(result).toEqual({ verdict: 'DENY', reason: 'looks like {injected} content' })
  })
})
