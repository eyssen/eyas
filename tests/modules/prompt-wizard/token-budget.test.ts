// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  BASELINE_WINDOW,
  DEFAULT_BUDGET_FULL,
  DEFAULT_MEMORY_RECALL_CHARS,
  LOCKED_BUDGET_KEYS,
  SMALL_WINDOW_SHARE,
  budgetForWindow,
  totalBudget,
  estimateTokens,
  estimateMessagesTokens,
  clipToBudget,
  type SectionBudget,
} from '../../../src/modules/prompt-wizard/token-budget.js'
import { CORE_IDENTITY } from '../../../src/modules/prompt-wizard/core-identity.js'
import { CORE_RULES } from '../../../src/modules/prompt-wizard/core-rules.js'
import { DEFAULT_PERSONALITY } from '../../../src/modules/prompt-wizard/master-prompt.js'

const SCALABLE = (Object.keys(DEFAULT_BUDGET_FULL) as Array<keyof SectionBudget>)
  .filter((k) => !(LOCKED_BUDGET_KEYS as readonly string[]).includes(k))

describe('token-budget', () => {
  it('the baseline declares the recall section from memory.index.budgetChars and a working-memory section', () => {
    expect(DEFAULT_BUDGET_FULL.memoryRecall).toBe(Math.ceil(DEFAULT_MEMORY_RECALL_CHARS / 4))
    expect(DEFAULT_BUDGET_FULL.memoryContext).toBeGreaterThan(0)
  })

  it('every locked section fits the budget it is given — nothing ships pre-truncated', () => {
    // A locked section is text WE ship, measured against a number WE choose, so
    // a mismatch is a self-inflicted cut with no operator in the loop.
    expect(estimateTokens(CORE_RULES)).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.coreRules)
    expect(estimateTokens(DEFAULT_PERSONALITY)).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.personality)
    expect(estimateTokens(CORE_IDENTITY)).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.coreIdentity)
  })

  it('shipped CORE_RULES / CORE_IDENTITY are never clipped at any window', () => {
    for (const window of [2_048, 4_096, 8_192, 32_768, 100_000, 200_000, 1_000_000]) {
      const b = budgetForWindow(window)
      expect(clipToBudget(CORE_RULES, b.coreRules).truncated, `coreRules at ${window}`).toBe(false)
      expect(clipToBudget(CORE_IDENTITY, b.coreIdentity).truncated, `coreIdentity at ${window}`).toBe(false)
      for (const key of LOCKED_BUDGET_KEYS) expect(b[key]).toBe(DEFAULT_BUDGET_FULL[key])
    }
  })

  it('100k is exactly the baseline', () => {
    expect(budgetForWindow(BASELINE_WINDOW)).toEqual(DEFAULT_BUDGET_FULL)
  })

  it('small windows (≤32k) stay within 35% of the window', () => {
    for (const window of [8_192, 16_384, 32_768]) {
      expect(totalBudget(budgetForWindow(window))).toBeLessThanOrEqual(SMALL_WINDOW_SHARE * window)
    }
    const at8k = budgetForWindow(8_192)
    expect(at8k.toolsList).toBeLessThan(DEFAULT_BUDGET_FULL.toolsList)
    expect(at8k.memoryRecall).toBeLessThan(DEFAULT_BUDGET_FULL.memoryRecall)
  })

  it('below ~5.5k only the locked floor remains: scalable sections go to 0, locked ones keep their caps', () => {
    const b = budgetForWindow(4_096)
    for (const key of SCALABLE) expect(b[key]).toBe(0)
    expect(b.coreRules).toBe(DEFAULT_BUDGET_FULL.coreRules)
  })

  it('large windows scale the scalable sections up to 2.5x (≥250k), never the locked ones', () => {
    const at500k = budgetForWindow(500_000)
    for (const key of SCALABLE) expect(at500k[key]).toBe(Math.floor(DEFAULT_BUDGET_FULL[key] * 2.5))
    expect(budgetForWindow(250_000)).toEqual(at500k)
    expect(at500k.coreIdentity).toBe(DEFAULT_BUDGET_FULL.coreIdentity)
    const at175k = budgetForWindow(175_000)
    expect(at175k.agentsMd).toBe(Math.floor(DEFAULT_BUDGET_FULL.agentsMd * 1.75))
  })

  it('is monotonic in the window for every section', () => {
    const windows = [1_024, 4_096, 6_000, 8_192, 16_384, 28_000, 29_000, 32_768, 64_000, 99_999, 100_000, 128_000, 200_000, 250_000, 1_000_000]
    for (let i = 1; i < windows.length; i++) {
      const prev = budgetForWindow(windows[i - 1]!)
      const next = budgetForWindow(windows[i]!)
      for (const key of Object.keys(prev) as Array<keyof SectionBudget>) {
        expect(next[key], `${key} ${windows[i - 1]}→${windows[i]}`).toBeGreaterThanOrEqual(prev[key])
      }
    }
  })

  it('memoryRecall follows memory.index.budgetChars and scales with the same factor', () => {
    expect(budgetForWindow(100_000, { memoryRecallChars: 8_000 }).memoryRecall).toBe(2_000)
    expect(budgetForWindow(250_000, { memoryRecallChars: 8_000 }).memoryRecall).toBe(5_000)
    expect(budgetForWindow(250_000).memoryRecall).toBe(Math.floor(DEFAULT_BUDGET_FULL.memoryRecall * 2.5))
  })

  it('an invalid window or recall size falls back to the baseline instead of breaking the budget', () => {
    expect(budgetForWindow(0)).toEqual(DEFAULT_BUDGET_FULL)
    expect(budgetForWindow(Number.NaN)).toEqual(DEFAULT_BUDGET_FULL)
    expect(budgetForWindow(100_000, { memoryRecallChars: -5 })).toEqual(DEFAULT_BUDGET_FULL)
  })

  it('a per-call override wins after scaling', () => {
    const b = budgetForWindow(500_000, { override: { agentsMd: 10 } })
    expect(b.agentsMd).toBe(10)
    expect(b.projectCascade).toBe(Math.floor(DEFAULT_BUDGET_FULL.projectCascade * 2.5))
  })

  it('estimateTokens returns 100 for 400-char string', () => {
    expect(estimateTokens('x'.repeat(400))).toBe(100)
  })

  it('clipToBudget truncates and appends marker', () => {
    const result = clipToBudget('x'.repeat(1000), 100)
    expect(result.truncated).toBe(true)
    expect(result.content).toContain('\n\n[truncated — section budget]')
  })
})

describe('clipToBudget droppedChars', () => {
  it('reports zero when the text fits', () => {
    const r = clipToBudget('short', 100)
    expect(r).toEqual({ content: 'short', truncated: false, droppedChars: 0 })
  })

  it('reports the number of source characters cut', () => {
    const text = 'x'.repeat(500)
    const r = clipToBudget(text, 100) // charBudget = 400
    expect(r.truncated).toBe(true)
    expect(r.droppedChars).toBe(100)
    expect(r.content.startsWith('x'.repeat(400))).toBe(true)
  })
})

// G11 — the history half of the occupancy estimate.
describe('estimateMessagesTokens', () => {
  it('(+) counts string content, text, reasoning, tool input and tool results with the same chars/4', () => {
    const tokens = estimateMessagesTokens([
      { content: 'x'.repeat(40) },
      { content: [
        { type: 'text', text: 'y'.repeat(20) },
        { type: 'thinking', thinking: 'z'.repeat(20) },
        { type: 'tool_use', id: 't', name: 'read', input: { path: '/a' } },
      ] },
      { content: [{ type: 'tool_result', toolUseId: 't', content: 'w'.repeat(40) }] },
    ])
    expect(tokens).toBe(Math.ceil((40 + 20 + 20 + JSON.stringify({ path: '/a' }).length + 40) / 4))
  })

  it('(−) images, malformed entries and a missing history count nothing', () => {
    expect(estimateMessagesTokens([{ content: [{ type: 'image', source: { type: 'base64', data: 'A'.repeat(4000) } }] }])).toBe(0)
    expect(estimateMessagesTokens([{ content: 42 }, { content: [null, 'x'] }, {} as { content?: unknown }])).toBe(0)
    expect(estimateMessagesTokens(undefined)).toBe(0)
    expect(estimateMessagesTokens([])).toBe(0)
  })
})
