// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 53.3 — Parametric voice scope test from fixture file.

import { describe, it, expect } from 'vitest'
import { resolveScope } from '@modules/communication/channel-resolver.js'
import type { ChannelContext } from '@modules/communication/channel-resolver.js'
import scenarios from '../fixtures/voice-scenarios.json' with { type: 'json' }

interface Scenario {
  id: string
  description: string
  channelContext: ChannelContext
  expectedScope: 'internal' | 'external'
  expectedReasonContains: string
}

describe('voice scope resolution — fixture scenarios', () => {
  for (const scenario of scenarios as Scenario[]) {
    it(`${scenario.id}: ${scenario.description}`, () => {
      const result = resolveScope(scenario.channelContext)
      expect(result.scope, `scope mismatch for ${scenario.id}`).toBe(scenario.expectedScope)
      expect(result.reason, `reason mismatch for ${scenario.id}`).toContain(scenario.expectedReasonContains)
    })
  }
})
