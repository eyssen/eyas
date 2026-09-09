// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { ParentSnapshot, VoiceProfile, VoiceScope } from '../prompt-wizard/types.js'
import type { SoulStyleParsed } from '../prompt-wizard/soul-style-schema.js'

export interface BuildParentSnapshotInput {
  originatingAgentId: string
  originatingAgentName: string
  originatingSoulStyle: SoulStyleParsed
  outputAudience: 'parent' | 'external'
}

export function buildParentSnapshot(input: BuildParentSnapshotInput): ParentSnapshot {
  const scope: VoiceScope = input.outputAudience === 'parent' ? 'internal' : 'external'
  const profile: VoiceProfile = input.originatingSoulStyle[scope]
  return {
    agentId: input.originatingAgentId,
    name: input.originatingAgentName,
    voiceProfile: profile,
    voiceProfileSource: scope,
    blockedPhrases: profile.blockedPhrases,
    signature: profile.signature,
    originatingAgentId: input.originatingAgentId,
  }
}
