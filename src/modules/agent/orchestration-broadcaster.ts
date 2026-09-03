// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { WSConnectionRegistry } from '@core/http/websocket.js'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'
import { WS_TOPICS } from '@shared/ws-topics.js'

export interface OrchestrationBroadcaster {
  emit(event: OrchestrationEvent): void
  topicFor(runId: string): string
}

/**
 * Broadcasts normalized OrchestrationEvents directly to WS subscribers.
 *
 * These never touch the bus at all — they are a per-run stream normalized from
 * orchestrator generator output, so there is nothing for the bus→WS bridge to
 * map. Direct `registry.broadcast` is the transport (same as notifications).
 */
export function createOrchestrationBroadcaster(
  registry: Pick<WSConnectionRegistry, 'broadcast'>,
): OrchestrationBroadcaster {
  const topicFor = (runId: string) => WS_TOPICS.orchestration(runId)
  return {
    topicFor,
    emit(event) {
      registry.broadcast(topicFor(event.runId), { event: 'orchestration', data: event })
    },
  }
}
