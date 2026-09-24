// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createPermissionBridge, type PermissionBridgeDeps } from '@modules/model/submodules/claude-code/permission-bridge.js'

const opts = { toolUseID: 'tu1', signal: new AbortController().signal }

function deps(over: Partial<PermissionBridgeDeps> = {}): PermissionBridgeDeps {
  return {
    validateToolCall: () => ({ decision: 'allow', reason: 'green', riskTier: 'green' }),
    ctx: { conversationId: 'c1', agentId: 'a1' },
    ...over,
  }
}

describe('createPermissionBridge', () => {
  it('denies when the security gate denies', async () => {
    const bridge = createPermissionBridge(deps({ validateToolCall: () => ({ decision: 'deny', reason: 'blocked pattern', riskTier: 'red' }) }))
    const r = await bridge('Bash', { command: 'rm -rf /' }, opts)
    expect(r).toMatchObject({ behavior: 'deny', message: expect.stringContaining('blocked pattern') })
  })

  it('interactive: allows a green tool', async () => {
    const r = await createPermissionBridge(deps())('Read', {}, opts)
    expect(r).toMatchObject({ behavior: 'allow' })
  })

  it('interactive: escalate now DENIES and enqueues an approval (fail-closed)', async () => {
    const createApproval = vi.fn()
    const bridge = createPermissionBridge(deps({
      validateToolCall: () => ({ decision: 'escalate', reason: 'no judge-capable model', riskTier: 'yellow' }),
      autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval },
    }))
    const r = await bridge('Write', {}, opts)
    expect(r).toMatchObject({ behavior: 'deny', message: expect.stringContaining('approval required') })
    expect(createApproval).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'Write', reason: 'no judge-capable model' }))
  })

  it('autonomous + L3 category: allows', async () => {
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      autonomy: { categoryForTool: () => 'routine_trivial_fix', resolve: () => ({ level: 3, locked: false, maxLevel: 3 }), createApproval: vi.fn() },
    }))
    expect(await bridge('Edit', {}, opts)).toMatchObject({ behavior: 'allow' })
  })

  it('autonomous + locked/low category: denies and enqueues an approval (fail-closed)', async () => {
    const createApproval = vi.fn()
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      validateToolCall: () => ({ decision: 'escalate', reason: 'yellow', riskTier: 'yellow' }),
      autonomy: { categoryForTool: () => 'data_delete', resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval },
    }))
    const r = await bridge('mcp__eyas__delete_record', {}, opts)
    expect(r).toMatchObject({ behavior: 'deny' })
    expect(createApproval).toHaveBeenCalledWith(expect.objectContaining({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', agentId: 'a1' }))
  })

  it('autonomous with no autonomy policy: fail-closed deny', async () => {
    const bridge = createPermissionBridge(deps({ autonomous: true, autonomy: undefined }))
    expect(await bridge('Bash', {}, opts)).toMatchObject({ behavior: 'deny' })
  })

  it('strips the mcp__eyas__ prefix before validating', async () => {
    const validateToolCall = vi.fn(() => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }))
    await createPermissionBridge(deps({ validateToolCall }))('mcp__eyas__search_memory', { q: 'x' }, opts)
    expect(validateToolCall).toHaveBeenCalledWith('search_memory', { q: 'x' }, expect.objectContaining({ conversationId: 'c1' }))
  })

  it('interactive: judge_error DENIES (fail-closed) — the vendor-neutral no-key case', async () => {
    const bridge = createPermissionBridge(deps({
      validateToolCall: () => ({ decision: 'judge_error', reason: 'Provider not found: anthropic', riskTier: 'red' } as any),
    }))
    const r = await bridge('Bash', { command: 'ls' }, opts)
    expect(r).toMatchObject({ behavior: 'deny', message: expect.stringContaining('fail-closed') })
  })

  it('autonomous + L3: judge_error still DENIES — the ladder never rescues a failed judge', async () => {
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      validateToolCall: () => ({ decision: 'judge_error', reason: 'judge down', riskTier: 'yellow' } as any),
      autonomy: { categoryForTool: () => 'routine_trivial_fix', resolve: () => ({ level: 3, locked: false, maxLevel: 3 }), createApproval: vi.fn() },
    }))
    expect(await bridge('Edit', {}, opts)).toMatchObject({ behavior: 'deny' })
  })

  it('denies an unknown/future gate verdict (exhaustive default)', async () => {
    const bridge = createPermissionBridge(deps({
      validateToolCall: () => ({ decision: 'maybe', reason: '?', riskTier: 'green' } as any),
    }))
    expect(await bridge('Read', {}, opts)).toMatchObject({ behavior: 'deny', message: expect.stringContaining('unknown gate verdict') })
  })

  it('denies when validateToolCall throws (never propagates into the SDK)', async () => {
    const bridge = createPermissionBridge(deps({
      validateToolCall: () => { throw new Error('gate exploded') },
    }))
    await expect(bridge('Bash', {}, opts)).resolves.toMatchObject({ behavior: 'deny', message: expect.stringContaining('gate exploded') })
  })

  it('escalate without an autonomy policy still denies (no approval queue available)', async () => {
    const bridge = createPermissionBridge(deps({
      validateToolCall: () => ({ decision: 'escalate', reason: 'no judge', riskTier: 'yellow' }),
    }))
    expect(await bridge('Write', {}, opts)).toMatchObject({ behavior: 'deny' })
  })

  it('logs every non-allow verdict when a logger is provided', async () => {
    const warn = vi.fn()
    const bridge = createPermissionBridge(deps({
      validateToolCall: () => ({ decision: 'deny', reason: 'blocked', riskTier: 'red' }),
      logger: { warn } as any,
    }))
    await bridge('Bash', {}, opts)
    expect(warn).toHaveBeenCalled()
  })

  it('autonomous locked-category run: createApproval throwing still resolves to deny (not a rejection)', async () => {
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      validateToolCall: () => ({ decision: 'allow', reason: 'green', riskTier: 'green' }),
      autonomy: {
        categoryForTool: () => 'data_delete',
        resolve: () => ({ level: 1, locked: true, maxLevel: 1 }),
        createApproval: () => { throw new Error('approvals DB down') },
      },
    }))
    await expect(bridge('mcp__eyas__delete_record', {}, opts)).resolves.toMatchObject({ behavior: 'deny' })
  })

  it('denies when validateToolCall resolves with a malformed/missing verdict (fail-closed)', async () => {
    const bridge = createPermissionBridge(deps({
      validateToolCall: () => undefined as any,
    }))
    await expect(bridge('Bash', {}, opts)).resolves.toMatchObject({ behavior: 'deny', message: expect.stringContaining('fail-closed') })
  })

  describe('F2 T3 — approval subsystem upgrade', () => {
    it('D14 riskTier fix: an unmapped RED-tier tool in the autonomous ladder now falls into the fail-safe category instead of "uncategorized"', async () => {
      const categoryForTool = vi.fn((_name: string, riskTier?: string) => (riskTier === 'red' ? 'data_delete' : null))
      const createApproval = vi.fn()
      const bridge = createPermissionBridge(deps({
        autonomous: true,
        validateToolCall: () => ({ decision: 'allow', reason: 'ok', riskTier: 'red' }),
        autonomy: { categoryForTool, resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval },
      }))
      const r = await bridge('some_new_destructive_tool', {}, opts)
      expect(categoryForTool).toHaveBeenCalledWith('some_new_destructive_tool', 'red')
      expect(r).toMatchObject({ behavior: 'deny' })
      expect(createApproval).toHaveBeenCalledWith(expect.objectContaining({ category: 'data_delete' }))
    })

    it('escalate branch enqueues with inputJson + argHash + the riskTier-threaded category', async () => {
      const categoryForTool = vi.fn(() => 'file_write')
      const createApproval = vi.fn()
      const bridge = createPermissionBridge(deps({
        validateToolCall: () => ({ decision: 'escalate', reason: 'no judge-capable model', riskTier: 'yellow' }),
        autonomy: { categoryForTool, resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval },
      }))
      await bridge('Write', { file: 'a.txt' }, opts)
      expect(categoryForTool).toHaveBeenCalledWith('Write', 'yellow')
      expect(createApproval).toHaveBeenCalledWith(expect.objectContaining({
        toolName: 'Write',
        inputJson: JSON.stringify({ file: 'a.txt' }),
        argHash: expect.any(String),
      }))
    })

    it('escalate branch: a granted call (consumeGrant) ALLOWS without enqueuing a new approval', async () => {
      const createApproval = vi.fn()
      const consumeGrant = vi.fn(() => ({ granted: true, approvalId: 3 }))
      const bridge = createPermissionBridge(deps({
        validateToolCall: () => ({ decision: 'escalate', reason: 'no judge-capable model', riskTier: 'yellow' }),
        autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval, consumeGrant },
      }))
      const r = await bridge('Write', { file: 'a.txt' }, opts)
      expect(r).toMatchObject({ behavior: 'allow' })
      expect(consumeGrant).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'c1', toolName: 'Write', argHash: expect.any(String) }))
      expect(createApproval).not.toHaveBeenCalled()
    })

    it('escalate branch: a THROWING consumeGrant fails closed to the normal enqueue+deny flow', async () => {
      const createApproval = vi.fn()
      const consumeGrant = vi.fn(() => { throw new Error('approvals table locked') })
      const bridge = createPermissionBridge(deps({
        validateToolCall: () => ({ decision: 'escalate', reason: 'no judge-capable model', riskTier: 'yellow' }),
        autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval, consumeGrant },
      }))
      const r = await bridge('Write', { file: 'a.txt' }, opts)
      expect(r).toMatchObject({ behavior: 'deny' })
      expect(createApproval).toHaveBeenCalledTimes(1)
    })

    it('autonomous ladder branch: a granted call ALLOWS without enqueuing a new approval', async () => {
      const createApproval = vi.fn()
      const consumeGrant = vi.fn(() => ({ granted: true, approvalId: 9 }))
      const bridge = createPermissionBridge(deps({
        autonomous: true,
        autonomy: {
          categoryForTool: () => 'data_delete',
          resolve: () => ({ level: 1, locked: true, maxLevel: 1 }),
          createApproval,
          consumeGrant,
        },
      }))
      const r = await bridge('mcp__eyas__delete_record', {}, opts)
      expect(r).toMatchObject({ behavior: 'allow' })
      expect(consumeGrant).toHaveBeenCalled()
      expect(createApproval).not.toHaveBeenCalled()
    })

    it('I3: escalate branch with no conversation_id in scope skips createApproval and denies with an explicit "cannot receive grants" message', async () => {
      const createApproval = vi.fn()
      const bridge = createPermissionBridge(deps({
        validateToolCall: () => ({ decision: 'escalate', reason: 'no judge-capable model', riskTier: 'yellow' }),
        autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval },
        ctx: { conversationId: undefined, agentId: 'a1' },
      }))
      const r = await bridge('Write', { file: 'a.txt' }, opts)
      expect(r).toMatchObject({ behavior: 'deny', message: expect.stringContaining('cannot receive grants') })
      expect(createApproval).not.toHaveBeenCalled()
    })

    it('I3: autonomous ladder branch with no conversation_id in scope skips createApproval and denies with an explicit "cannot receive grants" message', async () => {
      const createApproval = vi.fn()
      const bridge = createPermissionBridge(deps({
        autonomous: true,
        autonomy: { categoryForTool: () => 'data_delete', resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval },
        ctx: { conversationId: undefined, agentId: 'a1' },
      }))
      const r = await bridge('mcp__eyas__delete_record', {}, opts)
      expect(r).toMatchObject({ behavior: 'deny', message: expect.stringContaining('cannot receive grants') })
      expect(createApproval).not.toHaveBeenCalled()
    })

    it("SECURITY INVARIANT: a grant is never consulted on a gate 'deny' — consumeGrant must not be called", async () => {
      const consumeGrant = vi.fn(() => ({ granted: true, approvalId: 1 }))
      const bridge = createPermissionBridge(deps({
        validateToolCall: () => ({ decision: 'deny', reason: 'blocked pattern', riskTier: 'red' }),
        autonomy: { categoryForTool: () => 'data_delete', resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval: vi.fn(), consumeGrant },
      }))
      const r = await bridge('Bash', { command: 'rm -rf /' }, opts)
      expect(r).toMatchObject({ behavior: 'deny', message: expect.stringContaining('blocked pattern') })
      expect(consumeGrant).not.toHaveBeenCalled()
    })
  })
})
