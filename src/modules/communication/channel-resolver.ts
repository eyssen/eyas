// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { VoiceScope } from '../prompt-wizard/types.js'
export type { VoiceScope }

export type ParticipantType = 'owner' | 'team-member' | 'known-contact' | 'unknown-external'

export interface ParticipantInfo {
  id: string
  type: ParticipantType
}

export interface ChannelContext {
  channelType: string
  conversationKind: 'owner-dm' | 'group' | 'public-channel' | 'broadcast'
  participants: ParticipantInfo[]
  origin: 'inbound' | 'outbound-proactive'
}

export interface ResolveScopeResult {
  scope: VoiceScope
  reason: string
}

export function resolveScope(ctx: ChannelContext): ResolveScopeResult {
  if (ctx.participants.length === 1 && ctx.participants[0].type === 'owner') {
    return { scope: 'internal', reason: 'owner DM' }
  }
  if (ctx.participants.every((p) => p.type === 'owner' || p.type === 'team-member')) {
    return { scope: 'internal', reason: 'owner + team-members only' }
  }
  const externals = ctx.participants.filter((p) => p.type === 'known-contact' || p.type === 'unknown-external').length
  return {
    scope: 'external',
    reason: `${ctx.conversationKind} with ${externals} external participant(s)`,
  }
}
