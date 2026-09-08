// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import {
  resolveWithOverrides,
  createEphemeralOverrideStore,
  type OverrideInputs,
} from '../../../src/modules/communication/voice-scope-overrides.js'

function inputs(overrides: Partial<OverrideInputs> = {}): OverrideInputs {
  return {
    perMessage: null,
    ephemeralSession: null,
    perConversation: null,
    perChannel: null,
    autoResolved: 'internal',
    ...overrides,
  }
}

describe('resolveWithOverrides — priority chain', () => {
  it('per-message wins over everything', () => {
    const r = resolveWithOverrides(inputs({
      perMessage: 'external',
      ephemeralSession: 'internal',
      perConversation: 'internal',
      perChannel: 'internal',
      autoResolved: 'internal',
    }))
    expect(r).toEqual({ scope: 'external', source: 'per-message' })
  })

  it('ephemeral-session wins when no per-message', () => {
    const r = resolveWithOverrides(inputs({
      ephemeralSession: 'external',
      perConversation: 'internal',
      perChannel: 'internal',
      autoResolved: 'internal',
    }))
    expect(r).toEqual({ scope: 'external', source: 'ephemeral-session' })
  })

  it('per-conversation wins when no per-message or ephemeral', () => {
    const r = resolveWithOverrides(inputs({
      perConversation: 'external',
      perChannel: 'internal',
      autoResolved: 'internal',
    }))
    expect(r).toEqual({ scope: 'external', source: 'per-conversation' })
  })

  it('per-channel wins when no higher overrides', () => {
    const r = resolveWithOverrides(inputs({
      perChannel: 'external',
      autoResolved: 'internal',
    }))
    expect(r).toEqual({ scope: 'external', source: 'per-channel' })
  })

  it('falls back to autoResolved when nothing overrides', () => {
    const r = resolveWithOverrides(inputs({ autoResolved: 'internal' }))
    expect(r).toEqual({ scope: 'internal', source: 'auto' })
  })
})

describe('createEphemeralOverrideStore', () => {
  it('set then get returns the scope', () => {
    const store = createEphemeralOverrideStore()
    store.set('c1', 'external')
    expect(store.get('c1')).toBe('external')
  })

  it('expired entries return null and self-evict', () => {
    let nowMs = 1_000_000
    const store = createEphemeralOverrideStore(() => nowMs)
    store.set('c1', 'external', 1)  // 1 minute TTL
    expect(store.get('c1')).toBe('external')
    nowMs += 61_000  // advance past TTL
    expect(store.get('c1')).toBeNull()
    // Subsequent get also null (entry was evicted)
    expect(store.get('c1')).toBeNull()
  })

  it('clear removes the entry', () => {
    const store = createEphemeralOverrideStore()
    store.set('c1', 'internal')
    store.clear('c1')
    expect(store.get('c1')).toBeNull()
  })

  it('default TTL is 60 minutes', () => {
    let nowMs = 0
    const store = createEphemeralOverrideStore(() => nowMs)
    store.set('c1', 'external')  // no ttlMinutes → default 60
    nowMs = 59 * 60_000          // 59 minutes — still active
    expect(store.get('c1')).toBe('external')
    nowMs = 61 * 60_000          // 61 minutes — expired
    expect(store.get('c1')).toBeNull()
  })
})
