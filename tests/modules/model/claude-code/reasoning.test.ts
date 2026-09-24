// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F5 — the pure part of Claude Code's reasoning wire: which options a plan
// becomes on the running binary, when the display flag may be sent, and a
// readback that never decides or throws.

import { describe, it, expect } from 'vitest'
import {
  createEffortReadback,
  runtimeEffortLevels,
  runtimeHasThinkingDisplay,
  toClaudeCodeReasoningOptions,
  THINKING_DISPLAY_MIN_VERSION,
} from '@modules/model/submodules/claude-code/reasoning.js'
import { effortPlanFor, ADAPTIVE_EFFORT_CAPABILITY } from '../../../helpers/effort-plan.js'
import thinkingDisplayFacts from '../../../fixtures/cli/claude-code/2.1.280/thinking-display.json'

const discovered = (levels: string[], runtime = '2.1.281', adaptiveThinking = true) => ({
  source: 'sdk' as const, param: 'effort' as const, levels: levels as any, adaptiveThinking, runtime, discoveredAt: '2026-09-23T00:00:00.000Z',
})
const OPUS_55 = { ...ADAPTIVE_EFFORT_CAPABILITY, levels: ['low', 'medium', 'high', 'xhigh', 'max'] as any, canDisable: false, defaultLevel: 'medium' as const, thinking: 'always-on' as const, displayParam: true }

describe('claude-code reasoning — the display flag', () => {
  it('is sent only to a runtime at or above the verified version', () => {
    expect(runtimeHasThinkingDisplay(THINKING_DISPLAY_MIN_VERSION)).toBe(true)
    expect(runtimeHasThinkingDisplay('2.1.281')).toBe(true)
    expect(runtimeHasThinkingDisplay('2.2.0')).toBe(true)
    expect(runtimeHasThinkingDisplay('3.0.1')).toBe(true)
  })

  // R1B-16: the verified minimum is the oldest binary whose option table was
  // read, not a later one — 2.1.280 already has the flag.
  it('the minimum is the 2.1.280 binary the fixture recorded the flag on', () => {
    expect(THINKING_DISPLAY_MIN_VERSION).toBe(thinkingDisplayFacts.cliVersion)
    expect(thinkingDisplayFacts.verified).toBe(true)
    expect(thinkingDisplayFacts.option.flag).toBe('--thinking-display <display>')
    expect(thinkingDisplayFacts.option.choices).toContain('summarized')
    expect(runtimeHasThinkingDisplay('2.1.280')).toBe(true)
    const out = toClaudeCodeReasoningOptions({ plan: effortPlanFor('xhigh', OPUS_55), discovered: discovered(['low', 'medium', 'high', 'xhigh', 'max'], '2.1.280'), runtimeVersion: '2.1.280' })
    expect(out.extraArgs).toEqual({ 'thinking-display': 'summarized' })
  })

  it('an Auto turn on a model that thinks by default still asks 2.1.280 for the display (positive)', () => {
    const out = toClaudeCodeReasoningOptions({ plan: effortPlanFor('auto', OPUS_55), discovered: discovered(['high'], '2.1.280'), runtimeVersion: '2.1.280' })
    expect(out).toEqual({ extraArgs: { 'thinking-display': 'summarized' }, sent: 'auto' })
  })

  it('never to an older, unknown or unparseable one (negative)', () => {
    // No other way exists on them: the SDK session is non-interactive, and
    // showThinkingSummaries acts only in an interactive one (fixture).
    expect(thinkingDisplayFacts.sdkBundledCli.hasThinkingDisplayFlag).toBe(false)
    expect(thinkingDisplayFacts.setting.effectInSdkSessions).toMatch(/^none/)
    expect(runtimeHasThinkingDisplay('2.1.279')).toBe(false)
    expect(runtimeHasThinkingDisplay('2.1.89')).toBe(false)
    const old = toClaudeCodeReasoningOptions({ plan: effortPlanFor('xhigh', OPUS_55), discovered: discovered(['low', 'medium', 'high', 'xhigh', 'max'], '2.1.279'), runtimeVersion: '2.1.279' })
    expect(old.extraArgs).toBeUndefined()
    expect(runtimeHasThinkingDisplay(null)).toBe(false)
    expect(runtimeHasThinkingDisplay('')).toBe(false)
    expect(runtimeHasThinkingDisplay('latest')).toBe(false)
  })
})

describe('claude-code reasoning — levels the running binary reported', () => {
  it('are the discovered effort levels of the same runtime version', () => {
    expect(runtimeEffortLevels(discovered(['low', 'high', 'xhigh']), '2.1.281')).toEqual(['low', 'high', 'xhigh'])
    // A report without a version, or a runtime whose version is unknown, is taken as is.
    expect(runtimeEffortLevels({ ...discovered(['low']), runtime: undefined }, '2.1.281')).toEqual(['low'])
    expect(runtimeEffortLevels(discovered(['low']), null)).toEqual(['low'])
  })

  it('are none without a report, for a model without effort, or from another version (negative)', () => {
    expect(runtimeEffortLevels(null, '2.1.281')).toEqual([])
    expect(runtimeEffortLevels({ ...discovered([]), param: 'none' }, '2.1.281')).toEqual([])
    expect(runtimeEffortLevels(discovered(['low', 'high']), '2.1.282')).toEqual([])
  })
})

describe('claude-code reasoning — plan → options', () => {
  it('a discovered level goes out as effort with adaptive thinking and the display flag', () => {
    const out = toClaudeCodeReasoningOptions({ plan: effortPlanFor('xhigh', OPUS_55), discovered: discovered(['low', 'medium', 'high', 'xhigh', 'max']), runtimeVersion: '2.1.281' })
    expect(out).toEqual({ effort: 'xhigh', thinking: { type: 'adaptive' }, extraArgs: { 'thinking-display': 'summarized' }, sent: 'xhigh' })
  })

  it('a model the runtime runs without adaptive thinking gets the effort alone', () => {
    const out = toClaudeCodeReasoningOptions({ plan: effortPlanFor('high'), discovered: discovered(['low', 'high'], '2.1.281', false), runtimeVersion: '2.1.281' })
    expect(out).toEqual({ effort: 'high', sent: 'high' })
  })

  it('a level the runtime did not report is clamped to one it did, ties rounding down', () => {
    const out = toClaudeCodeReasoningOptions({ plan: effortPlanFor('xhigh', OPUS_55), discovered: discovered(['low', 'medium', 'high', 'max']), runtimeVersion: '2.1.281' })
    expect(out.effort).toBe('high')
    expect(out.sent).toBe('high')
  })

  it('nothing is sent without a plan, for Auto, or without discovered levels (negative)', () => {
    expect(toClaudeCodeReasoningOptions({ plan: undefined, discovered: discovered(['high']), runtimeVersion: '2.1.281' })).toEqual({ sent: 'auto' })
    expect(toClaudeCodeReasoningOptions({ plan: effortPlanFor('auto'), discovered: discovered(['high']), runtimeVersion: '2.1.281' })).toEqual({ sent: 'auto' })
    expect(toClaudeCodeReasoningOptions({ plan: effortPlanFor('high'), discovered: null, runtimeVersion: '2.1.281' })).toEqual({ sent: 'auto' })
  })

  it("'none' switches thinking off only where the model can (negative: never a forced disabled otherwise)", () => {
    expect(toClaudeCodeReasoningOptions({ plan: effortPlanFor('none'), discovered: discovered(['low']), runtimeVersion: '2.1.281' }))
      .toEqual({ thinking: { type: 'disabled' }, sent: 'none' })
    const cannot = { ...effortPlanFor('low', OPUS_55), level: 'none' as const }
    expect(toClaudeCodeReasoningOptions({ plan: cannot, discovered: discovered(['low']), runtimeVersion: '2.1.281' })).toEqual({ sent: 'auto' })
  })
})

describe('claude-code reasoning — the readback', () => {
  const input = (extra: Record<string, unknown>) => ({ hook_event_name: 'Stop', session_id: 's', transcript_path: '', cwd: '/w', ...extra }) as any

  it('records the last reported level from either matcher, answering continue', async () => {
    const readback = createEffortReadback()
    const stop = readback.hooks.hooks.Stop![0].hooks[0]
    const pre = readback.hooks.hooks.PreToolUse![0].hooks[0]
    expect(readback.effective()).toBeUndefined()
    expect(await pre(input({ hook_event_name: 'PreToolUse', effort: { level: 'max' } }), 't', { signal: new AbortController().signal })).toEqual({ continue: true })
    expect(readback.effective()).toBe('max')
    expect(await stop(input({ effort: { level: 'high' } }), undefined, { signal: new AbortController().signal })).toEqual({ continue: true })
    expect(readback.effective()).toBe('high')
  })

  it('ignores inputs without a readable level and never throws (negative)', async () => {
    const readback = createEffortReadback()
    const stop = readback.hooks.hooks.Stop![0].hooks[0]
    const signal = new AbortController().signal
    for (const bad of [input({}), input({ effort: null }), input({ effort: { level: 3 } }), input({ effort: { level: '' } }), input({ effort: { level: 'x'.repeat(100) } }), null, 'Stop']) {
      expect(await stop(bad as any, undefined, { signal })).toEqual({ continue: true })
    }
    expect(readback.effective()).toBeUndefined()
    // Asks for no hook lifecycle messages in the output stream.
    expect(readback.hooks.includeHookEvents).toBeUndefined()
  })
})
