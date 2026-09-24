// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The status of one tool row in the chat (G10). A row opens as 'running' on
// the tool_use frame and settles ONLY on its tool_result (shared/chat-stream.ts
// ToolOutcome), whatever the provider — so a call that was denied, is waiting
// for approval or was never run looks the same on every provider, and never
// green. A row still open when the turn ends is 'unknown', not a success.

import type { ToolOutcome } from '../../../../shared/chat-stream'

export const TOOL_CALL_STATUSES = ['running', 'success', 'error', 'denied', 'approval_required', 'skipped', 'unknown'] as const
export type ToolCallStatus = typeof TOOL_CALL_STATUSES[number]

/** The settled outcomes a tool_result may carry (ToolOutcome), as a runtime set. */
const OUTCOMES: Record<ToolOutcome, true> = {
  success: true,
  error: true,
  denied: true,
  approval_required: true,
  skipped: true,
}

/**
 * The row status a tool_result settles to. An outcome this build does not
 * know is not guessed: with an error text it is a failure, otherwise its
 * outcome is unknown — never a success.
 */
export function toolStatusOf(outcome: unknown, error?: unknown): ToolCallStatus {
  if (typeof outcome === 'string' && Object.prototype.hasOwnProperty.call(OUTCOMES, outcome)) return outcome as ToolOutcome
  return typeof error === 'string' && error.length > 0 ? 'error' : 'unknown'
}

/** conversations.toolCall.status.<key> — the label (and tooltip) of each row status. */
export const TOOL_STATUS_KEY: Record<ToolCallStatus, string> = {
  running: 'conversations.toolCall.status.running',
  success: 'conversations.toolCall.status.success',
  error: 'conversations.toolCall.status.error',
  denied: 'conversations.toolCall.status.denied',
  approval_required: 'conversations.toolCall.status.approvalRequired',
  skipped: 'conversations.toolCall.status.skipped',
  unknown: 'conversations.toolCall.status.unknown',
}
