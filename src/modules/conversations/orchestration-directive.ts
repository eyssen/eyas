// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * System-prompt directive injected for deep orchestration mode. The mechanism
 * differs per provider: claude-code runs its own native subagents (Task tool,
 * governed via canUseTool and rendered in the run tree), every other provider
 * goes through the EYAS engine (propose_team / delegate_to_agent tools).
 * Solo/auto add nothing — auto leaves the decision entirely to the model.
 */
export function buildOrchestrationDirective(
  mode: string | null | undefined,
  providerId: string | null | undefined,
): string {
  if (mode !== 'deep') return ''
  if (providerId === 'claude-code') {
    return [
      'Deep orchestration mode is ON for this conversation.',
      'Decompose non-trivial work and fan out aggressively with the Task tool: run independent subtasks as parallel subagents, give each a precise, self-contained brief, and pick the most suitable agent type from the available roster.',
      'Verify important results with an independent subagent before presenting conclusions. Keep the final synthesis yourself.',
    ].join(' ')
  }
  return [
    'Deep orchestration mode is ON for this conversation.',
    'For non-trivial work, decompose the task and use propose_team to assemble a team of specialist agents (or delegate_to_agent for a single well-scoped subtask) instead of doing everything inline.',
    'Verify important results before presenting conclusions.',
  ].join(' ')
}
