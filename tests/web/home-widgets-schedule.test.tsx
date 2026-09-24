// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fix: the task brief's Step 1 snippet renders `<ScheduleWidget config={{}} />`
// without `onConfigChange` — but every widget's Component type
// (WidgetDef['Component'], widget-registry.ts) requires it, and every other
// widget test in this suite (home-widgets-attention.test.tsx,
// home-widgets-running.test.tsx) passes a no-op. Adding it here matches both
// the real prop contract and that convention; the endpoints, mock shapes and
// assertions below are otherwise the brief's values verbatim.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ScheduleWidget } from '@/pages/home/widgets/schedule-widget'
import { BriefingWidget } from '@/pages/home/widgets/briefing-widget'
import { api, ApiError } from '@/lib/api'

const noopConfigChange = () => {}

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/scheduler/jobs')) {
      return { jobs: [
        { id: 'j1', name: 'Daily briefing', status: 'active', nextRunAt: new Date(Date.now() + 720_000).toISOString() },
        { id: 'j2', name: 'Weekly backup', status: 'active', nextRunAt: new Date(Date.now() + 86_400_000).toISOString() },
      ] } as never
    }
    if (path.includes('/scheduler/executions')) {
      return { executions: [{ jobId: 'j2', status: 'failed', finishedAt: new Date(Date.now() - 172_800_000).toISOString() }] } as never
    }
    return {} as never
  })
})

describe('schedule widget', () => {
  it('marks a job whose last execution failed', async () => {
    render(<ScheduleWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByTestId('job-failed-j2')).toBeInTheDocument())
    expect(screen.queryByTestId('job-failed-j1')).toBeNull()
  })

  it('runs a job on demand', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    render(<ScheduleWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => screen.getByTestId('run-now-j1'))
    fireEvent.click(screen.getByTestId('run-now-j1'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/scheduler/jobs/j1/run'))
  })

  // Proves the join reads *recency*, not array position or presence alone.
  // The failed execution is listed FIRST (despite being older) and the
  // successful one SECOND — an implementation that trusted array order (or
  // "first execution seen wins") would still mark j1 as failed here; only
  // comparing `completedAt` correctly picks the later, successful run.
  it('does not mark a job whose latest execution succeeded after an earlier failure', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/scheduler/jobs')) {
        return { jobs: [
          { id: 'j1', name: 'Daily briefing', status: 'active', nextRunAt: new Date(Date.now() + 720_000).toISOString() },
        ] } as never
      }
      if (path.includes('/scheduler/executions')) {
        return { executions: [
          { jobId: 'j1', status: 'failed', completedAt: new Date(Date.now() - 172_800_000).toISOString() },
          { jobId: 'j1', status: 'completed', completedAt: new Date(Date.now() - 60_000).toISOString() },
        ] } as never
      }
      return {} as never
    })
    render(<ScheduleWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => screen.getByTestId('run-now-j1'))
    expect(screen.queryByTestId('job-failed-j1')).toBeNull()
  })

  // Mirrors home-widgets-attention.test.tsx's proof for the same pattern:
  // two calls, not one — the first (rejected) proves the error renders, the
  // second (resolved) proves it's cleared by a subsequent success, not just
  // on unmount/remount.
  it('shows a visible error when run-now fails, and clears it on a later success', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce(new ApiError(500, 'scheduler service unavailable'))
      .mockResolvedValueOnce({} as never)
    render(<ScheduleWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => screen.getByTestId('run-now-j1'))

    fireEvent.click(screen.getByTestId('run-now-j1'))
    await waitFor(() =>
      expect(screen.getByTestId('action-error')).toHaveTextContent('scheduler service unavailable'),
    )

    fireEvent.click(screen.getByTestId('run-now-j1'))
    await waitFor(() => expect(screen.queryByTestId('action-error')).toBeNull())
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('shows the unavailable empty state when no jobs are upcoming', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ jobs: [], executions: [] } as never)
    render(<ScheduleWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText(/no upcoming scheduled jobs/i)).toBeInTheDocument())
  })
})

describe('briefing widget', () => {
  it('renders the fetched briefing text', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/memory/briefing')) return { briefing: 'Yesterday closed 3 tasks.' } as never
      return {} as never
    })
    render(<BriefingWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText('Yesterday closed 3 tasks.')).toBeInTheDocument())
  })

  it('shows the empty state when there is no briefing yet', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ briefing: null } as never)
    render(<BriefingWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText(/no briefing yet/i)).toBeInTheDocument())
  })
})
