// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { RunningAgentsWidget } from '@/pages/home/widgets/running-agents-widget'
import { BoardWidget } from '@/pages/home/widgets/board-widget'
import { api, ApiError } from '@/lib/api'

const noopConfigChange = () => {}

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('mission-control/snapshot')) {
      return {
        agents: [{ sessionId: 's1', agentName: 'Researcher', status: 'running', costUsd: 1.24, currentAction: 'reading sources', lastUpdatedAt: new Date().toISOString(), pendingApprovals: 0 }],
        totals: { running: 1, waiting: 0, costTodayUsd: 1.24 },
      } as never
    }
    if (path === '/projects') {
      return { projects: [{ id: 'proj-7', name: 'Proj 7' }, { id: 'proj-9', name: 'Proj 9' }] } as never
    }
    // Real GET /projects/:id/board shape (board/routes.ts) is
    // `{ project, stages: [{ id, name, ..., conversations: [...] }] }` —
    // not the brief's invented `{ name, cards }`, which has no `id` (React
    // key) and no `conversations` (what board-widget.tsx actually counts).
    return {
      project: { id: 'proj-7', name: 'Proj 7' },
      stages: [{ id: 'stage-1', name: 'Doing', conversations: [{}, {}, {}] }],
    } as never
  })
})

describe('running agents widget', () => {
  it('shows a running agent with pause and stop controls', async () => {
    render(<RunningAgentsWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText('Researcher')).toBeInTheDocument())
    expect(screen.getByTestId('pause-s1')).toBeInTheDocument()
    expect(screen.getByTestId('interrupt-s1')).toBeInTheDocument()
  })

  it('sends the pause command', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    render(<RunningAgentsWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => screen.getByTestId('pause-s1'))
    fireEvent.click(screen.getByTestId('pause-s1'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mission-control/agents/s1/pause'))
  })

  // Fix round 2: not hypothetical for this tile — pause/resume currently
  // answer 500 against the live agent registry (AgentCard.tsx's own comment
  // documents it), so every click failed with zero visible feedback before
  // this fix. Two calls prove both the render-on-failure and the
  // clear-on-a-later-success halves, not just one or the other.
  it('shows a visible error when a command fails, and clears it on a later success', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce(new ApiError(500, 'pause not supported'))
      .mockResolvedValueOnce({} as never)
    render(<RunningAgentsWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => screen.getByTestId('pause-s1'))

    fireEvent.click(screen.getByTestId('pause-s1'))
    await waitFor(() => expect(screen.getByTestId('action-error')).toHaveTextContent('pause not supported'))

    fireEvent.click(screen.getByTestId('pause-s1'))
    await waitFor(() => expect(screen.queryByTestId('action-error')).toBeNull())
    expect(post).toHaveBeenCalledTimes(2)
  })
})

describe('board widget', () => {
  it('renders the configured project and nothing else', async () => {
    render(<BoardWidget config={{ projectId: 'proj-7' }} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/projects/proj-7/board'))
    await waitFor(() => expect(screen.getByText('Doing')).toBeInTheDocument())
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByTestId('board-needs-config')).toBeNull()
  })

  it('asks for configuration when no project is set', () => {
    render(<BoardWidget config={{}} onConfigChange={noopConfigChange} />)
    expect(screen.getByTestId('board-needs-config')).toBeInTheDocument()
  })

  it('lets the owner choose a project, and writes it back through onConfigChange', async () => {
    const onConfigChange = vi.fn()
    render(<BoardWidget config={{}} onConfigChange={onConfigChange} />)
    await waitFor(() => screen.getByTestId('select-project-proj-9'))
    fireEvent.click(screen.getByTestId('select-project-proj-9'))
    expect(onConfigChange).toHaveBeenCalledWith({ projectId: 'proj-9' })
  })

  it('re-fetches the newly configured project when its config changes', async () => {
    const { rerender } = render(<BoardWidget config={{ projectId: 'proj-7' }} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/projects/proj-7/board'))

    // Same mounted tile, a different `config` prop -- proves the fetch path
    // is re-derived from the current config on every render (BoardSummary's
    // `path` argument), the piece specific to this widget that WS
    // resubscription (use-widget-data.test.ts's own config-derived-topics
    // coverage, unmodified here) depends on to follow along.
    rerender(<BoardWidget config={{ projectId: 'proj-8' }} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/projects/proj-8/board'))
  })

  // Fix round 2: board-widget.tsx's picker used to swallow a failed
  // `GET /projects` (`.catch(() => {})`), leaving the picker looking
  // identical to "this owner genuinely has no projects yet" with no way to
  // tell the two apart. The retry button is this tile's version of "a
  // subsequent success clears it" -- there's no repeatable click like
  // approve/pause here, the initial load itself is the one action.
  it('shows a visible error when the project list fails to load, and clears it on retry', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/projects') throw new ApiError(500, 'projects unavailable')
      return {} as never
    })
    render(<BoardWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByTestId('action-error')).toHaveTextContent('projects unavailable'))

    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/projects') return { projects: [{ id: 'proj-1', name: 'P1' }] } as never
      return {} as never
    })
    fireEvent.click(screen.getByTestId('retry-projects'))
    await waitFor(() => expect(screen.queryByTestId('action-error')).toBeNull())
    expect(screen.getByTestId('select-project-proj-1')).toBeInTheDocument()
  })
})
