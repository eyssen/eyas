// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// ACP turns (Grok and Kimi CLIs) as the CLI sends them, for the stream-contract
// harness. The fake ACP agent replays a script over real stdio ('script'
// scenario, tests/fixtures/cli/fake-acp-agent.ts), so the whole client —
// parser, tripwire, governance, stream mapping — sees exactly these messages.
//
// The grok fixtures replay the grok 1.0.40 shapes the A1 spike recorded
// (tests/fixtures/cli/grok/1.0.40/session-prompt-result.json and
// permission-requests.json): the first tool_call carries only the tool's own
// name and rawInput, the kind and a display title arrive in the next update,
// and a completed update carries no content. The ACP-spec fixtures follow the
// Agent Client Protocol schema (kind on the tool_call, output as content
// blocks); no Kimi binary was available to record them, so they stand for
// Kimi until one is.

import type { ModelUsage, StopReason } from '@modules/model/types.js'
import type { ToolOutcome } from '@shared/chat-stream.js'

export interface AcpScriptStep {
  update?: Record<string, unknown>
  permission?: Record<string, unknown>
  sleep?: number
}

export interface AcpStreamFixture {
  name: string
  providerId: 'grok-cli' | 'kimi-cli'
  script: { steps: AcpScriptStep[]; result: Record<string, unknown> }
  expected: {
    /** Canonical names of the tool rows, in order (one per call). */
    toolNames: string[]
    outcomes: ToolOutcome[]
    stopReason: StopReason
    usage: ModelUsage
    text: string
  }
}

const text = (t: string): AcpScriptStep => ({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } } })

/** grok 1.0.40: a shell call, asked about, run, completed without content. */
export const grokShellTurn: AcpStreamFixture = {
  name: 'grok 1.0.40: shell call',
  providerId: 'grok-cli',
  script: {
    steps: [
      text('Listing.'),
      { update: { sessionUpdate: 'tool_call', toolCallId: 'call_main_0', title: 'run_terminal_command', rawInput: { command: 'ls', description: 'List files' } } },
      {
        update: {
          sessionUpdate: 'tool_call_update', toolCallId: 'call_main_0', title: 'Execute `ls`', kind: 'execute', locations: [],
          rawInput: { variant: 'Bash', command: 'ls', description: 'List files', is_background: false },
        },
      },
      { permission: { toolCallId: 'call_main_0', kind: 'execute', title: 'Execute `ls`', rawInput: { variant: 'Bash', command: 'ls', description: 'List files', is_background: false } } },
      { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_0', status: 'in_progress' } },
      { sleep: 5 },
      { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_0', status: 'completed' } },
      text(' Done.'),
    ],
    result: {
      stopReason: 'end_turn',
      _meta: {
        inputTokens: 10, outputTokens: 5, totalTokens: 15,
        usage: { inputTokens: 110, outputTokens: 55, totalTokens: 165, cachedReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, modelCalls: 2 },
      },
    },
  },
  expected: {
    toolNames: ['run_command'],
    outcomes: ['success'],
    stopReason: 'end',
    usage: { inputTokens: 110, outputTokens: 55 },
    text: 'Listing. Done.',
  },
}

/** ACP spec: a shell call with its output as a content block; cache reads counted apart from input. */
export const acpSpecShellTurn: AcpStreamFixture = {
  name: 'ACP spec: shell call with output',
  providerId: 'kimi-cli',
  script: {
    steps: [
      { update: { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'Shell: ls -la', kind: 'execute', status: 'pending', rawInput: { command: 'ls -la' } } },
      { permission: { toolCallId: 'tc-1', title: 'Shell: ls -la', kind: 'execute', rawInput: { command: 'ls -la' } } },
      { update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'in_progress' } },
      { sleep: 5 },
      {
        update: {
          sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'a.txt\nb.txt' } }],
        },
      },
      text('Two files.'),
    ],
    result: { stopReason: 'end_turn', usage: { inputTokens: 40, outputTokens: 12, totalTokens: 352, cachedReadTokens: 300 } },
  },
  expected: {
    toolNames: ['run_command'],
    outcomes: ['success'],
    stopReason: 'end',
    usage: { inputTokens: 40, outputTokens: 12, cacheReadTokens: 300 },
    text: 'Two files.',
  },
}

/** ACP spec: an edit whose diff becomes the row's input. */
export const acpSpecEditTurn: AcpStreamFixture = {
  name: 'ACP spec: edit with a diff',
  providerId: 'kimi-cli',
  script: {
    steps: [
      {
        update: {
          sessionUpdate: 'tool_call', toolCallId: 'tc-2', title: 'Edit notes.md', kind: 'edit', status: 'pending',
          content: [{ type: 'diff', path: '/w/notes.md', oldText: 'old line', newText: 'new line' }],
        },
      },
      { permission: { toolCallId: 'tc-2', title: 'Edit notes.md', kind: 'edit' } },
      { update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-2', status: 'completed' } },
    ],
    result: { stopReason: 'end_turn', usage: { inputTokens: 20, outputTokens: 8 } },
  },
  expected: {
    toolNames: ['edit_file'],
    outcomes: ['success'],
    stopReason: 'end',
    usage: { inputTokens: 20, outputTokens: 8 },
    text: '',
  },
}

/** A shell call EYAS refuses: the CLI reports it failed. */
export const acpDeniedTurn: AcpStreamFixture = {
  name: 'ACP: a refused call',
  providerId: 'grok-cli',
  script: {
    steps: [
      { update: { sessionUpdate: 'tool_call', toolCallId: 'call_main_0', title: 'run_terminal_command', rawInput: { command: 'rm -rf build' } } },
      { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_0', title: 'Execute `rm`', kind: 'execute' } },
      { permission: { toolCallId: 'call_main_0', kind: 'execute', title: 'Execute `rm`', rawInput: { command: 'rm -rf build' } } },
      { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_main_0', status: 'failed' } },
      text('I was not allowed to.'),
    ],
    result: { stopReason: 'end_turn', _meta: { usage: { inputTokens: 30, outputTokens: 9, totalTokens: 39 } } },
  },
  expected: {
    toolNames: ['run_command'],
    outcomes: ['denied'],
    stopReason: 'end',
    usage: { inputTokens: 30, outputTokens: 9 },
    text: 'I was not allowed to.',
  },
}

/** The CLI's own turn limit: an outcome, with no usage reported. */
export const acpMaxTurnRequests: AcpStreamFixture = {
  name: 'ACP: max_turn_requests without usage',
  providerId: 'kimi-cli',
  script: {
    steps: [text('Partial answer')],
    result: { stopReason: 'max_turn_requests' },
  },
  expected: {
    toolNames: [],
    outcomes: [],
    stopReason: 'max_turns',
    usage: { inputTokens: 0, outputTokens: 0, reported: false },
    text: 'Partial answer',
  },
}

/** Every fixture the harness runs through both the grok and the kimi provider shapes. */
export const ACP_STREAM_FIXTURES: readonly AcpStreamFixture[] = [
  grokShellTurn,
  acpSpecShellTurn,
  acpSpecEditTurn,
  acpDeniedTurn,
  acpMaxTurnRequests,
]
