// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G3 — the pure ACP → stream-contract bookkeeping (acp-stream.ts): tool rows,
// refusals, bridge outcomes, output capping and usage normalization.

import { describe, it, expect } from 'vitest'
import {
  ACP_TOOL_OUTPUT_CAP_BYTES,
  acpRunUsage,
  acpToolOutputText,
  capToolOutput,
  createAcpBridgeOutcomes,
  createAcpToolStream,
  normalizeAcpUsage,
} from '@modules/model/submodules/grok-cli/acp-stream.js'
import type { BridgeToolOutcome } from '@modules/model/cli-mcp/bridge-routes.js'
import type { StreamEvent } from '@modules/model/types.js'

function clock(start = 1000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('createAcpToolStream — rows', () => {
  it('opens one row and settles it once with output, duration and outcome', () => {
    const c = clock()
    const tools = createAcpToolStream({ now: c.now })
    const opened = tools.update({ kind: 'tool_call', toolCallId: 't1', title: 'Read a.txt', toolKind: 'read', rawInput: { file_path: '/w/a.txt' } })
    expect(opened).toEqual([{ type: 'tool_use_start', id: 't1', name: 'read_file', rawName: 'Read a.txt', input: { path: '/w/a.txt' } }])
    c.advance(25)
    const done = tools.update({ kind: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: { lines: 2 } })
    expect(done).toEqual([{ type: 'tool_result', toolUseId: 't1', content: '{"lines":2}', isError: false, durationMs: 25, outcome: 'success', executedBy: 'provider' }])
    // A settled row stays settled (negative).
    expect(tools.update({ kind: 'tool_call_update', toolCallId: 't1', status: 'failed' })).toEqual([])
  })

  it('re-emits the row only when its name or input changes', () => {
    const tools = createAcpToolStream()
    expect(tools.update({ kind: 'tool_call', toolCallId: 't1', title: 'run_terminal_command', rawInput: { command: 'ls' } })).toHaveLength(1)
    expect(tools.update({ kind: 'tool_call_update', toolCallId: 't1', status: 'in_progress' })).toEqual([])
    const upsert = tools.update({ kind: 'tool_call_update', toolCallId: 't1', title: 'Execute `ls`', toolKind: 'execute' })
    expect(upsert).toEqual([{ type: 'tool_use_start', id: 't1', name: 'run_command', rawName: 'Execute `ls`', input: { command: 'ls' } }])
  })

  it('an unmapped kind keeps the tool\'s own name from the first title; a human title is never the name', () => {
    const tools = createAcpToolStream()
    tools.update({ kind: 'tool_call', toolCallId: 't1', title: 'list_dir' })
    const [row] = tools.update({ kind: 'tool_call_update', toolCallId: 't1', title: 'List `/w`', toolKind: 'other' })
    expect(row).toMatchObject({ name: 'list_dir', rawName: 'List `/w`' })
    const [bare] = createAcpToolStream().update({ kind: 'tool_call', toolCallId: 't2', title: 'Think about it', toolKind: 'think' })
    expect(bare).toMatchObject({ name: 'think', rawName: 'Think about it' })
  })

  it('an EYAS tool through the bridge is named by its EYAS name and executed by eyas', () => {
    const tools = createAcpToolStream()
    const [row] = tools.update({ kind: 'tool_call', toolCallId: 't1', title: 'mcp__eyas__memory_search', toolKind: 'other', rawInput: { query: 'x' } })
    expect(row).toMatchObject({ name: 'memory_search', rawName: 'mcp__eyas__memory_search' })
    const [result] = tools.update({ kind: 'tool_call_update', toolCallId: 't1', status: 'completed' })
    expect(result).toMatchObject({ executedBy: 'eyas', outcome: 'success' })
  })

  it('a failed call nobody refused is the tool\'s own error (negative)', () => {
    const tools = createAcpToolStream()
    tools.update({ kind: 'tool_call', toolCallId: 't1', title: 'x', toolKind: 'execute' })
    const [result] = tools.update({ kind: 'tool_call_update', toolCallId: 't1', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'exit 1' } }] })
    expect(result).toMatchObject({ outcome: 'error', isError: true, content: 'exit 1' })
  })
})

describe('createAcpToolStream — refusals', () => {
  it('a refusal recorded before the CLI settles the row decides its outcome, with the reason as content', () => {
    const tools = createAcpToolStream()
    tools.update({ kind: 'tool_call', toolCallId: 't1', title: 'Execute rm', toolKind: 'execute' })
    expect(tools.refuse({ toolCallId: 't1', outcome: 'denied', reason: 'gate denied Bash' })).toEqual([])
    const [result] = tools.update({ kind: 'tool_call_update', toolCallId: 't1', status: 'failed' })
    expect(result).toMatchObject({ outcome: 'denied', isError: true, content: 'gate denied Bash' })
  })

  it('an approval raises approval_required at once, under the row\'s canonical name', () => {
    const tools = createAcpToolStream()
    tools.update({ kind: 'tool_call', toolCallId: 't1', title: 'Execute rm', toolKind: 'execute' })
    expect(tools.refuse({ toolCallId: 't1', outcome: 'approval_required', reason: 'needs a human', approvalId: 4, toolName: 'Bash' }))
      .toEqual([{ type: 'approval_required', toolUseId: 't1', toolName: 'run_command', reason: 'needs a human', approvalId: 4 }])
  })

  it('an approval with no row names the gate tool canonically and carries no toolUseId', () => {
    const tools = createAcpToolStream()
    expect(tools.refuse({ outcome: 'approval_required', reason: 'r', toolName: 'Write' }))
      .toEqual([{ type: 'approval_required', toolName: 'write_file', reason: 'r' }])
  })

  it('the first refusal of a call stands (a later cap cancel does not overwrite it)', () => {
    const tools = createAcpToolStream()
    tools.update({ kind: 'tool_call', toolCallId: 't1', title: 'x', toolKind: 'execute' })
    tools.refuse({ toolCallId: 't1', outcome: 'approval_required', reason: 'waits', approvalId: 1 })
    tools.refuse({ toolCallId: 't1', outcome: 'skipped', reason: 'limit' })
    expect(tools.finish()).toMatchObject([{ outcome: 'approval_required', content: 'waits' }])
  })

  it('finish() settles only refused rows the CLI never settled (they never ran)', () => {
    const tools = createAcpToolStream()
    tools.update({ kind: 'tool_call', toolCallId: 'refused', title: 'x', toolKind: 'execute' })
    tools.update({ kind: 'tool_call', toolCallId: 'unknown', title: 'y', toolKind: 'read' })
    tools.refuse({ toolCallId: 'refused', outcome: 'skipped', reason: 'turn ended: tool-call limit reached' })
    const settled = tools.finish()
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({ toolUseId: 'refused', outcome: 'skipped', isError: true })
    expect(tools.finish()).toEqual([])
  })
})

describe('createAcpToolStream — bridge outcomes', () => {
  const approval: BridgeToolOutcome = { toolName: 'memory_forget', outcome: 'approval_required', reason: 'approval required', approvalId: 9 }

  it('attaches to the open row of that EYAS tool and raises approval_required with its id', () => {
    const tools = createAcpToolStream()
    tools.update({ kind: 'tool_call', toolCallId: 'c6', title: 'use_tool', rawInput: { tool_name: 'eyas__memory_forget' } })
    expect(tools.bridgeOutcome(approval)).toEqual([{ type: 'approval_required', toolUseId: 'c6', toolName: 'memory_forget', reason: 'approval required', approvalId: 9 }])
    expect(tools.update({ kind: 'tool_call_update', toolCallId: 'c6', status: 'completed' })[0]).toMatchObject({ outcome: 'approval_required', executedBy: 'eyas' })
  })

  it('an outcome that arrives before its row is applied when that row settles', () => {
    const tools = createAcpToolStream()
    expect(tools.bridgeOutcome({ toolName: 'board_delete', outcome: 'denied', reason: 'refused' })).toEqual([])
    tools.update({ kind: 'tool_call', toolCallId: 'c1', title: 'eyas__board_delete' })
    expect(tools.update({ kind: 'tool_call_update', toolCallId: 'c1', status: 'failed' })[0]).toMatchObject({ outcome: 'denied' })
  })

  it('never attaches to a native tool of the same name (negative)', () => {
    const tools = createAcpToolStream()
    tools.update({ kind: 'tool_call', toolCallId: 'n1', title: 'memory_forget' })
    tools.bridgeOutcome(approval)
    expect(tools.update({ kind: 'tool_call_update', toolCallId: 'n1', status: 'completed' })[0]).toMatchObject({ outcome: 'success', executedBy: 'provider' })
  })
})

describe('createAcpToolStream — EYAS tools reached through use_tool', () => {
  const inputOf = (events: StreamEvent[]) => (events.at(-1) as Extract<StreamEvent, { type: 'tool_use_start' }>).input

  it('(+) the row\'s input is use_tool\'s tool_input — what the bridge receives and the ledger keys on', () => {
    const tools = createAcpToolStream()
    tools.update({ kind: 'tool_call', toolCallId: 'u1', title: 'use_tool', rawInput: { tool_name: 'eyas__send_email', tool_input: { to: 'a@example.com' } } })
    const events = tools.update({ kind: 'tool_call_update', toolCallId: 'u1', title: 'eyas__send_email', toolKind: 'other', rawInput: { variant: 'mcp', tool_name: 'eyas__send_email', tool_input: { to: 'a@example.com' } } })
    expect(events.at(-1)).toMatchObject({ type: 'tool_use_start', name: 'send_email' })
    expect(inputOf(events)).toEqual({ to: 'a@example.com' })
  })

  it('(+) a tool_input sent as a JSON string is read as its object', () => {
    const tools = createAcpToolStream()
    const events = tools.update({ kind: 'tool_call', toolCallId: 'u2', title: 'use_tool', rawInput: { tool_name: 'eyas__send_email', tool_input: '{"to":"b@example.com"}' } })
    expect(inputOf(events)).toEqual({ to: 'b@example.com' })
  })

  it('(−) a use_tool of a non-EYAS tool, and a native tool with a tool_input key, keep their input as reported', () => {
    const tools = createAcpToolStream()
    const other = tools.update({ kind: 'tool_call', toolCallId: 'u3', title: 'use_tool', rawInput: { tool_name: 'github__create_issue', tool_input: { title: 't' } } })
    expect(inputOf(other)).toEqual({ tool_name: 'github__create_issue', tool_input: { title: 't' } })
    const native = tools.update({ kind: 'tool_call', toolCallId: 'n2', title: 'read_file', toolKind: 'read', rawInput: { target_file: '/w/a', tool_input: 'x' } })
    expect(inputOf(native)).toEqual({ target_file: '/w/a', tool_input: 'x' })
  })
})

describe('createAcpBridgeOutcomes', () => {
  it('buffers until the turn subscribes, then delivers live; nothing after unsubscribe', () => {
    const relay = createAcpBridgeOutcomes()
    const seen: string[] = []
    relay.emit({ toolName: 'a', outcome: 'denied', reason: 'r' })
    const stop = relay.subscribe((o) => seen.push(o.toolName))
    relay.emit({ toolName: 'b', outcome: 'denied', reason: 'r' })
    stop()
    relay.emit({ toolName: 'c', outcome: 'denied', reason: 'r' })
    expect(seen).toEqual(['a', 'b'])
  })
})

describe('output text and cap', () => {
  it('prefers text content blocks, then rawOutput', () => {
    expect(acpToolOutputText([{ type: 'content', content: { type: 'text', text: 'a' } }, { type: 'diff', path: '/x', newText: 'n' }, { type: 'content', content: { type: 'text', text: 'b' } }], 'raw')).toBe('a\nb')
    expect(acpToolOutputText(undefined, 'plain')).toBe('plain')
    expect(acpToolOutputText([], { ok: true })).toBe('{"ok":true}')
    expect(acpToolOutputText(undefined, undefined)).toBe('')
  })

  it('caps at 64 KiB of UTF-8 and says how much was cut; a short text is untouched (negative)', () => {
    const long = 'é'.repeat(ACP_TOOL_OUTPUT_CAP_BYTES) // 2 bytes each
    const capped = capToolOutput(long)
    expect(Buffer.byteLength(capped.split('\n…')[0], 'utf8')).toBeLessThanOrEqual(ACP_TOOL_OUTPUT_CAP_BYTES)
    expect(capped).toMatch(/output truncated: \d+ more bytes/)
    expect(capped).not.toContain('�')
    expect(capToolOutput('short')).toBe('short')
  })
})

describe('normalizeAcpUsage', () => {
  it('takes the ACP reading: cache counted apart, reasoning inside output', () => {
    expect(normalizeAcpUsage({ inputTokens: 40, outputTokens: 12, totalTokens: 352, cachedReadTokens: 300 }))
      .toEqual({ inputTokens: 40, outputTokens: 12, cacheReadTokens: 300 })
  })

  it('takes the cached tokens out of an input count whose total shows it contains them', () => {
    expect(normalizeAcpUsage({ inputTokens: 340, outputTokens: 12, totalTokens: 352, cachedReadTokens: 300 }))
      .toEqual({ inputTokens: 40, outputTokens: 12, cacheReadTokens: 300 })
  })

  it('adds reasoning to an output count whose total shows it is separate', () => {
    expect(normalizeAcpUsage({ input_tokens: 10, output_tokens: 5, total_tokens: 23, thought_tokens: 8 }))
      .toEqual({ inputTokens: 10, outputTokens: 13, reasoningTokens: 8 })
  })

  it('without a total the figures are taken as stated; zero extras are left out', () => {
    expect(normalizeAcpUsage({ inputTokens: 110, outputTokens: 55, cachedReadTokens: 0, reasoningTokens: 0 })).toEqual({ inputTokens: 110, outputTokens: 55 })
  })

  it('nothing reported: null for no counts, garbage or a non-object (negative)', () => {
    expect(normalizeAcpUsage(undefined)).toBeNull()
    expect(normalizeAcpUsage({ totalTokens: 9 })).toBeNull()
    expect(normalizeAcpUsage('lots')).toBeNull()
    expect(normalizeAcpUsage({ inputTokens: 'many', outputTokens: -3 })).toBeNull()
  })

  it('acpRunUsage marks an unreported turn and carries the cache counts', () => {
    expect(acpRunUsage({ inputTokens: 0, outputTokens: 0, usageReported: false })).toEqual({ inputTokens: 0, outputTokens: 0, reported: false })
    expect(acpRunUsage({ inputTokens: 1, outputTokens: 2, usageReported: true, cacheReadTokens: 3 })).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 })
  })
})
