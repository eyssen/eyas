// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E6 — the effort of a scheduled agent run: the shared EffortSelect in the
// scheduler's create form (once the agent id names a known agent) and in the
// job drawer. Its rungs follow the chosen agent's model, Auto names the
// agent's own effort, and Auto stores no effort key.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { get, post, patch, del, toastError, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), toastError: vi.fn(), FakeApiError }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))
vi.mock('@/lib/api', () => ({ api: { get, post, patch, delete: del }, ApiError: FakeApiError }))
// See scheduler-page.test.tsx: the header's help icon is unrelated and needs a second React copy.
vi.mock('@/components/docs/contextual-help', () => ({ ContextualHelp: () => null }))

import SchedulerPage from '@/pages/scheduler/scheduler-page'
import { t } from '@/pages/scheduler/i18n'
import {
  agentEffortIntent,
  agentRunConfigOf,
  agentRunHandlerConfig,
  withAgentRunEffort,
} from '@/pages/scheduler/agent-run-effort'
import { effortOptionsFor, type EffortOptions } from '@/lib/effort-options'
import { useLanguageStore } from '@/stores/language-store'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import type { ScheduledJob } from '@/pages/scheduler/types'

const registry = createReasoningRegistry({ getDiscovered: () => null })
const pinned = (providerId: string, modelId: string): EffortOptions =>
  effortOptionsFor(registry.get(providerId, modelId), { providerId, modelId, name: modelId })

const AGENTS = [
  { id: 'writer', name: 'Writer', provider: 'anthropic', model: 'claude-opus-4-8', effort: 'low' },
  { id: 'coder', name: 'Coder', provider: 'openai', model: 'gpt-5.5', effort: null },
]

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1',
    name: 'Nightly digest',
    triggerType: 'cron',
    triggerConfig: '{}',
    handler: 'scheduler.agent_run',
    kind: 'agent_run',
    status: 'active',
    runCount: 0,
    failCount: 0,
    source: 'user',
    runnability: { runnable: true },
    ...overrides,
  }
}

function installApi(jobs: ScheduledJob[] = []): void {
  get.mockImplementation((path: string) => {
    if (path.startsWith('/scheduler/jobs/')) {
      const id = path.slice('/scheduler/jobs/'.length).split('?')[0]
      return Promise.resolve({ job: jobs.find((j) => j.id === id), executions: [] })
    }
    if (path.startsWith('/scheduler/jobs')) return Promise.resolve({ jobs })
    if (path === '/scheduler/health') return Promise.resolve({ leader: true, activeJobs: 0, running: 0, failed24h: 0, deadLetter: 0, overdue: 0, unrunnable: 0 })
    if (path === '/scheduler/handlers') return Promise.resolve({ handlers: ['scheduler.agent_run'] })
    if (path.startsWith('/scheduler/timeline')) return Promise.resolve({ timeline: [], projections: [] })
    if (path.startsWith('/agents?')) return Promise.resolve({ agents: AGENTS })
    if (path.startsWith('/agents/')) {
      const agent = AGENTS.find((a) => a.id === path.slice('/agents/'.length))
      return agent ? Promise.resolve({ agent }) : Promise.reject(new FakeApiError(404, 'Agent not found'))
    }
    if (path.startsWith('/model/effort-options')) {
      const params = new URLSearchParams(path.split('?')[1] ?? '')
      return Promise.resolve(pinned(params.get('providerId') ?? '', params.get('modelId') ?? ''))
    }
    return Promise.resolve({})
  })
}

function inputNear(labelText: string): HTMLInputElement {
  const input = screen.getByText(labelText).parentElement?.querySelector('input')
  if (!input) throw new Error(`no <input> near label "${labelText}"`)
  return input
}
const effortSelect = () => screen.queryByTestId('effort-select') as HTMLSelectElement | null
const optionValues = () => Array.from(effortSelect()!.options).map((o) => o.value)
const optionTexts = () => Array.from(effortSelect()!.options).map((o) => o.textContent ?? '')

async function openAgentRunForm(user: ReturnType<typeof userEvent.setup>) {
  render(<SchedulerPage />)
  await user.click(screen.getByText(t('scheduler.createJob')))
  await user.click(await screen.findByText(t('scheduler.kind.agent_run')))
  await user.type(inputNear(t('common.name')), 'Digest')
  await user.type(inputNear(t('scheduler.prompt')), 'Summarise the day')
}

beforeEach(() => {
  vi.clearAllMocks()
  useLanguageStore.getState().setLang('en')
  post.mockResolvedValue({})
  patch.mockResolvedValue({})
})
afterEach(() => cleanup())

describe('scheduler create form — agent_run effort (E6)', () => {
  it("(+) the options follow the chosen agent's model, and Auto names the agent's effort", async () => {
    installApi()
    const user = userEvent.setup()
    await openAgentRunForm(user)

    await user.type(inputNear(t('scheduler.agentId')), 'writer')
    await waitFor(() => expect(effortSelect()?.options.length ?? 0).toBeGreaterThan(1))
    expect(get).toHaveBeenCalledWith('/model/effort-options?providerId=anthropic&modelId=claude-opus-4-8')
    expect(optionValues()).toEqual(['auto', ...pinned('anthropic', 'claude-opus-4-8').levels])
    expect(optionTexts()[0]).toBe('Auto · Low (colleague)')

    const agentInput = inputNear(t('scheduler.agentId'))
    await user.clear(agentInput)
    await user.type(agentInput, 'coder')
    await waitFor(() => expect(optionValues()).toEqual(['auto', ...pinned('openai', 'gpt-5.5').levels]))
    expect(get).toHaveBeenCalledWith('/model/effort-options?providerId=openai&modelId=gpt-5.5')
    // No agent effort: Auto is the model's own default.
    expect(optionTexts()[0]).not.toContain('colleague')
  })

  it('(−) no select before the agent id names a known agent, and no lookup per keystroke', async () => {
    installApi()
    const user = userEvent.setup()
    await openAgentRunForm(user)
    expect(effortSelect()).toBeNull()

    await user.type(inputNear(t('scheduler.agentId')), 'ghost')
    expect(effortSelect()).toBeNull()
    expect(get.mock.calls.some(([p]) => typeof p === 'string' && /^\/agents\/[^?]/.test(p))).toBe(false)
  })

  it('(+) a chosen rung is saved in handlerConfig.effort', async () => {
    installApi()
    const user = userEvent.setup()
    await openAgentRunForm(user)
    await user.type(inputNear(t('scheduler.agentId')), 'writer')
    await waitFor(() => expect(optionValues()).toContain('high'))
    await user.selectOptions(effortSelect()!, 'high')
    await user.click(screen.getByText(t('common.create')))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/scheduler/jobs', expect.anything()))
    const body = post.mock.calls[0]![1] as { handlerConfig: string }
    expect(JSON.parse(body.handlerConfig)).toEqual({ agentId: 'writer', prompt: 'Summarise the day', title: 'Digest', effort: 'high' })
  })

  it('(−) Auto emits no effort key', async () => {
    installApi()
    const user = userEvent.setup()
    await openAgentRunForm(user)
    await user.type(inputNear(t('scheduler.agentId')), 'writer')
    await waitFor(() => expect(optionValues()).toContain('high'))
    await user.selectOptions(effortSelect()!, 'high')
    await user.selectOptions(effortSelect()!, 'auto')
    await user.click(screen.getByText(t('common.create')))

    await waitFor(() => expect(post).toHaveBeenCalled())
    const cfg = JSON.parse((post.mock.calls[0]![1] as { handlerConfig: string }).handlerConfig)
    expect('effort' in cfg).toBe(false)
  })
})

describe('scheduler job drawer — agent_run effort (E6)', () => {
  const stored = JSON.stringify({ agentId: 'writer', prompt: 'Summarise the day', title: 'Digest', effort: 'high', conversationPolicy: 'new' })

  it('(+) shows the stored rung; a change is saved at once and keeps every other key', async () => {
    installApi([job({ handlerConfig: stored })])
    const user = userEvent.setup()
    render(<SchedulerPage />)
    await user.click(await screen.findByText('Nightly digest'))
    await waitFor(() => expect(effortSelect()?.value).toBe('high'))
    await waitFor(() => expect(optionValues()).toContain('xhigh'))

    await user.selectOptions(effortSelect()!, 'xhigh')
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
    expect(patch.mock.calls[0]![0]).toBe('/scheduler/jobs/job-1')
    expect(JSON.parse((patch.mock.calls[0]![1] as { handlerConfig: string }).handlerConfig)).toEqual({
      agentId: 'writer', prompt: 'Summarise the day', title: 'Digest', effort: 'xhigh', conversationPolicy: 'new',
    })

    await user.selectOptions(effortSelect()!, 'auto')
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2))
    const cleared = JSON.parse((patch.mock.calls[1]![1] as { handlerConfig: string }).handlerConfig)
    expect('effort' in cleared).toBe(false)
    expect(cleared.prompt).toBe('Summarise the day')
  })

  it('(−) a failed save says so and does not refresh', async () => {
    installApi([job({ handlerConfig: stored })])
    const user = userEvent.setup()
    render(<SchedulerPage />)
    await user.click(await screen.findByText('Nightly digest'))
    await waitFor(() => expect(optionValues()).toContain('xhigh'))
    const listCalls = () => get.mock.calls.filter(([p]) => typeof p === 'string' && p.startsWith('/scheduler/jobs?')).length
    const before = listCalls()

    patch.mockRejectedValueOnce(new FakeApiError(400, 'Invalid agent_run handlerConfig'))
    await user.selectOptions(effortSelect()!, 'max')
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t('common.saveFailed')))
    expect(listCalls()).toBe(before)
  })

  it('(−) a plain handler job, or an agent_run job without an agent, has no effort select', async () => {
    installApi([
      job({ id: 'job-2', name: 'Backup', handler: 'backup.run', kind: 'handler', handlerConfig: '{"agentId":"writer"}' }),
      job({ id: 'job-3', name: 'Broken run', handlerConfig: 'not json' }),
    ])
    const user = userEvent.setup()
    render(<SchedulerPage />)
    await user.click(await screen.findByText('Backup'))
    await screen.findByText(t('scheduler.recentExecutions'))
    expect(effortSelect()).toBeNull()

    await user.click(screen.getByText('Broken run'))
    await waitFor(() => expect(screen.getAllByText('Broken run').length).toBeGreaterThan(1))
    expect(effortSelect()).toBeNull()
  })
})

describe('agent-run-effort helpers', () => {
  it('(+) reads the agent and a rung from a stored config', () => {
    expect(agentRunConfigOf('{"agentId":" writer ","effort":"max"}')).toEqual({ agentId: 'writer', effort: 'max' })
    expect(agentRunConfigOf('{"agentId":"writer"}')).toEqual({ agentId: 'writer', effort: null })
  })

  it('(−) anything that is not a rung reads as Auto; a broken config names no agent', () => {
    expect(agentRunConfigOf('{"agentId":"writer","effort":"ultra"}').effort).toBeNull()
    expect(agentRunConfigOf('{"agentId":"writer","effort":"auto"}').effort).toBeNull()
    expect(agentRunConfigOf('not json')).toEqual({ agentId: null, effort: null })
    expect(agentRunConfigOf('[1]')).toEqual({ agentId: null, effort: null })
    expect(agentRunConfigOf(undefined)).toEqual({ agentId: null, effort: null })
  })

  it('(+) replaces only the effort; Auto removes the key', () => {
    expect(JSON.parse(withAgentRunEffort('{"agentId":"a","prompt":"p","effort":"low"}', 'high')!)).toEqual({ agentId: 'a', prompt: 'p', effort: 'high' })
    expect(JSON.parse(withAgentRunEffort('{"agentId":"a","prompt":"p","effort":"low"}', null)!)).toEqual({ agentId: 'a', prompt: 'p' })
  })

  it('(−) a config that is not a JSON object is not edited', () => {
    expect(withAgentRunEffort('not json', 'high')).toBeNull()
    expect(withAgentRunEffort('"text"', 'high')).toBeNull()
    expect(withAgentRunEffort(null, 'high')).toBeNull()
  })

  it('(+/−) a new config carries a rung only; the agent intent only for a rung', () => {
    expect(JSON.parse(agentRunHandlerConfig({ agentId: 'a', prompt: 'p', title: 't', effort: 'low' })).effort).toBe('low')
    expect('effort' in JSON.parse(agentRunHandlerConfig({ agentId: 'a', prompt: 'p', title: 't', effort: null }))).toBe(false)
    expect(agentEffortIntent({ id: 'a', effort: 'medium' })).toEqual({ level: 'medium', source: 'agent' })
    expect(agentEffortIntent({ id: 'a', effort: 'auto' })).toBeNull()
    expect(agentEffortIntent({ id: 'a', effort: 'bogus' })).toBeNull()
    expect(agentEffortIntent(null)).toBeNull()
  })
})
