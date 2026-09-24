// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D7 — the context inspector's privacy view: the section content as the
// model received it, and the per-section badge.

import { describe, it, expect } from 'vitest'
import {
  applyEgressSpans,
  hasEgressSpans,
  maskedToolResults,
  sectionEgressBadge,
  type CompositionEgress,
} from '../../src/web/src/pages/conversations/composition-egress'

const CONTENT = 'contact billing@example.com, IBAN HU42 1177 3016 1111 1018 0000 0000, paid 2026-09-08'
const EMAIL_AT: [number, number, string] = [8, 27, 'email']
const IBAN_AT: [number, number, string] = [34, 68, 'iban']

function egress(over: Partial<CompositionEgress> = {}): CompositionEgress {
  return {
    locality: 'remote',
    transport: 'gateway',
    providerId: 'openai',
    rulesetVersion: 'regex@2/policy@1',
    calls: 1,
    at: '2026-09-22T10:00:00.000Z',
    unattributed: { masked: 0, warned: 0 },
    messages: { masked: 0, warned: 0 },
    toolResults: [],
    byType: {},
    ...over,
  }
}

describe('applyEgressSpans', () => {
  it('(+) renders every span as its [TYPE] placeholder, in any order', () => {
    expect(CONTENT.slice(...EMAIL_AT.slice(0, 2) as [number, number])).toBe('billing@example.com')
    expect(applyEgressSpans(CONTENT, [IBAN_AT, EMAIL_AT])).toBe('contact [EMAIL], IBAN [IBAN], paid 2026-09-08')
  })

  it('(+) upper-cases a custom pattern type', () => {
    expect(applyEgressSpans('ticket ABC-123', [[7, 14, 'internal_ticket']])).toBe('ticket [INTERNAL_TICKET]')
  })

  it('(−) no spans → the content unchanged', () => {
    expect(applyEgressSpans(CONTENT, [])).toBe(CONTENT)
    expect(applyEgressSpans(CONTENT, null)).toBe(CONTENT)
    expect(applyEgressSpans('', [EMAIL_AT])).toBe('')
  })

  it('(−) ignores out-of-range, empty, inverted and malformed spans safely', () => {
    expect(applyEgressSpans('short', [[2, 99, 'email']])).toBe('short')
    expect(applyEgressSpans('short', [[-1, 2, 'email']])).toBe('short')
    expect(applyEgressSpans('short', [[3, 3, 'email']])).toBe('short')
    expect(applyEgressSpans('short', [[4, 2, 'email']])).toBe('short')
    expect(applyEgressSpans('short', [[0, 2, '']])).toBe('short')
    expect(applyEgressSpans('short', [['a', 'b', 'email'] as unknown, null, 'x'])).toBe('short')
  })

  it('(−) ignores a span overlapping one already applied', () => {
    expect(applyEgressSpans(CONTENT, [EMAIL_AT, [20, 40, 'phone']])).toBe(`contact [EMAIL]${CONTENT.slice(27)}`)
  })
})

describe('sectionEgressBadge', () => {
  it('(+) masked → count and types in order of appearance', () => {
    expect(sectionEgressBadge({ masked: 3, spans: [EMAIL_AT, IBAN_AT, [70, 80, 'email']], skipped: false }, egress()))
      .toEqual({ kind: 'masked', count: 3, types: ['email', 'iban'] })
  })

  it('(+) EYAS-generated → not scanned; scanned clean → none', () => {
    expect(sectionEgressBadge({ masked: 0, spans: [], skipped: true }, egress())).toEqual({ kind: 'notScanned' })
    expect(sectionEgressBadge({ masked: 0, spans: [], skipped: false }, egress())).toEqual({ kind: 'none' })
  })

  it('(+) a local destination marks every section, recorded or not', () => {
    expect(sectionEgressBadge(null, egress({ locality: 'local' }))).toEqual({ kind: 'local' })
  })

  it('(−) nothing recorded → no badge', () => {
    expect(sectionEgressBadge({ masked: 1, spans: [EMAIL_AT], skipped: false }, null)).toBeNull()
    expect(sectionEgressBadge(null, egress())).toBeNull()
    expect(sectionEgressBadge(undefined, undefined)).toBeNull()
  })
})

describe('hasEgressSpans / maskedToolResults', () => {
  it('(+) detects a section with masks', () => {
    expect(hasEgressSpans([{ egress: null }, { egress: { masked: 1, spans: [EMAIL_AT], skipped: false } }])).toBe(true)
    expect(hasEgressSpans([{ egress: { masked: 0, spans: [], skipped: false } }, {}])).toBe(false)
  })

  it('(+) sums masked results per tool across the gateway and the CLI bridge', () => {
    expect(maskedToolResults(egress({
      toolResults: [
        { toolName: 'memory_search', transport: 'gateway', masked: 1, warned: 0, calls: 1 },
        { toolName: 'memory_search', transport: 'mcp-bridge', masked: 2, warned: 0, calls: 2 },
        { toolName: 'memory_expand', transport: 'mcp-bridge', masked: 0, warned: 1, calls: 1 },
      ],
    }))).toEqual([{ toolName: 'memory_search', masked: 3 }])
  })

  it('(−) none for a local destination or without egress', () => {
    expect(maskedToolResults(egress({ locality: 'local', toolResults: [{ toolName: 'memory_search', transport: 'gateway', masked: 1, warned: 0, calls: 1 }] }))).toEqual([])
    expect(maskedToolResults(null)).toEqual([])
  })
})
