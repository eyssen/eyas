// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The effort options of one target (E5), from the effort-options endpoints:
//   - { conversationId }        → GET /conversations/:id/effort-options (the
//                                 model its next turn runs on, what Auto means there);
//   - { providerId?, modelId? } → GET /model/effort-options (a model; no model
//                                 → the Auto-routing tier union);
//   - { agentId }               → the colleague's model, then as above.
// `refreshKey` refetches when something the options depend on changed
// without the key itself changing (the conversation's model, Deep, its
// colleague), so a model or Deep change re-renders the select.

import { useEffect, useRef } from 'react'
import { useApi } from '@/hooks/use-api'
import type { ConversationEffortOptions, EffortOptions } from '@/lib/effort-options'

export type EffortOptionsKey =
  | { conversationId: string; refreshKey?: string }
  | { providerId?: string | null; modelId?: string | null; refreshKey?: string }
  | { agentId: string | null | undefined; refreshKey?: string }

/** GET /model/effort-options for a model (a pair or a bare id), or the tier union without one. */
export function modelEffortOptionsPath(providerId?: string | null, modelId?: string | null): string {
  const params = new URLSearchParams()
  if (modelId) {
    if (providerId) params.set('providerId', providerId)
    params.set('modelId', modelId)
  }
  const query = params.toString()
  return `/model/effort-options${query ? `?${query}` : ''}`
}

interface AgentModel {
  agent?: { provider?: string | null; model?: string | null }
}

export function useEffortOptions<T extends EffortOptions = EffortOptions>(key: EffortOptionsKey): {
  options: T | null
  isLoading: boolean
} {
  const conversationId = 'conversationId' in key ? key.conversationId : null
  const agentId = 'agentId' in key ? key.agentId ?? null : null
  const agentQuery = useApi<AgentModel>(agentId ? `/agents/${agentId}` : '')

  let path = ''
  if (conversationId) {
    path = `/conversations/${conversationId}/effort-options`
  } else if ('agentId' in key) {
    // Wait for the colleague's model before asking for its options.
    if (agentId && agentQuery.data) {
      path = modelEffortOptionsPath(agentQuery.data.agent?.provider, agentQuery.data.agent?.model)
    }
  } else if (!('conversationId' in key)) {
    path = modelEffortOptionsPath(key.providerId, key.modelId)
  }

  const { data, isLoading, refetch } = useApi<T>(path)

  // A change the path does not show (model, Deep, colleague) refetches.
  const refreshKey = key.refreshKey ?? ''
  const lastKey = useRef(refreshKey)
  useEffect(() => {
    if (lastKey.current === refreshKey) return
    lastKey.current = refreshKey
    if (path) refetch()
  }, [refreshKey, path, refetch])

  return { options: data, isLoading: isLoading || (!!agentId && agentQuery.isLoading) }
}

export type { ConversationEffortOptions, EffortOptions }
