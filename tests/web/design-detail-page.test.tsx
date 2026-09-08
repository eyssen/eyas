// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Component tests for the design detail page. The two behaviours here are the
// ones extracted helpers cannot answer: that a destructive control actually
// asks before it fires, and that the reason a nine-minute AI edit failed is
// actually on screen after a reload.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { get, patch, put, del, navigate, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number
    constructor(status: number, message: string) { super(message); this.status = status }
  }
  return { get: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn(), navigate: vi.fn(), FakeApiError }
})

vi.mock('@/lib/api', () => ({
  api: { get, post: vi.fn(), patch, put, delete: del },
  ApiError: FakeApiError,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: unknown }) => children as any,
  useNavigate: () => navigate,
}))

// Both mount sandboxed iframes or fetch print status; neither is under test.
vi.mock('@/pages/design/canvas-view', () => ({ CanvasView: () => null }))
vi.mock('@/pages/design/export-menu', () => ({ ExportMenu: () => null }))

import DesignDetailPage from '@/pages/design/design-detail-page'
import { t } from '@/pages/design/i18n'
import type { DesignAiRun } from '@/pages/design/types'

const DESIGN = {
  id: 'd1',
  title: 'Spring Flyer',
  slug: 'spring-flyer',
  kind: 'print',
  tags: [],
  currentVersion: 3,
  createdAt: '2026-08-26T10:00:00Z',
  updatedAt: '2026-08-26T10:00:00Z',
  files: { 'Main.dc.html': '<x-dc><p>hi</p></x-dc>' },
  manifest: {},
  artboards: ['Main.dc.html'],
}

const run = (over: Partial<DesignAiRun> = {}): DesignAiRun => ({
  id: 'r1',
  designId: 'd1',
  instruction: 'make the header blue',
  targetFile: null,
  status: 'failed',
  tier: 'whole-canvas',
  attempts: 2,
  message: 'Main.dc.html: missing x-dc root',
  versionBefore: 3,
  versionAfter: null,
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_523_000,
  durationMs: 523_000,
  createdBy: null,
  ...over,
})

function wireApi({ links = { total: 2, byModule: { conversations: 2 } }, runs = [] as DesignAiRun[] } = {}) {
  get.mockImplementation(async (path: string) => {
    if (path.includes('/versions')) {
      return { versions: [{ version: 1, origin: 'manual', createdAt: '', createdBy: null, changeNote: 'created' }] }
    }
    if (path.includes('/ai/runs')) return { runs, now: 1_700_000_600_000 }
    if (path.includes('/render/')) return { srcdoc: '', sandbox: '', propsSpec: {} }
    return { design: DESIGN, links }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  wireApi()
})
afterEach(() => { vi.restoreAllMocks() })

describe('deleting a design', () => {
  it('asks first, naming the versions and attachments that go with it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DesignDetailPage designId="d1" />)
    await screen.findByText('Spring Flyer')

    await userEvent.click(screen.getByRole('button', { name: t('design.detail.delete') }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    // Asserting the whole interpolation, because the arguments are the part
    // that can quietly be wrong: the VERSION COUNT (not currentVersion) and the
    // attachment total that only `GET /designs/:id` knows.
    expect(confirmSpy.mock.calls[0][0]).toBe(
      t('design.detail.deleteConfirm', { title: 'Spring Flyer', versions: 1, links: 2 }),
    )
    expect(confirmSpy.mock.calls[0][0]).toContain('Spring Flyer')
    // Declining must not touch anything.
    expect(del).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('deletes and leaves the page once confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    del.mockResolvedValue({})
    render(<DesignDetailPage designId="d1" />)
    await screen.findByText('Spring Flyer')

    await userEvent.click(screen.getByRole('button', { name: t('design.detail.delete') }))

    await waitFor(() => expect(del).toHaveBeenCalledWith('/designs/d1'))
    expect(navigate).toHaveBeenCalledWith({ to: '/design' })
  })
})

describe('the last AI run', () => {
  it('shows why the previous edit failed, after a reload that lost the response', async () => {
    wireApi({ runs: [run()] })
    render(<DesignDetailPage designId="d1" />)
    await screen.findByText('Spring Flyer')

    await userEvent.click(screen.getByRole('button', { name: new RegExp(t('design.detail.ai')) }))

    expect(await screen.findByText(t('design.ai.lastRun'))).toBeInTheDocument()
    expect(screen.getByText(`· ${t('design.ai.statusFailed')}`)).toBeInTheDocument()
    expect(screen.getByText('Main.dc.html: missing x-dc root')).toBeInTheDocument()
    // 523 s of work, reported as a clock rather than a raw millisecond count.
    expect(screen.getByText(/8:43/)).toBeInTheDocument()
  })

  it('reports an edit still running on the server, and refuses to start a second one', async () => {
    wireApi({ runs: [run({ status: 'running', finishedAt: null, durationMs: null, tier: null, attempts: null })] })
    render(<DesignDetailPage designId="d1" />)
    await screen.findByText('Spring Flyer')

    await userEvent.click(screen.getByRole('button', { name: new RegExp(t('design.detail.ai')) }))

    expect(await screen.findByText(t('design.ai.running'))).toBeInTheDocument()
    expect(screen.getByText(t('design.ai.slowHint'))).toBeInTheDocument()
    // 600 s on the SERVER's clock, which is what makes the number trustworthy.
    expect(screen.getByText(/10:00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(t('design.ai.apply')) })).toBeDisabled()
  })

  it('says nothing at all when the canvas has never been edited by AI', async () => {
    render(<DesignDetailPage designId="d1" />)
    await screen.findByText('Spring Flyer')
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t('design.detail.ai')) }))

    expect(screen.queryByText(t('design.ai.lastRun'))).toBeNull()
    expect(screen.queryByText(t('design.ai.running'))).toBeNull()
  })
})
