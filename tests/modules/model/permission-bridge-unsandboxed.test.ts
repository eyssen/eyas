// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — with security.cliSandbox 'auto', Claude Code may ask to run a shell
// command outside the kernel sandbox (Bash with dangerouslyDisableSandbox).
// Such a call is a human's decision: the gate runs only its deterministic
// checkpoint (a deny still wins, memory outside EYAS included), the judge is
// never asked, the autonomy ladder is never reached, and only an approval or
// a human grant for the exact call lets it run. Wired to the REAL security
// gate with a spy judge.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { securityGateModule } from '@modules/security-gate/index.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createPermissionBridge, type PermissionBridgeDeps } from '@modules/model/permission-bridge.js'
import { resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import { UNSANDBOXED_SHELL_REASON, isUnsandboxedShellReason } from '@shared/cli-sandbox.js'
import type { ModelGateway } from '@modules/model/types'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture'
import { auxOk, createFakeAuxiliaryModel } from '../../helpers/fake-auxiliary-model'

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

/** The real gate over a throw-away instance, with a judge that allows everything — and is spied on. */
async function realGate() {
  fx.stubInstanceEnv()
  const auxiliaryModel = createFakeAuxiliaryModel(auxOk('{"verdict":"ALLOW","reason":"fine"}'))
  const judgeCall = vi.spyOn(auxiliaryModel, 'complete')
  const model = { listProviders: () => [{ id: 'mock' }], async complete() { throw new Error('no direct model call') }, async *stream() { /* unused */ } } as unknown as ModelGateway
  const ctx = { db: createMemoryDb(), model, auxiliaryModel, permissions: createPermissionRegistry(), logger: noopLogger, config: {} } as any
  await securityGateModule.onRegister!(ctx)
  return { gate: ctx.securityGate, judgeCall }
}

function autonomyStub(granted = false) {
  return {
    categoryForTool: vi.fn(() => 'shell'),
    resolve: vi.fn(() => ({ level: 3, locked: false, maxLevel: 3 })),
    createApproval: vi.fn((_rec: { reason: string; toolName: string }) => 42),
    consumeGrant: vi.fn(() => (granted ? { granted: true, approvalId: 7 } : { granted: false })),
    defaultExpiresAt: vi.fn(() => '2099-01-01T00:00:00.000Z'),
  }
}

describe.each([
  ['interactive', false],
  ['autonomous', true],
] as const)('permission bridge — a command that asks to leave the sandbox (%s)', (_label, autonomous) => {
  function bridgeWith(validateToolCall: PermissionBridgeDeps['validateToolCall'], over: Partial<PermissionBridgeDeps> = {}) {
    const autonomy = autonomyStub()
    const onEscalatedApproval = vi.fn()
    const onDecision = vi.fn()
    const bridge = createPermissionBridge({
      validateToolCall,
      autonomy,
      autonomous,
      cliSandboxMode: 'auto',
      ctx: { conversationId: 'conv-1', agentId: 'agent-1', runId: 'run-1', workingDirectories: [fx.ownWorkspace] },
      onEscalatedApproval,
      onDecision,
      ...over,
    })
    return { bridge, autonomy, onEscalatedApproval, onDecision }
  }

  it("(+) 'auto': waits for a human — approval enqueued, the judge never called", async () => {
    const { gate, judgeCall } = await realGate()
    const { bridge, autonomy, onEscalatedApproval, onDecision } = bridgeWith(gate.validateToolCall)
    const r = await bridge('Bash', { command: 'ls', dangerouslyDisableSandbox: true }, opts)
    expect(r).toMatchObject({ behavior: 'deny', interrupt: true })
    expect(autonomy.createApproval).toHaveBeenCalledTimes(1)
    expect(isUnsandboxedShellReason(autonomy.createApproval.mock.calls[0]?.[0]?.reason)).toBe(true)
    expect(onEscalatedApproval).toHaveBeenCalledWith(42, 'Bash')
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'approval_required', approvalId: 42 }))
    expect(judgeCall).not.toHaveBeenCalled()
    // Never the autonomy ladder, even at L3.
    expect(autonomy.resolve).not.toHaveBeenCalled()
  })

  it("a gate that answers 'allow' anyway (switched off, a stub) still needs the human", async () => {
    const stub = vi.fn(async (_n: string, _i: Record<string, unknown>, _c?: Record<string, unknown>) => ({ decision: 'allow' as const, reason: 'gate disabled', riskTier: 'green' }))
    const { bridge, autonomy } = bridgeWith(stub)
    const r = await bridge('Bash', { command: 'ls', dangerouslyDisableSandbox: true }, opts)
    expect(r).toMatchObject({ behavior: 'deny' })
    expect(autonomy.createApproval).toHaveBeenCalledWith(expect.objectContaining({ reason: UNSANDBOXED_SHELL_REASON }))
    expect(stub.mock.calls[0][2]).toMatchObject({ requireHuman: true })
  })

  it('a prior human grant for the exact call lets it run once', async () => {
    const { gate, judgeCall } = await realGate()
    const autonomy = autonomyStub(true)
    const bridge = createPermissionBridge({
      validateToolCall: gate.validateToolCall,
      autonomy,
      autonomous,
      cliSandboxMode: 'auto',
      ctx: { conversationId: 'conv-1', workingDirectories: [fx.ownWorkspace] },
    })
    const r = await bridge('Bash', { command: 'npm install', dangerouslyDisableSandbox: true }, opts)
    expect(r).toEqual({ behavior: 'allow' })
    expect(autonomy.consumeGrant).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1', toolName: 'Bash' }))
    expect(autonomy.createApproval).not.toHaveBeenCalled()
    expect(judgeCall).not.toHaveBeenCalled()
  })

  it('a command naming memory outside EYAS is a plain deny — no approval, no grant', async () => {
    const { gate } = await realGate()
    const { bridge, autonomy, onDecision } = bridgeWith(gate.validateToolCall)
    const r = await bridge('Bash', { command: `cat ${fx.claudeMemory}`, dangerouslyDisableSandbox: true }, opts)
    expect(r).toMatchObject({ behavior: 'deny' })
    expect(r).not.toHaveProperty('interrupt')
    expect(autonomy.createApproval).not.toHaveBeenCalled()
    expect(autonomy.consumeGrant).not.toHaveBeenCalled()
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'denied' }))
  })

  it('negative: Bash without the flag follows the normal path (the judge decides a red call)', async () => {
    const { gate, judgeCall } = await realGate()
    const { bridge, autonomy } = bridgeWith(gate.validateToolCall)
    const r = await bridge('Bash', { command: 'make build' }, opts)
    expect(judgeCall).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ behavior: 'allow' })
    expect(autonomy.createApproval).not.toHaveBeenCalled()
  })

  it("negative: in 'required' (or with no sandbox applied) the bridge never sets requireHuman", async () => {
    for (const cliSandboxMode of ['required', undefined] as const) {
      const stub = vi.fn(async (_n: string, _i: Record<string, unknown>, _c?: Record<string, unknown>) => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }))
      const { bridge } = bridgeWith(stub, { cliSandboxMode })
      const r = await bridge('Bash', { command: 'ls', dangerouslyDisableSandbox: true }, opts)
      expect(stub.mock.calls[0][2]).not.toHaveProperty('requireHuman')
      expect(r).toEqual({ behavior: 'allow' })
    }
  })

  it('negative: only a true flag on Bash counts', async () => {
    const stub = vi.fn(async (_n: string, _i: Record<string, unknown>, _c?: Record<string, unknown>) => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }))
    const { bridge } = bridgeWith(stub)
    await bridge('Bash', { command: 'ls', dangerouslyDisableSandbox: 'true' }, opts)
    await bridge('run_command', { command: 'ls', dangerouslyDisableSandbox: true }, opts)
    for (const call of stub.mock.calls) expect(call[2]).not.toHaveProperty('requireHuman')
  })
})
