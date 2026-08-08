// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { api } from '@/lib/api'

export type VoiceScope = 'internal' | 'external' | null

export async function setVoiceScopeOverride(conversationId: string, scope: VoiceScope): Promise<void> {
  await api.put(`/conversations/${conversationId}/voice-scope`, { scope })
}
