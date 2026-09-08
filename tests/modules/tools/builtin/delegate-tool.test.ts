// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createDelegateTool } from '@modules/tools/builtin/delegate-tool'
import { DEFAULT_CONFIG } from '@modules/security-gate/types'

function registry(agents: Array<{ id: string; name: string; tier: string; enabled: boolean }>) {
  return {
    get: (id: string) => agents.find(a => a.id === id),
    list: (filter?: { enabled?: boolean }) =>
      filter?.enabled === true ? agents.filter(a => a.enabled) : agents,
  } as any
}

describe('createDelegateTool', () => {
  const specialist = { id: 'code-reviewer', name: 'Reviewer', tier: 'specialist', enabled: true }
  const engineer = { id: 'system-engineer', name: 'Engineer', tier: 'primary', enabled: true }
  const disabled = { id: 'old', name: 'Old', tier: 'specialist', enabled: false }

  it('registers run_specialist and the delegate_to_agent alias as green, ungated', () => {
    const tools = createDelegateTool({ delegate: vi.fn() } as any)
    expect(tools.map(t => t.name).sort()).toEqual(['delegate_to_agent', 'run_specialist'])
    for (const t of tools) {
      expect(t.riskTier).toBe('green')
      expect(t.requiresApproval).toBe(false)
    }
  })

  it('is listed green in the security-gate config (unclassified would be yellow)', () => {
    expect(DEFAULT_CONFIG.riskTiers.green).toContain('run_specialist')
    expect(DEFAULT_CONFIG.riskTiers.green).toContain('delegate_to_agent')
    expect(DEFAULT_CONFIG.riskTiers.yellow).not.toContain('run_specialist')
    expect(DEFAULT_CONFIG.riskTiers.yellow).not.toContain('delegate_to_agent')
  })

  it('refuses a colleague and names handoff_to_colleague', async () => {
    const delegate = vi.fn()
    const [run] = createDelegateTool({ delegate } as any, registry([engineer, specialist]))
    const out = await run!.execute(
      { agentId: 'system-engineer', task: 'fix the build' },
      { conversationId: 'c1', userId: 'u1', logger: { info() {}, warn() {}, error() {}, debug() {} } as any },
    )
    expect(out.error).toMatch(/handoff_to_colleague/)
    expect(delegate).not.toHaveBeenCalled()
  })

  it('runs an enabled specialist and records an implicit work session', async () => {
    const delegate = vi.fn().mockResolvedValue({ conversationId: 'child-1', result: 'ok' })
    const ensureWorkSession = vi.fn()
    const tools = createDelegateTool(
      { delegate } as any,
      registry([specialist, engineer, disabled]),
      { ensureWorkSession },
    )
    const run = tools.find(t => t.name === 'run_specialist')!
    const alias = tools.find(t => t.name === 'delegate_to_agent')!
    const ctx = {
      conversationId: 'c1',
      userId: 'u1',
      agentId: 'primary-assistant',
      logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
    }
    const out = await run.execute({ agentId: 'code-reviewer', task: 'review src/x.ts' }, ctx)
    expect(out).toMatchObject({ delegatedTo: 'code-reviewer', childConversationId: 'child-1', result: 'ok' })
    expect(ensureWorkSession).toHaveBeenCalledWith('c1', ['primary-assistant', 'code-reviewer'])

    const aliased = await alias.execute({ agentId: 'code-reviewer', task: 'again' }, ctx)
    expect(aliased.delegatedTo).toBe('code-reviewer')
  })

  it('lists specialists (not colleagues) when the id is missing', async () => {
    const [run] = createDelegateTool({ delegate: vi.fn() } as any, registry([engineer, specialist]))
    const out = await run!.execute(
      { agentId: 'nope', task: 'x' },
      { conversationId: 'c1', userId: 'u1', logger: { info() {}, warn() {}, error() {}, debug() {} } as any },
    )
    expect(out.error).toMatch(/not found/)
    expect(out.availableAgents).toEqual([{ id: 'code-reviewer', name: 'Reviewer', tier: 'specialist' }])
  })
})
