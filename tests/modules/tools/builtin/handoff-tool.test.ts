// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createHandoffTool } from '@modules/tools/builtin/handoff-tool'
import { DEFAULT_CONFIG } from '@modules/security-gate/types'

describe('createHandoffTool', () => {
  const engineer = { id: 'system-engineer', name: 'Engineer', tier: 'primary', enabled: true }
  const reviewer = { id: 'code-reviewer', name: 'Reviewer', tier: 'specialist', enabled: true }

  const registry = {
    get: (id: string) => [engineer, reviewer].find(a => a.id === id),
    list: (filter?: { enabled?: boolean }) => {
      const all = [engineer, reviewer]
      return filter?.enabled === true ? all.filter(a => a.enabled) : all
    },
  } as any

  it('is green and ungated', () => {
    const [tool] = createHandoffTool({ getConversations: () => undefined, registry })
    expect(tool!.name).toBe('handoff_to_colleague')
    expect(tool!.riskTier).toBe('green')
    expect(tool!.requiresApproval).toBe(false)
    expect(DEFAULT_CONFIG.riskTiers.green).toContain('handoff_to_colleague')
  })

  it('refuses a specialist and names run_specialist', async () => {
    const getOrCreateHomeThread = vi.fn()
    const [tool] = createHandoffTool({
      getConversations: () => ({ get: () => ({ id: 'c1', userId: 'u1' }), getOrCreateHomeThread } as any),
      registry,
    })
    const out = await tool!.execute(
      { agentId: 'code-reviewer', reason: 'review', summary: 'look at src' },
      { conversationId: 'c1', userId: 'u1', agentId: 'primary-assistant', logger: {} as any },
    )
    expect(out.error).toMatch(/run_specialist/)
    expect(getOrCreateHomeThread).not.toHaveBeenCalled()
  })

  it('opens the colleague home thread and marks it waiting', async () => {
    const home = { id: 'home-1', userId: 'u1', projectId: null }
    const conversations = {
      get: vi.fn().mockReturnValue({ id: 'c1', userId: 'u1', projectId: 'p1', providerId: null, modelId: null }),
      getOrCreateHomeThread: vi.fn().mockReturnValue(home),
      update: vi.fn(),
      addMessage: vi.fn(),
    }
    const bus = { emit: vi.fn() }
    const [tool] = createHandoffTool({ getConversations: () => conversations as any, registry, bus: bus as any })
    const out = await tool!.execute(
      { agentId: 'system-engineer', reason: 'platform work', summary: 'Fix the boot order.' },
      { conversationId: 'c1', userId: 'u1', agentId: 'primary-assistant', logger: {} as any },
    )
    expect(out).toMatchObject({
      handedOff: true,
      conversationId: 'home-1',
      agentId: 'system-engineer',
      agentName: 'Engineer',
    })
    expect(conversations.update).toHaveBeenCalledWith('home-1', expect.objectContaining({ status: 'waiting' }))
    expect(conversations.addMessage).toHaveBeenCalled()
    expect(bus.emit).toHaveBeenCalledWith('eyas.board.task_assigned', expect.objectContaining({
      conversationId: 'home-1',
      agentId: 'system-engineer',
    }))
  })
})
