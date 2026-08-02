// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  createCandidateExtractor,
  canonicalChainKey,
  slugifyChain,
  mineTriggers,
  bindingsFromTrace,
} from '../../../src/modules/skill-generation/candidate-extractor.js'
import type { AgentTrace } from '../../../src/modules/skill-generation/types.js'

function traceOf(opts: Partial<AgentTrace> & { sessionId: string }): AgentTrace {
  return {
    sessionId: opts.sessionId,
    agentId: opts.agentId ?? 'agent-a',
    userGoal: opts.userGoal ?? 'Do the thing',
    toolCalls: opts.toolCalls ?? [
      { seq: 0, toolName: 'read', input: { path: '/a' }, success: true, durationMs: 12 },
      { seq: 1, toolName: 'grep', input: { pattern: 'x' }, success: true, durationMs: 8 },
      { seq: 2, toolName: 'write', input: { path: '/a' }, success: true, durationMs: 9 },
    ],
    outcome: opts.outcome ?? 'success',
    turns: opts.turns ?? 3,
    costUsd: opts.costUsd ?? 0.01,
    startedAt: opts.startedAt ?? 0,
    endedAt: opts.endedAt ?? 1,
  }
}

describe('candidate-extractor helpers', () => {
  it('canonicalChainKey sorts by seq and joins tool names', () => {
    const key = canonicalChainKey([
      { seq: 2, toolName: 'c', input: {}, success: true, durationMs: 1 },
      { seq: 0, toolName: 'a', input: {}, success: true, durationMs: 1 },
      { seq: 1, toolName: 'b', input: {}, success: true, durationMs: 1 },
    ])
    expect(key).toBe('a > b > c')
  })

  it('slugifyChain produces filesystem-safe slugs', () => {
    expect(slugifyChain('read > grep > write')).toBe('read-grep-write')
    expect(slugifyChain('foo.bar/baz:qux')).toBe('foo-bar-baz-qux')
    expect(slugifyChain('')).toBe('unnamed-skill')
  })

  it('mineTriggers dedupes and caps to 8', () => {
    const triggers = mineTriggers(['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
    expect(triggers.length).toBeLessThanOrEqual(8)
    expect(new Set(triggers).size).toBe(triggers.length)
  })

  it('bindingsFromTrace deduplicates tool names and records input type map', () => {
    const t = traceOf({ sessionId: 's1' })
    const bindings = bindingsFromTrace(t)
    expect(bindings.map((b) => b.toolName)).toEqual(['read', 'grep', 'write'])
    expect(bindings[0]!.schema).toEqual({ path: 'string' })
  })
})

describe('createCandidateExtractor', () => {
  it('produces a candidate when ≥ minObservations successful traces share a chain', () => {
    const traces = [
      traceOf({ sessionId: 's1' }),
      traceOf({ sessionId: 's2' }),
      traceOf({ sessionId: 's3' }),
    ]
    const ex = createCandidateExtractor({ minObservations: 3, minToolCalls: 3, minSuccessRate: 0.8 })
    const candidates = ex.extract(traces)
    expect(candidates).toHaveLength(1)
    const c = candidates[0]!
    expect(c.pattern.name).toBe('read-grep-write')
    expect(c.observations.timesObserved).toBe(3)
    expect(c.observations.successRate).toBe(1)
    expect(c.fromSessionIds).toEqual(['s1', 's2', 's3'])
    expect(c.pattern.toolChain.map((b) => b.toolName)).toEqual(['read', 'grep', 'write'])
  })

  it('ignores short traces and failed outcomes', () => {
    const traces = [
      traceOf({ sessionId: 's1', toolCalls: [{ seq: 0, toolName: 'a', input: {}, success: true, durationMs: 1 }] }),
      traceOf({ sessionId: 's2', outcome: 'failure' }),
      traceOf({ sessionId: 's3' }),
    ]
    const ex = createCandidateExtractor()
    expect(ex.extract(traces)).toHaveLength(0)
  })

  it('groups independently when chains differ', () => {
    const alt = traceOf({ sessionId: 'x', toolCalls: [
      { seq: 0, toolName: 'fetch', input: {}, success: true, durationMs: 1 },
      { seq: 1, toolName: 'parse', input: {}, success: true, durationMs: 1 },
      { seq: 2, toolName: 'store', input: {}, success: true, durationMs: 1 },
    ] })
    const traces = [
      traceOf({ sessionId: 's1' }),
      traceOf({ sessionId: 's2' }),
      traceOf({ sessionId: 's3' }),
      { ...alt, sessionId: 'a1' },
      { ...alt, sessionId: 'a2' },
      { ...alt, sessionId: 'a3' },
    ]
    const ex = createCandidateExtractor()
    const candidates = ex.extract(traces)
    expect(candidates).toHaveLength(2)
    const names = new Set(candidates.map((c) => c.pattern.name))
    expect(names.has('read-grep-write')).toBe(true)
    expect(names.has('fetch-parse-store')).toBe(true)
  })

  it('returns empty array on empty input', () => {
    const ex = createCandidateExtractor()
    expect(ex.extract([])).toHaveLength(0)
  })
})
