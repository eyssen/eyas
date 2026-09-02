// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { WSConnectionRegistry } from '@core/http/websocket.js'
import { WS_TOPICS } from '@shared/ws-topics.js'
import type { NotificationChannel, NotificationPayload } from '../router.js'

/**
 * WebSocket push channel — broadcasts notifications to connected clients
 * subscribed to the per-user notifications topic.
 */
export function createWebChannel(wsRegistry: WSConnectionRegistry): NotificationChannel {
  return {
    id: 'web',

    async send(userId: string, payload: NotificationPayload): Promise<boolean> {
      const connections = wsRegistry.getConnections(userId)
      if (connections.length === 0) return false

      wsRegistry.broadcast(WS_TOPICS.notifications(userId), {
        event: 'notification',
        data: {
          id: payload.id,
          event: payload.event,
          severity: payload.severity,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          createdAt: payload.createdAt,
        },
      })

      return true
    },
  }
}
