// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The turn budget of an interactive run: how many model round trips one chat
// turn may take before it stops with the 'max_turns' outcome (a normal
// ending — the partial answer is kept). The agent's own "Max turns" wins;
// without one, every provider gets the same default, and the CLI providers
// use it as their own internal turn cap too. Relative imports only: the web
// imports this file.

/** The default turn budget of a chat turn and of a CLI provider's own loop. */
export const DEFAULT_AGENT_MAX_TURNS = 25

/**
 * The turn budget for a run: the agent's own positive whole-number setting,
 * else the default. Anything else (absent, zero, negative, fractional, not a
 * number) falls back — a broken setting must never end a turn before its
 * first model call.
 */
export function resolveMaxTurns(agentMaxTurns: unknown): number {
  return typeof agentMaxTurns === 'number' && Number.isInteger(agentMaxTurns) && agentMaxTurns >= 1
    ? agentMaxTurns
    : DEFAULT_AGENT_MAX_TURNS
}
