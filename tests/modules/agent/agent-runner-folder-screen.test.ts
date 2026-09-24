// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K2 — a stored folder a protection rule now refuses (saved before the rule,
// inherited from a project, or a vault created in it since) is left out of
// the run for every channel: the provider request metadata (a CLI's cwd,
// jail and hook roots), the security gate's folders and the executor's
// context. The run says so once, with a folderRefused notice. Throw-away
// layout only (tests/helpers/memory-sovereignty-fixture.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import { NoticeSchema } from '@shared/chat-stream.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'

const silentLogger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child: () => silentLogger }

function response(content: ModelResponse['content'], stopReason: ModelResponse['stopReason']): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content, stopReason, usage: { inputTokens: 1, outputTokens: 1 } }
}

function gateway(captured: { metadata?: ModelRequest['metadata'] }): ModelGateway {
  const replies = [
    response([{ type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'a.md' } }], 'tool_use'),
    response([{ type: 'text', text: 'done' }], 'end'),
  ]
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(),
    async *stream(request: ModelRequest) {
      captured.metadata ??= request.metadata
      yield { type: 'done', response: replies[i++] ?? replies[1] } as StreamEvent
    },
  } as unknown as ModelGateway
}

async function run(toolContext: Record<string, unknown>) {
  const captured: { metadata?: ModelRequest['metadata'] } = {}
  const validateToolCall = vi.fn(async () => ({ decision: 'allow', reason: 'green', riskTier: 'green' }))
  const execute = vi.fn(async (..._args: unknown[]) => ({ success: true, output: { ok: true }, durationMs: 1 }))
  const warn = vi.fn()
  const runner = createAgentRunner({
    gateway: gateway(captured),
    toolExecutor: { execute },
    securityGate: { validateToolCall },
    logger: { info: vi.fn(), debug: vi.fn(), warn },
  } as any)
  const events: any[] = []
  for await (const event of runner.run({
    messages: [{ role: 'user', content: 'go' }],
    tools: [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
    maxTurns: 3,
    metadata: { conversationId: 'conv-1', origin: 'interactive' },
    toolContext: { conversationId: 'conv-1', userId: 'u1', logger: silentLogger, ...toolContext },
  } as any)) events.push(event)
  return { events, metadata: captured.metadata, validateToolCall, execute, warn }
}

describe('agent runner — stored folders refused at run time (K2)', () => {
  let f: SovereigntyFixture
  let project: string

  beforeEach(() => {
    f = createSovereigntyFixture()
    installPathPolicy(f.policy)
    vi.stubEnv('HOME', f.home)
    project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
  })
  afterEach(() => {
    resetPathPolicyForTests()
    vi.unstubAllEnvs()
    f.cleanup()
  })

  it('(−) a checkout holding the EYAS data dir is left out of the metadata, the gate and the executor, with one notice', async () => {
    const { events, metadata, validateToolCall, execute, warn } = await run({ workingDirectory: f.repo, workingDirectories: [f.repo, project] })

    const notices = events.filter((e) => e.type === 'notice')
    expect(notices).toEqual([{ type: 'notice', code: 'folderRefused', params: { path: f.repo, reason: 'containsEyasData' } }])
    expect(NoticeSchema.safeParse({ code: notices[0].code, params: notices[0].params }).success).toBe(true)
    // The notice comes before the model is asked anything.
    expect(events[0].type).toBe('notice')

    expect(metadata?.workingDirectory).toBe(project)
    expect(metadata?.workingDirectories).toEqual([project])
    expect(validateToolCall).toHaveBeenCalledWith('read_file', { path: 'a.md' }, expect.objectContaining({ workingDirectories: [project] }))
    const execCtx = execute.mock.calls[0]?.[2] as { workingDirectory?: string; workingDirectories?: string[] }
    expect(execCtx.workingDirectory).toBe(project)
    expect(execCtx.workingDirectories).toEqual([project])
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ folder: f.repo, code: 'containsEyasData' }), expect.any(String))
  })

  it('(−) ~/Documents holding a vault, as the only folder: the run gets no folder at all', async () => {
    const documents = join(f.home, 'Documents')
    mkdirSync(join(documents, 'Vault', '.obsidian'), { recursive: true })
    const { events, metadata, validateToolCall } = await run({ workingDirectory: documents, workingDirectories: [documents] })
    expect(events.filter((e) => e.type === 'notice').map((e) => e.params)).toEqual([{ path: documents, reason: 'containsVault' }])
    expect(metadata?.workingDirectory).toBeUndefined()
    expect(metadata?.workingDirectories).toBeUndefined()
    const ctx = (validateToolCall.mock.calls[0] as unknown[])[2] as { workingDirectories?: string[] }
    expect(ctx.workingDirectories).toBeUndefined()
  })

  it('(+) allowed folders — and a missing one — go through unchanged, without a notice', async () => {
    const missing = join(f.root, 'gone')
    const { events, metadata, warn } = await run({ workingDirectory: project, workingDirectories: [project, missing] })
    expect(events.some((e) => e.type === 'notice')).toBe(false)
    expect(metadata?.workingDirectory).toBe(project)
    expect(metadata?.workingDirectories).toEqual([project, missing])
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ code: expect.anything() }), expect.stringContaining('stored folder refused'))
  })

  it('(+) a run with no folders is not screened', async () => {
    const { events, metadata } = await run({})
    expect(events.some((e) => e.type === 'notice')).toBe(false)
    expect(metadata?.workingDirectories).toBeUndefined()
  })
})
