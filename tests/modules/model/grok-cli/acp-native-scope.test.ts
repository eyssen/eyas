// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K3 (R1A-15) end to end on the ACP CLIs: the request's tool scope (the names
// it offers — the agent's tool list) reaches the permission decision through
// the real Grok and Kimi providers and the real ACP client. The fake ACP
// agent replays the recorded shapes over stdio ('script' scenario): a grok
// 1.0.40 shell call (kind on the permission request, the tool's own name in
// _meta and on the first tool_call) and a kimi-cli 1.52.0 write (derived from
// its source: the permission request carries no kind).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import type { AIProvider, StreamEvent } from '@modules/model/types.js'
import type { AcpScriptStep } from '../stream-contract/fixtures/acp.js'
import { fakeAcpProfile, readFakeAcpLog } from '../../../helpers/fake-acp.js'

let root: string
let homesDir: string
let cwd: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-native-scope-')))
  homesDir = join(root, 'data', 'cli-homes')
  cwd = join(root, 'workspace')
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** grok 1.0.40: a shell call, asked about with its kind and its own name. */
const GROK_SHELL: AcpScriptStep[] = [
  { update: { sessionUpdate: 'tool_call', toolCallId: 'call_main_0', title: 'run_terminal_command', rawInput: { command: 'touch made.txt', description: 'Make a file' } } },
  { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_0', title: 'Execute `touch`', kind: 'execute' } },
  {
    permission: {
      toolCallId: 'call_main_0', kind: 'execute', title: 'Execute `touch`',
      rawInput: { variant: 'Bash', command: 'touch made.txt', description: 'Make a file', is_background: false },
      _meta: { 'x.ai/tool': { version: 1, name: 'run_terminal_command', kind: 'execute', namespace: 'grok_build', read_only: false } },
    },
  },
  { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_0', status: 'failed' } },
]

/** grok 1.0.40: a read, which every tool list keeps. */
const GROK_READ: AcpScriptStep[] = [
  { update: { sessionUpdate: 'tool_call', toolCallId: 'call_main_1', title: 'read_file', rawInput: { target_file: 'a.txt' } } },
  { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_1', title: 'Read `a.txt`', kind: 'read' } },
  { permission: { toolCallId: 'call_main_1', kind: 'read', title: 'Read `a.txt`', rawInput: { variant: 'ReadFile', target_file: 'a.txt' } } },
  { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_1', status: 'completed' } },
]

/** kimi-cli 1.52.0 (source): a file write, asked about with a title and no kind. */
const KIMI_WRITE: AcpScriptStep[] = [
  { update: { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'WriteFile', status: 'pending' } },
  { permission: { toolCallId: 'tc-1', title: 'WriteFile: notes.md', content: [{ type: 'content', content: { type: 'text', text: 'write notes.md' } }] } },
  { update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'failed' } },
]

function governance(validateToolCall: ReturnType<typeof vi.fn>) {
  return () => ({ securityGate: { validateToolCall } }) as any
}

function providerFor(providerId: 'grok-cli' | 'kimi-cli', steps: AcpScriptStep[], validateToolCall: ReturnType<typeof vi.fn>, log: string): AIProvider {
  const script = join(root, `script-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(script, JSON.stringify({ steps, result: { stopReason: 'end_turn' } }))
  const profile = fakeAcpProfile({ providerId, homesDir, dir: root, log, scenario: 'script', script })
  const common = { profile, getGovernance: governance(validateToolCall) }
  return providerId === 'kimi-cli' ? createKimiCliProvider(common) : createGrokCliProvider(common)
}

const def = (name: string) => ({ name, description: name, inputSchema: {} })

async function run(provider: AIProvider, tools: string[] | undefined): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const ev of provider.stream({
    messages: [{ role: 'user', content: 'go' }],
    metadata: { workingDirectories: [cwd], origin: 'interactive', conversationId: 'conv-k3' },
    ...(tools ? { tools: tools.map(def) } : {}),
  } as any)) events.push(ev)
  return events
}

const answers = (log: string) => readFakeAcpLog(log).permissionAnswers.map((a) => [a.toolCallId, a.decision?.outcome?.optionId])
const allowGate = () => vi.fn((_toolName: string, _input: Record<string, unknown>) => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' as const }))
const deniedRow = (events: StreamEvent[], id: string) =>
  events.find((e): e is Extract<StreamEvent, { type: 'tool_result' }> => e.type === 'tool_result' && e.toolUseId === id)

describe.skipIf(process.platform === 'win32')('K3 — the tool list bounds the ACP CLIs\' own tools', () => {
  it('(−) grok: a shell call on a list without run_command is rejected by EYAS, the gate is never asked, and the row says why', async () => {
    const log = join(root, 'grok-narrow.log')
    const gate = allowGate()
    const events = await run(providerFor('grok-cli', [...GROK_SHELL, ...GROK_READ], gate, log), ['memory_search', 'read_file'])
    expect(answers(log)).toEqual([['call_main_0', 'reject-once'], ['call_main_1', 'allow-once']])
    // The read went to the gate; the shell call did not.
    expect(gate.mock.calls.map((c) => c[0])).toEqual(['Read'])
    expect(deniedRow(events, 'call_main_0')).toMatchObject({ outcome: 'denied', isError: true })
    expect(String(deniedRow(events, 'call_main_0')?.content)).toContain("'run_terminal_command' is not in this agent's toolset")
  })

  it('(+) grok: the same shell call on a list with run_command goes to the gate and is allowed', async () => {
    const log = join(root, 'grok-wide.log')
    const gate = allowGate()
    await run(providerFor('grok-cli', GROK_SHELL, gate, log), ['memory_search', 'run_command'])
    expect(answers(log)).toEqual([['call_main_0', 'allow-once']])
    expect(gate.mock.calls.map((c) => c[0])).toEqual(['Bash'])
  })

  it('(+) grok: a request that names no tools (no list) sets no limit', async () => {
    const log = join(root, 'grok-none.log')
    const gate = allowGate()
    await run(providerFor('grok-cli', GROK_SHELL, gate, log), undefined)
    expect(answers(log)).toEqual([['call_main_0', 'allow-once']])
  })

  it('(−) kimi: a kindless write on a list without write_file/edit_file is rejected before the gate', async () => {
    const log = join(root, 'kimi-narrow.log')
    const gate = allowGate()
    const events = await run(providerFor('kimi-cli', KIMI_WRITE, gate, log), ['memory_search', 'run_command'])
    expect(answers(log)).toEqual([['tc-1', 'reject-once']])
    expect(gate).not.toHaveBeenCalled()
    expect(deniedRow(events, 'tc-1')).toMatchObject({ outcome: 'denied', isError: true })
  })

  it('(+) kimi: with write and shell tools on the list, the kindless write goes to the gate', async () => {
    const log = join(root, 'kimi-wide.log')
    const gate = allowGate()
    await run(providerFor('kimi-cli', KIMI_WRITE, gate, log), ['memory_search', 'write_file', 'run_command'])
    expect(answers(log)).toEqual([['tc-1', 'allow-once']])
    expect(gate).toHaveBeenCalledTimes(1)
  })
})
