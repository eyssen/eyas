// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I12 — the context inspector's 'Memory delivered' row: the same record on
// every provider, and no row at all when nothing was recorded.

import { describe, it, expect } from 'vitest'
import {
  memoryDeliveryView,
  type CompositionDelivery,
  type DrillDownSummary,
} from '../../src/web/src/pages/conversations/composition-delivery'
import en from '../../src/web/src/pages/conversations/locales/en.json'

function delivery(over: Partial<CompositionDelivery> = {}): CompositionDelivery {
  return {
    turnId: '01K5TURNAAAAAAAAAAAAAAAAAA',
    profile: {
      providerId: 'grok-cli', modelId: 'grok-4', contextWindow: 256_000, resolved: true, windowSource: 'catalog',
      supportsTools: true, drillDown: true, toolAddressing: 'meta-tool',
    },
    budgetTotalTokens: 12_000,
    recall: {
      ids: ['vt:a.md', 'gs:g1', 'ft:f1'], hits: 3, retrieved: 2, expanded: 1,
      chars: 1_800, budgetChars: 6_000, tokens: 450, budgetTokens: 1_500, withheld: null,
    },
    systemPromptChannel: null,
    ...over,
  }
}

const drill: DrillDownSummary = { calls: 2, reads: 5, limit: 3 }

describe('memoryDeliveryView', () => {
  it('(+) shows the model and window, the recall counts against the cap, and the drill-down calls', () => {
    expect(memoryDeliveryView(delivery(), drill)).toEqual({
      window: { kind: 'known', model: 'grok-4', window: 256_000 },
      recall: { kind: 'delivered', hits: 3, expanded: 1, tokens: 450, budgetTokens: 1_500 },
      drill: { kind: 'used', calls: 2, reads: 5, limit: 3 },
      channelKey: null,
    })
  })

  it('(+) names the prompt channel of an ACP CLI', () => {
    for (const [channel, key] of [
      ['meta-verified', 'conversations.compositionPanel.memory.channel.metaVerified'],
      ['meta-unverified', 'conversations.compositionPanel.memory.channel.metaUnverified'],
      ['prompt', 'conversations.compositionPanel.memory.channel.prompt'],
    ] as const) {
      expect(memoryDeliveryView(delivery({ systemPromptChannel: channel }), drill)?.channelKey).toBe(key)
    }
  })

  it('(+) says why recall was withheld, and that nothing was recalled', () => {
    const withheld = delivery({ recall: { ...delivery().recall!, ids: [], hits: 0, withheld: 'no-budget' } })
    expect(memoryDeliveryView(withheld, drill)?.recall).toEqual({
      kind: 'withheld', reasonKey: 'conversations.compositionPanel.memory.withheldReason.noBudget',
    })
    const empty = delivery({ recall: { ...delivery().recall!, ids: [], hits: 0, expanded: 0 } })
    expect(memoryDeliveryView(empty, drill)?.recall).toEqual({ kind: 'none' })
  })

  it('(+) an unresolved window is said to be unknown; a model that cannot drill says so', () => {
    const view = memoryDeliveryView(delivery({
      profile: { ...delivery().profile!, resolved: false, drillDown: false, modelId: null },
    }), drill)
    expect(view?.window).toEqual({ kind: 'unknown', model: 'grok-cli' })
    expect(view?.drill).toEqual({ kind: 'unavailable' })
  })

  it('(+) drill-down rows without an ordinal show the items read only', () => {
    expect(memoryDeliveryView(delivery(), { calls: null, reads: 4, limit: 3 })?.drill).toEqual({ kind: 'reads', reads: 4, limit: 3 })
  })

  it('(−) no delivery record: no row', () => {
    expect(memoryDeliveryView(null, drill)).toBeNull()
    expect(memoryDeliveryView(undefined, null)).toBeNull()
  })

  it('(−) a channel-only record (no assembler ran) shows the channel and nothing it does not know', () => {
    const view = memoryDeliveryView(delivery({ profile: null, budgetTotalTokens: null, recall: null, systemPromptChannel: 'prompt' }), null, 'grok-4')
    expect(view).toEqual({ window: null, recall: null, drill: null, channelKey: 'conversations.compositionPanel.memory.channel.prompt' })
  })

  it('(−) an unreadable drill-down count leaves the drill line out rather than showing zero', () => {
    expect(memoryDeliveryView(delivery(), null)?.drill).toBeNull()
  })

  it('every key the row can use exists in the English bundle', () => {
    const keys = [
      'heading', 'summary', 'none', 'withheld', 'window', 'windowUnknown', 'drillDown', 'drillDownReads',
      'drillUnavailable', 'promptChannel',
      'withheldReason.external', 'withheldReason.noBudget', 'withheldReason.unavailable', 'withheldReason.failed',
      'channel.metaVerified', 'channel.metaUnverified', 'channel.prompt',
    ].map((k) => `conversations.compositionPanel.memory.${k}`)
    for (const key of keys) expect((en as Record<string, string>)[key], key).toBeTruthy()
  })
})
