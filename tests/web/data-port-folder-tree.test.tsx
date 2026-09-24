// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The folder tree of a scan. These cases answer what extraction cannot: that a
// checkbox is ACTUALLY disabled on a folder with nothing importable, that the
// class of a folder the walker did not enter is ACTUALLY shown with its file
// count, and that the keyboard actually moves, expands and toggles.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

import {
  FolderTree,
  TREE_REASONS_EN,
  TriStateCheckbox,
  flattenTree,
  folderState,
  nodeLabel,
  type FlatDirNode,
} from '@/pages/settings/data-port-folder-tree'
import { t } from '@/pages/settings/i18n'
import type { DirNode, SelectionWire } from '@/pages/settings/data-port-types'

const emptyWire: SelectionWire = { base: 'default', groups: [], rows: [] }

function dir(overrides: Partial<DirNode> & { path: string }): DirNode {
  const path = overrides.path
  const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
  return {
    path,
    parent: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.',
    name,
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

const notes = dir({
  path: 'notes',
  hasChildren: true,
  subtree: { total: 30, importable: 30, selectedByDefault: 24 },
  byKind: { memory: 30 },
})
const alpha = dir({ path: 'notes/alpha', subtree: { total: 12, importable: 12, selectedByDefault: 12 }, byKind: { memory: 12 } })
const bravo = dir({
  path: 'notes/bravo',
  subtree: { total: 8, importable: 8, selectedByDefault: 8 },
  byKind: { memory: 8 },
  aliasOf: 'notes/alpha',
})
const deps = dir({
  path: 'GitHub/node_modules',
  skippedClass: 'node_modules',
  fileCount: 1420,
  subtree: { total: 1, importable: 0, selectedByDefault: 0 },
  byKind: { noise: 1 },
  byReason: { 'directory-skipped': 1, binary: 3 },
})

function rows(): FlatDirNode[] {
  return [
    { node: notes, level: 0, setSize: 2, posInSet: 1, expanded: true },
    { node: alpha, level: 1, setSize: 2, posInSet: 1, expanded: false },
    { node: bravo, level: 1, setSize: 2, posInSet: 2, expanded: false },
    { node: deps, level: 0, setSize: 2, posInSet: 2, expanded: false },
  ]
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

function renderTree(overrides: Partial<React.ComponentProps<typeof FolderTree>> = {}) {
  const onToggle = vi.fn()
  const onSetExpanded = vi.fn()
  const onFocus = vi.fn()
  const utils = render(
    <FolderTree
      rows={rows()}
      wire={emptyWire}
      counts={null}
      focused={null}
      onToggle={onToggle}
      onSetExpanded={onSetExpanded}
      onFocus={onFocus}
      virtualize={false}
      {...overrides}
    />,
  )
  const rowFor = (path: string): HTMLElement => {
    const el = utils.container.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`)
    if (!el) throw new Error(`no tree row for ${path}`)
    return el
  }
  return { ...utils, onToggle, onSetExpanded, onFocus, rowFor }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FolderTree', () => {
  it('renders one treeitem per visible node with its level and position', () => {
    renderTree()
    const items = screen.getAllByRole('treeitem')
    expect(items).toHaveLength(4)
    expect(items[0]!.getAttribute('aria-level')).toBe('1')
    expect(items[1]!.getAttribute('aria-level')).toBe('2')
    expect(items[1]!.getAttribute('aria-posinset')).toBe('1')
    expect(screen.getByRole('tree').getAttribute('aria-label')).toBe(t('settings.dataPort.wizard.tree.label'))
  })

  it('names the expand control after the folder and reports the click', () => {
    const { onSetExpanded } = renderTree()
    fireEvent.click(screen.getByRole('button', { name: t('settings.dataPort.wizard.tree.collapse', { group: 'notes' }) }))
    expect(onSetExpanded).toHaveBeenCalledWith(notes, false)
  })

  it('shows a folder the walker did not enter with its class, its file count and no usable checkbox', () => {
    renderTree()
    const row = screen.getByRole('treeitem', { name: /node_modules/ })
    expect(within(row).getByText(t('settings.dataPort.wizard.dirClass.node_modules'))).toBeTruthy()
    expect(within(row).getByText(t('settings.dataPort.wizard.dirSkippedFiles', { count: 1420 }))).toBeTruthy()
    expect(within(row).getByRole('checkbox')).toHaveProperty('disabled', true)
    expect(within(row).getByTitle(t('settings.dataPort.wizard.tree.notSearched'))).toBeTruthy()
  })

  it('names the folder a symlink alias points at', () => {
    renderTree()
    const row = screen.getByRole('treeitem', { name: /bravo/ })
    expect(within(row).getByText(t('settings.dataPort.wizard.tree.aliasOf', { path: 'notes/alpha' }))).toBeTruthy()
  })

  it('opens a per-reason list built from the folder’s own rows, and does not call them un-importable', () => {
    // `byReason` counts every row in the subtree, importable ones included, so
    // the list is headed by what it IS rather than by "why not importable".
    renderTree()
    const row = screen.getByRole('treeitem', { name: /node_modules/ })
    expect(within(row).queryByText(t('settings.dataPort.reason.binary'))).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: TREE_REASONS_EN }))
    expect(within(row).getByText(/3$/)).toBeTruthy()
    expect(within(row).getByText(new RegExp(t('settings.dataPort.reason.binary')))).toBeTruthy()
    expect(within(row).getByText(TREE_REASONS_EN)).toBeTruthy()
    // The heading this replaced, written out rather than looked up: the key was
    // deleted with the heading, and `t()` on a missing key answers the key's own
    // name — a string no rendering could ever produce, so the assertion would
    // have stayed green while meaning nothing (A-63's lesson in miniature).
    expect(within(row).queryByText('Why not importable')).toBeNull()
  })

  it('closes the reason list on Escape, however it was opened', () => {
    renderTree()
    const row = screen.getByRole('treeitem', { name: /node_modules/ })
    fireEvent.click(within(row).getByRole('button', { name: TREE_REASONS_EN }))
    expect(within(row).getByText(TREE_REASONS_EN)).toBeTruthy()
    // The click may not have focused the toggle, so Escape is handled on the row.
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(within(row).queryByText(TREE_REASONS_EN)).toBeNull()
  })

  it('shows the server’s own selected count and paints the checkbox to match it', () => {
    const { rowFor } = renderTree({
      counts: { byFolder: { notes: 16, 'notes/alpha': 12, 'notes/bravo': 0 }, current: true },
    })
    expect(
      within(rowFor('notes')).getByText(
        t('settings.dataPort.wizard.group.selected', { selected: 16, importable: 30 }),
      ),
    ).toBeTruthy()
    // 16 of 30 is partial, 12 of 12 is whole, 0 of 8 is none — three states, one source.
    expect(within(rowFor('notes')).getByRole('checkbox').getAttribute('aria-checked')).toBe('mixed')
    expect(within(rowFor('notes/alpha')).getByRole('checkbox').getAttribute('aria-checked')).toBe('true')
    expect(within(rowFor('notes/bravo')).getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
  })

  it('reports a checkbox click as a folder gesture', () => {
    const { onToggle, rowFor } = renderTree({ counts: { byFolder: { 'notes/alpha': 12 }, current: true } })
    fireEvent.click(within(rowFor('notes/alpha')).getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith(alpha, false)
  })

  it('focuses a folder when its name is clicked', () => {
    const { onFocus } = renderTree()
    fireEvent.click(screen.getByText('notes'))
    expect(onFocus).toHaveBeenCalledWith('notes')
  })

  it('moves, expands, collapses, toggles and opens from the keyboard', () => {
    const { onToggle, onSetExpanded, onFocus } = renderTree()
    const tree = screen.getByRole('tree')
    const items = screen.getAllByRole('treeitem')

    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(tree, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(tree, { key: 'End' })
    expect(document.activeElement).toBe(items[3])
    fireEvent.keyDown(tree, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])

    // Right on an expanded folder steps into it; Left collapses it.
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(onSetExpanded).toHaveBeenCalledWith(notes, false)

    // `notes` is partly ticked (24 of 30 by default), so Space selects the rest.
    fireEvent.keyDown(tree, { key: ' ' })
    expect(onToggle).toHaveBeenCalledWith(notes, true)
    fireEvent.keyDown(tree, { key: 'Enter' })
    expect(onFocus).toHaveBeenCalledWith('notes')
  })

  it('jumps to a folder by typing its first letters', () => {
    renderTree()
    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'b' })
    expect(document.activeElement).toBe(screen.getAllByRole('treeitem')[2])
  })

  it('never claims a whole folder is selected when the wire only says so in part', () => {
    // `notes/alpha` is unticked; the server has not answered yet, so the parent
    // must read partial rather than inherit the default "all".
    const wire: SelectionWire = { base: 'default', groups: [{ folder: 'notes/alpha', selected: false }], rows: [] }
    const { rowFor } = renderTree({ wire, counts: null })
    expect(within(rowFor('notes/alpha')).getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
    expect(within(rowFor('notes')).getByRole('checkbox').getAttribute('aria-checked')).toBe('mixed')
  })

  it('says what a folder HOLDS where no answer covers it, rather than the scan’s suggestion', () => {
    // `notes/alpha` is not in the answer — printing its default as "selected"
    // is what made a row read "12 of 12 selected" beside an empty box.
    const { rowFor } = renderTree({ counts: { byFolder: { notes: 16 }, current: true } })
    expect(
      within(rowFor('notes/alpha')).getByText(
        t('settings.dataPort.wizard.group.importable', { importable: 12, total: 12 }),
      ),
    ).toBeTruthy()
    expect(
      within(rowFor('notes/alpha')).queryByText(
        t('settings.dataPort.wizard.group.selected', { selected: 12, importable: 12 }),
      ),
    ).toBeNull()
  })

  it('never paints a checkbox from an answer that has been overtaken', () => {
    // The wire says none; the answer still on screen was for the wire before it.
    const wire: SelectionWire = { base: 'none', groups: [], rows: [] }
    const { rowFor } = renderTree({ wire, counts: { byFolder: { 'notes/alpha': 12 }, current: false } })
    expect(within(rowFor('notes/alpha')).getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
    // The number is still shown — it is the last true thing known — but muted.
    expect(
      within(rowFor('notes/alpha')).getByText(
        t('settings.dataPort.wizard.group.selected', { selected: 12, importable: 12 }),
      ),
    ).toBeTruthy()
  })

  it('renders through the virtualiser without losing the tree role, and owns items rather than divs', () => {
    const restore = sizeVirtualiser(44)
    try {
      const { container } = renderTree({ virtualize: true, initialRect: { width: 800, height: 600 } })
      expect(screen.getByRole('tree')).toBeTruthy()
      expect(screen.getAllByRole('treeitem')).toHaveLength(4)
      expect(screen.getByText('notes')).toBeTruthy()
      // The positioning wrapper between the tree and each item must be
      // transparent, or the tree owns four divs and no rows.
      for (const wrapper of container.querySelectorAll('[data-index]')) {
        if (wrapper.getAttribute('role') === 'treeitem') continue
        expect(wrapper.getAttribute('role')).toBe('presentation')
      }
    } finally {
      restore()
    }
  })
})

describe('flattenTree', () => {
  it('walks only the expanded folders, depth first, numbering each level', () => {
    const children = new Map<string, DirNode[]>([
      ['.', [notes, dir({ path: 'GitHub', hasChildren: true })]],
      ['notes', [alpha, bravo]],
      ['GitHub', [deps]],
    ])
    const flat = flattenTree(children, new Set(['notes']), new Set())
    expect(flat.map((r) => r.node.path)).toEqual(['notes', 'notes/alpha', 'notes/bravo', 'GitHub'])
    expect(flat[1]!.level).toBe(1)
    expect(flat[1]!.setSize).toBe(2)
    expect(flat[3]!.posInSet).toBe(2)
  })

  it('marks a folder whose children are still on the wire as loading', () => {
    const children = new Map<string, DirNode[]>([['.', [notes]]])
    const flat = flattenTree(children, new Set(['notes']), new Set(['notes']))
    expect(flat[0]!.loading).toBe(true)
  })

  it('puts the scan root first and pushes the top level one step in', () => {
    const root = dir({ path: '.', hasChildren: true, subtree: { total: 40, importable: 36, selectedByDefault: 30 } })
    const children = new Map<string, DirNode[]>([['.', [notes]], ['notes', [alpha]]])
    const flat = flattenTree(children, new Set(['.', 'notes']), new Set(), root)
    expect(flat.map((r) => r.node.path)).toEqual(['.', 'notes', 'notes/alpha'])
    expect(flat[0]!.level).toBe(0)
    expect(flat[1]!.level).toBe(1)
    expect(flat[2]!.level).toBe(2)
  })

  it('is the root ALONE for a flat source, and it is still a row', () => {
    // One uploaded file: no directories at all. Without the root row the tree
    // is empty, the list can never be asked for a folder, and the footer offers
    // to import something the screen never showed.
    const root = dir({ path: '.', hasChildren: false, subtree: { total: 1, importable: 1, selectedByDefault: 1 } })
    const flat = flattenTree(new Map([['.', []]]), new Set(['.']), new Set(), root)
    expect(flat).toHaveLength(1)
    expect(flat[0]!.node.path).toBe('.')
  })

  it('hides the top level when the root row is collapsed', () => {
    const root = dir({ path: '.', hasChildren: true })
    const flat = flattenTree(new Map([['.', [notes]]]), new Set(), new Set(), root)
    expect(flat.map((r) => r.node.path)).toEqual(['.'])
  })
})

describe('folderState', () => {
  it('is none for a folder with nothing importable, whatever the wire says', () => {
    expect(folderState({ base: 'all', groups: [], rows: [] }, deps, null)).toBe('none')
  })

  it('prefers the server answer over the client guess', () => {
    const wire: SelectionWire = { base: 'all', groups: [], rows: [] }
    expect(folderState(wire, notes, null)).toBe('all')
    expect(folderState(wire, notes, { notes: 5 })).toBe('mixed')
    expect(folderState(wire, notes, { notes: 0 })).toBe('none')
    expect(folderState(wire, notes, { notes: 30 })).toBe('all')
  })
})

describe('nodeLabel', () => {
  it('names the scan root rather than showing a dot', () => {
    expect(nodeLabel(dir({ path: '.' }))).toBe(t('settings.dataPort.wizard.group.rootFolder'))
    expect(nodeLabel(notes)).toBe('notes')
  })
})

describe('TriStateCheckbox', () => {
  it('carries the DOM indeterminate flag and announces mixed', () => {
    const onChange = vi.fn()
    render(<TriStateCheckbox state="mixed" label="Sessions" onChange={onChange} />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.indeterminate).toBe(true)
    expect(box.getAttribute('aria-checked')).toBe('mixed')
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('turns a whole selection off in one click', () => {
    const onChange = vi.fn()
    render(<TriStateCheckbox state="all" label="Memory" onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
