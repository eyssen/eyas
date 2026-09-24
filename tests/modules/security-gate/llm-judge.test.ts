import { describe, it, expect, vi } from 'vitest'
import { createLlmJudge, parseJudgeVerdict } from '@modules/security-gate/llm-judge'
import type { ModelRequest, ModelResponse } from '@modules/model/types'
import type { TierConfig } from '@modules/model/routing/types'
import {
  auxEmpty,
  auxError,
  auxNone,
  auxOk,
  createAuxiliaryModelOverGateway,
  createFakeAuxiliaryModel,
} from '../../helpers/fake-auxiliary-model'

// ─── Helpers ─────────────────────────────────

function response(text: string, provider = 'p', model = 'p-model'): ModelResponse {
  return {
    id: 'resp-judge', provider, model,
    content: [{ type: 'text', text }],
    stopReason: 'end',
    usage: { inputTokens: 50, outputTokens: 20 },
  }
}

/** A scripted gateway: each call takes the next answer (text, or an Error to throw). */
function scriptedGateway(...answers: Array<string | Error>) {
  const requests: ModelRequest[] = []
  const complete = vi.fn(async (request: ModelRequest) => {
    requests.push(request)
    const next = answers.length > 1 ? answers.shift()! : answers[0]
    if (next instanceof Error) throw next
    return response(next, request.provider ?? 'p', request.model ?? 'p-model')
  })
  return { complete, requests }
}

/** The real service over `gateway` with one eligible API provider. */
function judgeOver(gateway: ReturnType<typeof scriptedGateway>, providers?: string[], tiers?: TierConfig[]) {
  const aux = createAuxiliaryModelOverGateway(gateway, { providers, tiers })
  return createLlmJudge({ getAux: () => aux })
}

function tier(name: TierConfig['tier'], providerId: string, modelId: string): TierConfig {
  return { tier: name, providerId, modelId, fallbackProviderId: null, fallbackModelId: null, description: '', enabled: true, updatedAt: '' }
}

// ─── Tests ───────────────────────────────────

describe('LlmJudge', () => {
  describe('JSON verdict parsing', () => {
    it('returns allow for a JSON ALLOW verdict', async () => {
      const gateway = scriptedGateway('{"verdict":"ALLOW","reason":"relevant to goal"}')
      const result = await judgeOver(gateway).check('search_memory', { query: 't' }, 'yellow', 'Find info')
      expect(result.decision).toBe('allow')
      expect(result.reason).toBe('relevant to goal')
      expect(result.checkpoint).toBe('llm_judge')
    })

    it('returns deny for a JSON DENY verdict', async () => {
      const gateway = scriptedGateway('{"verdict":"DENY","reason":"rm on critical path"}')
      const result = await judgeOver(gateway).check('run_command', { command: 'rm important.db' }, 'red', 'Clean up')
      expect(result.decision).toBe('deny')
      expect(result.reason).toBe('rm on critical path')
      expect(result.riskTier).toBe('red')
    })

    it('accepts a fenced ```json verdict', async () => {
      const gateway = scriptedGateway('```json\n{"verdict":"ALLOW","reason":"fenced ok"}\n```')
      const result = await judgeOver(gateway).check('search_memory', {}, 'yellow')
      expect(result.decision).toBe('allow')
      expect(result.reason).toBe('fenced ok')
    })
  })

  describe('the model call — one isolated background one-shot', () => {
    it("is an isolated request with purpose 'security_judge', the rules in system and one user message", async () => {
      const gateway = scriptedGateway('{"verdict":"ALLOW","reason":"ok"}')
      await judgeOver(gateway).check('run_command', { command: 'echo hi' }, 'red', 'Greet', { conversationId: 'conv-1', agentId: 'agent-1' })

      expect(gateway.requests).toHaveLength(1)
      const req = gateway.requests[0]
      expect(req.isolated).toBe(true)
      expect(req.tools).toBeUndefined()
      expect(req.temperature).toBe(0)
      expect(req.maxTokens).toBe(250)
      expect(req.system).toContain('security judge')
      expect(req.messages).toHaveLength(1)
      expect(req.messages[0].role).toBe('user')
      expect(req.metadata).toMatchObject({ purpose: 'security_judge', conversationId: 'conv-1', agentId: 'agent-1', autonomous: true })
      // Candidate iteration is the resolver's alone — no gateway tier hop.
      expect(req.metadata?.tier).toBeUndefined()
    })

    it('runs on the heartbeat tier model — no hardcoded provider', async () => {
      const gateway = scriptedGateway('{"verdict":"ALLOW","reason":"ok"}')
      await judgeOver(gateway, ['api-a', 'api-b'], [tier('heartbeat', 'api-b', 'mb')]).check('run_command', {}, 'red')
      expect(gateway.requests[0]).toMatchObject({ provider: 'api-b', model: 'mb' })
    })

    it('a CLI that advertises isolated completion is eligible (e.g. a verified Grok CLI)', async () => {
      const gateway = scriptedGateway('{"verdict":"ALLOW","reason":"ok"}')
      const result = await judgeOver(gateway, ['grok-cli!'], [tier('heartbeat', 'grok-cli', 'grok-cli-default')]).check('run_command', {}, 'red')
      expect(result.decision).toBe('allow')
      expect(gateway.requests).toHaveLength(1)
      expect(gateway.requests[0].provider).toBe('grok-cli')
      expect(gateway.requests[0].isolated).toBe(true)
      // A CLI is pinned by provider only — its model rows are not guaranteed aliases.
      expect(gateway.requests[0].model).toBeUndefined()
    })

    it('a retryable failure on the first candidate uses the second (heartbeat → quick)', async () => {
      const gateway = scriptedGateway(new Error('fetch failed'), '{"verdict":"ALLOW","reason":"ok"}')
      const result = await judgeOver(gateway, ['api-a', 'api-b'], [tier('heartbeat', 'api-a', 'ma'), tier('quick', 'api-b', 'mb')])
        .check('run_command', {}, 'red')
      expect(result.decision).toBe('allow')
      expect(gateway.requests.map((r) => r.provider)).toEqual(['api-a', 'api-b'])
    })
  })

  describe('fail-closed on unparseable output', () => {
    it('DENIES on prose / unparseable output', async () => {
      const result = await judgeOver(scriptedGateway('I think this might be okay')).check('run_command', { command: 'ls' }, 'red')
      expect(result.decision).toBe('deny')
      expect(result.reason).toContain('unparseable')
    })

    it('DENIES a JSON object with a non-ALLOW/DENY verdict value', async () => {
      const result = await judgeOver(scriptedGateway('{"verdict":"MAYBE"}')).check('run_command', {}, 'red')
      expect(result.decision).toBe('deny')
    })

    it('DENIES an empty answer', async () => {
      const result = await createLlmJudge({ getAux: () => createFakeAuxiliaryModel(auxEmpty()) }).check('run_command', {}, 'red')
      expect(result.decision).toBe('deny')
      expect(result.reason).toContain('unparseable')
    })

    it('does NOT shop for a more permissive judge — denies on the first unparseable response without trying the next candidate', async () => {
      // Two eligible candidates (heartbeat → quick). The FIRST response is
      // prose; the SECOND would be a valid ALLOW. Moving on after an answer
      // would come back `allow` with two calls instead.
      const gateway = scriptedGateway('I think this might be okay', '{"verdict":"ALLOW","reason":"ok"}')
      const result = await judgeOver(gateway, ['api-a', 'api-b'], [tier('heartbeat', 'api-a', 'ma'), tier('quick', 'api-b', 'mb')])
        .check('run_command', {}, 'red')
      expect(result.decision).toBe('deny')
      expect(gateway.complete).toHaveBeenCalledTimes(1)
    })
  })

  describe('escalate when no model can judge — never allow', () => {
    it('a Grok-only install (CLI not verified isolated) escalates with ZERO model calls', async () => {
      const gateway = scriptedGateway('{"verdict":"ALLOW","reason":"x"}')
      const result = await judgeOver(gateway, ['grok-cli'], [tier('heartbeat', 'grok-cli', 'grok-cli-default')]).check('run_command', {}, 'red')
      expect(result.decision).toBe('escalate')
      expect(result.checkpoint).toBe('llm_judge')
      expect(result.reason).toContain('human approval required')
      expect(gateway.complete).not.toHaveBeenCalled()
    })

    it('a Kimi-only install escalates the same way', async () => {
      const gateway = scriptedGateway('{"verdict":"ALLOW","reason":"x"}')
      const result = await judgeOver(gateway, ['kimi-cli'], []).check('run_command', {}, 'red')
      expect(result.decision).toBe('escalate')
      expect(gateway.complete).not.toHaveBeenCalled()
    })

    it('an empty install (no provider at all) escalates', async () => {
      const gateway = scriptedGateway('{"verdict":"ALLOW","reason":"x"}')
      const result = await judgeOver(gateway, [], []).check('run_command', {}, 'red')
      expect(result.decision).toBe('escalate')
      expect(gateway.complete).not.toHaveBeenCalled()
    })

    it('no background model service wired escalates', async () => {
      const result = await createLlmJudge({ getAux: () => undefined }).check('run_command', {}, 'red')
      expect(result.decision).toBe('escalate')
    })

    it('a budget stop escalates without a model call', async () => {
      const aux = createFakeAuxiliaryModel(auxNone('budget_stop'))
      const result = await createLlmJudge({ getAux: () => aux }).check('run_command', {}, 'red')
      expect(result.decision).toBe('escalate')
      expect(result.reason).toContain('budget')
    })

    it('an error on every candidate escalates (never allow, never a silent pass)', async () => {
      const gateway = scriptedGateway(new Error('fetch failed'))
      const result = await judgeOver(gateway, ['api-a', 'api-b'], [tier('heartbeat', 'api-a', 'ma'), tier('quick', 'api-b', 'mb')])
        .check('run_command', { command: 'ls' }, 'red')
      expect(result.decision).toBe('escalate')
      expect(result.reason).toContain('fetch failed')
      expect(gateway.complete).toHaveBeenCalledTimes(2)
    })

    it('a non-retryable error stops at the first candidate and escalates', async () => {
      const gateway = scriptedGateway(new Error('Model unavailable'))
      const result = await judgeOver(gateway, ['api-a', 'api-b'], [tier('heartbeat', 'api-a', 'ma'), tier('quick', 'api-b', 'mb')])
        .check('run_command', {}, 'red')
      expect(result.decision).toBe('escalate')
      expect(gateway.complete).toHaveBeenCalledTimes(1)
    })

    it('a stand-in service that throws still escalates rather than escaping the gate', async () => {
      const aux = { complete: vi.fn(async () => { throw new Error('boom') }) }
      const result = await createLlmJudge({ getAux: () => aux as any }).check('run_command', {}, 'red')
      expect(result.decision).toBe('escalate')
    })

    it('an error answer from the service escalates', async () => {
      const aux = createFakeAuxiliaryModel(auxError('overloaded'))
      const result = await createLlmJudge({ getAux: () => aux }).check('run_command', {}, 'red')
      expect(result.decision).toBe('escalate')
      expect(result.reason).toContain('overloaded')
    })
  })

  describe('sandwich prompt / prompt injection resistance', () => {
    it('sandwiches the untrusted input between nonce markers with rules on both sides', async () => {
      const aux = createFakeAuxiliaryModel(auxOk('{"verdict":"ALLOW","reason":"ok"}'))
      await createLlmJudge({ getAux: () => aux }).check('run_command', { command: 'echo hi' }, 'red', 'Greet the user')
      const req = aux.calls[0]
      const m = req.user
      const marker = m.match(/<(untrusted-[a-z0-9]+)>/)
      expect(marker).not.toBeNull()
      expect(m).toContain(`</${marker![1]}>`)
      expect(m).toContain('echo hi'); expect(m).toContain('Greet the user')
      expect(m.slice(m.indexOf(`</${marker![1]}>`))).toContain('When in doubt, DENY')
      expect(req.system).toContain('DATA under evaluation')
      expect(req.system).not.toContain('echo hi')
    })

    it('uses "Not specified" when agentGoal is undefined', async () => {
      const aux = createFakeAuxiliaryModel(auxOk('{"verdict":"ALLOW","reason":"ok"}'))
      await createLlmJudge({ getAux: () => aux }).check('search_memory', {}, 'yellow')
      expect(aux.calls[0].user).toContain('Not specified')
    })
  })

  describe('timestamp', () => {
    it('includes ISO timestamp in result', async () => {
      const result = await judgeOver(scriptedGateway('{"verdict":"ALLOW","reason":"ok"}')).check('search_memory', {}, 'green')
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
