// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AgentRunnerPort, AgentRunInput, AgentRunOutput } from '../port-types.js'

function tryParseJson(text: string): unknown | undefined {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : text).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    return undefined
  }
}

/**
 * AgentRunnerPort backed by the high-level `ctx.agents.executeAgent`
 * (src/modules/agent/index.ts). We deliberately use this high-level
 * entrypoint rather than draining the low-level runner generator — it
 * already handles agent lookup, model/provider resolution, tool wiring,
 * conversation persistence, and (F2 T4) supervision — and honors the
 * agent's own config and the security-gate. `modelOverride`/token counts
 * are not surfaced by `executeAgent`, so `tokensIn`/`tokensOut` are left
 * undefined.
 *
 * F2 T4 — `executeAgent` now returns an honest `{ text, status, sessionId }`
 * result instead of a bare string that always read as success. A stage must
 * no longer succeed on a run that didn't complete, so both `status: 'failed'`
 * and `status: 'max_turns'` are turned into a throw here — the pipeline
 * orchestrator's existing per-stage try/catch (ticket-to-code/orchestrator.ts)
 * already marks the stage 'failed' and stops the run on any thrown error, so
 * this is the mechanism that keeps that failure handling intact without the
 * orchestrator needing to know about the richer result shape.
 *
 * Fix round 1 / Important 4 (controller ruling) — a max_turns result is
 * truncated mid-work by construction: the next stage would otherwise consume
 * it as a completed artifact (tryParseJson → undefined → the stage proceeds
 * blind on garbage). The thrown message stays distinguishable from a hard
 * 'failed' so the operator can see WHY the stage stopped.
 */
export function createAgentRunnerPort(deps: {
  executeAgent(
    conversationId: string,
    agentId: string,
    task: string,
    opts?: { origin?: 'pipeline' | 'delegation' },
  ): Promise<{ text: string; status: 'completed' | 'failed' | 'max_turns' | 'parked'; sessionId: string; approvalId?: number }>
  newConversationId?: () => string
}): AgentRunnerPort {
  return {
    async run(input: AgentRunInput): Promise<AgentRunOutput> {
      const conversationId =
        input.sessionId ?? (deps.newConversationId ? deps.newConversationId() : `pipeline-${input.agentId}`)
      const task = input.context
        ? `${input.instructions}\n\nContext:\n${JSON.stringify(input.context, null, 2)}`
        : input.instructions
      // F0 R4 — the pipeline is an unattended, background-triggered run.
      const outcome = await deps.executeAgent(conversationId, input.agentId, task, { origin: 'pipeline' })
      if (outcome.status === 'failed') {
        throw new Error(
          `Agent run failed for ${input.agentId}${outcome.text ? `: ${outcome.text}` : ' (no output produced)'}`,
        )
      }
      // F2 T5 — a parked run is paused, not finished: its stage must stop with
      // a message that says so, distinctly from a hard failure or a turn-cap
      // truncation, so an operator knows the pipeline is waiting on THEM.
      if (outcome.status === 'parked') {
        throw new Error(
          `Agent run for ${input.agentId} is parked pending approval #${outcome.approvalId ?? '?'} — ` +
            'the stage stopped because an operator decision is required before it can continue',
        )
      }
      if (outcome.status === 'max_turns') {
        throw new Error(
          `Agent run for ${input.agentId} hit its turn limit (max_turns) before finishing` +
            `${outcome.text ? ` — partial output: ${outcome.text}` : ' (no output produced)'}`,
        )
      }
      return { text: outcome.text, json: tryParseJson(outcome.text) }
    },
  }
}
