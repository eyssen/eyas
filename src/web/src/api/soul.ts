// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { api } from '@/lib/api'
import type { SoulStyleParsed } from '@shared/prompt-wizard/soul-style-schema'

export async function loadSoulStyle(agentId: string): Promise<SoulStyleParsed | null> {
  try {
    const result = await api.get<SoulStyleParsed>(`/agents/${agentId}/soul-style`)
    return result
  } catch {
    return null
  }
}

export async function saveSoulStyle(agentId: string, style: SoulStyleParsed): Promise<void> {
  await api.put(`/agents/${agentId}/soul-style`, style)
}
