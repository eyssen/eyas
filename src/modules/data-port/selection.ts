// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// ONE resolver for what a selection means. The web app carries a verbatim copy
// (src/web/src/pages/settings/data-port-selection.ts); both run
// tests/fixtures/data-port/selection-cases.json. Change one, change both.

import { SELECTION_MAX_GROUPS, SELECTION_MAX_ROWS } from './constants.js'
import type { CandidateTarget, ImportJobSelection, SelectionWire } from './types.js'

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
