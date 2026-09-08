// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A-19: the wizard's resolver and the server's resolver must agree exactly, or
// the owner ticks one set of rows and the job imports another. Two guards run
// here: the SAME fixture the server suite runs
// (tests/fixtures/data-port/selection-cases.json), and a source-text compare of
// the copied region against src/modules/data-port/selection.ts.
import { readFileSync } from 'node:fs'
import { stripComments } from '../helpers/strip-comments'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyGesture, compileSelection, groupState, normaliseSelection, setBase } from '@/pages/settings/data-port-selection'
import type { SelectionWire } from '@/pages/settings/data-port-types'

/** First line of the region the web file copies from the server module. */
const VERBATIM_START_ANCHOR = '/**\n * The minimum a row must expose'
/** The web file's sentinel: everything after it is web-only, not part of the copy. */
const VERBATIM_END_MARKER = '// --- End of the verbatim copy.'

interface FixtureRow {
  id: string
  kind: string
  folder: string
  target: string
  importable: boolean
  selectedByDefault: boolean
}
interface FixtureCase {
  name: string
  wire: SelectionWire
  expect: Record<string, boolean>
  targets?: Record<string, string>
}
interface Fixture {
  rows: FixtureRow[]
  cases: FixtureCase[]
  legacy: { input: Array<{ candidateId: string; target?: string }>; expect: Record<string, boolean>; targets?: Record<string, string> }
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/data-port/selection-cases.json'), 'utf-8'),
) as Fixture

const resolveAll = (wire: SelectionWire): Record<string, boolean> => {
  const sel = compileSelection(wire)
  return Object.fromEntries(fixture.rows.map((r) => [r.id, sel.resolve(r)]))
}

describe('web selection resolver = server resolver', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(resolveAll(c.wire)).toEqual(c.expect)
      if (c.targets) {
        const sel = compileSelection(c.wire)
        for (const [id, target] of Object.entries(c.targets)) {
          expect(sel.target(fixture.rows.find((r) => r.id === id)!)).toBe(target)
        }
      }
    })
  }

  it('normalises the legacy array', () => {
    const sel = compileSelection(normaliseSelection(fixture.legacy.input as never))
    expect(Object.fromEntries(fixture.rows.map((r) => [r.id, sel.resolve(r)]))).toEqual(fixture.legacy.expect)
    expect(sel.target(fixture.rows[0]!)).toBe('vault.procedural')
  })

  it('tolerates a partial wire and refuses a wire over the transport limits', () => {
    expect(compileSelection({} as SelectionWire).resolve(fixture.rows[0]!)).toBe(true)
    const groups = Array.from({ length: 5001 }, () => ({ selected: true }))
    expect(() => compileSelection({ base: 'none', groups, rows: [] })).toThrow(RangeError)
    const rows = Array.from({ length: 50_001 }, (_, i) => ({ candidateId: `r${i}`, selected: true }))
    expect(() => compileSelection({ base: 'none', groups: [], rows })).toThrow(RangeError)
  })
})

describe('gestures', () => {
  it('prunes shadowed gestures', () => {
    let wire = normaliseSelection({ base: 'default', groups: [], rows: [] })
    wire = applyGesture(wire, { folder: 'alpha/deep', selected: true })
    wire = applyGesture(wire, { folder: 'alpha', selected: false })
    expect(wire.groups).toEqual([{ folder: 'alpha', selected: false }])
    wire = applyGesture(wire, { kind: 'memory', selected: true })
    expect(wire.groups).toHaveLength(2)
  })

  it('does not prune a gesture the new one cannot cover', () => {
    let wire: SelectionWire = { base: 'default', groups: [], rows: [] }
    wire = applyGesture(wire, { kind: 'session', selected: false })
    wire = applyGesture(wire, { folder: 'alpha', selected: true })
    expect(wire.groups).toEqual([
      { kind: 'session', selected: false },
      { folder: 'alpha', selected: true },
    ])
    // A root gesture covers every folder gesture, whatever its depth.
    wire = applyGesture(wire, { folder: '.', selected: false })
    expect(wire.groups).toEqual([
      { kind: 'session', selected: false },
      { folder: '.', selected: false },
    ])
  })

  it('drops row selection overrides but keeps target-only rows', () => {
    const wire: SelectionWire = {
      base: 'default',
      groups: [],
      rows: [
        { candidateId: 'r1', selected: false },
        { candidateId: 'r2', target: 'vault.procedural' },
      ],
    }
    const after = applyGesture(wire, { folder: 'alpha', selected: true })
    expect(after.rows).toEqual([{ candidateId: 'r2', target: 'vault.procedural' }])
  })

  it('setBase resets the groups and keeps the target-only rows', () => {
    const wire: SelectionWire = {
      base: 'default',
      groups: [{ folder: 'alpha', selected: false }],
      rows: [
        { candidateId: 'r1', selected: false },
        { candidateId: 'r2', target: 'vault.procedural' },
      ],
    }
    expect(setBase(wire, 'all')).toEqual({
      base: 'all',
      groups: [],
      rows: [{ candidateId: 'r2', target: 'vault.procedural' }],
    })
  })

  it('reports a group state', () => {
    const wire: SelectionWire = { base: 'default', groups: [{ folder: 'alpha', selected: false }], rows: [] }
    expect(groupState(wire, { path: 'alpha', subtree: { total: 3, importable: 3, selectedByDefault: 2 } })).toBe('none')
    expect(groupState(wire, { path: 'bravo', subtree: { total: 3, importable: 3, selectedByDefault: 2 } })).toBe('mixed')
    expect(groupState({ ...wire, groups: [] }, { path: 'bravo', subtree: { total: 3, importable: 3, selectedByDefault: 3 } })).toBe('all')
  })

  it('a folder with nothing importable is never tickable, and a deeper folder inherits its ancestor', () => {
    const empty = { path: 'alpha', subtree: { total: 4, importable: 0, selectedByDefault: 0 } }
    expect(groupState({ base: 'all', groups: [], rows: [] }, empty)).toBe('none')
    expect(groupState({ base: 'none', groups: [], rows: [] }, { path: 'alpha', subtree: { total: 3, importable: 3, selectedByDefault: 3 } })).toBe('none')
    const deep: SelectionWire = { base: 'default', groups: [{ folder: 'alpha', selected: true }], rows: [] }
    expect(groupState(deep, { path: 'alpha/deep', subtree: { total: 2, importable: 2, selectedByDefault: 0 } })).toBe('all')
  })

  // The defect the review found: one click on a SUBFOLDER left every folder
  // above it painting "all" while the importer selected a fraction of it.
  it('a gesture on a descendant makes the folder above it partial', () => {
    const bravo = { path: 'bravo', subtree: { total: 3, importable: 3, selectedByDefault: 3 } }
    expect(groupState({ base: 'all', groups: [{ folder: 'bravo/x', selected: false }], rows: [] }, bravo)).toBe('mixed')
    expect(groupState({ base: 'none', groups: [{ folder: 'bravo/x', selected: true }], rows: [] }, bravo)).toBe('mixed')
    expect(groupState({ base: 'default', groups: [{ folder: 'bravo/x', selected: false }], rows: [] }, bravo)).toBe('mixed')
    // A descendant gesture that AGREES with the state splits nothing.
    expect(groupState({ base: 'all', groups: [{ folder: 'bravo/x', selected: true }], rows: [] }, bravo)).toBe('all')
    // Neither does one in an unrelated subtree, or on a prefix that is not a parent.
    expect(groupState({ base: 'all', groups: [{ folder: 'charlie', selected: false }], rows: [] }, bravo)).toBe('all')
    expect(groupState({ base: 'all', groups: [{ folder: 'bravo-2', selected: false }], rows: [] }, bravo)).toBe('all')
    // The root folder sees every gesture below it.
    expect(groupState({ base: 'all', groups: [{ folder: 'bravo/x', selected: false }], rows: [] }, { path: '.', subtree: { total: 9, importable: 9, selectedByDefault: 9 } })).toBe('mixed')
  })

  it('a kind gesture is judged against the folder own kind counts', () => {
    const node = { path: 'alpha', subtree: { total: 3, importable: 3, selectedByDefault: 3 } }
    const wire: SelectionWire = { base: 'all', groups: [{ kind: 'session', selected: false }], rows: [] }
    // No kind counts to judge with: partial rather than a guess.
    expect(groupState(wire, node)).toBe('mixed')
    // The folder holds no session at all — the gesture cannot reach it.
    expect(groupState(wire, { ...node, byKind: { memory: 3 } })).toBe('all')
    // The folder is nothing but sessions — the gesture decides all of it.
    expect(groupState(wire, { ...node, byKind: { session: 3 } })).toBe('none')
    // A mixed folder is split by it.
    expect(groupState(wire, { ...node, byKind: { session: 1, memory: 2 } })).toBe('mixed')
  })

  it('respects group order: a later group that covers the folder wins outright', () => {
    const bravo = { path: 'bravo', subtree: { total: 3, importable: 3, selectedByDefault: 3 } }
    const wire: SelectionWire = {
      base: 'default',
      groups: [
        { folder: 'bravo/x', selected: false },
        { folder: 'bravo', selected: true },
      ],
      rows: [],
    }
    expect(groupState(wire, bravo)).toBe('all')
    expect(groupState({ ...wire, groups: [wire.groups[1]!, wire.groups[0]!] }, bravo)).toBe('mixed')
  })
})

/**
 * The checkbox and the count beside it come from two different places — this
 * module and the server's `/selection/count` — so they are checked against each
 * other here over randomised trees and randomised gesture sequences. The wires
 * are built with `applyGesture`, which is the only way the wizard makes one.
 */
describe('groupState agrees with the resolver it paints for', () => {
  const KINDS = ['memory', 'session', 'code']
  const FOLDERS = ['.', 'alpha', 'alpha/deep', 'alpha/deep/deeper', 'bravo', 'bravo/x', 'charlie']

  const mulberry = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const under = (path: string, folder: string) => path === '.' || folder === path || folder.startsWith(path + '/')

  interface Row {
    id: string
    kind: string
    folder: string
    target: string
    importable: boolean
    selectedByDefault: boolean
  }

  /**
   * A scan-shaped world. The scanner emits `target: 'none'` only with `kind:
   * 'noise'` (`scan-path.ts:470`), so a non-importable row never carries a kind
   * the kind strip offers — which is the invariant the folder state's kind
   * arithmetic rests on.
   *
   * @param pruned build the wire through `applyGesture` (what the wizard does,
   *   and what leaves no group fully shadowed by a later one) or as a raw list
   *   of groups, which is what a wire restored from the server may look like.
   */
  const world = (seed: number, pruned: boolean) => {
    const rnd = mulberry(seed * 7919 + 13)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!
    // Every folder holds at least one importable row, so a gesture on any of
    // them bites and the expected state is decidable from the rows alone.
    const rows: Row[] = FOLDERS.flatMap((folder, f) =>
      Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => {
        const importable = i === 0 || rnd() > 0.25
        return {
          id: `r${f}-${i}`,
          kind: importable ? pick(KINDS) : 'noise',
          folder,
          target: importable ? 'vault.semantic' : 'none',
          importable,
          selectedByDefault: importable && rnd() > 0.4,
        }
      }),
    )
    const base = pick(['default', 'all', 'none']) as SelectionWire['base']
    const gesture = () => {
      const shape = rnd()
      return {
        ...(shape < 0.55 ? { folder: pick(FOLDERS) } : {}),
        ...(shape > 0.4 ? { kind: pick(KINDS) } : {}),
        selected: rnd() > 0.5,
      }
    }
    let wire: SelectionWire = { base, groups: [], rows: [] }
    for (let g = 0; g < 1 + Math.floor(rnd() * 4); g++) {
      wire = pruned ? applyGesture(wire, gesture()) : { ...wire, groups: [...wire.groups, gesture()] }
    }
    return { rows, wire }
  }

  const nodeFor = (rows: Row[], path: string) => {
    const mine = rows.filter((r) => under(path, r.folder))
    const importable = mine.filter((r) => r.importable)
    const byKind: Record<string, number> = {}
    for (const r of mine) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    return {
      node: {
        path,
        subtree: {
          total: mine.length,
          importable: importable.length,
          selectedByDefault: importable.filter((r) => r.selectedByDefault).length,
        },
        byKind,
      },
      importable,
    }
  }

  const truthFor = (importable: Row[], sel: ReturnType<typeof compileSelection>) => {
    const selected = importable.filter((r) => sel.resolve(r)).length
    return importable.length === 0 || selected === 0 ? 'none' : selected === importable.length ? 'all' : 'mixed'
  }

  it('never claims all or none where the resolver disagrees, over 400 randomised scans', () => {
    let checked = 0
    let conservative = 0
    for (let seed = 0; seed < 400; seed++) {
      const { rows, wire } = world(seed, true)
      const sel = compileSelection(wire)
      for (const path of FOLDERS) {
        const { node, importable } = nodeFor(rows, path)
        const state = groupState(wire, node)
        const truth = truthFor(importable, sel)
        if (state !== 'mixed') expect({ seed, path, state }).toEqual({ seed, path, state: truth })
        else if (truth !== 'mixed') conservative += 1
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(2500)
    // Measured at 58 of 2 800 (2.1 %). Bounded so the checkbox cannot quietly
    // decay into always saying "partly"; before the descendant and kind passes
    // landed, 4.7 % of these rows were not cautious but WRONG.
    expect(conservative).toBeLessThan(120)
  })

  it('never claims all or none where the resolver disagrees, on a wire nothing pruned', () => {
    let conservative = 0
    let checked = 0
    for (let seed = 0; seed < 400; seed++) {
      const { rows, wire } = world(seed, false)
      const sel = compileSelection(wire)
      for (const path of FOLDERS) {
        const { node, importable } = nodeFor(rows, path)
        const state = groupState(wire, node)
        const truth = truthFor(importable, sel)
        // `mixed` is always allowed to be the honest "partly": which rows a
        // group reaches cannot always be settled from a subtree aggregate.
        // `all` and `none` are claims, and a claim must be true.
        if (state !== 'mixed') expect({ seed, path, state }).toEqual({ seed, path, state: truth })
        else if (truth !== 'mixed') conservative += 1
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(2500)
    expect(conservative).toBeLessThan(200)
  })
})

/**
 * `groupState` is called once per painted row of a virtualised tree, so its cost
 * is paid on every scroll frame — and the selection wire is allowed 5 000
 * groups. Reading the folder one kind at a time made it O(kinds × groups) for a
 * while; these budgets are what stops that coming back unnoticed.
 */
describe('groupState stays cheap enough to paint on every row', () => {
  const KINDS = ['memory', 'index', 'session', 'skill', 'rule', 'identity', 'persona', 'knowledge', 'code', 'unknown', 'noise']

  /** The worst shape, and the natural one: the broad gesture first, then narrow ones that close no kind. */
  const wireOf = (count: number): SelectionWire => {
    const groups: SelectionWire['groups'] = [{ folder: '.', selected: false }]
    for (let i = 1; i < count; i++) groups.push({ folder: `notes/f${i}`, selected: i % 2 === 0 })
    return { base: 'default', groups, rows: [] }
  }

  const node = {
    path: 'notes',
    subtree: { total: 40, importable: 40, selectedByDefault: 20 },
    byKind: Object.fromEntries(KINDS.filter((k) => k !== 'noise').map((k) => [k, 4])),
  }

  /*
   * A-87. These were microsecond budgets — 60 µs at 500 groups, 400 µs at
   * 5 000 — and a stopwatch measures the machine as much as the code. Under five
   * concurrent runs they failed twice in fifteen.
   *
   * The regression they exist for is structural, not temporal: reading the
   * folder one kind at a time made this O(kinds × groups), so painting a row
   * walked the group list once PER KIND. That is a count of how many groups the
   * function touches, and the count is the same on every machine however busy.
   *
   * Measured: exactly one pass — 500 reads at 500 groups, 5 000 at 5 000. The
   * shape this replaced would read ten times that, one pass for each kind.
   */
  const groupReadsPerRow = (wire: SelectionWire): number => {
    let reads = 0
    const counting = new Proxy(wire.groups ?? [], {
      get: (t, k) => {
        if (typeof k === 'string' && /^\d+$/.test(k)) reads++
        return Reflect.get(t, k)
      },
    })
    const state = groupState({ ...wire, groups: counting } as SelectionWire, node)
    expect(state).toBeTruthy()
    return reads
  }

  it('walks the group list once per painted row at 500 groups, not once per kind', () => {
    const reads = groupReadsPerRow(wireOf(500))
    expect(reads).toBeLessThanOrEqual(500)
    // Ten kinds are in play, so the shape this replaced would read ~5 000.
    expect(reads).toBeLessThan(500 * KINDS.length)
  })

  it('walks it once at the 5 000-group transport cap too', () => {
    const reads = groupReadsPerRow(wireOf(5_000))
    expect(reads).toBeLessThanOrEqual(5_000)
    expect(reads).toBeLessThan(5_000 * KINDS.length)
  })
})

describe('the copy has not drifted from the server module', () => {
  it('carries the server resolver source verbatim', () => {
    const server = readFileSync(resolve(process.cwd(), 'src/modules/data-port/selection.ts'), 'utf-8')
    const web = readFileSync(resolve(process.cwd(), 'src/web/src/pages/settings/data-port-selection.ts'), 'utf-8')

    const serverAt = server.indexOf(VERBATIM_START_ANCHOR)
    const webAt = web.indexOf(VERBATIM_START_ANCHOR)
    const webEnd = web.indexOf(VERBATIM_END_MARKER)
    expect(serverAt, 'the server resolver no longer starts with the anchored comment').toBeGreaterThan(-1)
    expect(webAt, 'the web copy no longer starts with the anchored comment').toBeGreaterThan(-1)
    expect(webEnd, 'the web copy lost its end-of-copy sentinel').toBeGreaterThan(webAt)

    const copied = web.slice(webAt, webEnd).trimEnd()
    // A truncated anchor must not make this pass by comparing two empty strings.
    expect(copied.length).toBeGreaterThan(1000)
    expect(
      copied,
      'src/web/src/pages/settings/data-port-selection.ts has drifted from src/modules/data-port/selection.ts (A-19) — copy the server file again',
    ).toBe(server.slice(serverAt).trimEnd())
  })

  it('inlines the same transport limits the server imports', () => {
    // These two sit ABOVE the copied region, so the text compare cannot see
    // them. Diverge and the wizard accepts a wire the route answers 400 for.
    // Comments out first. `NAME = 500` written in a doc comment to explain the
    // limit would satisfy this pattern and be taken as the value, since `exec`
    // returns the FIRST match — the same class of failure that read a doc
    // comment as array members in the vocabulary guard.
    const constants = stripComments(
      readFileSync(resolve(process.cwd(), 'src/modules/data-port/constants.ts'), 'utf-8'),
    )
    const web = stripComments(
      readFileSync(resolve(process.cwd(), 'src/web/src/pages/settings/data-port-selection.ts'), 'utf-8'),
    )
    const value = (source: string, name: string) => {
      const m = new RegExp(`${name}\\s*=\\s*([0-9_]+)`).exec(source)
      expect(m, `${name} not found`).toBeTruthy()
      return Number(m![1]!.replace(/_/g, ''))
    }
    for (const name of ['SELECTION_MAX_ROWS', 'SELECTION_MAX_GROUPS']) {
      expect({ name, web: value(web, name) }).toEqual({ name, web: value(constants, name) })
    }
  })
})
