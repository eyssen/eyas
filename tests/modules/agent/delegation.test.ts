// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createDelegationService } from '@modules/agent/delegation'

/** Synchronous transaction stub — just runs the callback, mirroring sync SQLite. */
const syncTx = <T,>(fn: () => T): T => fn()

describe('Delegation', () => {
  it('rejects delegation beyond max depth', () => {
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([
        { agentId: 'a1' }, { agentId: 'a2' }, { agentId: 'a3' },
      ]),
      createChildConversation: vi.fn(),
      executeAgent: vi.fn(),
      runTransaction: syncTx,
    })
    expect(() => service.validate('a4', 'conv-deep')).toThrow('Maximum delegation depth (3) exceeded')

  })

  it('rejects circular delegation', () => {
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([
        { agentId: 'a1' }, { agentId: 'a2' },
      ]),
      createChildConversation: vi.fn(),
      executeAgent: vi.fn(),
      runTransaction: syncTx,
    })
    expect(() => service.validate('a1', 'conv-mid')).toThrow('Circular delegation detected')
  })

  it('allows valid delegation', () => {
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([{ agentId: 'a1' }]),
      createChildConversation: vi.fn(),
      executeAgent: vi.fn(),
      runTransaction: syncTx,
    })
    expect(() => service.validate('a3', 'conv-1')).not.toThrow()
  })

  it('allows delegation when ancestry is empty', () => {
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([]),
      createChildConversation: vi.fn(),
      executeAgent: vi.fn(),
      runTransaction: syncTx,
    })
    expect(() => service.validate('any-agent', 'conv-root')).not.toThrow()
  })

  it('delegates successfully and returns result', async () => {
    const createChild = vi.fn().mockReturnValue('child-conv-1')
    const executeAgent = vi.fn().mockResolvedValue({ text: 'Task completed successfully', status: 'completed' as const, sessionId: 'sess-1' })
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([{ agentId: 'a1' }]),
      createChildConversation: createChild,
      executeAgent,
      runTransaction: syncTx,
    })

    const result = await service.delegate('parent-conv', 'a2', 'Write tests')

    expect(createChild).toHaveBeenCalledWith('parent-conv', 'a2', 'Write tests')
    expect(executeAgent).toHaveBeenCalledWith('child-conv-1', 'a2', 'Write tests')
    expect(result).toEqual({ conversationId: 'child-conv-1', result: 'Task completed successfully' })
  })

  // F2 T4 — executeAgent's result is now honest: a thrown provider error or a
  // max_turns cap means the run did NOT complete, and delegate() must not
  // report fabricated success prose for either case.
  it('reports an explicit failure string (not the raw text) when the run failed', async () => {
    const executeAgent = vi.fn().mockResolvedValue({ text: 'partial output before the crash', status: 'failed' as const, sessionId: 'sess-2' })
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([{ agentId: 'a1' }]),
      createChildConversation: vi.fn().mockReturnValue('child-conv-2'),
      executeAgent,
      runTransaction: syncTx,
    })

    const result = await service.delegate('parent-conv', 'a2', 'Write tests')

    expect(result.result).not.toBe('partial output before the crash')
    expect(result.result).toContain('did not complete')
    expect(result.result).toContain('failed')
    expect(result.result).toContain('partial output before the crash')
  })

  it('reports an explicit non-success string when the run hit max_turns', async () => {
    const executeAgent = vi.fn().mockResolvedValue({ text: 'ran out of turns', status: 'max_turns' as const, sessionId: 'sess-3' })
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([{ agentId: 'a1' }]),
      createChildConversation: vi.fn().mockReturnValue('child-conv-3'),
      executeAgent,
      runTransaction: syncTx,
    })

    const result = await service.delegate('parent-conv', 'a2', 'Write tests')

    expect(result.result).not.toBe('ran out of turns')
    expect(result.result).toContain('did not complete')
    expect(result.result).toContain('max_turns')
  })

  it('delegate rejects when validation fails', async () => {
    const service = createDelegationService({
      maxDepth: 2,
      getAncestry: vi.fn().mockReturnValue([
        { agentId: 'a1' }, { agentId: 'a2' },
      ]),
      createChildConversation: vi.fn(),
      executeAgent: vi.fn(),
      runTransaction: syncTx,
    })

    await expect(service.delegate('conv-deep', 'a3', 'task')).rejects.toThrow('Maximum delegation depth (2) exceeded')
  })

  it('validate + createChildConversation run inside the same transaction (TOCTOU fix)', async () => {
    // Record call order: the transaction callback must wrap BOTH getAncestry
    // (used by validate) and createChildConversation. executeAgent must run OUTSIDE.
    const callOrder: string[] = []
    const getAncestry = vi.fn(() => {
      callOrder.push('getAncestry')
      return [{ agentId: 'a1' }]
    })
    const createChildConversation = vi.fn(() => {
      callOrder.push('createChildConversation')
      return 'child-2'
    })
    const executeAgent = vi.fn(async () => {
      callOrder.push('executeAgent')
      return { text: 'ok', status: 'completed' as const, sessionId: 'sess-toctou' }
    })
    // Plain spy wrapper so we can assert call count while keeping the generic
    // signature `<T>(fn: () => T) => T` that DelegationDeps.runTransaction expects.
    let txCalls = 0
    const runTransaction = <T>(fn: () => T): T => {
      txCalls++
      callOrder.push('tx:begin')
      try {
        return fn()
      } finally {
        callOrder.push('tx:commit')
      }
    }

    const service = createDelegationService({
      maxDepth: 3,
      getAncestry,
      createChildConversation,
      executeAgent,
      runTransaction,
    })

    await service.delegate('parent', 'a2', 'task')

    expect(txCalls).toBe(1)
    expect(callOrder).toEqual([
      'tx:begin',
      'getAncestry',
      'createChildConversation',
      'tx:commit',
      'executeAgent',
    ])
  })

  it('does not create child conversation when validation fails inside transaction', async () => {
    const createChildConversation = vi.fn()
    let txCalls = 0
    const runTransaction = <T>(fn: () => T): T => {
      txCalls++
      return fn()
    }

    const service = createDelegationService({
      maxDepth: 2,
      getAncestry: vi.fn().mockReturnValue([{ agentId: 'x' }, { agentId: 'y' }]),
      createChildConversation,
      executeAgent: vi.fn(),
      runTransaction,
    })

    await expect(service.delegate('c', 'z', 't')).rejects.toThrow(/Maximum delegation depth/)
    // Transaction was entered but create was never reached — rollback in real DB.
    expect(txCalls).toBe(1)
    expect(createChildConversation).not.toHaveBeenCalled()
  })
})
