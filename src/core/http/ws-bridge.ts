/**
 * Bus event → WebSocket topic bridge.
 *
 * Maps internal bus events to WS topics so frontend clients receive real-time
 * updates via topic subscriptions. Topics come from the shared WS_TOPICS
 * catalogue — the frontend subscribes through the same module, so a renamed
 * topic can never silently strand a producer.
 *
 * Three rules the mappings depend on:
 *  - `local-bus` invokes a `<prefix>.*` handler with the CONCRETE emitted
 *    subject as the second argument; frames carry that, not the wildcard, so
 *    clients can switch on the real event name.
 *  - `resolveTopic` returns null when the payload lacks the id the topic is
 *    keyed on. Skipping beats broadcasting to a `board:undefined` topic that
 *    nobody can meaningfully subscribe to.
 *  - `project` narrows the payload before it leaves the process. Topic
 *    subscription is authenticated but NOT permission-scoped, and `agent-runs`
 *    is global, so any bus payload with free text in it (an exception message,
 *    a rendered sentence) would otherwise be readable by every logged-in user.
 */

import type { EyasBus } from '@core/types'
import { WS_TOPICS } from '@shared/ws-topics.js'
import type { WSConnectionRegistry } from './websocket.js'

interface BridgeMapping {
  subject: string
  /** Topic for this frame, or null to skip the broadcast. */
  resolveTopic: (data: any) => string | null
  /** Narrow the payload before broadcasting. Omitted = forward `data` verbatim. */
  project?: (data: any) => unknown
}

/**
 * Allow-list projection. Deliberately an allow-list, not a deny-list: a field
 * added to a bus payload later is dropped from the frame by DEFAULT, so a new
 * emit cannot quietly widen what the socket exposes.
 */
function pick(data: any, keys: readonly string[]): Record<string, unknown> {
  const thin: Record<string, unknown> = {}
  if (!data || typeof data !== 'object') return thin
  for (const key of keys) {
    if (data[key] !== undefined) thin[key] = data[key]
  }
  return thin
}

/**
 * Ids + enums + counters only. Notably NOT `error`: run.failed carries raw
 * provider/SQL/filesystem exception text from someone else's run, and the
 * concrete subject (`eyas.agent.run.failed`) already tells the client what
 * happened. The full payload stays on the bus for in-process listeners; the
 * detail crosses the CASL-guarded REST routes.
 */
const RUN_FRAME_KEYS = ['runId', 'agentId', 'conversationId', 'kind', 'seq', 'stalledMs', 'recovered'] as const

/** Same reasoning: the alert's rendered `message` embeds the agent name. */
const BUDGET_FRAME_KEYS = ['agentId', 'level', 'percentage'] as const

const BRIDGE_MAPPINGS: BridgeMapping[] = [
  {
    subject: 'eyas.board.*',
    resolveTopic: (data) => (data?.projectId ? WS_TOPICS.board(String(data.projectId)) : null),
  },
  {
    subject: 'eyas.notify',
    resolveTopic: (data) => (data?.userId ? WS_TOPICS.notifications(String(data.userId)) : null),
  },
  // Run lifecycle fans out twice: the list-level topic behind the Agent Runs
  // page, and the per-agent topic behind the agent detail page. The supervisor
  // keys its payloads on runId/agentId — resolving `agent:${sessionId}` (as an
  // earlier mapping did) produced `agent:undefined` for every frame.
  {
    subject: 'eyas.agent.run.*',
    resolveTopic: () => WS_TOPICS.agentRuns,
    project: (data) => pick(data, RUN_FRAME_KEYS),
  },
  {
    subject: 'eyas.agent.run.*',
    resolveTopic: (data) => (data?.agentId ? WS_TOPICS.agent(String(data.agentId)) : null),
    project: (data) => pick(data, RUN_FRAME_KEYS),
  },
  {
    subject: 'eyas.agent.budget.*',
    resolveTopic: (data) => (data?.agentId ? WS_TOPICS.agent(String(data.agentId)) : null),
    project: (data) => pick(data, BUDGET_FRAME_KEYS),
  },
  {
    subject: 'eyas.conversation.*',
    resolveTopic: (data) => (data?.conversationId ? WS_TOPICS.chat(String(data.conversationId)) : null),
  },
  // The conversations module emits on the PLURAL namespace (stage_changed,
  // closed); it is a separate prefix as far as the bus is concerned, so it
  // needs its own mapping rather than relying on the singular one above.
  {
    subject: 'eyas.conversations.*',
    resolveTopic: (data) => (data?.conversationId ? WS_TOPICS.chat(String(data.conversationId)) : null),
  },
  {
    subject: 'eyas.module.*',
    resolveTopic: () => WS_TOPICS.system,
  },
  {
    subject: 'eyas.budget.*',
    resolveTopic: () => WS_TOPICS.system,
  },
  {
    subject: 'eyas.communication.*',
    resolveTopic: () => WS_TOPICS.system,
  },
]

export function createWSBridge(bus: EyasBus, registry: WSConnectionRegistry) {
  const subs = BRIDGE_MAPPINGS.map((mapping) =>
    bus.on(mapping.subject, async (data, emittedSubject) => {
      const topic = mapping.resolveTopic(data)
      if (!topic) return
      registry.broadcast(topic, {
        event: emittedSubject ?? mapping.subject,
        data: mapping.project ? mapping.project(data) : data,
      })
    })
  )

  return {
    /** Unsubscribe all bridge listeners (for shutdown) */
    destroy() {
      for (const sub of subs) {
        sub.unsubscribe()
      }
    },
  }
}
