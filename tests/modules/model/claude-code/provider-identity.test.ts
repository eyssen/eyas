// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F5 — per-turn model identity and the effective-effort readback on Claude
// Code. `model` stays the EYAS id (the runtime's default id when none was
// asked for, never a placeholder like 'claude-code-sonnet'); the concrete
// model the runtime answered with is resolvedModelId. The effort the runtime
// really ran at is read from its hook inputs (effort.level, after any silent
// downgrade of its own) and confirmed on the response; without a report
// nothing is claimed.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  options: undefined as any,
  /** effort.level each hook input of the scripted turn carries (undefined: no field). */
  hookEffort: undefined as unknown,
  /** Also drive a tool call's PreToolUse (with this level). */
  preToolEffort: undefined as unknown,
  init: {} as Record<string, unknown>,
  result: {} as Record<string, unknown>,
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options, h.init)
      const base = { session_id: 's', transcript_path: '', cwd: args.options.cwd, permission_mode: 'default' }
      if (h.preToolEffort !== undefined) {
        for (const m of args.options.hooks?.PreToolUse ?? []) {
          for (const hook of m.hooks) await hook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, tool_use_id: 't1', effort: { level: h.preToolEffort } }, 't1', { signal: new AbortController().signal })
        }
      }
      // The runtime runs its Stop hooks before it reports the result.
      for (const m of args.options.hooks?.Stop ?? []) {
        const input = { ...base, hook_event_name: 'Stop', stop_hook_active: false, ...(h.hookEffort !== undefined ? { effort: { level: h.hookEffort } } : {}) }
        for (const hook of m.hooks) await hook(input, undefined, { signal: new AbortController().signal })
      }
      yield { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, ...h.result }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { mergeHooks } from '@modules/model/submodules/claude-code/hooks.js'
import { createClaudeStreamNormalizer } from '@modules/model/submodules/claude-code/stream-normalizer.js'
import { mergeEffortOutcome } from '@modules/model/reasoning/outcome.js'
import { resolveEffortPlan } from '@modules/model/reasoning/resolve.js'
import type { ModelResponse } from '@modules/model/types.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'
import { ADAPTIVE_EFFORT_CAPABILITY } from '../../../helpers/effort-plan.js'

const XHIGH_CAPABILITY = { ...ADAPTIVE_EFFORT_CAPABILITY, levels: ['low', 'medium', 'high', 'xhigh', 'max'] as any, canDisable: false }

async function done(stream: AsyncIterable<any>): Promise<ModelResponse> {
  let response: ModelResponse | undefined
  for await (const event of stream) if (event.type === 'done') response = event.response
  return response!
}

const ask = (extra: Record<string, unknown> = {}) => ({ messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' }, ...extra })

beforeEach(() => {
  h.options = undefined
  h.hookEffort = undefined
  h.preToolEffort = undefined
  h.init = {}
  h.result = {}
})

describe('claude-code — per-turn model identity', () => {
  it('the init model becomes resolvedModelId; model stays the EYAS id (positive)', async () => {
    h.init = { model: 'claude-opus-5-5' }
    const response = await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME }).stream(ask({ model: 'claude-code-opus' }) as any))
    expect(response.model).toBe('claude-code-opus')
    expect(response.resolvedModelId).toBe('claude-opus-5-5')
  })

  it('without request.model the model is the runtime default id, never the old placeholder (negative)', async () => {
    h.init = { model: 'claude-opus-5-5' }
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const streamed = await done(provider.stream(ask() as any))
    expect(streamed.model).toBe('claude-code-default')
    expect(streamed.model).not.toBe('claude-code-sonnet')
    const completed = await provider.complete(ask() as any)
    expect(completed.model).toBe('claude-code-default')
  })

  it('the model of each main-thread call wins; the usage report is the fallback; nothing reported, nothing claimed', () => {
    const streamed = createClaudeStreamNormalizer({ model: 'claude-code-opus' })
    streamed.observeInit({ type: 'system', subtype: 'init', model: 'claude-opus-5-5[1m]' })
    streamed.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1', model: 'claude-opus-5-5' } } })
    const a = streamed.finish({ type: 'result', subtype: 'success', result: 'ok' })
    expect(a.kind === 'done' && a.response.resolvedModelId).toBe('claude-opus-5-5')

    const usageOnly = createClaudeStreamNormalizer({ model: 'claude-code-default' })
    const b = usageOnly.finish({
      type: 'result', subtype: 'success', result: 'ok',
      modelUsage: { 'claude-haiku-4-5': { inputTokens: 10, outputTokens: 1 }, 'claude-sonnet-5': { inputTokens: 900, outputTokens: 300 } },
    })
    expect(b.kind === 'done' && b.response.resolvedModelId).toBe('claude-sonnet-5')

    const none = createClaudeStreamNormalizer({ model: 'claude-code-default' }).finish({ type: 'result', subtype: 'success', result: 'ok' })
    expect(none.kind === 'done' && 'resolvedModelId' in none.response).toBe(false)
    // An absurd name from the runtime is not recorded.
    const huge = createClaudeStreamNormalizer({ model: 'm' })
    huge.observeInit({ type: 'system', subtype: 'init', model: 'x'.repeat(400) })
    expect('resolvedModelId' in huge.finishWithoutResult()).toBe(false)
  })
})

describe('claude-code — effective-effort readback', () => {
  it("the Stop hook's effort.level confirms the effective level: xhigh asked, high ran (positive)", async () => {
    h.hookEffort = 'high'
    const plan = resolveEffortPlan({ intent: { level: 'xhigh', source: 'conversation' }, capability: XHIGH_CAPABILITY, streaming: true })
    const response = await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME }).stream(ask({ effortPlan: plan.plan }) as any))
    expect(response.effortOutcome).toMatchObject({ effective: 'high', confirmed: true, reason: 'runtime-readback' })
    // Through the gateway's merge: requested/source stay the gateway's.
    expect(mergeEffortOutcome(plan.outcome, response.effortOutcome)).toEqual({
      requested: 'xhigh', effective: 'high', source: 'conversation', clamped: true, reason: 'runtime-readback', confirmed: true,
    })
  })

  it('Auto sends nothing, and the readback still names the level the model ran at', async () => {
    h.hookEffort = 'medium'
    const plan = resolveEffortPlan({ capability: XHIGH_CAPABILITY, streaming: true })
    const response = await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME }).stream(ask({ effortPlan: plan.plan }) as any))
    expect('effort' in h.options).toBe(false)
    expect(mergeEffortOutcome(plan.outcome, response.effortOutcome)).toMatchObject({ requested: 'auto', effective: 'medium', clamped: false, confirmed: true })
  })

  it('a PreToolUse report counts too; the last report wins', async () => {
    h.preToolEffort = 'max'
    h.hookEffort = 'high'
    const plan = resolveEffortPlan({ intent: { level: 'max', source: 'agent' }, capability: XHIGH_CAPABILITY, streaming: true })
    const response = await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME }).stream(ask({ effortPlan: plan.plan }) as any))
    expect(response.effortOutcome?.effective).toBe('high')

    h.hookEffort = undefined
    const onlyTool = await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME }).stream(ask({ effortPlan: plan.plan }) as any))
    expect(onlyTool.effortOutcome).toMatchObject({ effective: 'max', confirmed: true })
  })

  it('no effort field (a model without effort control) claims nothing (negative)', async () => {
    const plan = resolveEffortPlan({ intent: { level: 'high', source: 'request' }, capability: XHIGH_CAPABILITY, streaming: true })
    const response = await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME }).stream(ask({ effortPlan: plan.plan }) as any))
    expect(response.effortOutcome).toBeUndefined()
    // The gateway's own outcome then stands, unconfirmed.
    expect(mergeEffortOutcome(plan.outcome, response.effortOutcome).confirmed).toBeUndefined()
  })

  it('a level that is not a rung is never claimed (negative)', async () => {
    h.hookEffort = 'turbo'
    const response = await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME }).stream(ask() as any))
    expect(response.effortOutcome).toBeUndefined()
    h.hookEffort = { nested: 'high' }
    const odd = await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME }).stream(ask() as any))
    expect(odd.effortOutcome).toBeUndefined()
  })

  it('the readback matchers sit in the merged hooks after the policy hook, on every query', async () => {
    const gate = { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }), checkMemoryPath: () => null }
    await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME, getGovernance: () => ({ securityGate: gate }) }).stream(ask() as any))
    expect(h.options.hooks.PreToolUse).toHaveLength(2)
    expect(h.options.hooks.Stop).toHaveLength(1)
    // The readback slot comes after the sovereignty slot by construction.
    const policy = { hooks: [async () => ({ continue: true })] }
    const readback = { hooks: [async () => ({ continue: true })] }
    expect(mergeHooks({ readback: { hooks: { PreToolUse: [readback] } }, sovereignty: { hooks: { PreToolUse: [policy] } } }).hooks!.PreToolUse).toEqual([policy, readback])
    // An isolated query (no tools) still reads the effort back at Stop.
    await done(createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME }).stream(ask({ isolated: true }) as any))
    expect(h.options.hooks.Stop).toHaveLength(1)
  })
})
