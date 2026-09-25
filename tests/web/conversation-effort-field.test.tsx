// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — the conversation's effort field is the shared EffortSelect fed by
// GET /conversations/:id/effort-options: only the model's rungs, Auto that
// names what it inherits (Deep → Max), and a PATCH of {effort} only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { get: h.get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } }
})

import { ConversationFields } from '@/pages/conversations/conversation-fields'
import { useLanguageStore } from '@/stores/language-store'

const OPTIONS = {
  mode: 'pinned',
  target: { providerId: 'anthropic', modelId: 'claude-opus-4-8', name: 'Opus 4.8' },
  kind: 'effort',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'high',
  canDisable: true,
  reasoningVisible: 'summary',
  current: null,
  inherited: { level: 'max', source: 'deep' },
}

beforeEach(() => {
  useLanguageStore.getState().setLang('en')
  h.get.mockReset()
  h.get.mockImplementation(async (path: string) => {
    if (path === '/conversations/c1/effort-options') return OPTIONS
    if (path === '/projects') return { projects: [] }
    if (path === '/project-types') return { projectTypes: [] }
    if (path === '/stages') return { stages: [] }
    if (path.startsWith('/agents')) return { agents: [] }
    if (path.endsWith('/tags')) return { tags: [] }
    return {}
  })
})
afterEach(() => cleanup())

function renderFields(onUpdate = vi.fn(), effort: string | null = null) {
  render(
    <ConversationFields
      conversationId="c1" projectId={null} stageId={null} agentId={null} dueDate={null}
      assignees={[]} tags={[]} effort={effort} effortRefreshKey="k" orchestration="deep" godMode={false}
      hasMessages={false} onUpdate={onUpdate}
    />,
  )
  return onUpdate
}

describe('conversation effort field', () => {
  it("lists the conversation model's rungs, xhigh and none included, with Auto · Max (Deep)", async () => {
    renderFields()
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/conversations/c1/effort-options'))
    await waitFor(() => {
      const values = Array.from((screen.getByTestId('effort-select') as HTMLSelectElement).options).map((o) => o.value)
      expect(values).toEqual(['auto', 'none', 'low', 'medium', 'high', 'xhigh', 'max'])
    })
    expect((screen.getByTestId('effort-select') as HTMLSelectElement).options[0].textContent).toBe('Auto · Max (Deep)')
  })

  it('a pick PATCHes {effort} only; Auto sends null', async () => {
    const onUpdate = renderFields(vi.fn(), 'high')
    await waitFor(() => expect((screen.getByTestId('effort-select') as HTMLSelectElement).options.length).toBe(7))
    await act(async () => { fireEvent.change(screen.getByTestId('effort-select'), { target: { value: 'xhigh' } }) })
    expect(onUpdate).toHaveBeenLastCalledWith({ effort: 'xhigh' })
    await act(async () => { fireEvent.change(screen.getByTestId('effort-select'), { target: { value: 'auto' } }) })
    expect(onUpdate).toHaveBeenLastCalledWith({ effort: null })
  })

  it('no legacy thinking fields are ever sent (negative)', async () => {
    const onUpdate = renderFields()
    await waitFor(() => expect((screen.getByTestId('effort-select') as HTMLSelectElement).options.length).toBe(7))
    await act(async () => { fireEvent.change(screen.getByTestId('effort-select'), { target: { value: 'low' } }) })
    for (const call of onUpdate.mock.calls) {
      expect(call[0]).not.toHaveProperty('thinking')
      expect(call[0]).not.toHaveProperty('thinkingBudget')
    }
  })
})
