// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { buildParentSnapshot } from '../../../src/modules/agent/parent-snapshot.js'
import type { SoulStyleParsed } from '../../../src/modules/prompt-wizard/soul-style-schema.js'

const fakeSoulStyle: SoulStyleParsed = {
  version: 1,
  preset: { internal: 'jarvis', external: 'diplomata' },
  internal: {
    address: 'tegező',
    tone: 'baráti',
    verbosity: 'lényegre törő',
    directness: 'direkt + udvarias',
    humor: 'száraz/szellemes',
    emoji: 'soha',
    blockedPhrases: ['természetesen', 'minden bizonnyal'],
    signature: 'J.',
  },
  external: {
    address: 'magázó',
    tone: 'kiegyensúlyozott',
    verbosity: 'kiegyensúlyozott',
    directness: 'diplomatikus',
    humor: 'nincs',
    emoji: 'funkcionálisan',
    blockedPhrases: [],
    signature: '',
  },
}

describe('buildParentSnapshot', () => {
  it('picks INTERNAL voice when outputAudience is "parent"', () => {
    const snap = buildParentSnapshot({
      originatingAgentId: 'agent-001',
      originatingAgentName: 'Jarvis',
      originatingSoulStyle: fakeSoulStyle,
      outputAudience: 'parent',
    })

    expect(snap.voiceProfileSource).toBe('internal')
    expect(snap.voiceProfile).toBe(fakeSoulStyle.internal)
    expect(snap.agentId).toBe('agent-001')
    expect(snap.originatingAgentId).toBe('agent-001')
    expect(snap.name).toBe('Jarvis')
    expect(snap.blockedPhrases).toEqual(fakeSoulStyle.internal.blockedPhrases)
    expect(snap.signature).toBe(fakeSoulStyle.internal.signature)
  })

  it('picks EXTERNAL voice when outputAudience is "external"', () => {
    const snap = buildParentSnapshot({
      originatingAgentId: 'agent-001',
      originatingAgentName: 'Jarvis',
      originatingSoulStyle: fakeSoulStyle,
      outputAudience: 'external',
    })

    expect(snap.voiceProfileSource).toBe('external')
    expect(snap.voiceProfile).toBe(fakeSoulStyle.external)
    expect(snap.agentId).toBe('agent-001')
    expect(snap.originatingAgentId).toBe('agent-001')
    expect(snap.name).toBe('Jarvis')
    expect(snap.blockedPhrases).toEqual(fakeSoulStyle.external.blockedPhrases)
    expect(snap.signature).toBe(fakeSoulStyle.external.signature)
  })
})
