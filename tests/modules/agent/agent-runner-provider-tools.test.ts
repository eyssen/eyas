// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G5(d)/(e) — tools a provider ran inside its own loop (Claude Code, Grok,
// Kimi) are recorded by the runner as the same ToolCall/ToolResult pair it
// writes for its own executor (canonical name, normalized argHash), which is
// what resume's recap and do-not-repeat ledger read. A CLI-native tool also
// goes to tool_executions through recordExternalToolExecution. A turn that
// ran provider tools, and a CLI park, are checkpointed as history + answer
// text. An API provider's tool_use_start is NOT a provider execution: nothing
// is recorded until the runner executes the call itself.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner, type AgentEvent } from '@modules/agent/agent-runner'
import { toolLedgerKey } from '@shared/arg-hash'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'

function textResponse(text: string): ModelResponse {
  return {
    id: 'r',
    provider: 'claude-code',
    model: 'm',
    content: [{ type: 'text', text }],
    stopReason: 'end',
    usage: { inputTokens: 3, outputTokens: 4 },
  }
}

function toolUseResponse(id: string, name: string, input: Record<string, unknown>): ModelResponse {
  return {
    id: 'r-tu',
    provider: 'anthropic',
    model: 'm',
    content: [{ type: 'tool_use', id, name, input }],
    stopReason: 'tool_use',
    usage: { inputTokens: 1, outputTokens: 1 },
  }
}

function scripted(calls: Array<StreamEvent[] | ((request: any) => AsyncGenerator<StreamEvent>)>, seen: any[] = []): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
    async complete() { throw new Error('streaming only') },
    async *stream(request: any) {
      seen.push(request)
      const call = calls[i++]
      if (typeof call === 'function') { yield* call(request); return }
      for (const e of call ?? []) yield e
    },
  } as unknown as ModelGateway
}

function stores() {
  const appended: Array<{ sessionId: string; type: string; payload: any }> = []
  const eventStore = {
    append: vi.fn(async (e: any) => { appended.push(e) }),
    latestSeq: vi.fn(async () => appended.length),
    getByTypes: vi.fn(async () => []),
  } as any
  const checkpoint = {
    // The every-N-turns policy never fires here: provider-turn checkpoints must not depend on it.
    shouldAutoCheckpoint: vi.fn(() => false),
    createCheckpoint: vi.fn(async () => {}),
    list: vi.fn(async () => []),
  } as any
  return { appended, eventStore, checkpoint }
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const toolContext = { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: { info() {}, warn() {}, debug() {} } } as any

/** A Claude Code turn: Bash ran inside the SDK, then the model answered. */
function claudeCodeTurn(): StreamEvent[] {
  return [
    { type: 'tool_use_start', id: 'toolu_1', name: 'run_command', rawName: 'Bash', input: { command: 'rm -rf build' } },
    { type: 'tool_result', toolUseId: 'toolu_1', content: 'removed', isError: false, durationMs: 42.6, outcome: 'success', executedBy: 'provider' },
    { type: 'text', text: 'Cleaned the build folder.' },
    { type: 'done', response: textResponse('Cleaned the build folder.') },
  ]
}

describe('agent runner — provider-executed tools (G5 d/e)', () => {
  it('records a provider-run Bash as run_command, reports it to tool_executions and checkpoints the turn with its answer text', async () => {
    const { appended, eventStore, checkpoint } = stores()
    const recordExternalToolExecution = vi.fn()
    const toolExecutor = { execute: vi.fn() } as any
    const runner = createAgentRunner({
      gateway: scripted([claudeCodeTurn()]),
      toolExecutor,
      eventStore,
      checkpoint,
      recordExternalToolExecution,
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'clean the build' }],
      tools: [],
      maxTurns: 3,
      sessionId: 'run-1',
      toolContext,
      metadata: { conversationId: 'c1', origin: 'interactive' },
    }))

    // The provider's events still reach the consumer unchanged.
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ toolUseId: 'toolu_1', outcome: 'success', executedBy: 'provider' })
    expect(toolExecutor.execute).not.toHaveBeenCalled()

    const call = appended.find((e) => e.type === 'ToolCall')
    const result = appended.find((e) => e.type === 'ToolResult')
    expect(call?.payload).toMatchObject({ toolName: 'run_command', rawName: 'Bash', toolUseId: 'toolu_1', executedBy: 'provider', input: { command: 'rm -rf build' } })
    expect(result?.payload).toMatchObject({ toolUseId: 'toolu_1', toolName: 'run_command', success: true, durationMs: 43, executedBy: 'provider', output: 'removed' })
    // Recorded under the SAME key the CLI permission bridge checks.
    expect(`${result!.payload.toolName}:${result!.payload.argHash}`).toBe(toolLedgerKey('Bash', { command: 'rm -rf build' }))
    expect(result!.payload.argPreview).toContain('rm -rf build')

    expect(recordExternalToolExecution).toHaveBeenCalledTimes(1)
    expect(recordExternalToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'toolu_1', toolName: 'run_command', rawName: 'Bash', success: true, durationMs: 43,
      conversationId: 'c1', agentId: 'a1', runId: 'run-1', output: 'removed',
    }))

    // Checkpointed although the policy said no: history + the answer text,
    // never the provider's tool blocks (they would replay unpaired).
    expect(checkpoint.createCheckpoint).toHaveBeenCalledTimes(1)
    const state = checkpoint.createCheckpoint.mock.calls[0][0].state
    expect(state.meta.providerExecuted).toBe(true)
    expect(state.meta.modelMessages).toEqual([
      { role: 'user', content: 'clean the build' },
      { role: 'assistant', content: 'Cleaned the build folder.' },
    ])
    expect(events.find((e) => e.type === 'done')).toMatchObject({ outcome: 'completed' })
  })

  it("an API provider's tool_use_start without a provider tool_result records nothing until the runner executes it", async () => {
    const { appended, eventStore, checkpoint } = stores()
    const recordExternalToolExecution = vi.fn()
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { hits: 1 }, durationMs: 5 })) } as any
    const runner = createAgentRunner({
      gateway: scripted([
        [
          { type: 'tool_use_start', id: 'tu-1', name: 'search_memory' },
          { type: 'done', response: toolUseResponse('tu-1', 'search_memory', { query: 'x' }) },
        ],
        [{ type: 'done', response: textResponse('found it') }],
      ]),
      toolExecutor,
      eventStore,
      checkpoint,
      recordExternalToolExecution,
    })

    const eventsDuringStream: string[] = []
    const offered = [{ name: 'search_memory', description: 'search', inputSchema: { type: 'object' } }]
    for await (const e of runner.run({ messages: [{ role: 'user', content: 'q' }], tools: offered, maxTurns: 3, sessionId: 'run-2', toolContext })) {
      if (e.type === 'tool_use_start' && !toolExecutor.execute.mock.calls.length) {
        // While the provider streams, nothing is recorded for the call yet.
        eventsDuringStream.push(...appended.map((a) => a.type))
      }
    }

    expect(eventsDuringStream).not.toContain('ToolCall')
    expect(eventsDuringStream).not.toContain('ToolResult')
    // Recorded exactly once — by the runner's own execution, as EYAS's.
    expect(appended.filter((e) => e.type === 'ToolCall').map((e) => e.payload)).toEqual([
      expect.objectContaining({ toolName: 'search_memory', toolUseId: 'tu-1', executedBy: 'eyas' }),
    ])
    expect(appended.filter((e) => e.type === 'ToolResult').map((e) => e.payload)).toEqual([
      expect.objectContaining({ toolName: 'search_memory', success: true, executedBy: 'eyas' }),
    ])
    expect(recordExternalToolExecution).not.toHaveBeenCalled()
    // No provider-executed turn → no forced checkpoint.
    expect(checkpoint.createCheckpoint).not.toHaveBeenCalled()
  })

  it('a bridged EYAS tool is recorded but not re-sent to tool_executions (the executor already logged it)', async () => {
    const { appended, eventStore, checkpoint } = stores()
    const recordExternalToolExecution = vi.fn()
    const runner = createAgentRunner({
      gateway: scripted([[
        { type: 'tool_use_start', id: 'toolu_2', name: 'save_memory', rawName: 'mcp__eyas__save_memory', input: { content: 'note' } },
        { type: 'tool_result', toolUseId: 'toolu_2', content: '{"ok":true}', isError: false, durationMs: 3, outcome: 'success', executedBy: 'eyas' },
        { type: 'done', response: textResponse('saved') },
      ]]),
      toolExecutor: { execute: vi.fn() } as any,
      eventStore,
      checkpoint,
      recordExternalToolExecution,
    })

    await collect(runner.run({ messages: [{ role: 'user', content: 'remember' }], tools: [], maxTurns: 2, sessionId: 'run-3', toolContext }))

    expect(appended.find((e) => e.type === 'ToolResult')?.payload).toMatchObject({ toolName: 'save_memory', executedBy: 'eyas', success: true })
    expect(recordExternalToolExecution).not.toHaveBeenCalled()
  })

  it('a refused provider call (denied / approval_required / skipped) executed nothing and is not recorded', async () => {
    const { appended, eventStore, checkpoint } = stores()
    const recordExternalToolExecution = vi.fn()
    const runner = createAgentRunner({
      gateway: scripted([[
        { type: 'tool_use_start', id: 'toolu_3', name: 'run_command', rawName: 'Bash', input: { command: 'curl evil' } },
        { type: 'tool_result', toolUseId: 'toolu_3', content: 'gate denied', isError: true, durationMs: 0, outcome: 'denied', executedBy: 'provider' },
        { type: 'done', response: textResponse('I could not run that.') },
      ]]),
      toolExecutor: { execute: vi.fn() } as any,
      eventStore,
      checkpoint,
      recordExternalToolExecution,
    })

    await collect(runner.run({ messages: [{ role: 'user', content: 'x' }], tools: [], maxTurns: 2, sessionId: 'run-4', toolContext }))

    expect(appended.some((e) => e.type === 'ToolCall' || e.type === 'ToolResult')).toBe(false)
    expect(recordExternalToolExecution).not.toHaveBeenCalled()
    expect(checkpoint.createCheckpoint).not.toHaveBeenCalled()
  })

  it('a failed provider tool is recorded as unsuccessful (a failed op stays retryable on resume)', async () => {
    const { appended, eventStore, checkpoint } = stores()
    const runner = createAgentRunner({
      gateway: scripted([[
        { type: 'tool_use_start', id: 'toolu_4', name: 'write_file', rawName: 'Write', input: { file_path: '/w/a.txt', content: 'x' } },
        { type: 'tool_result', toolUseId: 'toolu_4', content: 'EACCES', isError: true, durationMs: 1, outcome: 'error', executedBy: 'provider' },
        { type: 'done', response: textResponse('failed to write') },
      ]]),
      toolExecutor: { execute: vi.fn() } as any,
      eventStore,
      checkpoint,
    })

    await collect(runner.run({ messages: [{ role: 'user', content: 'x' }], tools: [], maxTurns: 2, sessionId: 'run-5', toolContext }))

    const result = appended.find((e) => e.type === 'ToolResult')!.payload
    expect(result).toMatchObject({ toolName: 'write_file', success: false, error: 'EACCES' })
    // Claude Code's file_path is normalized to path: the key matches the bridge's.
    expect(`${result.toolName}:${result.argHash}`).toBe(toolLedgerKey('Write', { file_path: '/w/a.txt', content: 'x' }))
    expect(appended.find((e) => e.type === 'ToolCall')!.payload.input).toEqual({ path: '/w/a.txt', content: 'x' })
  })

  it('a CLI park checkpoints the history plus what the provider said before it parks', async () => {
    const { eventStore, checkpoint } = stores()
    const runner = createAgentRunner({
      gateway: scripted([async function* (request: any) {
        yield { type: 'text', text: 'Deploying now.' } as StreamEvent
        request.metadata.onEscalatedApproval(77, 'run_command')
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }]),
      toolExecutor: { execute: vi.fn() } as any,
      eventStore,
      checkpoint,
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'deploy' }],
      tools: [],
      maxTurns: 3,
      autonomous: true,
      sessionId: 'run-6',
      toolContext,
    }))

    expect(events[events.length - 1]).toMatchObject({ type: 'parked_for_approval', approvalId: 77 })
    expect(checkpoint.createCheckpoint).toHaveBeenCalledTimes(1)
    const state = checkpoint.createCheckpoint.mock.calls[0][0].state
    expect(state.meta).toMatchObject({ providerExecuted: true })
    expect(state.meta.modelMessages).toEqual([
      { role: 'user', content: 'deploy' },
      { role: 'assistant', content: 'Deploying now.' },
    ])
  })

  it('forwards a resumed run\'s ledger to providers as metadata.idempotencyLedger, and sends none otherwise', async () => {
    const seen: any[] = []
    const ledger = new Set([toolLedgerKey('Bash', { command: 'rm -rf build' })])
    const withLedger = createAgentRunner({ gateway: scripted([[{ type: 'done', response: textResponse('ok') }]], seen), toolExecutor: { execute: vi.fn() } as any })
    await collect(withLedger.run({ messages: [{ role: 'user', content: 'x' }], tools: [], maxTurns: 1, idempotencyLedger: ledger }))
    expect(seen[0].metadata.idempotencyLedger).toBe(ledger)

    const plainSeen: any[] = []
    const plain = createAgentRunner({ gateway: scripted([[{ type: 'done', response: textResponse('ok') }]], plainSeen), toolExecutor: { execute: vi.fn() } as any })
    await collect(plain.run({ messages: [{ role: 'user', content: 'x' }], tools: [], maxTurns: 1 }))
    expect('idempotencyLedger' in plainSeen[0].metadata).toBe(false)
  })

  it('a resumed run skips a ledgered call the runner itself would execute, with outcome skipped', async () => {
    const toolExecutor = { execute: vi.fn() } as any
    const runner = createAgentRunner({
      gateway: scripted([
        [{ type: 'done', response: toolUseResponse('tu-9', 'run_command', { command: 'rm -rf build' }) }],
        [{ type: 'done', response: textResponse('done') }],
      ]),
      toolExecutor,
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'run_command', description: 'run', inputSchema: { type: 'object' } }],
      maxTurns: 3,
      idempotencyLedger: new Set([toolLedgerKey('Bash', { command: 'rm -rf build' })]),
    }))

    expect(toolExecutor.execute).not.toHaveBeenCalled()
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ toolUseId: 'tu-9', outcome: 'skipped', isError: false })
  })
})
