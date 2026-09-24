// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// VERBATIM COPY of `src/modules/data-port/selection.ts`, plus the gestures the
// wizard needs on top of it. The wizard must resolve a selection exactly as the
// job that imports it does; a drift here means the owner ticks one set of rows
// and the importer files another (A-19). Two guards hold the two copies
// together, both in `tests/web/data-port-selection.test.ts`: the same fixture
// the server suite runs (`tests/fixtures/data-port/selection-cases.json`), and
// a source-text compare of the copied region against the server file. Change
// one, change both.
//
// The web app is a separate package and cannot import the server module, so the
// two transport limits are inlined here with the values
// `src/modules/data-port/constants.ts` holds.

import type { CandidateTarget, ImportJobSelection, SelectionWire } from './data-port-types'

const SELECTION_MAX_ROWS = 50_000
const SELECTION_MAX_GROUPS = 5_000

/**
 * The minimum a row must expose for the resolver to decide. Every producer —
 * the candidate store's `StoredCandidate`, the API's `PublicCandidate`, the
 * wizard's list item — is structurally one of these.
 */
export interface SelectableRow {
  id: string
  kind: string
  folder: string
  target: CandidateTarget | string
  importable: boolean
  selectedByDefault: boolean
}

export interface CompiledSelection {
  /** Canonical, key-order-independent form of the wire — a cache key. */
  key: string
  /** P-10: `!importable` → false; else the row override, else the LAST matching group, else the base. */
  resolve(row: SelectableRow): boolean
  /** The row's own target unless the wire overrides it. */
  target(row: SelectableRow): CandidateTarget
}

/** Accepts the P-10 wire or the legacy `[{candidateId, target?}]` id list and answers a wire. */
export function normaliseSelection(input: SelectionWire | ImportJobSelection[]): SelectionWire {
  if (Array.isArray(input)) {
    return {
      base: 'none',
      groups: [],
      rows: input.map((s) => ({ candidateId: s.candidateId, selected: true, ...(s.target ? { target: s.target } : {}) })),
    }
  }
  return { base: input.base ?? 'default', groups: input.groups ?? [], rows: input.rows ?? [] }
}

/** `.` is the whole scan; otherwise the folder itself and everything under it, at any depth. */
const folderMatches = (rowFolder: string, groupFolder: string): boolean =>
  groupFolder === '.' || rowFolder === groupFolder || rowFolder.startsWith(groupFolder + '/')

export function compileSelection(wire: SelectionWire): CompiledSelection {
  const base = wire.base ?? 'default'
  const groups = wire.groups ?? []
  const wireRows = wire.rows ?? []
  if (groups.length > SELECTION_MAX_GROUPS) throw new RangeError(`selection.groups over ${SELECTION_MAX_GROUPS}`)
  if (wireRows.length > SELECTION_MAX_ROWS) throw new RangeError(`selection.rows over ${SELECTION_MAX_ROWS}`)
  const rowSel = new Map<string, boolean>()
  const rowTarget = new Map<string, CandidateTarget>()
  for (const r of wireRows) {
    if (typeof r.selected === 'boolean') rowSel.set(r.candidateId, r.selected)
    if (r.target) rowTarget.set(r.candidateId, r.target)
  }
  // `null` for an absent field, never a sentinel string: an absent `folder`
  // matches every row while `folder: '*'` matches none, and `*` is a legal
  // POSIX directory name — a wildcard sentinel would give the two opposite
  // meanings the same key. Group ORDER is significant (last match wins) so
  // groups are not sorted; rows are order-independent, so they are.
  const canon = JSON.stringify({
    base,
    groups: groups.map((g) => [g.kind ?? null, g.folder ?? null, g.selected]),
    rows: wireRows.map((r) => [r.candidateId, r.selected ?? null, r.target ?? null]).sort(),
  })
  return {
    key: canon,
    resolve(row: SelectableRow): boolean {
      if (!row.importable) return false
      const forced = rowSel.get(row.id)
      if (forced !== undefined) return forced
      for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i]!
        if (g.kind !== undefined && g.kind !== row.kind) continue
        if (g.folder !== undefined && !folderMatches(row.folder, g.folder)) continue
        return g.selected
      }
      return base === 'all' ? true : base === 'default' ? row.selectedByDefault : false
    },
    target(row: SelectableRow): CandidateTarget {
      return rowTarget.get(row.id) ?? (row.target as CandidateTarget)
    },
  }
}

// --- End of the verbatim copy. Everything below is the wizard's own. ---

/**
 * One bulk act by the owner: a click on a folder checkbox or on a kind
 * checkbox. `kind` alone is every row of that kind anywhere; `folder` alone is
 * every row in that subtree; both together is the intersection.
 */
export interface Gesture {
  kind?: string
  folder?: string
  selected: boolean
}

/**
 * Does `outer` decide every row `inner` decides? Only then may `inner` be
 * dropped: it is the LAST matching group that wins, so an earlier group a later
 * one fully shadows can never be reached again — keeping it would grow the wire
 * without changing a single answer. A gesture with no `kind` covers any kind; a
 * folder gesture covers the folder itself and everything under it, `.` meaning
 * the whole scan; and a gesture that names no folder is shadowed only by
 * another that names none either.
 */
const covers = (outer: Gesture, inner: Gesture): boolean => {
  if (outer.kind !== undefined && outer.kind !== inner.kind) return false
  // One of them says nothing about folders: only a gesture with no folder of
  // its own reaches every row the other one does.
  if (outer.folder === undefined || inner.folder === undefined) return outer.folder === undefined
  return inner.folder === outer.folder || inner.folder.startsWith(outer.folder + '/') || outer.folder === '.'
}

/**
 * Appends a gesture and prunes the groups it shadows.
 *
 * Row-level selection overrides are dropped: the wire carries a row's id but
 * neither its kind nor its folder, so which of them this gesture covers cannot
 * be known here, and keeping an override that outranks the gesture the owner
 * just made would silently ignore the click. Target-only rows (a rule sent
 * somewhere else) carry no selection and survive untouched.
 */
export function applyGesture(wire: SelectionWire, g: Gesture): SelectionWire {
  const groups = (wire.groups ?? []).filter((old) => !covers(g, old))
  const rows = (wire.rows ?? []).filter((r) => r.selected === undefined)
  return { ...wire, base: wire.base ?? 'default', groups: [...groups, g], rows }
}

/** "Select all" / "Select none" / "Back to suggested": one base, no groups, targets kept. */
export function setBase(wire: SelectionWire, base: SelectionWire['base']): SelectionWire {
  return { base, groups: [], rows: (wire.rows ?? []).filter((r) => r.selected === undefined) }
}

/**
 * What a folder node must expose for its checkbox to be painted honestly.
 * `subtree` and `byKind` are exactly the aggregates `DirNode` already carries,
 * so the tree hands its own row straight in.
 */
export interface FolderNode {
  path: string
  subtree: { total: number; importable: number; selectedByDefault: number }
  /** Rows per kind in the subtree (`DirNode.byKind`), so a kind gesture can be judged. */
  byKind?: Record<string, number>
}

type Tri = 'all' | 'none' | 'mixed'

const SLASH = 47 // '/'

/**
 * How much of the node's subtree a group's `folder` reaches.
 *
 * Written without `a.startsWith(b + '/')` on purpose: this is the inner loop of
 * a checkbox painted on every row of a virtualised tree, and the wire may hold
 * 5 000 groups, so allocating a joined string per group showed up as milliseconds
 * per render. The character check is the same test without the allocation.
 */
const folderReach = (folder: string | undefined, path: string): 'all' | 'part' | 'none' => {
  if (folder === undefined || folder === '.') return 'all'
  if (path === folder) return 'all'
  // The node sits inside the group's folder: the group decides all of it.
  if (path.length > folder.length && path.charCodeAt(folder.length) === SLASH && path.startsWith(folder)) return 'all'
  if (path === '.') return 'part'
  // The group's folder sits inside the node: it decides only part of it.
  if (folder.length > path.length && folder.charCodeAt(path.length) === SLASH && folder.startsWith(path)) return 'part'
  return 'none'
}

/**
 * The importable rows of the subtree, split by kind — or `null` when the node's
 * aggregates cannot support the split.
 *
 * The scanner emits `target: 'none'` only with `kind: 'noise'`
 * (`scan-path.ts:470`), so every other kind in `byKind` counts importable rows
 * and the two numbers must reconcile. When they do not — a `byKind` the caller
 * did not pass, a server that files a non-importable row under a real kind —
 * nothing is assumed and the conservative path takes over.
 */
function importableKinds(node: FolderNode): string[] | null {
  if (!node.byKind) return null
  const kinds: string[] = []
  let counted = 0
  for (const [kind, n] of Object.entries(node.byKind)) {
    if (kind === 'noise' || n <= 0) continue
    kinds.push(kind)
    counted += n
  }
  return counted === node.subtree.importable && kinds.length > 0 ? kinds : null
}

/** Per-kind bookkeeping for the single backwards pass over the groups. */
interface KindTally {
  /** What a group covering the whole subtree said, once one has been found. */
  covered: Tri | null
  /** Whether a group reaching only part of the subtree said `all` / `none`. */
  sawAll: boolean
  sawNone: boolean
}

/**
 * What the wire does to each kind's rows in this subtree, in ONE backwards pass.
 *
 * Walking backwards is what makes this order-correct — the last matching group
 * wins per row. A group whose folder lies outside the subtree decides nothing
 * here and is stepped over; the first one that covers the subtree closes that
 * kind, and everything earlier is then irrelevant to it. A group reaching only
 * PART of the subtree is remembered rather than answered, because it splits the
 * kind only if it disagrees with what the other rows turn out to take — so
 * unticking a subfolder of an already-unticked tree does not paint the parent
 * partial for nothing.
 *
 * One pass, not one per kind: this runs inside a virtualised tree row on every
 * render, and the selection wire is allowed 5 000 groups. A group with no kind
 * of its own speaks for every kind still open, so its partial verdicts are kept
 * once, globally, and inherited by each kind at the moment that kind closes —
 * which is what keeps a kind-less group O(1) instead of O(kinds).
 */
function kindStates(wire: SelectionWire, path: string, kinds: string[], fallback: Tri): Tri[] {
  const groups = wire.groups ?? []
  const tally = new Map<string, KindTally>()
  for (const k of kinds) tally.set(k, { covered: null, sawAll: false, sawNone: false })
  let open = kinds.length
  // Partial verdicts from groups that name no kind, cumulative in walk order.
  let anyAll = false
  let anyNone = false

  for (let i = groups.length - 1; i >= 0 && open > 0; i--) {
    const g = groups[i]!
    const reach = folderReach(g.folder, path)
    if (reach === 'none') continue
    const here: Tri = g.selected ? 'all' : 'none'
    if (g.kind === undefined) {
      if (reach === 'part') {
        if (here === 'all') anyAll = true
        else anyNone = true
        continue
      }
      // Covers the whole subtree and speaks for every kind: close them all.
      for (const t of tally.values()) {
        if (t.covered !== null) continue
        t.covered = here
        t.sawAll = t.sawAll || anyAll
        t.sawNone = t.sawNone || anyNone
      }
      open = 0
      break
    }
    const t = tally.get(g.kind)
    if (!t || t.covered !== null) continue
    if (reach === 'part') {
      if (here === 'all') t.sawAll = true
      else t.sawNone = true
      continue
    }
    t.covered = here
    t.sawAll = t.sawAll || anyAll
    t.sawNone = t.sawNone || anyNone
    open -= 1
  }

  const fromBase: Tri = wire.base === 'all' ? 'all' : wire.base === 'none' ? 'none' : fallback
  return kinds.map((k) => {
    const t = tally.get(k)!
    const rest = t.covered ?? fromBase
    // A kind still open at the end never met a covering group, so every
    // kind-less partial verdict of the whole wire applies to it.
    const sawAll = t.sawAll || (t.covered === null && anyAll)
    const sawNone = t.sawNone || (t.covered === null && anyNone)
    if (sawAll && rest !== 'all') return 'mixed'
    if (sawNone && rest !== 'none') return 'mixed'
    return rest
  })
}

/** The state the folder takes from the base alone, with no group applying to it. */
const baseState = (wire: SelectionWire, node: FolderNode): Tri => {
  if (wire.base === 'all') return 'all'
  if (wire.base === 'none') return 'none'
  return node.subtree.selectedByDefault === node.subtree.importable
    ? 'all'
    : node.subtree.selectedByDefault === 0
      ? 'none'
      : 'mixed'
}

/**
 * Without per-kind counts the folder can only be read from the groups that
 * cover the whole subtree, and anything after them that disagrees and reaches
 * inside makes it partial. Never claims `all` or `none` unless the resolver
 * agrees; it may answer `mixed` where the truth is definite.
 */
function coarseState(wire: SelectionWire, node: FolderNode): Tri {
  const groups = wire.groups ?? []
  let at = -1
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!
    if (g.kind === undefined && folderReach(g.folder, node.path) === 'all') {
      at = i
      break
    }
  }
  const state = at >= 0 ? (groups[at]!.selected ? 'all' : 'none') : baseState(wire, node)
  if (state === 'mixed') return 'mixed'
  for (let i = at + 1; i < groups.length; i++) {
    const g = groups[i]!
    if ((g.selected ? 'all' : 'none') === state) continue
    if (g.kind !== undefined || folderReach(g.folder, node.path) !== 'none') return 'mixed'
  }
  return state
}

/**
 * The tri-state a folder checkbox paints, decided from the wire and the
 * folder's own aggregates — never from the rows, which the wizard does not
 * hold.
 *
 * A gesture the owner made ANYWHERE can split this folder: a subfolder below
 * it, a kind that cuts across it. Reading only the groups at or above the node
 * left every ancestor of an unticked subfolder still painting "all" while the
 * importer selected a fraction of it — next to the server's own count saying
 * so. So the folder is read one kind at a time: `byKind` partitions its
 * importable rows, each part is resolved against the wire the way the resolver
 * would, and the parts are combined. Agreeing parts give a definite answer;
 * disagreeing or unresolvable ones give `mixed`.
 *
 * The guarantee is one-sided, and deliberately so: `all` and `none` are claims
 * the resolver always agrees with, while `mixed` is also the honest answer when
 * a subtree aggregate cannot settle which rows a group reaches — a gesture on a
 * folder below this one whose own counts are not in hand. Measured at 2 % of
 * folder rows over randomised scans; the alternative is a checkbox that lies.
 */
export function groupState(wire: SelectionWire, node: FolderNode): Tri {
  if (node.subtree.importable === 0) return 'none'
  const kinds = importableKinds(node)
  if (!kinds) return coarseState(wire, node)
  // A kind the wire says nothing about follows the scan's own suggestion, which
  // the aggregate pins down only when it is unanimous.
  const states = kindStates(wire, node.path, kinds, baseState(wire, node))
  if (states.every((s) => s === 'all')) return 'all'
  if (states.every((s) => s === 'none')) return 'none'
  return 'mixed'
}
