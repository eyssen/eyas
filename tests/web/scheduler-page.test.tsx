// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Component tests for the scheduler page. Every other web test in this repo is
// a pure-logic .ts file testing extracted functions (runnability-view.ts and
// friends); that pattern cannot answer whether a control is ACTUALLY disabled,
// whether an error ACTUALLY renders, or whether a toast ACTUALLY fires. Those
// are exactly the silent-failure fixes this feature exists for, so here the
// real SchedulerPage component is rendered and driven through Testing Library.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// vi.mock factories are hoisted above imports, so the fakes they close over
// must be created with vi.hoisted() rather than plain top-level `const`.
const { get, post, patch, del, toastError, toastSuccess, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    FakeApiError,
  }
})

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))

// useApi (src/web/src/hooks/use-api.ts) calls api.get internally, so this one
// mock covers both the hook and every direct api.* call the page makes.
vi.mock('@/lib/api', () => ({
  api: { get, post, patch, delete: del },
  ApiError: FakeApiError,
}))

// ContextualHelp (the header's "?" icon) is the only thing in the scheduler
// page's render tree that calls a zustand store as a React hook (selector
// form). src/web carries its own nested node_modules/react — a second React
// copy distinct from the root one @testing-library/react renders with — so
// that one hook call throws "Invalid hook call" regardless of how the page's
// own react imports are aliased. It is unrelated to anything under test here.
vi.mock('@/components/docs/contextual-help', () => ({ ContextualHelp: () => null }))

import SchedulerPage from '@/pages/scheduler/scheduler-page'
import { t } from '@/pages/scheduler/i18n'
import { faultLabelKey, faultTooltipKey } from '@/pages/scheduler/runnability-view'
import type { ScheduledJob, SchedulerHealth } from '@/pages/scheduler/types'

let seq = 0

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  seq += 1
  return {
    id: `job-${seq}`,
    name: `Job ${seq}`,
    triggerType: 'cron',
    triggerConfig: '{}',
    handler: 'test.handler',
    status: 'active',
    runCount: 0,
    failCount: 0,
    source: 'user',
    kind: 'handler',
    ...overrides,
  }
}

function makeHealth(overrides: Partial<SchedulerHealth> = {}): SchedulerHealth {
  return {
    leader: true,
    activeJobs: 0,
    running: 0,
    failed24h: 0,
    deadLetter: 0,
    overdue: 0,
    unrunnable: 0,
    ...overrides,
  }
}

/**
 * Route `api.get` by path the way the real server would, with sensible shapes
 * for every path the page issues on mount. Deliberately dumb about query
 * params — the point of these tests is what the page does with a given job
 * list, not server-side filtering, which belongs to a different layer.
 */
function installApi(jobs: ScheduledJob[], health: Partial<SchedulerHealth> = {}): void {
  get.mockImplementation((path: string) => {
    if (path.startsWith('/scheduler/jobs/')) {
      const id = path.slice('/scheduler/jobs/'.length).split('?')[0]
      const job = jobs.find((j) => j.id === id)
      return Promise.resolve({ job, executions: [] })
    }
    if (path.startsWith('/scheduler/jobs')) return Promise.resolve({ jobs })
    if (path === '/scheduler/health') return Promise.resolve(makeHealth(health))
    if (path.startsWith('/agents')) return Promise.resolve({ agents: [] })
    if (path === '/scheduler/handlers') return Promise.resolve({ handlers: ['backup.run'] })
    if (path.startsWith('/scheduler/timeline')) return Promise.resolve({ timeline: [], projections: [] })
    return Promise.resolve({})
  })
}

/** Find the <input>/<select> that sits next to a given <Label> text — the
 *  create form has no htmlFor/id association, so getByLabelText can't see it. */
function inputNear(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText)
  const input = label.parentElement?.querySelector('input')
  if (!input) throw new Error(`no <input> near label "${labelText}"`)
  return input
}
function selectNear(labelText: string): HTMLSelectElement {
  const label = screen.getByText(labelText)
  const select = label.parentElement?.querySelector('select')
  if (!select) throw new Error(`no <select> near label "${labelText}"`)
  return select
}

beforeEach(() => {
  vi.clearAllMocks()
  seq = 0
})

describe('Run Now gate (Rulings 18 and 23)', () => {
  // executeJob declines only a missing handler and disabled/dead_letter — an
  // unarmable_trigger or not_armed job still runs by hand, and for an event
  // job Run Now is the only way it ever runs (Ruling 23). No state may leave
  // the button disabled while its tooltip still reads the plain label,
  // i.e. a greyed-out control with no reason given (Ruling 18).
  const cases: Array<{ name: string; job: Partial<ScheduledJob>; disabled: boolean; tooltip: string }> = [
    {
      name: 'no_handler fault blocks Run Now and explains why',
      job: { status: 'active', runnability: { runnable: false, fault: 'no_handler', detail: 'gone.handler' } },
      disabled: true,
      tooltip: t(faultTooltipKey('no_handler'), { detail: 'gone.handler' }),
    },
    {
      name: 'unarmable_trigger does NOT block Run Now — the only way an event job ever runs',
      job: {
        status: 'active',
        runnability: { runnable: false, fault: 'unarmable_trigger', detail: 'conversation.completed' },
      },
      disabled: false,
      tooltip: t(faultTooltipKey('unarmable_trigger'), { detail: 'conversation.completed' }),
    },
    {
      name: 'not_armed does NOT block Run Now — a bad cron can still be run by hand',
      job: { status: 'active', runnability: { runnable: false, fault: 'not_armed', detail: 'every minute' } },
      disabled: false,
      tooltip: t(faultTooltipKey('not_armed'), { detail: 'every minute' }),
    },
    {
      name: 'disabled status with no fault blocks and shows the inactive line',
      job: { status: 'disabled', runnability: { runnable: true } },
      disabled: true,
      tooltip: t('scheduler.fault.inactive'),
    },
    {
      name: 'dead_letter status with no fault blocks and shows the inactive line',
      job: { status: 'dead_letter', runnability: { runnable: true } },
      disabled: true,
      tooltip: t('scheduler.fault.inactive'),
    },
    {
      name: 'paused + healthy does not block and shows the plain label',
      job: { status: 'paused', runnability: { runnable: true } },
      disabled: false,
      tooltip: t('scheduler.runNow'),
    },
    {
      name: 'active + healthy does not block and shows the plain label',
      job: { status: 'active', runnability: { runnable: true } },
      disabled: false,
      tooltip: t('scheduler.runNow'),
    },
  ]

  for (const c of cases) {
    it(c.name, async () => {
      installApi([makeJob(c.job)])
      render(<SchedulerPage />)
      // A fault badge carries the SAME tooltip text as the Run Now button in
      // the unarmable_trigger/not_armed/no_handler cases (both read it off
      // job.runnability), so title alone is ambiguous — narrow to the button.
      const candidates = await screen.findAllByTitle(c.tooltip)
      const btn = candidates.find((el) => el.tagName === 'BUTTON') as HTMLButtonElement | undefined
      if (!btn) throw new Error(`no <button> among elements titled "${c.tooltip}"`)
      expect(btn.disabled).toBe(c.disabled)
      // Ruling 18, asserted directly: a disabled Run Now must never carry the
      // plain "Run now" tooltip — that combination is a greyed-out control
      // with no explanation.
      if (btn.disabled) {
        expect(btn.title).not.toBe(t('scheduler.runNow'))
      }
    })
  }
})

describe('fault badge', () => {
  const faults = [
    { fault: 'no_handler' as const, detail: 'gone.handler' },
    { fault: 'unarmable_trigger' as const, detail: 'conversation.completed' },
    { fault: 'not_armed' as const, detail: 'every minute' },
  ]

  for (const { fault, detail } of faults) {
    it(`renders the ${fault} badge with its label and interpolated tooltip`, async () => {
      installApi([makeJob({ runnability: { runnable: false, fault, detail } })])
      render(<SchedulerPage />)
      // The Run Now button carries the same title for these faults (both read
      // it off job.runnability) — narrow to the badge, a <span>, not a button.
      const candidates = await screen.findAllByTitle(t(faultTooltipKey(fault), { detail }))
      const badge = candidates.find((el) => el.tagName === 'SPAN')
      if (!badge) throw new Error('no <span> badge found among matching titles')
      expect(badge.textContent).toBe(t(faultLabelKey(fault)))
    })
  }

  it('renders no fault badge for a job with no fault', async () => {
    installApi([makeJob({ runnability: { runnable: true } })])
    render(<SchedulerPage />)
    await screen.findByText('Job 1')
    for (const { fault } of faults) {
      expect(screen.queryByText(t(faultLabelKey(fault)))).toBeNull()
    }
  })
})

describe('silent-failure fixes', () => {
  it('create form: a 400 renders the error, keeps the dialog open, and keeps what was typed', async () => {
    installApi([])
    const user = userEvent.setup()
    render(<SchedulerPage />)

    await user.click(screen.getByText(t('scheduler.createJob')))
    await screen.findByText(t('scheduler.newJob'))

    const nameInput = inputNear(t('common.name'))
    await user.type(nameInput, 'My Job')
    const handlerSelect = selectNear(t('scheduler.handler'))
    await user.selectOptions(handlerSelect, 'backup.run')

    post.mockRejectedValueOnce(new FakeApiError(400, 'bad request'))
    await user.click(screen.getByText(t('common.create')))

    await screen.findByText(t('scheduler.error.unschedulable'))
    // Dialog stays open — the create form is not dismissed on failure.
    expect(screen.getByText(t('scheduler.newJob'))).toBeTruthy()
    // The form still holds what was typed — nothing was cleared or lost.
    expect(nameInput.value).toBe('My Job')
    expect(handlerSelect.value).toBe('backup.run')
  })

  it('Run Now: a 409 calls toast.error and does not refresh the list', async () => {
    const job = makeJob({ status: 'active', runnability: { runnable: true } })
    installApi([job])
    const user = userEvent.setup()
    render(<SchedulerPage />)

    const btn = await screen.findByTitle(t('scheduler.runNow'))
    const jobsCallsBefore = get.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].startsWith('/scheduler/jobs?'),
    ).length

    post.mockRejectedValueOnce(new FakeApiError(409, 'cannot run'))
    await user.click(btn)

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t('scheduler.error.cannotRun')))

    // refreshAll() calls refetch(), which re-issues the jobs-list query. If it
    // had run, this count would have gone up.
    const jobsCallsAfter = get.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].startsWith('/scheduler/jobs?'),
    ).length
    expect(jobsCallsAfter).toBe(jobsCallsBefore)
  })

  it('reschedule: a 400 renders next to the control and refreshAll does not run', async () => {
    const job = makeJob({ status: 'active', cronExpression: '0 9 * * *', runnability: { runnable: true } })
    installApi([job])
    const user = userEvent.setup()
    render(<SchedulerPage />)

    await user.click(await screen.findByText(job.name))
    await screen.findByText(t('scheduler.reschedule'))

    const detailPath = `/scheduler/jobs/${job.id}`
    const detailCallsBefore = get.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].startsWith(detailPath),
    ).length

    const rescheduleInput = screen.getByPlaceholderText('0 9 * * *') as HTMLInputElement
    await user.clear(rescheduleInput)
    await user.type(rescheduleInput, '0 10 * * *')

    patch.mockRejectedValueOnce(new FakeApiError(400, 'ignored'))
    await user.click(screen.getByText(t('scheduler.apply')))

    await screen.findByText(t('scheduler.error.unschedulable'))

    // refreshAll() would re-run openDetail() for the selected job — assert it
    // did not, by checking the detail fetch was not issued a second time.
    const detailCallsAfter = get.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].startsWith(detailPath),
    ).length
    expect(detailCallsAfter).toBe(detailCallsBefore)
  })
})

describe('unrunnable chip (Task 12, Ruling 27)', () => {
  it('does not render when the count is zero', async () => {
    installApi([makeJob()], { unrunnable: 0 })
    render(<SchedulerPage />)
    await screen.findByText('Job 1')
    expect(screen.queryByText(/cannot run/)).toBeNull()
  })

  it('filters to faulted jobs, clears the filters, and restores them on a second click', async () => {
    const healthy = makeJob({
      name: 'Healthy Job',
      source: 'user',
      status: 'active',
      runnability: { runnable: true },
    })
    const faulted = makeJob({
      name: 'Faulted Job',
      source: 'user',
      status: 'active',
      runnability: { runnable: false, fault: 'no_handler', detail: 'x' },
    })
    installApi([healthy, faulted], { unrunnable: 1 })
    const user = userEvent.setup()
    render(<SchedulerPage />)

    await screen.findByText('Healthy Job')
    await screen.findByText('Faulted Job')

    // Set up filters the user chose, so we can prove the chip restores them.
    const searchInput = screen.getByPlaceholderText(t('scheduler.search')) as HTMLInputElement
    await user.type(searchInput, 'abc')
    const [sourceSelect, statusSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    await user.selectOptions(sourceSelect, 'user')
    await user.selectOptions(statusSelect, 'active')
    const infraCheckbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(infraCheckbox.checked).toBe(false)

    const chip = await screen.findByRole('button', { name: t('scheduler.health.unrunnable', { count: 1 }) })

    // First click: turn the chip on.
    await user.click(chip)

    expect(searchInput.value).toBe('')
    expect(sourceSelect.value).toBe('')
    expect(statusSelect.value).toBe('')
    expect(infraCheckbox.checked).toBe(true)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    await screen.findByText('Faulted Job')
    expect(screen.queryByText('Healthy Job')).toBeNull()

    // Second click: this is the state-loss fix — the ON direction alone
    // would miss it. The user's own filter choices must come back.
    await user.click(chip)

    expect(searchInput.value).toBe('abc')
    expect(sourceSelect.value).toBe('user')
    expect(statusSelect.value).toBe('active')
    expect(infraCheckbox.checked).toBe(false)
    expect(chip.getAttribute('aria-pressed')).toBe('false')
  })
})

describe("infra filter's escape hatch (spec §8.2)", () => {
  it('keeps a faulted system job visible but hides a healthy one, through the rendered page', async () => {
    const healthySystem = makeJob({
      name: 'Healthy System Job',
      source: 'system',
      kind: 'handler',
      runnability: { runnable: true },
    })
    const faultedSystem = makeJob({
      name: 'Faulted System Job',
      source: 'system',
      kind: 'handler',
      runnability: { runnable: false, fault: 'no_handler', detail: 'x' },
    })
    // "Show infrastructure jobs" is off by default (component's initial state).
    installApi([healthySystem, faultedSystem])
    render(<SchedulerPage />)

    await screen.findByText('Faulted System Job')
    expect(screen.queryByText('Healthy System Job')).toBeNull()
  })
})
