// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { WorkspaceLoader } from '../prompt-wizard/workspace-loader.js'
import type { VoiceProfile, VoiceScope } from '../prompt-wizard/types.js'
import { soulStyleSchema } from '../prompt-wizard/soul-style-schema.js'
import { resolveScope, type ChannelContext } from './channel-resolver.js'
import { resolveWithOverrides, type EphemeralOverrideStore } from './voice-scope-overrides.js'

export interface ActiveVoiceResolverDeps {
  workspaceLoader: WorkspaceLoader
  ephemeralStore: EphemeralOverrideStore
  loadConversationOverride: (conversationId: string) => Promise<VoiceScope | null>
  loadChannelForceScope: (channelId: string) => Promise<VoiceScope | null>
}

export interface ResolveActiveVoiceInput {
  agentId: string
  conversationId: string | null
  channelId: string | null
  channelContext: ChannelContext
  perMessageOverride?: VoiceScope | null
}

export interface ActiveVoiceResult {
  scope: VoiceScope
  reason: string
  source: 'per-message' | 'ephemeral-session' | 'per-conversation' | 'per-channel' | 'auto'
  profile: VoiceProfile
}

export function createActiveVoiceResolver(deps: ActiveVoiceResolverDeps) {
  return async function resolveActiveVoice(input: ResolveActiveVoiceInput): Promise<ActiveVoiceResult> {
    const auto = resolveScope(input.channelContext)
    const perConv = input.conversationId ? await deps.loadConversationOverride(input.conversationId) : null
    const perCh = input.channelId ? await deps.loadChannelForceScope(input.channelId) : null
    const ephemeral = input.conversationId ? deps.ephemeralStore.get(input.conversationId) : null

    const decision = resolveWithOverrides({
      perMessage: input.perMessageOverride ?? null,
      ephemeralSession: ephemeral,
      perConversation: perConv,
      perChannel: perCh,
      autoResolved: auto.scope,
    })

    const ws = await deps.workspaceLoader.load(input.agentId)
    if (!ws.soulStyleJson.exists) {
      throw new Error(`agent ${input.agentId} has no SOUL.style.json`)
    }
    const style = soulStyleSchema.parse(JSON.parse(ws.soulStyleJson.body))
    const profile = style[decision.scope]

    return {
      scope: decision.scope,
      reason: decision.source === 'auto' ? auto.reason : `override (${decision.source})`,
      source: decision.source,
      profile,
    }
  }
}
