// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { VoiceScope } from './channel-resolver.js'

export interface OverrideInputs {
  perMessage: VoiceScope | null
  ephemeralSession: VoiceScope | null
  perConversation: VoiceScope | null
  perChannel: VoiceScope | null
  autoResolved: VoiceScope
}

export interface ResolveOverrideResult {
  scope: VoiceScope
  source: 'per-message' | 'ephemeral-session' | 'per-conversation' | 'per-channel' | 'auto'
}

export function resolveWithOverrides(inputs: OverrideInputs): ResolveOverrideResult {
  if (inputs.perMessage) return { scope: inputs.perMessage, source: 'per-message' }
  if (inputs.ephemeralSession) return { scope: inputs.ephemeralSession, source: 'ephemeral-session' }
  if (inputs.perConversation) return { scope: inputs.perConversation, source: 'per-conversation' }
  if (inputs.perChannel) return { scope: inputs.perChannel, source: 'per-channel' }
  return { scope: inputs.autoResolved, source: 'auto' }
}

export interface EphemeralOverrideStore {
  get(conversationId: string): VoiceScope | null
  set(conversationId: string, scope: VoiceScope, ttlMinutes?: number): void
  clear(conversationId: string): void
}

export function createEphemeralOverrideStore(now: () => number = () => Date.now()): EphemeralOverrideStore {
  const data = new Map<string, { scope: VoiceScope; expiresAt: number }>()
  return {
    get(id) {
      const r = data.get(id)
      if (!r) return null
      if (r.expiresAt < now()) { data.delete(id); return null }
      return r.scope
    },
    set(id, scope, ttlMinutes = 60) {
      data.set(id, { scope, expiresAt: now() + ttlMinutes * 60_000 })
    },
    clear(id) { data.delete(id) },
  }
}
