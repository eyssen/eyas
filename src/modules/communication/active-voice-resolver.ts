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

/** What the scope decision needs: the override stores, not the agent's voice files. */
export type VoiceScopeResolverDeps = Pick<ActiveVoiceResolverDeps, 'ephemeralStore' | 'loadConversationOverride' | 'loadChannelForceScope'>

export type ResolveVoiceScopeInput = Omit<ResolveActiveVoiceInput, 'agentId'>

export type VoiceScopeDecision = Omit<ActiveVoiceResult, 'profile'>

/**
 * The scope half of the active voice: per-message, ephemeral, per-conversation
 * and per-channel overrides over the scope the channel context resolves to.
 * It needs no SOUL.style.json, so a caller that only has to know WHO the answer
 * is for (a channel reply deciding whether owner memory may be recalled) gets
 * the same answer the voice uses without depending on the agent's style file.
 */
export function createVoiceScopeResolver(deps: VoiceScopeResolverDeps) {
  return async function resolveVoiceScope(input: ResolveVoiceScopeInput): Promise<VoiceScopeDecision> {
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

    return {
      scope: decision.scope,
      reason: decision.source === 'auto' ? auto.reason : `override (${decision.source})`,
      source: decision.source,
    }
  }
}

export function createActiveVoiceResolver(deps: ActiveVoiceResolverDeps) {
  const resolveVoiceScope = createVoiceScopeResolver(deps)
  return async function resolveActiveVoice(input: ResolveActiveVoiceInput): Promise<ActiveVoiceResult> {
    const decision = await resolveVoiceScope(input)

    const ws = await deps.workspaceLoader.load(input.agentId)
    if (!ws.soulStyleJson.exists) {
      throw new Error(`agent ${input.agentId} has no SOUL.style.json`)
    }
    const style = soulStyleSchema.parse(JSON.parse(ws.soulStyleJson.body))
    const profile = style[decision.scope]

    return { ...decision, profile }
  }
}
