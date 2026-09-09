// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useState } from 'react'

export type AgentAction = 'interrupt' | 'pause' | 'resume'

export interface UseAgentActionsResult {
  pending: Record<string, AgentAction | null>
  run(sessionId: string, action: AgentAction): Promise<boolean>
  error: string | null
}

/**
 * Thin wrapper around the three POST endpoints. Tracks in-flight action
 * per session so UI can disable buttons while the request is pending.
 */
export function useAgentActions(
  baseUrl = '/api/v1/mission-control/agents',
): UseAgentActionsResult {
  const [pending, setPending] = useState<Record<string, AgentAction | null>>({})
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (sessionId: string, action: AgentAction): Promise<boolean> => {
      setPending((prev) => ({ ...prev, [sessionId]: action }))
      setError(null)
      try {
        const resp = await fetch(`${baseUrl}/${encodeURIComponent(sessionId)}/${action}`, {
          method: 'POST',
          credentials: 'include',
        })
        if (!resp.ok) {
          const body = await resp.text().catch(() => '')
          setError(body || `${resp.status} ${resp.statusText}`)
          return false
        }
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return false
      } finally {
        setPending((prev) => {
          const next = { ...prev }
          next[sessionId] = null
          return next
        })
      }
    },
    [baseUrl],
  )

  return { pending, run, error }
}
