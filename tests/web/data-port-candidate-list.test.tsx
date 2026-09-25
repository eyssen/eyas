// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The virtualised candidate list. What matters here is what a pure function
// cannot answer: that a row nobody has fetched yet renders as a busy
// placeholder rather than as nothing, that a not-importable row is ACTUALLY
// locked, that the ticked state comes from the selection wire rather than from
// a second copy of the truth, and that a shift-click really moves a range.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

import { CandidateList } from '@/pages/settings/data-port-candidate-list'
import { formatBytes } from '@/pages/settings/data-port-progress'
import { t } from '@/pages/settings/i18n'
import type { PublicCandidate, SelectionWire } from '@/pages/settings/data-port-types'

const emptyWire: SelectionWire = { base: 'default', groups: [], rows: [] }

function candidate(overrides: Partial<PublicCandidate> & { id: string }): PublicCandidate {
  return {
    relativePath: `notes/${overrides.id}.md`,
    seq: 1,
    folder: 'notes',
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

const alpha = candidate({ id: 'alpha' })
const bravo = candidate({
  id: 'bravo',
  tags: ['contains-secrets', 'legacy'],
  warnings: ['large-file'],
  turns: 42,
  unit: 'transcript#2/7',
  sessionDate: '2026-03-04T10:00:00.000Z',
  assets: [{ relPath: 'run.sh', bytes: 10, sha256: 'x', binary: false }],
})
const charlie = candidate({ id: 'charlie' })
const rules = candidate({ id: 'rules', kind: 'rule', target: 'workspace.tools' })
const deps = candidate({
  id: 'deps',
  title: 'node_modules',
  importable: false,
  target: 'none',
  kind: 'noise',
  selectedByDefault: false,
  reasonCode: 'directory-skipped:node_modules',
  reason: 'Folder not searched',
  directory: { class: 'node_modules', files: 1420, dirs: 9, unreadable: 0 },
})

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

function renderList(
  loaded: Array<PublicCandidate | undefined>,
  overrides: Partial<React.ComponentProps<typeof CandidateList>> = {},
) {
  const onToggleRow = vi.fn()
  const onToggleRows = vi.fn()
  const onSetTarget = vi.fn()
  const onPreview = vi.fn()
  const onRangeRendered = vi.fn()
  const utils = render(
    <CandidateList
      total={loaded.length}
      rowAt={(i) => loaded[i]}
      onRangeRendered={onRangeRendered}
      wire={emptyWire}
      onToggleRow={onToggleRow}
      onToggleRows={onToggleRows}
      onSetTarget={onSetTarget}
      onPreview={onPreview}
      lang="en"
      virtualize={false}
      {...overrides}
    />,
  )
  return { ...utils, onToggleRow, onToggleRows, onSetTarget, onPreview, onRangeRendered }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CandidateList', () => {
  it('renders one option per position and a busy placeholder where no page has arrived', () => {
    renderList([alpha, undefined, charlie])
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[1]!.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true')
  })

  it('resolves the ticked state from the wire, never from a second copy', () => {
    const wire: SelectionWire = { base: 'default', groups: [], rows: [{ candidateId: 'alpha', selected: false }] }
    renderList([alpha, charlie], { wire })
    expect(screen.getByRole('option', { name: /alpha/ }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('option', { name: /charlie/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('locks a row nothing can import and still says why', () => {
    renderList([deps])
    const row = screen.getByRole('option', { name: /node_modules/ })
    expect(within(row).getByRole('checkbox')).toHaveProperty('disabled', true)
    expect(within(row).getByText(t('settings.dataPort.wizard.dirSkippedFiles', { count: 1420 }))).toBeTruthy()
    expect(
      within(row).getByText(t('settings.dataPort.reason.directory-skipped', {
        detail: t('settings.dataPort.wizard.dirClass.node_modules'),
      })),
    ).toBeTruthy()
  })

  it('shows the marks a row carries — tags, warnings, turns, part, bundled files and size', () => {
    renderList([bravo])
    const row = screen.getByRole('option', { name: /bravo/ })
    expect(within(row).getByText(t('settings.dataPort.wizard.tag.contains-secrets'))).toBeTruthy()
    expect(within(row).getByTitle(t('settings.dataPort.wizard.containsSecretsHint'))).toBeTruthy()
    expect(within(row).getByText(t('settings.dataPort.wizard.tag.legacy'))).toBeTruthy()
    expect(within(row).getByText(t('settings.dataPort.wizard.warning.large-file'))).toBeTruthy()
    expect(within(row).getByText(t('settings.dataPort.wizard.turns', { count: 42 }))).toBeTruthy()
    expect(within(row).getByText('2/7')).toBeTruthy()
    expect(within(row).getByText(t('settings.dataPort.wizard.bundledFiles', { count: 1 }))).toBeTruthy()
    expect(within(row).getByText(formatBytes(2048, 'en'))).toBeTruthy()
  })

  it('offers a rule its own destination first and reports a change', () => {
    const { onSetTarget } = renderList([rules])
    const select = screen.getByLabelText(
      `${t('settings.dataPort.wizard.targetLabel')}: rules`,
    ) as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual([
      'workspace.tools',
      'workspace.agents',
      'prompt.project-type',
    ])
    fireEvent.change(select, { target: { value: 'prompt.project-type' } })
    expect(onSetTarget).toHaveBeenCalledWith(rules, 'prompt.project-type')
  })

  it('reports a single tick and opens the preview for the row it was clicked on', () => {
    const { onToggleRow, onPreview } = renderList([alpha, charlie])
    fireEvent.click(within(screen.getByRole('option', { name: /alpha/ })).getByRole('checkbox'))
    expect(onToggleRow).toHaveBeenCalledWith(alpha, false)
    fireEvent.click(screen.getAllByRole('button', { name: t('settings.dataPort.wizard.preview.open') })[1]!)
    expect(onPreview).toHaveBeenCalledWith(charlie)
  })

  it('toggles a whole range on a shift-click and says how many moved', () => {
    const { onToggleRows, onToggleRow } = renderList([alpha, bravo, deps, charlie])
    const box = (name: RegExp) => within(screen.getByRole('option', { name })).getByRole('checkbox')
    fireEvent.click(box(/alpha/))
    expect(onToggleRow).toHaveBeenCalledWith(alpha, false)
    fireEvent.click(box(/charlie/), { shiftKey: true })
    // The locked row is not part of the range: nothing can select it.
    expect(onToggleRows).toHaveBeenCalledWith([alpha, bravo, charlie], false)
    expect(screen.getByText(t('settings.dataPort.wizard.list.rangeToggled', { count: 3 }))).toBeTruthy()
  })

  it('tells its owner which rows are on screen, so the pages behind them can be fetched', () => {
    const { onRangeRendered } = renderList([alpha, bravo, charlie])
    expect(onRangeRendered).toHaveBeenCalledWith(0, 2)
  })

  it('keeps only a window of a large list in the DOM and asks for that range', () => {
    const restore = sizeVirtualiser(78)
    try {
      const many = Array.from({ length: 4000 }, (_, i) => candidate({ id: `row-${i}` }))
      const { onRangeRendered } = renderList(many, { virtualize: true, initialRect: { width: 800, height: 600 } })
      const rendered = screen.getAllByRole('option')
      expect(rendered.length).toBeGreaterThan(0)
      expect(rendered.length).toBeLessThan(200)
      // The positioning wrapper between the listbox and each option must be
      // transparent, or the listbox owns divs instead of rows.
      for (const wrapper of document.querySelectorAll('[data-index]')) {
        expect(wrapper.getAttribute('role')).toBe('presentation')
      }
      expect(onRangeRendered).toHaveBeenCalled()
      const [start, end] = onRangeRendered.mock.calls.at(-1)!
      expect(start).toBe(0)
      expect(end).toBeLessThan(4000)
    } finally {
      restore()
    }
  })
})
