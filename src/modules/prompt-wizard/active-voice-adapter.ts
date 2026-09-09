// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/active-voice-adapter.ts
//
// Adapts the communication module's active-voice resolver to the assembler's
// resolveActiveVoice dep. Two things make this its own file: it must be
// unit-testable, and it must be FAIL-SOFT. buildForPrimary awaits every
// resolver inside a single Promise.all, so a resolver that throws takes the
// whole prompt with it — the interactive path's catch then sends system: ''.
// A missing SOUL.style.json must cost the caller its voice profile, nothing
// more.

import type { VoiceProfile, VoiceScope } from './types.js'

export type ActiveVoiceFn = (input: {
  agentId: string
  conversationId: string | null
  channelId: string | null
  channelContext: unknown
}) => Promise<{ scope: VoiceScope; reason: string; profile: VoiceProfile }>

export interface AdapterLogger {
  warn?: (obj: unknown, msg: string) => void
}

/** Neutral profile used whenever a real one cannot be resolved. */
export const FALLBACK_VOICE_PROFILE: VoiceProfile = {
  address: 'tegező',
  tone: 'kiegyensúlyozott',
  verbosity: 'lényegre törő',
  directness: 'direkt + udvarias',
  humor: 'nincs',
  emoji: 'soha',
  blockedPhrases: [],
  signature: '',
}

const FALLBACK_CHANNEL_CONTEXT = {
  channelType: 'web',
  conversationKind: 'owner-dm' as const,
  participants: [{ id: 'owner', type: 'owner' as const }],
  origin: 'inbound' as const,
}

export function createActiveVoiceAdapter(
  getResolver: () => ActiveVoiceFn | undefined,
  logger?: AdapterLogger,
) {
  return async function resolveActiveVoice(params: {
    agentId: string
    channelContext: unknown
    conversationId: string | null
  }): Promise<{ scope: VoiceScope; reason: string; profile: VoiceProfile }> {
    const activeVoice = getResolver()
    if (!activeVoice) {
      // communication module has not started yet — prompt-wizard boots first.
      return {
        scope: 'internal',
        reason: 'fallback (communication module not ready)',
        profile: FALLBACK_VOICE_PROFILE,
      }
    }
    try {
      const result = await activeVoice({
        agentId: params.agentId,
        conversationId: params.conversationId,
        channelId: null,
        channelContext: params.channelContext ?? FALLBACK_CHANNEL_CONTEXT,
      })
      return { scope: result.scope, reason: result.reason, profile: result.profile }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger?.warn?.({ err, agentId: params.agentId }, 'Active voice resolution failed; using fallback profile')
      return {
        scope: 'internal',
        reason: `fallback (${message})`,
        profile: FALLBACK_VOICE_PROFILE,
      }
    }
  }
}
