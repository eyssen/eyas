// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The review step, driven through its real API surface. These cases exist for
// the promises a pure function cannot keep: that mounting the screen does not
// pull a single candidate row, that the folder tree comes from `/tree` one
// level at a time (A-23), that a click on a folder or a kind becomes ONE
// gesture on the wire rather than a list of ids, that the number beside a
// checkbox is the server's own `/selection/count` answer (A-19), and that a
// page the cache had to drop is fetched again when the owner scrolls back.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

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

// The Radix dialog behind `Sheet` pulls in `react-remove-scroll` and friends,
// which live only under `src/web/node_modules` and ship a CJS build that
// `require`s the nested React copy outside Vite's alias — every render then
// dies on "resolveDispatcher().useRef". Same duplicate-React problem
// `scheduler-page.test.tsx` mocks `ContextualHelp` for, and unrelated to
// anything under test here.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}))

import DataPortReview, { TREE_ERROR_EN } from '@/pages/settings/data-port-review'
import { t } from '@/pages/settings/i18n'
import { kindLabel } from '@/pages/settings/data-port-reason-label'
import type {
  CandidateCounts,
  DirNode,
  PublicCandidate,
  ScanSummary,
  SelectionWire,
} from '@/pages/settings/data-port-types'

const SCAN_ID = 's1'
const base = `/data-port/import/scans/${SCAN_ID}`
const emptyWire: SelectionWire = { base: 'default', groups: [], rows: [] }

// ── Fixtures ────────────────────────────────────────────────────────

function dir(overrides: Partial<DirNode> & { path: string }): DirNode {
  const path = overrides.path
  return {
    path,
    parent: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.',
    name: path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path,
    depth: path.split('/').length,
    skippedClass: null,
    fileCount: 0,
    aliasOf: null,
    subtree: { total: 10, importable: 10, selectedByDefault: 10 },
    byKind: { memory: 10 },
    byReason: {},
    hasChildren: false,
    ...overrides,
  }
}

const TREE: Record<string, DirNode[]> = {
  '.': [
    dir({
      path: 'notes',
      hasChildren: true,
      subtree: { total: 30, importable: 30, selectedByDefault: 24 },
      byKind: { memory: 30 },
    }),
    dir({
      path: 'GitHub',
      hasChildren: true,
      subtree: { total: 6, importable: 5, selectedByDefault: 0 },
      byKind: { code: 5, noise: 1 },
    }),
    dir({
      path: 'big',
      subtree: { total: 4400, importable: 4400, selectedByDefault: 4400 },
      byKind: { memory: 4400 },
    }),
  ],
  notes: [
    dir({ path: 'notes/alpha', subtree: { total: 12, importable: 12, selectedByDefault: 12 }, byKind: { memory: 12 } }),
    dir({ path: 'notes/bravo', subtree: { total: 8, importable: 8, selectedByDefault: 8 }, byKind: { memory: 8 } }),
    dir({ path: 'notes/deep', subtree: { total: 10, importable: 10, selectedByDefault: 4 }, byKind: { memory: 10 } }),
  ],
  GitHub: [
    dir({
      path: 'GitHub/node_modules',
      skippedClass: 'node_modules',
      fileCount: 1,
      subtree: { total: 1, importable: 0, selectedByDefault: 0 },
      byKind: { noise: 1 },
      byReason: { 'directory-skipped': 1 },
    }),
  ],
}

const counts: CandidateCounts = {
  total: 40,
  importable: 36,
  selectedByDefault: 36,
  byKind: [
    { key: 'memory', total: 30, importable: 30, selectedByDefault: 30 },
    { key: 'session', total: 6, importable: 6, selectedByDefault: 6 },
    { key: 'noise', total: 4, importable: 0, selectedByDefault: 0 },
  ],
  byReason: [
    { key: 'memory-note', total: 30 },
    { key: 'directory-skipped', total: 1 },
  ],
  byFolder: [],
}

function candidate(overrides: Partial<PublicCandidate> & { id: string; folder: string }): PublicCandidate {
  return {
    relativePath: `${overrides.folder}/${overrides.id}.md`,
    seq: 1,
    importable: true,
    kind: 'memory',
    target: 'vault.semantic',
    title: overrides.id,
    preview: '',
    bytes: 2048,
    confidence: 0.9,
    reason: 'Memory note',
    reasonCode: 'memory-note',
    selectedByDefault: true,
    ...overrides,
  }
}

const notesRows = Array.from({ length: 30 }, (_, i) =>
  candidate({ id: `note-${i}`, folder: 'notes', ...(i === 0 ? { tags: ['contains-secrets'] } : {}) }),
)
const bigRows = Array.from({ length: 4400 }, (_, i) => candidate({ id: `big-${i}`, folder: 'big' }))
const githubRows = [
  candidate({
    id: 'deps',
    folder: 'GitHub',
    title: 'node_modules',
    relativePath: 'GitHub/node_modules',
    importable: false,
    target: 'none',
    kind: 'noise',
    selectedByDefault: false,
    reasonCode: 'directory-skipped:node_modules',
    reason: 'Folder not searched',
    directory: { class: 'node_modules', files: 1, dirs: 0, unreadable: 0 },
  }),
]

/** The scan root's OWN files — a Claude Code root puts CLAUDE.md right here. */
const rootRows = [
  candidate({ id: 'CLAUDE', folder: '.', relativePath: 'CLAUDE.md', title: 'CLAUDE.md', kind: 'rule' }),
  candidate({ id: 'settings', folder: '.', relativePath: 'settings.json', title: 'settings.json', kind: 'knowledge' }),
]

/** `GET /tree?parent=.` answers the root's direct files beside its child dirs. */
const rootFileCounts: CandidateCounts = {
  total: 2,
  importable: 2,
  selectedByDefault: 2,
  byKind: [
    { key: 'rule', total: 1, importable: 1, selectedByDefault: 1 },
    { key: 'knowledge', total: 1, importable: 1, selectedByDefault: 0 },
  ],
  byReason: [],
  byFolder: [],
}

const rowsFor = (folder: string): PublicCandidate[] =>
  folder === 'notes'
    ? notesRows
    : folder === 'big'
      ? bigRows
      : folder === 'GitHub'
        ? githubRows
        : folder === '.'
          ? [...rootRows, ...notesRows, ...githubRows]
          : []

const scan: ScanSummary = {
  scanId: SCAN_ID,
  status: 'done',
  sourceProfile: 'auto',
  detectedProfile: 'claude-code',
  rootPath: '/root',
  instructions: null,
  stats: {
    filesScanned: 40,
    filesSkipped: 4,
    totalBytes: 1000,
    dirsVisited: 6,
    dirsSkipped: { node_modules: 1 },
    filesInSkippedDirs: 1,
    symlinksFollowed: 0,
    symlinkAliases: 0,
    symlinkCycles: 0,
    unreadable: 0,
    largeFiles: 1,
    scanMs: 1200,
    candidateCount: 40,
    directoriesMapped: 6,
  },
  progress: null,
  counts,
  warnings: [{ code: 'directories-skipped', params: { count: 1, detail: '1 node_modules' }, message: 'skipped' }],
}

const previewAnswer = {
  candidate: notesRows[0]!,
  head: 'alpha body',
  truncated: true,
  encoding: 'utf-8',
  bytes: 65_536,
  size: 100_000,
}

// ── The API router every case starts from ───────────────────────────

const query = (p: string) => new URL(`http://x${p}`).searchParams

function route(p: string): unknown {
  if (p.includes('/tree')) {
    const parent = query(p).get('parent') ?? '.'
    return { parent, dirs: TREE[parent] ?? [], files: parent === '.' ? rootFileCounts : counts }
  }
  if (/\/candidates\/[^/]+\/preview/.test(p)) return previewAnswer
  if (p.includes('/counts')) return counts
  if (p.includes('/candidates')) {
    const params = query(p)
    const all = rowsFor(params.get('folder') ?? '.')
    const offset = Number(params.get('offset') ?? 0)
    const limit = Number(params.get('limit') ?? 200)
    return { items: all.slice(offset, offset + limit), total: all.length, offset, limit }
  }
  throw new Error(`unrouted GET ${p}`)
}

/**
 * jsdom sizes every element 0×0 and the virtualiser measures with
 * `offsetHeight`, not `getBoundingClientRect` — so without this the viewport is
 * zero-high, every row measures zero and the rendered range is empty. Rows are
 * recognised by `data-index`, the attribute the virtualiser itself reads.
 */
function sizeVirtualiser(rowHeight: number, viewport = 600): () => void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const height = Object.getOwnPropertyDescriptor(proto, 'offsetHeight')
  const width = Object.getOwnPropertyDescriptor(proto, 'offsetWidth')
  Object.defineProperty(proto, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-index') ? rowHeight : viewport
    },
  })
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 800 })
  return () => {
    if (height) Object.defineProperty(proto, 'offsetHeight', height)
    if (width) Object.defineProperty(proto, 'offsetWidth', width)
  }
}

/**
 * What the server says each folder's resolved selection is. A test that makes a
 * gesture sets the answer that gesture would produce, which is what lets the
 * two probes from the review be reproduced exactly.
 */
const BASE_SELECTED: Record<string, number> = {
  '.': 30,
  notes: 16,
  'notes/alpha': 12,
  'notes/bravo': 8,
  'notes/deep': 4,
  GitHub: 0,
  big: 4400,
}
let countOverrides: Record<string, number> = {}
const countFor = (folder: string): number => countOverrides[folder] ?? BASE_SELECTED[folder] ?? 0

const flush = async () => {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync()
  })
}

/**
 * The wizard shell owns the wire, so the test plays that part: a gesture is
 * recorded and fed straight back in, which is what makes the tri-states and the
 * debounced `/selection/count` behave as they do in the app.
 *
 * Deliberately NOT a stateful component: importing `react` into a test file
 * makes `@tanstack/react-virtual` resolve its own React to the copy under
 * `src/web/node_modules` instead of the aliased root one, and every hook call
 * inside the virtualiser then throws "resolveDispatcher().useReducer".
 */
function renderReview({
  virtualize = false,
  scan: scanOverride = scan,
}: { virtualize?: boolean; scan?: ScanSummary } = {}) {
  const onWire = vi.fn()
  const onCount = vi.fn()
  const onEnrich = vi.fn()
  let wire: SelectionWire = emptyWire
  const view = () => (
    <DataPortReview
      scan={scanOverride}
      wire={wire}
      onWireChange={(w) => {
        onWire(w)
        wire = w
      }}
      onResolvedCount={onCount}
      enrich={false}
      onEnrichChange={onEnrich}
      lang="en"
      treeProps={{ virtualize, ...(virtualize ? { initialRect: { width: 800, height: 600 } } : {}) }}
      listProps={{ virtualize, ...(virtualize ? { initialRect: { width: 800, height: 600 } } : {}) }}
    />
  )
  const utils = render(view())
  /** Push the wire a gesture produced back into the component, as the shell does. */
  const sync = () => utils.rerender(view())
  return { ...utils, onWire, onCount, onEnrich, sync }
}

const expand = (group: string) =>
  screen.getByRole('button', { name: t('settings.dataPort.wizard.tree.expand', { group }) })

/**
 * The candidate rows only. A single `<select>` maps to `combobox`, so the
 * listbox is unambiguous — but its `<option>` children answer to the `option`
 * role just as the rows do, so every row query is scoped to the list itself.
 */
const listRows = () => within(screen.getByRole('listbox')).getAllByRole('option')

const lastCountBody = () =>
  post.mock.calls.filter((c) => String(c[0]).endsWith('/selection/count')).at(-1)?.[1] as
    | { selection: SelectionWire; folders?: string[]; filter?: unknown }
    | undefined

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  get.mockImplementation(async (p: string) => route(p))
  countOverrides = {}
  post.mockImplementation(async (p: string, body: { folders?: string[] }) => {
    if (String(p).endsWith('/selection/count')) {
      const folders = body?.folders ?? []
      return {
        selected: 30,
        byFolder: Object.fromEntries(folders.map((f) => [f, countFor(f)])),
        byKind: { memory: 20, session: 6 },
      }
    }
    throw new Error(`unrouted POST ${p}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DataPortReview', () => {
  it('mounts with one tree request and no candidate request', async () => {
    renderReview()
    await flush()
    expect(get).toHaveBeenCalledWith(`${base}/tree?parent=.`)
    expect(get.mock.calls.some((c) => String(c[0]).includes('/candidates'))).toBe(false)
    expect(screen.getByText('notes')).toBeTruthy()
    expect(screen.getByText('big')).toBeTruthy()
  })

  it('expands a folder one level at a time and pages its files only once it is focused', async () => {
    renderReview()
    await flush()
    fireEvent.click(expand('notes'))
    await flush()
    expect(get).toHaveBeenCalledWith(`${base}/tree?parent=notes`)
    expect(screen.getByText('alpha')).toBeTruthy()

    fireEvent.click(screen.getByText('notes'))
    await flush()
    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(/\/candidates\?folder=notes&subtree=true&offset=0&limit=200/),
    )
    expect(listRows()).toHaveLength(30)
  })

  it('sends a folder gesture to the server count and shows the resolved numbers', async () => {
    const { container, onWire, onCount, sync } = renderReview()
    await flush()
    expect(onCount).toHaveBeenCalledWith(30)

    fireEvent.click(expand('notes'))
    await flush()
    const alphaRow = container.querySelector('[role="treeitem"][data-path="notes/alpha"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    expect(onWire).toHaveBeenLastCalledWith(
      expect.objectContaining({ groups: [{ folder: 'notes/alpha', selected: false }] }),
    )
    sync()
    await flush()

    const body = lastCountBody()!
    expect(body.selection.groups).toEqual([{ folder: 'notes/alpha', selected: false }])
    expect(body.folders).toEqual(expect.arrayContaining(['.', 'notes']))
    // No filter is on, so the count the button promises is the count on screen.
    expect(body.filter).toBeUndefined()
    expect(
      screen.getByText(t('settings.dataPort.wizard.group.selected', { selected: 16, importable: 30 })),
    ).toBeTruthy()
  })

  it('unticks a kind group everywhere with one gesture', async () => {
    const { onWire } = renderReview()
    await flush()
    const strip = screen.getByRole('group', { name: t('settings.dataPort.wizard.progress.byKind') })
    const sessions = within(strip).getByRole('checkbox', { name: kindLabel('session') })
    expect(sessions.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sessions)
    expect(onWire).toHaveBeenLastCalledWith(expect.objectContaining({ groups: [{ kind: 'session', selected: false }] }))
  })

  it('never prints the scan’s suggestion as a kind’s selection after a gesture', async () => {
    const { sync } = renderReview()
    await flush()
    const strip = () => screen.getByRole('group', { name: t('settings.dataPort.wizard.progress.byKind') })
    expect(
      within(strip()).getByText(t('settings.dataPort.wizard.group.selected', { selected: 20, importable: 30 })),
    ).toBeTruthy()

    // Between the click and the answer the strip must show the last real number,
    // marked as overtaken — never `selectedByDefault` dressed as a selection.
    fireEvent.click(within(strip()).getByRole('checkbox', { name: kindLabel('session') }))
    sync()
    expect(
      within(strip()).queryByText(t('settings.dataPort.wizard.group.selected', { selected: 30, importable: 30 })),
    ).toBeNull()
    const shown = within(strip()).getByText(
      t('settings.dataPort.wizard.group.selected', { selected: 20, importable: 30 }),
    )
    expect(shown.className).toContain('text-muted-foreground/50')
  })

  it('says what a kind HOLDS, indefinitely, when the count keeps failing', async () => {
    // A failed count leaves the last answer on the previous wire for ever, so
    // this is the case where a confident wrong number would never go away.
    post.mockImplementation(async (p: string) => {
      if (String(p).endsWith('/selection/count')) throw new Error('boom')
      throw new Error(`unrouted POST ${p}`)
    })
    renderReview()
    await flush()
    await flush()
    const strip = screen.getByRole('group', { name: t('settings.dataPort.wizard.progress.byKind') })
    expect(
      within(strip).getByText(t('settings.dataPort.wizard.group.importable', { importable: 30, total: 30 })),
    ).toBeTruthy()
    expect(
      within(strip).queryByText(t('settings.dataPort.wizard.group.selected', { selected: 30, importable: 30 })),
    ).toBeNull()
    expect(screen.getByText(t('settings.dataPort.wizard.countsError'))).toBeTruthy()
  })

  it('shows a kind with nothing importable as a count only', async () => {
    renderReview()
    await flush()
    const strip = screen.getByRole('group', { name: t('settings.dataPort.wizard.progress.byKind') })
    expect(within(strip).getByText(kindLabel('noise'))).toBeTruthy()
    expect(within(strip).queryByRole('checkbox', { name: kindLabel('noise') })).toBeNull()
  })

  it('refetches counts and the tree on a filter change and invalidates the pages behind the list', async () => {
    renderReview()
    await flush()
    fireEvent.click(screen.getByText('notes'))
    await flush()
    get.mockClear()

    fireEvent.change(screen.getByLabelText(t('settings.dataPort.wizard.filter.searchLabel')), {
      target: { value: 'alpha' },
    })
    await flush()
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/\/counts\?.*q=alpha/))
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/\/tree\?parent=\.&.*q=alpha/))
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/\/candidates\?.*q=alpha.*offset=0/))

    fireEvent.change(screen.getByLabelText(t('settings.dataPort.wizard.filter.reason')), {
      target: { value: 'directory-skipped' },
    })
    await flush()
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/\/counts\?.*reason=directory-skipped/))
  })

  it('counts the whole selection for the Import button and the filtered one for the screen', async () => {
    renderReview()
    await flush()
    post.mockClear()
    fireEvent.change(screen.getByLabelText(t('settings.dataPort.wizard.filter.searchLabel')), {
      target: { value: 'alpha' },
    })
    await flush()
    const bodies = post.mock.calls.filter((c) => String(c[0]).endsWith('/selection/count')).map((c) => c[1])
    expect(bodies).toHaveLength(2)
    expect(bodies[0].filter).toBeUndefined()
    expect(bodies[1].filter).toEqual({ q: 'alpha' })
  })

  it('shows countsError when counts fail and keeps the list working', async () => {
    get.mockImplementation(async (p: string) => {
      if (p.includes('/counts')) throw new Error('boom')
      return route(p)
    })
    renderReview()
    await flush()
    expect(screen.getByText(t('settings.dataPort.wizard.countsError'))).toBeTruthy()
    fireEvent.click(screen.getByText('notes'))
    await flush()
    expect(listRows().length).toBeGreaterThan(0)
  })

  it('opens the preview sheet for a row and reads its first 64 KiB', async () => {
    renderReview()
    await flush()
    fireEvent.click(screen.getByText('notes'))
    await flush()
    fireEvent.click(screen.getAllByRole('button', { name: t('settings.dataPort.wizard.preview.open') })[0]!)
    await flush()
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/\/candidates\/[^/]+\/preview\?bytes=65536$/))
    const sheet = screen.getByTestId('sheet')
    expect(within(sheet).getByText('alpha body')).toBeTruthy()
    expect(within(sheet).getByText(/imported in full/)).toBeTruthy()
    expect(within(sheet).getByTitle(t('settings.dataPort.wizard.containsSecretsHint'))).toBeTruthy()
  })

  it('renders a directory-skipped row with its file count and a not-importable lock', async () => {
    renderReview()
    await flush()
    fireEvent.click(screen.getByText('GitHub'))
    await flush()
    const row = within(screen.getByRole('listbox')).getByRole('option', { name: /node_modules/ })
    expect(within(row).getByText(t('settings.dataPort.wizard.dirSkippedFiles', { count: 1 }))).toBeTruthy()
    expect(within(row).getByRole('checkbox')).toHaveProperty('disabled', true)
  })

  it('says plainly that persona and rule rows become prompt text (A-28)', async () => {
    renderReview()
    await flush()
    expect(screen.queryByText(/used verbatim in the assistant/)).toBeNull()

    const withRules: CandidateCounts = {
      ...counts,
      byKind: [...counts.byKind, { key: 'rule', total: 2, importable: 2, selectedByDefault: 2 }],
    }
    renderReview({ scan: { ...scan, counts: withRules } })
    await flush()
    expect(screen.getAllByText(/used verbatim in the assistant/).length).toBeGreaterThan(0)
  })

  it('keeps the reason filter’s own options after one is chosen', async () => {
    renderReview()
    await flush()
    const reasons = screen.getByLabelText(t('settings.dataPort.wizard.filter.reason')) as HTMLSelectElement
    expect([...reasons.options].map((o) => o.value)).toEqual(['', 'memory-note', 'directory-skipped'])
    // The filtered `/counts` answer would collapse the list to the one chosen.
    get.mockImplementation(async (p: string) =>
      p.includes('/counts') ? { ...counts, byReason: [{ key: 'directory-skipped', total: 1 }] } : route(p),
    )
    fireEvent.change(reasons, { target: { value: 'directory-skipped' } })
    await flush()
    expect([...(screen.getByLabelText(t('settings.dataPort.wizard.filter.reason')) as HTMLSelectElement).options]
      .map((o) => o.value)).toEqual(['', 'memory-note', 'directory-skipped'])
  })

  it('makes the scan root a row of its own, so a candidate at the top level is reachable', async () => {
    // Without this row a `CLAUDE.md` at the scan root has no checkbox, no list
    // page and no preview — and the Import button counts it all the same.
    const { container } = renderReview()
    await flush()
    const root = container.querySelector('[role="treeitem"][data-path="."]') as HTMLElement
    expect(root).toBeTruthy()
    const rootName = within(root).getByText(t('settings.dataPort.wizard.group.rootFolder'))
    expect(
      within(root).getByText(t('settings.dataPort.wizard.group.selected', { selected: 30, importable: 36 })),
    ).toBeTruthy()

    fireEvent.click(rootName)
    await flush()
    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(/\/candidates\?folder=\.&subtree=true&offset=0&limit=200/),
    )
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: /CLAUDE\.md/ })).toBeTruthy()
  })

  it('shows a flat source rather than an empty tree over an Import button', async () => {
    const flatCounts: CandidateCounts = {
      total: 1,
      importable: 1,
      selectedByDefault: 1,
      byKind: [{ key: 'memory', total: 1, importable: 1, selectedByDefault: 1 }],
      byReason: [],
      byFolder: [],
    }
    const only = candidate({ id: 'only', folder: '.', relativePath: 'notes.md', title: 'notes.md' })
    get.mockImplementation(async (p: string) => {
      if (p.includes('/tree')) return { parent: '.', dirs: [], files: flatCounts }
      if (p.includes('/counts')) return flatCounts
      if (p.includes('/candidates')) return { items: [only], total: 1, offset: 0, limit: 200 }
      throw new Error(`unrouted GET ${p}`)
    })
    const { container } = renderReview({ scan: { ...scan, counts: flatCounts } })
    await flush()
    const root = container.querySelector('[role="treeitem"][data-path="."]') as HTMLElement
    expect(root).toBeTruthy()
    expect(screen.queryByText(t('settings.dataPort.wizard.tree.noMatches'))).toBeNull()

    fireEvent.click(within(root).getByText(t('settings.dataPort.wizard.group.rootFolder')))
    await flush()
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: /notes\.md/ })).toBeTruthy()
  })

  it('asks the server for the count of every folder row on screen, not only the expanded ones', async () => {
    renderReview()
    await flush()
    fireEvent.click(expand('notes'))
    // Twice: the first flush lands the level, the second lets the count the
    // newly visible rows triggered settle.
    await flush()
    await flush()
    expect(lastCountBody()!.folders).toEqual(
      expect.arrayContaining(['.', 'notes', 'notes/alpha', 'notes/bravo', 'notes/deep', 'GitHub', 'big']),
    )
  })

  it('reads an unticked subfolder’s number off the selection, never off the scan’s suggestion', async () => {
    const { container, sync } = renderReview()
    await flush()
    fireEvent.click(expand('notes'))
    await flush()
    await flush()
    const alpha = () => container.querySelector('[role="treeitem"][data-path="notes/alpha"]') as HTMLElement
    expect(
      within(alpha()).getByText(t('settings.dataPort.wizard.group.selected', { selected: 12, importable: 12 })),
    ).toBeTruthy()

    countOverrides = { 'notes/alpha': 0, notes: 4 }
    fireEvent.click(within(alpha()).getByRole('checkbox'))
    sync()
    await flush()

    expect(within(alpha()).getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
    expect(
      within(alpha()).getByText(t('settings.dataPort.wizard.group.selected', { selected: 0, importable: 12 })),
    ).toBeTruthy()
    expect(
      within(alpha()).queryByText(t('settings.dataPort.wizard.group.selected', { selected: 12, importable: 12 })),
    ).toBeNull()
  })

  it('reads a partly-suggested folder as whole after Select all', async () => {
    const { container, sync } = renderReview()
    await flush()
    fireEvent.click(expand('notes'))
    await flush()
    await flush()
    const deep = () => container.querySelector('[role="treeitem"][data-path="notes/deep"]') as HTMLElement
    expect(
      within(deep()).getByText(t('settings.dataPort.wizard.group.selected', { selected: 4, importable: 10 })),
    ).toBeTruthy()

    countOverrides = { 'notes/deep': 10, '.': 36, notes: 30 }
    fireEvent.click(screen.getByText(t('settings.dataPort.wizard.selectAll')))
    sync()
    await flush()

    expect(within(deep()).getByRole('checkbox').getAttribute('aria-checked')).toBe('true')
    expect(
      within(deep()).getByText(t('settings.dataPort.wizard.group.selected', { selected: 10, importable: 10 })),
    ).toBeTruthy()
  })

  it('says a level of the tree would not load instead of painting an empty pane', async () => {
    get.mockImplementation(async (p: string) => {
      if (p.includes('/tree')) throw new Error('boom')
      return route(p)
    })
    renderReview()
    await flush()
    expect(screen.getByText(TREE_ERROR_EN)).toBeTruthy()
  })

  it('reports the opt-in enrichment choice and leaves the selection alone', async () => {
    const { onEnrich, onWire } = renderReview()
    await flush()
    fireEvent.click(screen.getByText(t('settings.dataPort.wizard.enrich')))
    expect(onEnrich).toHaveBeenCalledWith(true)
    expect(onWire).not.toHaveBeenCalled()
  })

  it('drops the least recently seen page and fetches it again on the way back', async () => {
    const restore = sizeVirtualiser(78)
    try {
      renderReview({ virtualize: true })
      await flush()
      fireEvent.click(screen.getByText('big'))
      await flush()

      const list = screen.getByRole('listbox').parentElement as HTMLElement
      for (let page = 1; page <= 21; page++) {
        fireEvent.scroll(list, { target: { scrollTop: page * 200 * 78 } })
        await flush()
      }
      get.mockClear()

      fireEvent.scroll(list, { target: { scrollTop: 0 } })
      await flush()
      expect(get).toHaveBeenCalledWith(
        expect.stringMatching(/folder=big&subtree=true&offset=0&limit=200/),
      )
    } finally {
      restore()
    }
  })
})
