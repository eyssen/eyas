// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G3 — the ACP client (Grok and Kimi) emits the provider-neutral stream:
// canonical tool rows with input and output, denied and approval outcomes,
// max_turns as an outcome, honest usage and neutral error text. Driven end to
// end: the fake ACP agent replays the recorded shapes over real stdio through
// the real providers, and every stream passes the stream-contract harness.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import { runGrokAcpPrompt } from '@modules/model/submodules/grok-cli/acp-client.js'
import { createAcpBridgeOutcomes } from '@modules/model/submodules/grok-cli/acp-stream.js'
import type { AIProvider, StreamEvent } from '@modules/model/types.js'
import { checkStreamContract } from '../stream-contract/harness.js'
import {
  ACP_STREAM_FIXTURES,
  acpDeniedTurn,
  acpMaxTurnRequests,
  acpSpecEditTurn,
  acpSpecShellTurn,
  grokShellTurn,
  type AcpScriptStep,
  type AcpStreamFixture,
} from '../stream-contract/fixtures/acp.js'
import { fakeAcpProfile, readFakeAcpLog } from '../../../helpers/fake-acp.js'

let root: string
let homesDir: string
let cwd: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-stream-')))
  homesDir = join(root, 'data', 'cli-homes')
  cwd = join(root, 'workspace')
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

type Verdict = 'allow' | 'deny' | 'escalate'

/** A gate that refuses `rm`, and escalates what the test says. */
function governance(verdict: (input: Record<string, unknown>) => Verdict, createApproval = vi.fn(() => 41)) {
  return () => ({
    securityGate: {
      validateToolCall: (_name: string, input: Record<string, unknown>) => {
        const decision = verdict(input)
        return { decision, reason: decision === 'allow' ? 'ok' : `gate ${decision}`, riskTier: decision === 'allow' ? 'green' : 'red' }
      },
      autonomyPolicy: {
        categoryForTool: () => 'shell_exec',
        resolve: () => ({ level: 1, locked: true, maxLevel: 3 }),
        createApproval,
      },
    },
  }) as any
}

const refuseRm = (input: Record<string, unknown>): Verdict => (String(input.command ?? '').startsWith('rm') ? 'deny' : 'allow')

function providerFor(fixture: Pick<AcpStreamFixture, 'providerId' | 'script'>, opts: { verdict?: (input: Record<string, unknown>) => Verdict; createApproval?: any; log?: string } = {}): AIProvider {
  const script = join(root, `script-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(script, JSON.stringify(fixture.script))
  const profile = fakeAcpProfile({ providerId: fixture.providerId, homesDir, dir: root, log: opts.log ?? join(root, 'acp.log'), scenario: 'script', script })
  const common = { profile, getGovernance: governance(opts.verdict ?? refuseRm, opts.createApproval) }
  return fixture.providerId === 'kimi-cli' ? createKimiCliProvider(common) : createGrokCliProvider(common)
}

async function collect(provider: AIProvider, extra: Record<string, unknown> = {}): Promise<{ events: StreamEvent[]; error?: Error }> {
  const events: StreamEvent[] = []
  try {
    for await (const ev of provider.stream({
      messages: [{ role: 'user', content: 'go' }],
      metadata: { workingDirectories: [cwd], origin: 'interactive', conversationId: 'conv-1' },
      ...extra,
    } as any)) events.push(ev)
  } catch (err) {
    return { events, error: err as Error }
  }
  return { events }
}

const starts = (events: StreamEvent[]) => events.filter((e): e is Extract<StreamEvent, { type: 'tool_use_start' }> => e.type === 'tool_use_start')
const results = (events: StreamEvent[]) => events.filter((e): e is Extract<StreamEvent, { type: 'tool_result' }> => e.type === 'tool_result')
const doneOf = (events: StreamEvent[]) => events.find((e): e is Extract<StreamEvent, { type: 'done' }> => e.type === 'done')

describe.skipIf(process.platform === 'win32')('ACP stream normalization — the stream contract', () => {
  it.each(ACP_STREAM_FIXTURES.map((f) => [f.name, f] as const))('%s passes the stream-contract harness', async (_name, fixture) => {
    const { events, error } = await collect(providerFor(fixture))
    expect(error).toBeUndefined()
    expect(checkStreamContract(events).violations).toEqual([])
    // One row per call, however often the CLI filled it in.
    const rows = starts(events)
    const lastName = new Map(rows.map((r) => [r.id, r.name]))
    expect([...lastName.values()]).toEqual(fixture.expected.toolNames)
    expect(results(events).map((r) => r.outcome)).toEqual(fixture.expected.outcomes)
    const done = doneOf(events)!
    expect(done.response.stopReason).toBe(fixture.expected.stopReason)
    expect(done.response.usage).toEqual(fixture.expected.usage)
    expect(done.response.content).toEqual([{ type: 'text', text: fixture.expected.text }])
    expect(events.some((e) => (e as { type: string }).type === 'tool_use_end')).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('ACP stream normalization — tool rows', () => {
  it('tool_call{kind: execute, rawInput: {command}} opens a run_command row with that input (positive)', async () => {
    const { events } = await collect(providerFor(acpSpecShellTurn))
    const [row] = starts(events)
    expect(row).toMatchObject({ id: 'tc-1', name: 'run_command', rawName: 'Shell: ls -la', input: { command: 'ls -la' } })
  })

  it('grok: the row opens under the tool\'s own name and is upserted to the canonical one once the kind arrives', async () => {
    const { events } = await collect(providerFor(grokShellTurn))
    const rows = starts(events)
    expect(rows[0]).toMatchObject({ id: 'call_main_0', name: 'run_terminal_command', input: { command: 'ls', description: 'List files' } })
    expect(rows.at(-1)).toMatchObject({ id: 'call_main_0', name: 'run_command', rawName: 'Execute `ls`', input: { command: 'ls' } })
    // The human title is never the name.
    expect(rows.every((r) => r.name !== 'Execute `ls`')).toBe(true)
  })

  it('a completed update with text content settles the row with that output and a duration (positive)', async () => {
    const { events } = await collect(providerFor(acpSpecShellTurn))
    const [result] = results(events)
    expect(result).toMatchObject({ toolUseId: 'tc-1', content: 'a.txt\nb.txt', isError: false, outcome: 'success', executedBy: 'provider' })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(result.durationMs)).toBe(true)
  })

  it('an edit\'s diff becomes the row input {path, old_string, new_string}', async () => {
    const { events } = await collect(providerFor(acpSpecEditTurn))
    expect(starts(events)[0]).toMatchObject({ name: 'edit_file', input: { path: '/w/notes.md', old_string: 'old line', new_string: 'new line' } })
  })

  it('a call EYAS refused settles as denied, not as a failure of the tool (positive)', async () => {
    const { events } = await collect(providerFor(acpDeniedTurn))
    const [result] = results(events)
    expect(result).toMatchObject({ toolUseId: 'call_main_0', outcome: 'denied', isError: true })
    expect(result.content).toContain('gate denied')
  })

  it('an escalated call raises approval_required with the queued approval and settles as approval_required', async () => {
    const createApproval = vi.fn(() => 41)
    const { events } = await collect(providerFor(acpDeniedTurn, { verdict: () => 'escalate', createApproval }))
    const approval = events.find((e) => e.type === 'approval_required')
    expect(approval).toMatchObject({ type: 'approval_required', toolUseId: 'call_main_0', toolName: 'run_command', approvalId: 41 })
    expect(results(events)[0]).toMatchObject({ outcome: 'approval_required' })
    expect(checkStreamContract(events).violations).toEqual([])
  })

  it('an allowed call raises no approval (negative)', async () => {
    const { events } = await collect(providerFor(grokShellTurn))
    expect(events.some((e) => e.type === 'approval_required')).toBe(false)
  })

  it('a malformed update is ignored without throwing (negative)', async () => {
    const malformed: AcpStreamFixture['script'] = {
      steps: [
        { update: { sessionUpdate: 'tool_call', title: 'no id' } },
        { update: { sessionUpdate: 'tool_call_update', toolCallId: 'x', status: 'exploded' } },
        { update: { sessionUpdate: 'agent_message_chunk', content: 'not a block' } },
        { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'still fine' } } },
      ],
      result: { stopReason: 'end_turn', _meta: { usage: { inputTokens: 1, outputTokens: 1 } } },
    }
    const { events, error } = await collect(providerFor({ providerId: 'grok-cli', script: malformed }))
    expect(error).toBeUndefined()
    expect(starts(events)).toEqual([])
    expect(doneOf(events)!.response.content).toEqual([{ type: 'text', text: 'still fine' }])
  })
})

describe.skipIf(process.platform === 'win32')('ACP stream normalization — outcomes and usage', () => {
  it('stopReason max_turn_requests ends as max_turns, not max_tokens (regression)', async () => {
    const { events } = await collect(providerFor(acpMaxTurnRequests))
    const done = doneOf(events)!
    expect(done.response.stopReason).toBe('max_turns')
    expect(done.response.stopReason).not.toBe('max_tokens')
    expect(done.response.content).toEqual([{ type: 'text', text: 'Partial answer' }])
  })

  it('a response without usage is marked not reported (positive)', async () => {
    const { events } = await collect(providerFor(acpMaxTurnRequests))
    expect(doneOf(events)!.response.usage).toEqual({ inputTokens: 0, outputTokens: 0, reported: false })
  })

  it('a response with usage is reported, cache reads counted apart from input (negative of the above)', async () => {
    const { events } = await collect(providerFor(acpSpecShellTurn))
    const usage = doneOf(events)!.response.usage
    expect(usage).not.toHaveProperty('reported')
    expect(usage).toMatchObject({ inputTokens: 40, cacheReadTokens: 300 })
  })
})

describe.skipIf(process.platform === 'win32')('ACP stream normalization — neutral error text', () => {
  it('a Kimi abort message names Kimi, never Grok (negative)', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const { error } = await collect(providerFor(acpSpecShellTurn), { signal: aborted.signal })
    expect(error).toBeDefined()
    expect(error!.message).toContain('Kimi Code CLI')
    expect(error!.message).not.toMatch(/grok/i)
  })

  it('a Grok abort message names Grok CLI (positive)', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const { error } = await collect(providerFor(grokShellTurn), { signal: aborted.signal })
    expect(error!.message).toContain('Grok CLI')
  })
})

describe.skipIf(process.platform === 'win32')('ACP stream normalization — EYAS tools through the MCP bridge', () => {
  /** grok 1.0.40 reaches an EYAS tool through use_tool, without a permission request (A1 mcp-dispatch). */
  const bridgedSteps = (status: 'completed' | 'failed'): AcpScriptStep[] => [
    { update: { sessionUpdate: 'tool_call', toolCallId: 'call_main_6', title: 'use_tool', rawInput: { variant: 'mcp', tool_name: 'eyas__memory_forget', tool_input: { id: 'm1' } } } },
    { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_6', title: 'eyas__memory_forget', kind: 'other' } },
    { sleep: 150 },
    { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_6', status, content: [{ type: 'content', content: { type: 'text', text: 'Error: approval required' } }] } },
  ]

  async function runBridged(emit: boolean) {
    const script = join(root, 'bridged.json')
    writeFileSync(script, JSON.stringify({ steps: bridgedSteps('failed'), result: { stopReason: 'end_turn', _meta: { usage: { inputTokens: 5, outputTokens: 2 } } } }))
    const profile = fakeAcpProfile({ homesDir, dir: root, log: join(root, 'bridged.log'), scenario: 'script', script })
    const bridgeOutcomes = createAcpBridgeOutcomes()
    const gen = runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'forget it' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 }, bridgeOutcomes, canUseTool: async () => ({ behavior: 'allow' }) })
    const events: StreamEvent[] = []
    let step = await gen.next()
    while (!step.done) {
      events.push(step.value)
      // The bridge answers while the CLI's call is in flight.
      if (emit && step.value.type === 'tool_use_start' && step.value.name === 'memory_forget') {
        bridgeOutcomes.emit({ toolName: 'memory_forget', outcome: 'approval_required', reason: 'approval required (memory_delete): red', approvalId: 9 })
      }
      step = await gen.next()
    }
    return events
  }

  it('the row carries the EYAS tool name, runs as eyas, and settles with the bridge\'s approval outcome', async () => {
    const events = await runBridged(true)
    const rows = starts(events)
    // The row carries the arguments the bridge received (use_tool's tool_input), not grok's wrapper.
    expect(rows.at(-1)).toMatchObject({ id: 'call_main_6', name: 'memory_forget', input: { id: 'm1' } })
    expect(rows.at(-1)).not.toHaveProperty('input.tool_name')
    expect(events.find((e) => e.type === 'approval_required')).toMatchObject({ toolUseId: 'call_main_6', toolName: 'memory_forget', approvalId: 9 })
    expect(results(events)[0]).toMatchObject({ toolUseId: 'call_main_6', outcome: 'approval_required', executedBy: 'eyas' })
    expect(readFakeAcpLog(join(root, 'bridged.log')).permissionAnswers).toEqual([])
  })

  it('without a bridge refusal the same failed call is the tool\'s own error (negative)', async () => {
    const events = await runBridged(false)
    expect(events.some((e) => e.type === 'approval_required')).toBe(false)
    expect(results(events)[0]).toMatchObject({ outcome: 'error', executedBy: 'eyas', content: 'Error: approval required' })
  })
})
