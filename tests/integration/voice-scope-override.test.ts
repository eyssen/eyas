// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 51a — Voice scope override priority hierarchy test.
// Verifies the 5-level priority: per-message > ephemeral > per-conversation > per-channel > auto.

import { describe, it, expect } from 'vitest'
import { resolveWithOverrides, createEphemeralOverrideStore } from '@modules/communication/voice-scope-overrides.js'
import { resolveScope } from '@modules/communication/channel-resolver.js'
import type { ChannelContext } from '@modules/communication/channel-resolver.js'

describe('voice scope priority hierarchy', () => {
  it('auto: owner DM resolves to internal', () => {
    const ctx: ChannelContext = {
      channelType: 'telegram',
      conversationKind: 'owner-dm',
      participants: [{ id: 'owner-1', type: 'owner' }],
      origin: 'inbound',
    }
    const result = resolveScope(ctx)
    expect(result.scope).toBe('internal')
    expect(result.reason).toBe('owner DM')
  })

  it('auto: conversation with external participant resolves to external', () => {
    const ctx: ChannelContext = {
      channelType: 'email',
      conversationKind: 'group',
      participants: [
        { id: 'owner-1', type: 'owner' },
        { id: 'ext-1', type: 'unknown-external' },
      ],
      origin: 'inbound',
    }
    const result = resolveScope(ctx)
    expect(result.scope).toBe('external')
  })

  it('per-channel overrides auto', () => {
    const result = resolveWithOverrides({
      perMessage: null,
      ephemeralSession: null,
      perConversation: null,
      perChannel: 'external',
      autoResolved: 'internal',
    })
    expect(result.scope).toBe('external')
    expect(result.source).toBe('per-channel')
  })

  it('per-conversation overrides per-channel', () => {
    const result = resolveWithOverrides({
      perMessage: null,
      ephemeralSession: null,
      perConversation: 'external',
      perChannel: 'internal',
      autoResolved: 'internal',
    })
    expect(result.scope).toBe('external')
    expect(result.source).toBe('per-conversation')
  })

  it('ephemeral-session overrides per-conversation', () => {
    const result = resolveWithOverrides({
      perMessage: null,
      ephemeralSession: 'internal',
      perConversation: 'external',
      perChannel: 'external',
      autoResolved: 'external',
    })
    expect(result.scope).toBe('internal')
    expect(result.source).toBe('ephemeral-session')
  })

  it('per-message overrides everything (highest priority)', () => {
    const result = resolveWithOverrides({
      perMessage: 'external',
      ephemeralSession: 'internal',
      perConversation: 'internal',
      perChannel: 'internal',
      autoResolved: 'internal',
    })
    expect(result.scope).toBe('external')
    expect(result.source).toBe('per-message')
  })

  it('ephemeral store expires entries after TTL', () => {
    let now = 0
    const store = createEphemeralOverrideStore(() => now)
    store.set('conv-1', 'external', 1)  // 1 minute TTL

    now = 30 * 1000  // 30 seconds — still valid
    expect(store.get('conv-1')).toBe('external')

    now = 61 * 1000  // 61 seconds — expired
    expect(store.get('conv-1')).toBeNull()
  })

  it('all-null inputs fall back to auto', () => {
    const result = resolveWithOverrides({
      perMessage: null,
      ephemeralSession: null,
      perConversation: null,
      perChannel: null,
      autoResolved: 'internal',
    })
    expect(result.scope).toBe('internal')
    expect(result.source).toBe('auto')
  })
})
