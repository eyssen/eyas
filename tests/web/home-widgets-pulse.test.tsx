// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Covers all three Task 13 tiles (Pulse, Cost, System) in one file, same
// convention as home-widgets-schedule.test.tsx covering both Schedule and
// Briefing — the brief names only the first tile in the filename.
//
// Each `describe` block scopes its own `api.get` mock (rather than one
// shared top-level `beforeEach`, as the brief's Step 1 snippet shows for
// Pulse alone) because Cost and System hit different endpoints than Pulse;
// a single unconditional `mockResolvedValue` covering only Pulse's shape
// would silently feed the wrong payload to the other two tiles.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PulseWidget } from '@/pages/home/widgets/pulse-widget'
import { CostWidget } from '@/pages/home/widgets/cost-widget'
import { SystemWidget } from '@/pages/home/widgets/system-widget'
import { api } from '@/lib/api'

// Every widget's Component type (WidgetDef['Component'], widget-registry.ts)
// requires onConfigChange — same fix the brief's own Step 1 snippet needs,
// already applied by every other widget test in this suite (see
// home-widgets-schedule.test.tsx's header comment for the same note).
const noopConfigChange = () => {}

describe('pulse widget', () => {
  it('renders all five figures', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      { attention: 3, running: 2, waiting: 1, costTodayUsd: 4.82, failedJobs: 1 } as never,
    )
    render(<PulseWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByTestId('pulse-attention')).toHaveTextContent('3'))
    expect(screen.getByTestId('pulse-running')).toHaveTextContent('2')
    expect(screen.getByTestId('pulse-waiting')).toHaveTextContent('1')
    expect(screen.getByTestId('pulse-cost')).toHaveTextContent('4.82')
    expect(screen.getByTestId('pulse-failed')).toHaveTextContent('1')
  })

  it('tones the failed-job figure as an error only when non-zero', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      { attention: 3, running: 2, waiting: 1, costTodayUsd: 4.82, failedJobs: 1 } as never,
    )
    render(<PulseWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByTestId('pulse-failed').className).toMatch(/destructive/))
  })

  // Discrimination proof for the test above: the two tests together would
  // still pass if the destructive tone were applied unconditionally
  // (hardcoded, not gated on failedJobs > 0). This third case is the only
  // one that catches that — failedJobs: 0 must NOT carry the destructive
  // class. Verified by hand: temporarily hardcoding `error={true}` in
  // pulse-widget.tsx's failed Chip makes this test fail while the two
  // above still pass.
  it('does not tone the failed-job figure as an error when it is zero', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      { attention: 0, running: 0, waiting: 0, costTodayUsd: 0, failedJobs: 0 } as never,
    )
    render(<PulseWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByTestId('pulse-failed')).toHaveTextContent('0'))
    expect(screen.getByTestId('pulse-failed').className).not.toMatch(/destructive/)
  })
})

describe('cost widget', () => {
  it('renders the period total and each budget\'s burn-down percentage', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      period: '2026-08',
      currency: 'HUF',
      total: 1234.5,
      budgets: [{ id: 'b1', name: 'Infra', ratio: 0.923, status: 'warning' }],
    } as never)
    render(<CostWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByTestId('cost-total')).toHaveTextContent('1234.50'))
    expect(screen.getByTestId('cost-total')).toHaveTextContent('HUF')
    expect(screen.getByText('Infra')).toBeInTheDocument()
    // Discrimination: ratio 0.923 must round to 92%, not truncate to 92.3%
    // or 0.92% (a plausible *100 vs. /100 mixup) — proves the percentage
    // conversion, not just that some number renders.
    expect(screen.getByText('92%')).toBeInTheDocument()
  })

  it('shows a no-budgets hint when none are configured, not an empty list', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      { period: '2026-08', currency: 'HUF', total: 0, budgets: [] } as never,
    )
    render(<CostWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText('No budgets configured')).toBeInTheDocument())
  })
})

describe('system widget', () => {
  it('joins /observability/anomalies and /scheduler/health into one tile', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/observability/anomalies')) {
        return { anomalies: [{ model: 'gpt', metric: 'latency' }] } as never
      }
      if (path.includes('/scheduler/health')) {
        return { activeJobs: 5, running: 1, failed24h: 2, deadLetter: 1, overdue: 3, unrunnable: 4 } as never
      }
      return {} as never
    })
    render(<SystemWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByTestId('system-anomalies')).toHaveTextContent('1'))
    expect(screen.getByTestId('system-failed24h')).toHaveTextContent('2')
    expect(screen.getByTestId('system-overdue')).toHaveTextContent('3')
    expect(screen.getByTestId('system-dead-letter')).toHaveTextContent('1')
    expect(screen.getByTestId('system-unrunnable')).toHaveTextContent('4')
  })

  // Discrimination: proves each figure reads its OWN field rather than the
  // two responses being conflated (e.g. the anomalies count leaking into
  // the scheduler figures via a copy-paste join bug) — every field here is
  // a distinct value, so a mixup shows up as a wrong number, not just a
  // missing one.
  it('does not conflate the anomalies count with any scheduler health figure', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/observability/anomalies')) {
        return { anomalies: [{ model: 'a', metric: 'x' }, { model: 'b', metric: 'y' }] } as never
      }
      if (path.includes('/scheduler/health')) {
        return { activeJobs: 0, running: 0, failed24h: 0, deadLetter: 0, overdue: 0, unrunnable: 0 } as never
      }
      return {} as never
    })
    render(<SystemWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByTestId('system-anomalies')).toHaveTextContent('2'))
    expect(screen.getByTestId('system-failed24h')).toHaveTextContent('0')
    expect(screen.getByTestId('system-overdue')).toHaveTextContent('0')
    expect(screen.getByTestId('system-dead-letter')).toHaveTextContent('0')
    expect(screen.getByTestId('system-unrunnable')).toHaveTextContent('0')
  })
})
