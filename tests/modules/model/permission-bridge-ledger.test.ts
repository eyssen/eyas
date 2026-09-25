// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G5 — the CLI half of the do-not-repeat ledger, and the decision observer.
// A CLI (Claude Code, Grok, Kimi) runs its tools itself, so the permission
// bridge is the only EYAS code that sees such a call before it runs: a resumed
// run's ledger (toolLedgerKey entries of destructive calls its predecessor
// already executed) turns a gate ALLOW into a refusal for an exact repeat. It
// never widens a verdict. onDecision reports every non-allow verdict once, so
// the provider can settle the tool row with the real outcome.

import { describe, it, expect, vi } from 'vitest'
import {
  createPermissionBridge,
  LEDGER_DUPLICATE_MESSAGE,
  type BridgeDecision,
  type PermissionBridgeDeps,
} from '@modules/model/permission-bridge.js'
import { toolLedgerKey } from '@shared/arg-hash.js'

const opts = (toolUseID = 'toolu_1') => ({ toolUseID, signal: new AbortController().signal })

const allowGate = () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' })
const escalateGate = () => ({ decision: 'escalate' as const, reason: 'needs review', riskTier: 'yellow' })
const denyGate = () => ({ decision: 'deny' as const, reason: 'blocklisted', riskTier: 'red' })

function deps(over: Partial<PermissionBridgeDeps> = {}): PermissionBridgeDeps {
  return {
    validateToolCall: allowGate,
    ctx: { conversationId: 'c1', agentId: 'a1', runId: 'run-2' },
    ...over,
  }
}

const done = toolLedgerKey('Bash', { command: 'rm -rf build' })

describe('permission bridge — do-not-repeat ledger (G5)', () => {
  it('refuses a ledgered call with the duplicate message even though the gate allowed it', async () => {
    const validateToolCall = vi.fn(allowGate)
    const bridge = createPermissionBridge(deps({ validateToolCall, ledger: new Set([done]) }))

    const r = await bridge('Bash', { command: 'rm -rf build' }, opts())

    expect(validateToolCall).toHaveBeenCalledTimes(1) // the gate still decides first
    expect(r).toEqual({ behavior: 'deny', message: `Bash: ${LEDGER_DUPLICATE_MESSAGE}` })
    expect(LEDGER_DUPLICATE_MESSAGE).toBe('already executed on the original run — duplicate side effect prevented')
  })

  it('matches on canonical names and normalized inputs, whichever runtime reports the call', async () => {
    const ledger = new Set([
      toolLedgerKey('run_command', { command: 'make deploy' }),
      toolLedgerKey('write_file', { path: '/w/out.txt', content: 'x' }),
      toolLedgerKey('save_memory', { content: 'note' }),
    ])
    const bridge = createPermissionBridge(deps({ ledger }))

    // Claude Code builtin name for an EYAS-recorded run_command
    expect((await bridge('Bash', { command: 'make deploy' }, opts())).behavior).toBe('deny')
    // Claude Code's file_path is EYAS's path
    expect((await bridge('Write', { file_path: '/w/out.txt', content: 'x' }, opts())).behavior).toBe('deny')
    // a bridged EYAS tool
    expect((await bridge('mcp__eyas__save_memory', { content: 'note' }, opts())).behavior).toBe('deny')
  })

  it('also guards an autonomous run the ladder allows, and a call a consumed grant allows', async () => {
    const ladder = createPermissionBridge(deps({
      autonomous: true,
      autonomy: { categoryForTool: () => 'deploy_retry', resolve: () => ({ level: 3, locked: false, maxLevel: 3 }), createApproval: vi.fn() },
      ledger: new Set([done]),
    }))
    expect((await ladder('Bash', { command: 'rm -rf build' }, opts())).behavior).toBe('deny')

    const granted = createPermissionBridge(deps({
      validateToolCall: escalateGate,
      autonomy: {
        categoryForTool: () => null,
        resolve: () => ({ level: 1, locked: false, maxLevel: 3 }),
        createApproval: vi.fn(),
        consumeGrant: () => ({ granted: true, approvalId: 9 }),
      },
      ledger: new Set([done]),
    }))
    expect((await granted('Bash', { command: 'rm -rf build' }, opts())).behavior).toBe('deny')
  })

  it('allows a call that is not in the ledger, and the same tool with other arguments', async () => {
    const bridge = createPermissionBridge(deps({ ledger: new Set([done]) }))

    expect(await bridge('Read', { file_path: '/w/a.txt' }, opts())).toEqual({ behavior: 'allow' })
    expect(await bridge('Bash', { command: 'rm -rf dist' }, opts())).toEqual({ behavior: 'allow' })
  })

  it('an empty or absent ledger changes nothing', async () => {
    expect(await createPermissionBridge(deps({ ledger: new Set() }))('Bash', { command: 'rm -rf build' }, opts())).toEqual({ behavior: 'allow' })
    expect(await createPermissionBridge(deps())('Bash', { command: 'rm -rf build' }, opts())).toEqual({ behavior: 'allow' })
  })

  it('never widens a verdict: a gate deny of a ledgered call stays a gate deny', async () => {
    const onDecision = vi.fn()
    const bridge = createPermissionBridge(deps({ validateToolCall: denyGate, ledger: new Set([done]), onDecision }))

    const r = await bridge('Bash', { command: 'rm -rf build' }, opts())

    expect(r).toMatchObject({ behavior: 'deny', message: 'gate denied Bash: blocklisted' })
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'denied' }))
  })
})

describe('permission bridge — onDecision observer (G5)', () => {
  it('fires with the approval id on an escalation, and passes the runtime tool-use id through', async () => {
    const decisions: BridgeDecision[] = []
    const bridge = createPermissionBridge(deps({
      validateToolCall: escalateGate,
      autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval: () => 501 },
      onDecision: (d) => decisions.push(d),
    }))

    await bridge('Write', { path: '/tmp/x' }, opts('toolu_esc'))

    expect(decisions).toEqual([{
      toolUseId: 'toolu_esc',
      toolName: 'Write',
      outcome: 'approval_required',
      reason: 'approval required for Write (gate escalated): needs review',
      approvalId: 501,
    }])
  })

  it('fires with the approval id when the autonomy ladder holds a call', async () => {
    const onDecision = vi.fn()
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      autonomy: { categoryForTool: () => 'data_delete', resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval: () => 777 },
      onDecision,
    }))

    await bridge('mcp__eyas__delete_record', { id: 1 }, opts('toolu_l'))

    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ toolUseId: 'toolu_l', toolName: 'delete_record', outcome: 'approval_required', approvalId: 777 }))
  })

  it('an escalation with no queue row reports approval_required without an id', async () => {
    const onDecision = vi.fn()
    const bridge = createPermissionBridge(deps({
      ctx: { agentId: 'a1' }, // no conversation scope: no row can be created
      validateToolCall: escalateGate,
      autonomy: { categoryForTool: () => null, resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval: vi.fn(() => 1) },
      onDecision,
    }))

    await bridge('Write', {}, opts())

    const [decision] = onDecision.mock.calls[0]
    expect(decision.outcome).toBe('approval_required')
    expect(decision.approvalId).toBeUndefined()
    expect(decision.reason).toContain('cannot receive grants')
  })

  it('an escalation with no queue row never interrupts the provider, even with a park sink (nothing to park on)', async () => {
    const noScope = createPermissionBridge(deps({
      ctx: { agentId: 'a1' },
      validateToolCall: escalateGate,
      autonomy: { categoryForTool: () => null, resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval: vi.fn(() => 1) },
      onEscalatedApproval: vi.fn(),
      onDecision: vi.fn(),
    }))
    expect(await noScope('Write', {}, opts())).not.toHaveProperty('interrupt')

    // With a row, the same escalation still interrupts so the run can park.
    const scoped = createPermissionBridge(deps({
      validateToolCall: escalateGate,
      autonomy: { categoryForTool: () => null, resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval: vi.fn(() => 5) },
      onEscalatedApproval: vi.fn(),
    }))
    expect(await scoped('Write', {}, opts())).toMatchObject({ behavior: 'deny', interrupt: true })
  })

  it("reports every refusal as 'denied' (gate deny, judge error, thrown or malformed gate, no autonomy policy)", async () => {
    const cases: Array<Partial<PermissionBridgeDeps>> = [
      { validateToolCall: denyGate },
      { validateToolCall: () => ({ decision: 'judge_error' as const, reason: 'timeout', riskTier: 'yellow' }) },
      { validateToolCall: () => { throw new Error('gate down') } },
      { validateToolCall: () => undefined as any },
      { autonomous: true }, // autonomous run, no ladder wired
    ]
    for (const c of cases) {
      const onDecision = vi.fn()
      const r = await createPermissionBridge(deps({ ...c, onDecision }))('Bash', { command: 'ls' }, opts())
      expect(r.behavior).toBe('deny')
      expect(onDecision).toHaveBeenCalledTimes(1)
      expect(onDecision.mock.calls[0][0]).toMatchObject({ toolUseId: 'toolu_1', toolName: 'Bash', outcome: 'denied' })
    }
  })

  it("reports a ledger hit as 'skipped' (it already ran on the original run)", async () => {
    const onDecision = vi.fn()
    const bridge = createPermissionBridge(deps({ ledger: new Set([done]), onDecision }))

    await bridge('Bash', { command: 'rm -rf build' }, opts('toolu_dup'))

    expect(onDecision).toHaveBeenCalledWith({
      toolUseId: 'toolu_dup', toolName: 'Bash', outcome: 'skipped', reason: `Bash: ${LEDGER_DUPLICATE_MESSAGE}`,
    })
  })

  it('never fires on an allow (interactive, ladder L3, uncategorized, consumed grant)', async () => {
    const onDecision = vi.fn()
    await createPermissionBridge(deps({ onDecision }))('Read', { path: '/a' }, opts())
    await createPermissionBridge(deps({
      autonomous: true,
      autonomy: { categoryForTool: () => 'deploy_retry', resolve: () => ({ level: 3, locked: false, maxLevel: 3 }), createApproval: vi.fn() },
      onDecision,
    }))('Bash', { command: 'ls' }, opts())
    await createPermissionBridge(deps({
      autonomous: true,
      autonomy: { categoryForTool: () => null, resolve: vi.fn(), createApproval: vi.fn() } as any,
      onDecision,
    }))('Read', { path: '/b' }, opts())
    await createPermissionBridge(deps({
      validateToolCall: escalateGate,
      autonomy: { categoryForTool: () => null, resolve: vi.fn(), createApproval: vi.fn(), consumeGrant: () => ({ granted: true, approvalId: 3 }) } as any,
      onDecision,
    }))('Write', { path: '/c' }, opts())

    expect(onDecision).not.toHaveBeenCalled()
  })

  it('a throwing observer never changes the verdict', async () => {
    const bridge = createPermissionBridge(deps({
      validateToolCall: denyGate,
      onDecision: () => { throw new Error('observer broke') },
    }))

    await expect(bridge('Bash', { command: 'ls' }, opts())).resolves.toMatchObject({ behavior: 'deny', message: 'gate denied Bash: blocklisted' })
  })
})
