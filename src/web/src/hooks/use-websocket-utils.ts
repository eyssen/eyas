// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { WS_SUBSCRIBE_DENIED_EVENT } from '@/lib/ws-topics'

/** A frame as it arrives on the wire from the server WS registry. */
export interface WSFrame {
  event: string
  data: unknown
  /** Topic the frame was published on — absent on broadcastToUser/legacy frames. */
  topic?: string
}

export type WSMessageHandler = (frame: WSFrame) => void

/**
 * Route one incoming frame to the handlers that asked for it.
 *
 * `broadcast()` frames carry their topic, so they reach only the handlers
 * subscribed to that topic. Frames without a topic (broadcastToUser, older
 * servers) keep the historical fan-out to every handler.
 */
export function dispatchFrame(
  handlers: Map<string, Set<WSMessageHandler>>,
  frame: WSFrame,
): void {
  if (typeof frame.topic === 'string') {
    const topicHandlers = handlers.get(frame.topic)
    if (!topicHandlers) return
    for (const handler of topicHandlers) handler(frame)
    return
  }

  for (const topicHandlers of handlers.values()) {
    for (const handler of topicHandlers) handler(frame)
  }
}

/**
 * D14 — the server denied a subscribe (the topic ACL rejected it). The
 * protocol has no other ACK/NACK, so without this the reconnect logic in
 * use-websocket.ts — which resubscribes every key still in `handlers` — would
 * retry the same denied topic forever. Drops the topic from `handlers`
 * entirely, same as if every consumer had unsubscribed, so it is silently
 * skipped on the next reconnect.
 *
 * Returns whether `frame` WAS a denial, so the caller can skip
 * `dispatchFrame` for it — a NACK carries no `topic` sibling field, so
 * `dispatchFrame` would otherwise fan it out to every handler as an untagged
 * frame.
 */
export function handleSubscribeDenied(
  handlers: Map<string, Set<WSMessageHandler>>,
  frame: WSFrame,
): boolean {
  if (frame.event !== WS_SUBSCRIBE_DENIED_EVENT) return false
  const topic = (frame.data as { topic?: unknown } | null)?.topic
  if (typeof topic === 'string') handlers.delete(topic)
  return true
}
