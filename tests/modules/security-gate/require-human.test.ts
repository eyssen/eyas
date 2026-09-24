// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — callCtx.requireHuman (a shell command that asked to leave the kernel
// sandbox): the gate runs only its deterministic checkpoint. A deny there
// wins; anything else escalates with checkpoint 'deterministic' and riskTier
// 'red', logged to security_events — the LLM judge is never asked and the
// denial streak is left alone.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { securityGateModule } from '@modules/security-gate/index.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import { isUnsandboxedShellReason } from '@shared/cli-sandbox.js'
import type { ModelGateway } from '@modules/model/types'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture'
import { auxOk, createFakeAuxiliaryModel } from '../../helpers/fake-auxiliary-model'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }

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

async function makeGate() {
  fx.stubInstanceEnv()
  const auxiliaryModel = createFakeAuxiliaryModel(auxOk('{"verdict":"ALLOW","reason":"fine"}'))
  const judge = vi.spyOn(auxiliaryModel, 'complete')
  const model = { listProviders: () => [{ id: 'mock' }], async complete() { throw new Error('no direct model call') }, async *stream() { /* unused */ } } as unknown as ModelGateway
  const ctx = { db: createMemoryDb(), model, auxiliaryModel, permissions: createPermissionRegistry(), logger: noopLogger, config: {} } as any
  await securityGateModule.onRegister!(ctx)
  return { ctx, gate: ctx.securityGate, judge }
}

function rows(db: any, toolName: string) {
  return db.all(sql`SELECT * FROM security_events WHERE tool_name = ${toolName}`) as any[]
}

describe('security gate — requireHuman', () => {
  it('a deterministic allow becomes an escalation: deterministic checkpoint, red, logged, the judge never asked', async () => {
    const { ctx, gate, judge } = await makeGate()
    // `git status` is a deterministic allow on its own.
    const plain = await gate.validateToolCall('Bash', { command: 'git status' }, { conversationId: 'c1' })
    expect(plain.decision).toBe('allow')

    const r = await gate.validateToolCall('Bash', { command: 'git status', dangerouslyDisableSandbox: true }, { conversationId: 'c1', requireHuman: true })
    expect(r).toMatchObject({ decision: 'escalate', checkpoint: 'deterministic', riskTier: 'red' })
    expect(isUnsandboxedShellReason(r.reason)).toBe(true)
    expect(judge).not.toHaveBeenCalled()
    const logged = rows(ctx.db, 'Bash').filter((row) => row.decision === 'escalate')
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({ checkpoint: 'deterministic', risk_tier: 'red', conversation_id: 'c1' })
  })

  it('a red call the judge would allow still escalates without the judge', async () => {
    const { gate, judge } = await makeGate()
    const r = await gate.validateToolCall('Bash', { command: 'npm install', dangerouslyDisableSandbox: true }, { requireHuman: true })
    expect(r.decision).toBe('escalate')
    expect(judge).not.toHaveBeenCalled()
  })

  it('a deterministic deny wins: memory outside EYAS and blocklisted input', async () => {
    const { ctx, gate, judge } = await makeGate()
    const memory = await gate.validateToolCall('Bash', { command: `cat ${fx.claudeMemory}`, dangerouslyDisableSandbox: true }, { requireHuman: true })
    expect(memory).toMatchObject({ decision: 'deny', checkpoint: 'deterministic' })
    const blocked = await gate.validateToolCall('Bash', { command: 'sudo ls', dangerouslyDisableSandbox: true }, { requireHuman: true })
    expect(blocked).toMatchObject({ decision: 'deny', checkpoint: 'deterministic' })
    expect(judge).not.toHaveBeenCalled()
    expect(rows(ctx.db, 'Bash').every((row) => row.decision === 'deny')).toBe(true)
  })

  it('with the gate switched off: the memory deny still stands, everything else still needs the human', async () => {
    const { gate, judge } = await makeGate()
    gate.config.enabled = false
    try {
      const memory = await gate.validateToolCall('Bash', { command: `cat ${fx.claudeMemory}` }, { requireHuman: true })
      expect(memory.decision).toBe('deny')
      const other = await gate.validateToolCall('Bash', { command: 'ls' }, { requireHuman: true })
      expect(other).toMatchObject({ decision: 'escalate', checkpoint: 'deterministic', riskTier: 'red' })
      // Negative control: without requireHuman the switched-off gate allows.
      expect((await gate.validateToolCall('Bash', { command: 'ls' })).decision).toBe('allow')
      expect(judge).not.toHaveBeenCalled()
    } finally {
      gate.config.enabled = true
    }
  })

  it('negative: without requireHuman a red Bash call goes to the judge as before', async () => {
    const { gate, judge } = await makeGate()
    const r = await gate.validateToolCall('Bash', { command: 'npm install' })
    expect(judge).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ decision: 'allow', checkpoint: 'llm_judge' })
  })

  it('escalations for a human never feed the denial streak', async () => {
    const { gate } = await makeGate()
    for (let i = 0; i < 5; i++) {
      await gate.validateToolCall('Bash', { command: `echo ${i}`, dangerouslyDisableSandbox: true }, { requireHuman: true })
    }
    // A green call is still allowed afterwards: no lockout.
    expect((await gate.validateToolCall('read_file', { path: fx.ownFile }, { workingDirectories: [fx.ownWorkspace] })).decision).toBe('allow')
  })
})
