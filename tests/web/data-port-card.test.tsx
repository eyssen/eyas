// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The wizard shell: source → scanning → review → running → done. These cases
// cover the promises only the running screen can keep — that a 202 scan is
// polled and Review stays disabled until it finishes, that the import is
// started with the SELECTION WIRE and never with a list of ids, that a long
// import reports items, elapsed and an estimate, that a job moving only its
// keyset cursor is not mistaken for a stalled one, and that the result screen
// says how long both halves took.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const { get, post, del, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return { get: vi.fn(), post: vi.fn(), del: vi.fn(), FakeApiError }
})

vi.mock('@/lib/api', () => ({ api: { get, post, delete: del }, ApiError: FakeApiError }))

// `ContextualHelp` mounts a Radix TooltipProvider through a zustand store, and
// the Radix dialog behind `Dialog`/`Sheet` pulls in `react-remove-scroll` — both
// live only under `src/web/node_modules` and resolve their own React to the
// nested copy, so every render dies on "resolveDispatcher().useRef". Same
// duplicate-React problem `scheduler-page.test.tsx` mocks around, and unrelated
// to the wizard's own behaviour: what matters here is which step is on screen.
vi.mock('@/components/docs/contextual-help', () => ({ ContextualHelp: () => null }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="wizard">{children}</div> : null,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}))

import DataPortCard from '@/pages/settings/data-port-card'
import { t } from '@/pages/settings/i18n'
import { t as tc } from '@/i18n'
import { formatDuration } from '@/pages/settings/data-port-progress'
import type { CandidateCounts, ImportJob, ImportJobStats, ScanSummary } from '@/pages/settings/data-port-types'

const emptyCounts: CandidateCounts = {
  total: 0,
  importable: 0,
  selectedByDefault: 0,
  byKind: [],
  byReason: [],
  byFolder: [],
}

const counts: CandidateCounts = {
  total: 40,
  importable: 36,
  selectedByDefault: 36,
  byKind: [{ key: 'memory', total: 30, importable: 30, selectedByDefault: 30 }],
  byReason: [{ key: 'memory-note', total: 30 }],
  byFolder: [],
}

const zeroStats: ScanSummary['stats'] = {
  filesScanned: 0,
  filesSkipped: 0,
  totalBytes: 0,
  dirsVisited: 0,
  dirsSkipped: {},
  filesInSkippedDirs: 0,
  symlinksFollowed: 0,
  symlinkAliases: 0,
  symlinkCycles: 0,
  unreadable: 0,
  largeFiles: 0,
  scanMs: 0,
  candidateCount: 0,
  directoriesMapped: 0,
}

const scanBase: ScanSummary = {
  scanId: 's1',
  status: 'running',
  sourceProfile: 'auto',
  detectedProfile: 'claude-code',
  rootPath: '/alpha',
  instructions: null,
  stats: zeroStats,
  progress: { dirsVisited: 3, filesSeen: 120, candidates: 100, bytes: 1, elapsedMs: 10, currentDir: 'notes' },
  counts: emptyCounts,
  warnings: [],
}

const runningSummary: ScanSummary = { ...scanBase }
const doneSummary: ScanSummary = {
  ...scanBase,
  status: 'done',
  progress: null,
  stats: { ...zeroStats, filesScanned: 40, dirsVisited: 6, candidateCount: 40, directoriesMapped: 6, scanMs: 1200 },
  counts,
  warnings: [{ code: 'directories-skipped', params: { count: 1, detail: '1 node_modules' }, message: 'skipped' }],
}

const jobStats = (over: Partial<ImportJobStats> = {}): ImportJobStats => ({
  total: 400,
  processed: 0,
  applied: 0,
  skipped: 0,
  unchanged: 0,
  proposals: 0,
  errors: 0,
  aiEnriched: 0,
  aiFallback: 0,
  byKind: {},
  skippedReasons: {},
  elapsedMs: 0,
  resumed: 0,
  ...over,
})

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: 'j1',
  status: 'running',
  sourceProfile: 'claude-code',
  scanId: 's1',
  instructions: null,
  phase: 'apply',
  progress: 0,
  stats: jobStats(),
  error: null,
  selectionMode: 'wire',
  selectionTotal: 400,
  cursorSeq: 0,
  startedAt: '2026-09-07T10:00:00.000Z',
  importMs: null,
  createdAt: '2026-09-07T10:00:00.000Z',
  updatedAt: '2026-09-07T10:00:00.000Z',
  finishedAt: null,
  ...over,
})

/** Answers everything the review step asks for, so the shell can be driven. */
function reviewRoutes(p: string): unknown {
  if (p.includes('/tree')) return { parent: '.', dirs: [], files: counts }
  if (p.includes('/counts')) return counts
  if (p.includes('/candidates')) return { items: [], total: 0, offset: 0, limit: 200 }
  return undefined
}

const flush = async () => {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync()
  })
}

/** Opens the wizard and starts a path scan; returns once the scanning step is up. */
async function startScan() {
  render(<DataPortCard />)
  await flush()
  fireEvent.click(screen.getByText(t('settings.dataPort.import')))
  await flush()
  fireEvent.change(screen.getByLabelText(t('settings.dataPort.wizard.pathLabel')), { target: { value: '/alpha' } })
  fireEvent.click(screen.getByText(t('settings.dataPort.wizard.scan')))
  // Twice: the first flush lands the scan and mounts the step it leads to; the
  // second lets that step's own debounced `/selection/count` settle.
  await flush()
  await flush()
}

let selectedCount = 0

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  selectedCount = 0
  get.mockImplementation(async (p: string) => {
    if (p.startsWith('/data-port/import/jobs?')) return { jobs: [] }
    if (p === '/data-port/import/profiles') return { profiles: [] }
    return reviewRoutes(p) ?? {}
  })
  post.mockImplementation(async (p: string) => {
    if (String(p).endsWith('/selection/count')) return { selected: selectedCount, byKind: {}, byFolder: {} }
    throw new Error(`unrouted POST ${p}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DataPortCard', () => {
  it('puts the download icon on import (into EYAS) and the upload icon on export (out)', async () => {
    render(<DataPortCard />)
    await flush()
    const importBtn = screen.getByRole('button', { name: t('settings.dataPort.import') })
    const exportBtn = screen.getByRole('button', { name: new RegExp(t('settings.dataPort.export')) })
    expect(importBtn.querySelector('.lucide-download')).toBeTruthy()
    expect(importBtn.querySelector('.lucide-upload')).toBeFalsy()
    expect(exportBtn.querySelector('.lucide-upload')).toBeTruthy()
    expect(exportBtn.querySelector('.lucide-download')).toBeFalsy()
  })

  it('walks source → scanning → review on a 202 scan and polls until it is done', async () => {
    let polls = 0
    post.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scan') return runningSummary
      if (String(p).endsWith('/selection/count')) return { selected: 0, byKind: {}, byFolder: {} }
      throw new Error(`unrouted POST ${p}`)
    })
    get.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scans/s1') return polls++ < 1 ? runningSummary : doneSummary
      if (p.startsWith('/data-port/import/jobs?')) return { jobs: [] }
      if (p === '/data-port/import/profiles') return { profiles: [] }
      return reviewRoutes(p) ?? {}
    })

    await startScan()
    expect(screen.getByText(t('settings.dataPort.wizard.scanning.files', { count: 120 }))).toBeTruthy()
    expect(screen.getByText(t('settings.dataPort.wizard.scanning.current', { dir: 'notes' }))).toBeTruthy()
    expect(screen.getByRole('button', { name: t('settings.dataPort.wizard.scanning.continue') })).toHaveProperty(
      'disabled',
      true,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    expect(polls).toBeGreaterThanOrEqual(2)
    const settled = polls
    // The poll is torn down the moment the scan stops running — nobody keeps
    // asking a finished scan how it is getting on.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(polls).toBe(settled)
    const review = screen.getByRole('button', { name: t('settings.dataPort.wizard.scanning.continue') })
    expect(review).toHaveProperty('disabled', false)
    fireEvent.click(review)
    await flush()
    expect(screen.getByLabelText(t('settings.dataPort.wizard.filter.searchLabel'))).toBeTruthy()
  })

  it('stops a running scan', async () => {
    post.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scan') return runningSummary
      throw new Error(`unrouted POST ${p}`)
    })
    get.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scans/s1') return runningSummary
      if (p.startsWith('/data-port/import/jobs?')) return { jobs: [] }
      if (p === '/data-port/import/profiles') return { profiles: [] }
      return reviewRoutes(p) ?? {}
    })
    await startScan()
    fireEvent.click(screen.getByText(t('settings.dataPort.wizard.scanning.cancel')))
    await flush()
    expect(del).toHaveBeenCalledWith('/data-port/import/scans/s1')
    // Stopping purges the scan's rows, so there is nothing left to review: the
    // wizard goes back to the source step rather than offering Review over an
    // empty tree with no explanation.
    expect(screen.getByLabelText(t('settings.dataPort.wizard.pathLabel'))).toBeTruthy()
    expect(screen.queryByText(t('settings.dataPort.wizard.scanning.title'))).toBeNull()
  })

  it('leaves a scan whose poll gives up reviewable, not stranded on the destructive button', async () => {
    post.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scan') return runningSummary
      if (String(p).endsWith('/selection/count')) return { selected: 0, byKind: {}, byFolder: {} }
      throw new Error(`unrouted POST ${p}`)
    })
    get.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scans/s1') throw new FakeApiError(404, 'Scan not found')
      if (p.startsWith('/data-port/import/jobs?')) return { jobs: [] }
      if (p === '/data-port/import/profiles') return { profiles: [] }
      return reviewRoutes(p) ?? {}
    })
    await startScan()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(screen.getAllByText(t('settings.dataPort.wizard.scanning.failed')).length).toBeGreaterThan(0)
    // Stop is `DELETE /scans/:id` — it PURGES the rows, so it must not be the
    // only way out of a step the poll has abandoned.
    expect(screen.getByRole('button', { name: t('settings.dataPort.wizard.scanning.cancel') })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('button', { name: t('settings.dataPort.wizard.scanning.continue') })).toHaveProperty(
      'disabled',
      false,
    )

    // A blip must not stop the wizard following a scan that is still walking:
    // Retry puts it back on the poll rather than leaving it told, permanently,
    // that the scan ended.
    let polls = 0
    get.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scans/s1') {
        polls += 1
        return runningSummary
      }
      if (p.startsWith('/data-port/import/jobs?')) return { jobs: [] }
      if (p === '/data-port/import/profiles') return { profiles: [] }
      return reviewRoutes(p) ?? {}
    })
    fireEvent.click(screen.getByRole('button', { name: tc('common.retry') }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    expect(polls).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: t('settings.dataPort.wizard.scanning.cancel') })).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('posts the selection wire, never an id array, and disables Import at zero', async () => {
    post.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scan') return doneSummary
      if (String(p).endsWith('/selection/count')) return { selected: selectedCount, byKind: {}, byFolder: {} }
      if (p === '/data-port/import/jobs') return { job: job() }
      throw new Error(`unrouted POST ${p}`)
    })
    await startScan()
    // An upload or a finished scan lands straight on the review step.
    expect(
      screen.getByRole('button', { name: t('settings.dataPort.wizard.startImport', { count: 0 }) }),
    ).toHaveProperty('disabled', true)

    selectedCount = 30
    fireEvent.click(screen.getByText(t('settings.dataPort.wizard.selectAll')))
    await flush()
    const importBtn = screen.getByRole('button', { name: t('settings.dataPort.wizard.startImport', { count: 30 }) })
    expect(importBtn).toHaveProperty('disabled', false)

    fireEvent.click(importBtn)
    await flush()
    const body = post.mock.calls.find((c) => c[0] === '/data-port/import/jobs')![1] as { selection: unknown }
    expect(body.selection).toMatchObject({ base: 'all', groups: expect.any(Array), rows: expect.any(Array) })
    expect(Array.isArray(body.selection)).toBe(false)
  })

  it('shows items, elapsed, eta, a progressbar and the by-kind list while running, and stops on request', async () => {
    const running = job({ stats: jobStats({ processed: 120, elapsedMs: 60_000, byKind: { memory: 120 } }) })
    post.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scan') return doneSummary
      if (String(p).endsWith('/selection/count')) return { selected: selectedCount, byKind: {}, byFolder: {} }
      if (p === '/data-port/import/jobs') return { job: running }
      if (p === '/data-port/import/jobs/j1/cancel') return { ok: true }
      throw new Error(`unrouted POST ${p}`)
    })
    get.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/jobs/j1') return { job: running, proposals: [] }
      if (p.startsWith('/data-port/import/jobs?')) return { jobs: [] }
      if (p === '/data-port/import/profiles') return { profiles: [] }
      return reviewRoutes(p) ?? {}
    })
    selectedCount = 400
    await startScan()
    fireEvent.click(screen.getByRole('button', { name: t('settings.dataPort.wizard.startImport', { count: 400 }) }))
    await flush()

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30')
    expect(
      screen.getByText(t('settings.dataPort.wizard.progress.items', { processed: 120, total: 400 })),
    ).toBeTruthy()
    expect(
      screen.getByText(t('settings.dataPort.wizard.progress.elapsed', { time: formatDuration(60_000) })),
    ).toBeTruthy()
    expect(
      screen.getByText(t('settings.dataPort.wizard.progress.eta', { time: formatDuration(140_000) })),
    ).toBeTruthy()
    expect(screen.getByText(t('settings.dataPort.wizard.progress.byKind'))).toBeTruthy()

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByText(t('settings.dataPort.wizard.cancelImport')))
    await flush()
    expect(post).toHaveBeenCalledWith('/data-port/import/jobs/j1/cancel', expect.anything())
  })

  it('keeps the stall timer alive on a poll that only moves the keyset cursor', async () => {
    let seq = 100
    const stalledStats = jobStats({ processed: 120, elapsedMs: 60_000 })
    post.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scan') return doneSummary
      if (String(p).endsWith('/selection/count')) return { selected: selectedCount, byKind: {}, byFolder: {} }
      if (p === '/data-port/import/jobs') return { job: job({ stats: stalledStats, cursorSeq: seq }) }
      throw new Error(`unrouted POST ${p}`)
    })
    get.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/jobs/j1') {
        seq += 100
        return {
          job: job({ stats: stalledStats, cursorSeq: seq, updatedAt: `2026-09-07T10:${String(seq % 60).padStart(2, '0')}:00.000Z` }),
          proposals: [],
        }
      }
      if (p.startsWith('/data-port/import/jobs?')) return { jobs: [] }
      if (p === '/data-port/import/profiles') return { profiles: [] }
      return reviewRoutes(p) ?? {}
    })
    selectedCount = 400
    await startScan()
    fireEvent.click(screen.getByRole('button', { name: t('settings.dataPort.wizard.startImport', { count: 400 }) }))
    await flush()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1000)
    })
    expect(screen.queryByText(t('settings.dataPort.wizard.pollTimeout'))).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('shows total, import time and scan time on the done step and translates scan warnings', async () => {
    const finished = job({
      status: 'completed',
      phase: 'done',
      progress: 100,
      importMs: 65_000,
      finishedAt: '2026-09-07T10:01:05.000Z',
      stats: jobStats({ processed: 400, applied: 380, unchanged: 20, elapsedMs: 65_000, skippedReasons: { binary: 3 } }),
    })
    post.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/scan') return doneSummary
      if (String(p).endsWith('/selection/count')) return { selected: selectedCount, byKind: {}, byFolder: {} }
      if (p === '/data-port/import/jobs') return { job: job() }
      throw new Error(`unrouted POST ${p}`)
    })
    get.mockImplementation(async (p: string) => {
      if (p === '/data-port/import/jobs/j1') return { job: finished, proposals: [] }
      if (p.startsWith('/data-port/import/jobs?')) return { jobs: [] }
      if (p === '/data-port/import/profiles') return { profiles: [] }
      return reviewRoutes(p) ?? {}
    })
    selectedCount = 400
    await startScan()
    fireEvent.click(screen.getByRole('button', { name: t('settings.dataPort.wizard.startImport', { count: 400 }) }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(screen.getByText(t('settings.dataPort.wizard.stat.total'))).toBeTruthy()
    expect(
      screen.getByText(t('settings.dataPort.wizard.importTime', { time: formatDuration(65_000) })),
    ).toBeTruthy()
    expect(screen.getByText(t('settings.dataPort.wizard.scanTime', { time: formatDuration(1200) }))).toBeTruthy()
    expect(
      screen.getByText(
        t('settings.dataPort.scanWarning.directories-skipped', { count: 1, detail: '1 node_modules' }),
      ),
    ).toBeTruthy()
    expect(screen.getByText(`${t('settings.dataPort.reason.binary')} — 3`)).toBeTruthy()
  })
})
