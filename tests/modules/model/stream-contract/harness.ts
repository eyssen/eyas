// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Stream-contract harness (G1). Every provider's normalized stream must pass
// assertStreamContract: provider tests (G2 Claude Code, G3 ACP, G4 API) feed
// their recorded fixtures through it, so "looks the same in the UI whatever
// the provider" is checked mechanically rather than by eye.

import { ModelUsageSchema } from '@shared/chat-stream.js'
import type { ContractStreamEvent, StreamEvent } from '@modules/model/types.js'

/** The event types of the contract. The retired tool_use_end/context_compact are NOT among them. */
const CONTRACT_TYPES: ReadonlySet<ContractStreamEvent['type']> = new Set<ContractStreamEvent['type']>([
  'text', 'thinking', 'tool_use_start', 'tool_use_input', 'tool_result',
  'approval_required', 'step', 'notice', 'done', 'error',
])

export interface StreamContractReport {
  ok: boolean
  violations: string[]
}

/** Check a recorded stream against the contract and report every violation. */
export function checkStreamContract(events: readonly StreamEvent[]): StreamContractReport {
  const violations: string[] = []
  const started = new Set<string>()
  let doneCount = 0
  let doneIndex = -1

  events.forEach((event, i) => {
    const type = (event as { type?: unknown }).type
    if (typeof type !== 'string' || !CONTRACT_TYPES.has(type as ContractStreamEvent['type'])) {
      violations.push(`#${i}: event type ${JSON.stringify(type)} is not part of the stream contract`)
      return
    }
    const e = event as ContractStreamEvent
    if (doneIndex >= 0) violations.push(`#${i}: ${e.type} after done`)
    switch (e.type) {
      case 'tool_use_start':
        if (!e.id) violations.push(`#${i}: tool_use_start without an id`)
        started.add(e.id)
        break
      case 'tool_result':
        if (!started.has(e.toolUseId)) violations.push(`#${i}: tool_result for ${JSON.stringify(e.toolUseId)} without an earlier tool_use_start`)
        break
      case 'done': {
        doneCount++
        doneIndex = i
        const usage = ModelUsageSchema.safeParse(e.response.usage)
        if (!usage.success) {
          violations.push(`#${i}: done.response.usage is not canonical: ${usage.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`)
        }
        break
      }
    }
  })

  if (doneCount !== 1) violations.push(`expected exactly one done, got ${doneCount}`)
  return { ok: violations.length === 0, violations }
}

/** Throw with every violation listed when the stream breaks the contract. */
export function assertStreamContract(events: readonly StreamEvent[]): void {
  const report = checkStreamContract(events)
  if (!report.ok) throw new Error(`stream contract violated:\n- ${report.violations.join('\n- ')}`)
}
