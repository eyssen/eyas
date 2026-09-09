// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Tools whose slow work is a child agent run — safe and useful to overlap. */
export const PARALLEL_ROUTING_TOOLS = new Set(['run_specialist', 'delegate_to_agent'])

export function isParallelRoutingTool(name: string): boolean {
  return PARALLEL_ROUTING_TOOLS.has(name)
}

/**
 * When a turn contains two or more routing tools, run those first (the
 * agent-runner then Promise.all's their execute()) and keep the rest in
 * original relative order afterwards.
 */
export function orderToolUsesForTurn<T extends { name: string }>(blocks: readonly T[]): T[] {
  const routing = blocks.filter((b) => isParallelRoutingTool(b.name))
  if (routing.length < 2) return [...blocks]
  const rest = blocks.filter((b) => !isParallelRoutingTool(b.name))
  return [...routing, ...rest]
}

export const WRITER_TOOLS = new Set(['write_file', 'edit_file', 'run_command'])

export function agentHasWriterTools(tools: readonly string[] | undefined): boolean {
  if (!tools) return false
  return tools.some((t) => WRITER_TOOLS.has(t))
}
