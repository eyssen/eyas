// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// How an agent run ended — the agent runner's `done` terminal carries it, and
// every consumer (chat route, conversation runner, orchestrator, executeAgent,
// channel replies) reads it from there instead of re-deriving it. Pure: no
// runner dependency, so a consumer (or a test that fakes the runner) can use
// it on its own.

import type { StopReason } from '@modules/model/types.js'
import type { TurnOutcome } from '@shared/chat-stream.js'

/**
 * How a run that ended on a model answer ended. From the last call's stop
 * reason ('max_turns' also when a CLI's own turn budget ran out), the EYAS
 * loop cap ('max_turns') or the run's tool budget ('tool_budget'). Budget
 * stops are outcomes, never errors: the partial answer and its usage stay.
 * The other endings are their own terminals (cancelled, parked, a throw).
 */
export type RunOutcome = Extract<TurnOutcome, 'completed' | 'max_turns' | 'max_tokens' | 'refusal' | 'tool_budget'>

/** The outcome a provider stop reason ends a run with ('tool_use' never ends one — the loop goes on). */
export function outcomeOfStopReason(stopReason: StopReason): RunOutcome {
  switch (stopReason) {
    case 'max_turns': return 'max_turns'
    case 'max_tokens': return 'max_tokens'
    case 'refusal': return 'refusal'
    default: return 'completed'
  }
}

/**
 * The run-supervisor outcome of a finished run (agent_sessions status): only
 * the turn cap and the tool budget have one; every other ending completes.
 */
export function supervisorOutcomeOf(outcome: RunOutcome | undefined): 'max_turns' | 'tool_budget' | undefined {
  return outcome === 'max_turns' || outcome === 'tool_budget' ? outcome : undefined
}
