// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * System-prompt directive injected for deep orchestration mode. One text for
 * every provider: specialists always run through the EYAS engine
 * (run_specialist / handoff_to_colleague / propose_team), so each one gets the
 * EYAS prompt, memory and tool scope and appears as a sub-conversation — no
 * provider fans out with its own native subagents. Solo/auto add nothing;
 * auto leaves the decision entirely to the model.
 */
export function buildOrchestrationDirective(mode: string | null | undefined): string {
  if (mode !== 'deep') return ''
  return [
    'Deep orchestration mode is ON for this conversation.',
    'For non-trivial work, decompose it and call run_specialist for each independent specialist slice (parallel tool calls), giving each a precise, self-contained brief.',
    'Use handoff_to_colleague when another colleague owns the job. Call propose_team only if a required specialist is missing from the roster.',
    'Verify important results before presenting conclusions, and keep the final synthesis yourself.',
  ].join(' ')
}
