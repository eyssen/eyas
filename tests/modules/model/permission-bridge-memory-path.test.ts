// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B2 through the CLI permission bridge (Claude Code canUseTool, Grok/Kimi ACP
// permission requests), wired to the REAL security gate module: a memory-path
// violation is a deny in interactive and autonomous runs alike. No approval
// is enqueued and no standing grant is consumed — a human cannot open this
// door by approving, because nothing asks.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { join } from 'node:path'
import { createMemoryDb } from '../../helpers/test-db'
import { securityGateModule } from '@modules/security-gate/index.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createPermissionBridge, type PermissionBridgeDeps } from '@modules/model/permission-bridge.js'
import { resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import type { ModelGateway } from '@modules/model/types'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }
const opts = { toolUseID: 'tu1', signal: new AbortController().signal }

let fx: SovereigntyFixture
beforeAll(() => {
  fx = createSovereigntyFixture()
})
afterEach(() => {
  resetPathPolicyForTests()
  vi.unstubAllEnvs()
})
afterAll(() => {
  fx.cleanup()
})

/** The real gate over a throw-away instance. The judge must never be asked. */
async function realGate() {
  fx.stubInstanceEnv()
  const complete = vi.fn(async () => { throw new Error('the judge must not be called') })
  const model = {
    listProviders: () => [{ id: 'mock' }],
    complete,
    async *stream() { /* unused */ },
  } as unknown as ModelGateway
  const ctx = { db: createMemoryDb(), model, permissions: createPermissionRegistry(), logger: noopLogger, config: {} } as any
  await securityGateModule.onRegister!(ctx)
  return { gate: ctx.securityGate, complete }
}

function autonomyStub() {
  return {
    categoryForTool: vi.fn(() => null),
    resolve: vi.fn(() => ({ level: 3, locked: false, maxLevel: 3 })),
    createApproval: vi.fn(() => 1),
    consumeGrant: vi.fn(() => ({ granted: true, approvalId: 7 })),
    defaultExpiresAt: vi.fn(() => '2099-01-01T00:00:00.000Z'),
  }
}

describe.each([
  ['interactive', false],
  ['autonomous', true],
] as const)('permission bridge — memory outside EYAS (%s)', (_label, autonomous) => {
  async function bridgeFor(over: Partial<PermissionBridgeDeps> = {}) {
    const { gate, complete } = await realGate()
    const autonomy = autonomyStub()
    const onEscalatedApproval = vi.fn()
    const bridge = createPermissionBridge({
      validateToolCall: gate.validateToolCall,
      autonomy,
      autonomous,
      ctx: { conversationId: 'conv-1', agentId: 'agent-1', runId: 'run-1', workingDirectories: [fx.ownWorkspace] },
      onEscalatedApproval,
      ...over,
    })
    return { bridge, autonomy, onEscalatedApproval, complete }
  }

  it('(+) a Read of another tool\'s memory is denied: no approval, no grant, no judge', async () => {
    const { bridge, autonomy, onEscalatedApproval, complete } = await bridgeFor()
    const r = await bridge('Read', { file_path: fx.claudeMemory }, opts)
    expect(r).toMatchObject({ behavior: 'deny' })
    expect(r.behavior === 'deny' && r.message).toMatch(/Memory outside EYAS/)
    expect(r.behavior === 'deny' && r.interrupt).toBeFalsy()
    expect(autonomy.createApproval).not.toHaveBeenCalled()
    expect(autonomy.consumeGrant).not.toHaveBeenCalled()
    expect(onEscalatedApproval).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('(+) a bridged EYAS tool name and an ACP rawInput shape are refused the same way', async () => {
    const { bridge, autonomy } = await bridgeFor()
    expect((await bridge('mcp__eyas__read_file', { path: fx.vaultNote }, opts)).behavior).toBe('deny')
    expect((await bridge('AcpUnmappedTool', { target_directory: fx.vault }, opts)).behavior).toBe('deny')
    expect((await bridge('Write', { file_path: fx.eyasVaultNote, content: 'x' }, opts)).behavior).toBe('deny')
    expect(autonomy.createApproval).not.toHaveBeenCalled()
    expect(autonomy.consumeGrant).not.toHaveBeenCalled()
  })

  it('(+) another conversation\'s workspace is refused from the ctx working folders', async () => {
    const { bridge } = await bridgeFor()
    const r = await bridge('Read', { file_path: fx.otherFile }, opts)
    expect(r.behavior).toBe('deny')
    expect(r.behavior === 'deny' && r.message).toMatch(/Not this conversation's workspace/)
  })

  it('(−) a read inside the turn\'s own workspace passes', async () => {
    const { bridge, autonomy } = await bridgeFor()
    expect(await bridge('Read', { file_path: fx.ownFile }, opts)).toEqual({ behavior: 'allow' })
    expect(await bridge('Read', { file_path: 'out.md' }, opts)).toEqual({ behavior: 'allow' })
    expect(autonomy.createApproval).not.toHaveBeenCalled()
  })

  it('(−) without working folders, another workspace is not refused — foreign memory still is', async () => {
    const { bridge } = await bridgeFor({ ctx: { conversationId: 'conv-1' } })
    expect((await bridge('Read', { file_path: fx.otherFile }, opts)).behavior).toBe('allow')
    expect((await bridge('Read', { file_path: fx.grokMemory }, opts)).behavior).toBe('deny')
  })

  it('(+) the gate sees the bridge ctx working folders unchanged', async () => {
    const validateToolCall = vi.fn(() => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }))
    const bridge = createPermissionBridge({
      validateToolCall,
      autonomous: false,
      ctx: { conversationId: 'conv-1', workingDirectories: [fx.ownWorkspace, join(fx.repo, 'src')] },
    })
    await bridge('Read', { file_path: fx.ownFile }, opts)
    expect(validateToolCall).toHaveBeenCalledWith('Read', { file_path: fx.ownFile }, expect.objectContaining({
      workingDirectories: [fx.ownWorkspace, join(fx.repo, 'src')],
    }))
  })
})
