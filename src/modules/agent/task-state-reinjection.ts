// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Compact task-state re-injection for resumed / session-refreshed agent runs.
//
// When a run is resumed (from a checkpoint) or its provider session is dropped
// at a token threshold, the model no longer "remembers" what it already did.
// This builds a bounded reminder (for AssembledPrompt.reminders) that re-states
// the goal and — the safety-critical part — instructs the model NOT to repeat
// tool calls it already executed or resend messages it already delivered, so a
// resume can never double-execute a side effect.
//
// Pure + bounded; the resume/refresh wiring that populates the inputs from a
// run's recorded history is a separate (deferred) step.

export interface DoneToolCall {
  tool: string
  /** Stable hash of the call's arguments — identifies the exact call, not just the tool. */
  argHash: string
  /** Bounded human-readable arg preview so the model can avoid re-deriving the call. */
  args?: string
}

export interface TaskState {
  goal: string
  completedSteps?: string[]
  doneToolCalls?: DoneToolCall[]
  sentMessageIds?: string[]
  openSubTask?: string
}

const DEFAULT_MAX_CHARS = 12_000

export function buildTaskStateReinjection(state: TaskState, opts: { maxChars?: number } = {}): string {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const goal = state.goal?.trim() ?? ''
  const completed = state.completedSteps ?? []
  const done = state.doneToolCalls ?? []
  const sent = state.sentMessageIds ?? []
  const open = state.openSubTask?.trim() ?? ''

  if (!goal && completed.length === 0 && done.length === 0 && sent.length === 0 && !open) {
    return ''
  }

  const sections: string[] = ['## Resumed run — task state']
  if (goal) sections.push(`Goal: ${goal}`)
  if (completed.length) sections.push(`Already completed:\n${completed.map((s) => `- ${s}`).join('\n')}`)
  if (done.length) {
    sections.push(
      `Do NOT repeat these tool calls (already executed):\n${done
        .map((d) => `- ${d.tool}${d.args ? ` ${d.args}` : ''} [${d.argHash}]`)
        .join('\n')}`,
    )
  }
  if (sent.length) sections.push(`Do NOT resend these messages (already delivered): ${sent.join(', ')}`)
  if (open) sections.push(`Continue from: ${open}`)

  let out = sections.join('\n\n')
  if (out.length > maxChars) {
    const marker = '\n…[truncated]'
    out = out.slice(0, Math.max(0, maxChars - marker.length)) + marker
  }
  return out
}
