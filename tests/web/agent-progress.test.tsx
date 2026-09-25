// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G10 — the run panel: "Step N / Max" when the provider reports its steps,
// otherwise "N tool calls" (a CLI that reports no steps is never "Step 1"
// after dozens of calls); the colleague's name comes from its id, with
// "Assistant" as the fallback; the token total is the run's sum.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { get: h.get, post: vi.fn() } }
})

import { AgentProgress, progressLabel } from '@/pages/conversations/components/agent-progress'
import { useLanguageStore } from '@/stores/language-store'

const base = { maxTurns: 25, toolCalls: [], tokensUsed: 2000, isRunning: true }

describe('<AgentProgress>', () => {
  beforeEach(() => {
    useLanguageStore.getState().setLang('en')
    h.get.mockReset()
  })
  afterEach(() => cleanup())

  it('(+) steps known: "Step N / Max"', () => {
    render(<AgentProgress {...base} steps={4} stepsKnown />)
    expect(screen.getByTestId('agent-progress-steps').textContent).toBe('Step 4 / 25')
  })

  it('(−) steps unknown: the tool-call count, never "Step"', () => {
    render(<AgentProgress {...base} toolCalls={[{ toolName: 'a', status: 'success' }, { toolName: 'b', status: 'running' }]} />)
    expect(screen.getByTestId('agent-progress-steps').textContent).toBe('Tool calls: 2')
    expect(progressLabel({ stepsKnown: false, maxTurns: 25, toolCallCount: 0 })).not.toContain('Step')
  })

  it('(+) the colleague name is resolved from its id', async () => {
    h.get.mockResolvedValue({ agent: { name: 'Ada' } })
    render(<AgentProgress {...base} agentId="agent-7" />)
    expect(h.get).toHaveBeenCalledWith('/agents/agent-7')
    await waitFor(() => expect(screen.getByTestId('agent-progress-name').textContent).toBe('Ada'))
  })

  it('(−) no colleague: "Assistant" in the user\'s language, and nothing is fetched', () => {
    useLanguageStore.getState().setLang('hu')
    render(<AgentProgress {...base} agentId={null} />)
    expect(screen.getByTestId('agent-progress-name').textContent).toBe('Asszisztens')
    expect(h.get).not.toHaveBeenCalled()
  })

  it('(+) an explicit run label wins and is not looked up', () => {
    render(<AgentProgress {...base} agentId="agent-7" agentName="God Mode" />)
    expect(screen.getByTestId('agent-progress-name').textContent).toBe('God Mode')
    expect(h.get).not.toHaveBeenCalled()
  })
})
