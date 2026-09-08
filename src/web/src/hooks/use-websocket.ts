import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { dispatchFrame, handleSubscribeDenied, type WSFrame, type WSMessageHandler } from './use-websocket-utils'

type MessageHandler = WSMessageHandler

const RECONNECT_DELAY = 3000

/**
 * React hook for WebSocket connections with topic-based pub/sub.
 *
 * Auto-connects when the user is authenticated.
 * Fetches a short-lived WS token via the session-authenticated API,
 * then opens a WebSocket connection with that token.
 *
 * Topics always come from the shared WS_TOPICS catalogue — never a hand-written
 * string (tests/contracts/ws-topics.contract.test.ts enforces this).
 *
 * `connected` reflects the live socket. Consumers use it both for a status
 * badge and to re-sync over REST after a reconnect: frames broadcast while the
 * socket was down are gone, so a topic ping alone can't fill the gap.
 *
 * Usage:
 *   const { subscribe, connected } = useWebSocket()
 *   useEffect(() => subscribe(WS_TOPICS.board(projectId), (msg) => { ... }), [])
 */
export function useWebSocket() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map())
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(async () => {
    if (!mountedRef.current) return

    try {
      // Get a short-lived WS token using session cookie auth
      const { token } = await api.post<{ token: string }>('/auth/ws-token')
      if (!mountedRef.current) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`)

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close()
          return
        }
        wsRef.current = ws
        // Re-subscribe to all active topics
        for (const topic of handlersRef.current.keys()) {
          ws.send(JSON.stringify({ type: 'subscribe', topic }))
        }
        setConnected(true)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSFrame
          // D14 — a denied subscribe is dropped from the re-subscribe set
          // (not forwarded to any handler — it carries no topic sibling
          // field, so dispatchFrame would otherwise fan it out to everyone).
          if (handleSubscribeDenied(handlersRef.current, msg)) {
            console.warn('WS subscribe denied:', (msg.data as { topic?: unknown } | null)?.topic)
            return
          }
          dispatchFrame(handlersRef.current, msg)
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        setConnected(false)
        if (mountedRef.current) {
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      // Token fetch failed — retry after delay
      if (mountedRef.current) {
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    if (isAuthenticated) {
      connect()
    }

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setConnected(false)
    }
  }, [isAuthenticated, connect])

  const subscribe = useCallback((topic: string, handler: MessageHandler): (() => void) => {
    if (!handlersRef.current.has(topic)) {
      handlersRef.current.set(topic, new Set())
      // If already connected, subscribe on the server
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'subscribe', topic }))
      }
    }
    handlersRef.current.get(topic)!.add(handler)

    return () => {
      const handlers = handlersRef.current.get(topic)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          handlersRef.current.delete(topic)
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'unsubscribe', topic }))
          }
        }
      }
    }
  }, [])

  return { subscribe, connected }
}
