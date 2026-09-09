// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { HookEvent, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'

export interface OrchestrationHooksDeps {
  /** The run this Claude session belongs to (team session id, or the conversation id). */
  runId: string
  /** Node this SDK session's activity nests under (`conv:<conversationId>`), null when unknown. */
  parentNodeId: string | null
  /** Sink for normalized events — wired to the orchestration sink in the manifest. */
  emit(event: OrchestrationEvent): void
  /** Monotonic per-run sequence counter (createRunSeq). */
  seq(): number
}

/**
 * Translates Claude Agent SDK lifecycle hooks into normalized
 * OrchestrationEvents, so Claude-driven subagents render in the SAME `<RunTree>`
 * the EYAS engine feeds. Subagent nodes are keyed `sub:<agent_id>` and nest
 * under `parentNodeId`.
 *
 * Attribution: BaseHookInput carries `agent_id` whenever a hook fires from
 * within a subagent, so every tool event is attributed exactly — parallel Task
 * fan-out included. Main-thread tools (no agent_id) land on the parent node.
 */
export function buildOrchestrationHooks(
  deps: OrchestrationHooksDeps,
): { hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> } {
  const { runId, parentNodeId, emit, seq } = deps

  const matcher = (fn: (input: any) => void): HookCallbackMatcher => ({
    hooks: [
      async (input: any) => {
        try {
          fn(input)
        } catch {
          /* observers must never break the SDK loop */
        }
        return { continue: true }
      },
    ],
  })

  /** Where a tool event belongs: the emitting subagent, else the main-thread node. */
  const toolNode = (input: any): { nodeId: string; parentId: string | null } | null => {
    if (input.agent_id) return { nodeId: `sub:${input.agent_id}`, parentId: parentNodeId }
    return parentNodeId ? { nodeId: parentNodeId, parentId: null } : null
  }

  const toolName = (input: any): string => String(input.tool_name ?? '').replace(/^mcp__eyas__/, '')

  const toolResult = (status: 'success' | 'error') =>
    matcher((input) => {
      const node = toolNode(input)
      if (!node) return
      emit({
        runId,
        ...node,
        seq: seq(),
        payload: { type: 'tool_result', toolId: input.tool_use_id, status },
      })
    })

  return {
    hooks: {
      SubagentStart: [
        matcher((input) => {
          emit({
            runId,
            nodeId: `sub:${input.agent_id}`,
            parentId: parentNodeId,
            seq: seq(),
            payload: { type: 'node_started', kind: 'subagent', label: input.agent_type, agentId: input.agent_type },
          })
        }),
      ],
      SubagentStop: [
        matcher((input) => {
          const summary: string | undefined = input.last_assistant_message ?? input.lastMessage ?? undefined
          emit({
            runId,
            nodeId: `sub:${input.agent_id}`,
            parentId: parentNodeId,
            seq: seq(),
            payload: { type: 'node_completed', status: 'completed', summary },
          })
        }),
      ],
      PreToolUse: [
        matcher((input) => {
          const node = toolNode(input)
          if (!node) return
          emit({
            runId,
            ...node,
            seq: seq(),
            payload: { type: 'tool_started', toolId: input.tool_use_id, name: toolName(input) },
          })
        }),
      ],
      PostToolUse: [toolResult('success')],
      PostToolUseFailure: [toolResult('error')],
    },
  }
}
