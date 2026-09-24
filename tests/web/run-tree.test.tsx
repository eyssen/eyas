// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G6 — what the run tree actually shows: a CLI's plan step with its status,
// the localized statuses, and a run cost the provider did not report as '—'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

import { RunTree } from '@/pages/conversations/components/run-tree'
import { t } from '@/pages/conversations/i18n'
import { useRunTreeStore, type OrchestrationEventLike } from '@/stores/run-tree-store'

let seq = 0
const ev = (runId: string, nodeId: string, parentId: string | null, payload: OrchestrationEventLike['payload']): OrchestrationEventLike =>
  ({ runId, nodeId, parentId, seq: ++seq, payload })

function feed(events: OrchestrationEventLike[]): void {
  for (const e of events) useRunTreeStore.getState().handleEvent(e)
}

beforeEach(() => {
  seq = 0
  useRunTreeStore.getState().reset()
})

afterEach(() => cleanup())

describe('RunTree (G6)', () => {
  it('renders a plan step with its checklist mark and localized status', () => {
    feed([
      ev('c1', 'c1', null, { type: 'run_started', goal: '' }),
      ev('c1', 'conv:c1', null, { type: 'node_started', kind: 'root', label: 'grok-cli-default', conversationId: 'c1' }),
      ev('c1', 'plan:c1:0', 'conv:c1', { type: 'node_started', kind: 'plan_step', label: 'Run the tests', pending: true }),
    ])
    const { container } = render(<RunTree />)
    expect(screen.getByText('Run the tests')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: t('conversations.runTree.planStep') })).toBeInTheDocument()
    const row = container.querySelector('[data-kind="plan_step"]')!
    expect(row.getAttribute('data-status')).toBe('pending')
    expect(row.textContent).toContain(t('conversations.runTree.status.pending'))
    // Never a raw status string on the badge.
    expect(t('conversations.runTree.status.pending')).not.toBe('conversations.runTree.status.pending')
  })

  it('shows an unknown run cost as — with the reason', () => {
    feed([
      ev('c1', 'c1', null, { type: 'run_started', goal: '' }),
      ev('c1', 'conv:c1', null, { type: 'node_started', kind: 'root', label: 'kimi-cli-default', conversationId: 'c1' }),
      ev('c1', 'c1', null, { type: 'run_completed', status: 'completed', totalTokens: 0, totalCostUsd: null }),
    ])
    render(<RunTree />)
    const cost = screen.getByTestId('run-tree-cost')
    expect(cost.textContent).toBe('—')
    expect(cost.getAttribute('title')).toBe(t('conversations.runTree.costUnknown'))
  })

  it('shows a reported run cost in dollars, without the unknown hint (negative)', () => {
    feed([
      ev('c1', 'c1', null, { type: 'run_started', goal: '' }),
      ev('c1', 'conv:c1', null, { type: 'node_started', kind: 'root', label: 'claude-sonnet-4-6', conversationId: 'c1' }),
      ev('c1', 'c1', null, { type: 'run_completed', status: 'completed', totalTokens: 30, totalCostUsd: 0.0123 }),
    ])
    render(<RunTree />)
    const cost = screen.getByTestId('run-tree-cost')
    expect(cost.textContent).toBe('$0.0123')
    expect(cost.getAttribute('title')).toBeNull()
  })

  it('a running run shows no cost yet, and a root without a model name falls back to its agent', () => {
    feed([
      ev('c1', 'c1', null, { type: 'run_started', goal: '' }),
      ev('c1', 'conv:c1', null, { type: 'node_started', kind: 'root', label: '', agentId: 'researcher', conversationId: 'c1' }),
    ])
    render(<RunTree />)
    expect(screen.queryByTestId('run-tree-cost')).toBeNull()
    expect(screen.getByText('researcher')).toBeInTheDocument()
  })
})
