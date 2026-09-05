// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { WIDGETS } from '../../src/web/src/pages/home/widget-registry'
import en from '../../src/web/src/pages/home/locales/en.json'

/**
 * Extract the contents of the first `<key>: [ ... ]` array literal in
 * `source` — with comments stripped out of the result — tracking bracket
 * depth while skipping string literals AND `//` / `/* *​/` comments, so a
 * bracket that only appears inside one of those can't truncate the match
 * early the way a lazy `[\s\S]*?\]` regex would (e.g. a
 * `// TODO: restore [ the old layout ]` comment between two widget entries,
 * or a future array-typed field on `WidgetRegistration`). Comment text is
 * also OMITTED from the returned string, not just skipped for depth-counting
 * purposes — otherwise prose inside a comment that happens to contain
 * `id: '...'` (e.g. a commented-out old declaration) would be picked up by
 * the caller's id regex as a real one. String and comment detection are
 * mutually exclusive and checked in a fixed order (string first) so a `//`
 * inside a string is never read as a comment start, and a quote inside a
 * comment is never read as a string start.
 *
 * Returns null if `<key>:` isn't declared at all — that's a module with no
 * widgets, not a scraper failure.
 *
 * Throws if `<key>:` IS declared but isn't a plain array literal (e.g. built
 * by a helper function call) or the array never closes: both mean "found a
 * widget declaration this scraper cannot read", and silently returning []
 * there would let a real widget go permanently invisible to this contract —
 * the one failure mode this test exists to rule out. See the "fails loudly"
 * describe block below for the fixture that proves it.
 */
function extractArrayBlock(source: string, key: string): string | null {
  const keyIdx = source.indexOf(`${key}:`)
  if (keyIdx === -1) return null

  let i = keyIdx + key.length + 1
  while (i < source.length && /\s/.test(source[i])) i++
  if (source[i] !== '[') {
    throw new Error(
      `"${key}:" is not immediately followed by an array literal (found ` +
        `"${source.slice(i, i + 30).trim()}…") — this scraper only understands ` +
        `"${key}: [ ... ]"; teach it the new shape rather than let the widget go undetected.`,
    )
  }
  const openIdx = i

  let out = ''
  let depth = 1 // the '[' at openIdx itself is consumed here, not appended to `out`
  let inString: '"' | "'" | '`' | null = null
  let inLineComment = false
  let inBlockComment = false
  for (let j = openIdx + 1; j < source.length; j++) {
    const c = source[j]
    const next = source[j + 1]

    if (inLineComment) {
      if (c === '\n') inLineComment = false
      continue // comment characters never reach the returned block
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; j++ }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') { j++; if (j < source.length) out += source[j]; continue } // keep the escaped char, including an escaped quote
      if (c === inString) inString = null
      continue
    }
    // Not inside a string or comment — this is the only point where a new
    // string or comment can start, and where brackets count toward depth.
    if (c === '/' && next === '/') { inLineComment = true; j++; continue }
    if (c === '/' && next === '*') { inBlockComment = true; j++; continue }
    if (c === '"' || c === "'" || c === '`') { inString = c; out += c; continue }
    if (c === '[') { depth++; out += c; continue }
    if (c === ']') {
      depth--
      if (depth === 0) return out
      out += c
      continue
    }
    out += c
  }
  throw new Error(`"${key}: [" never closes in this file — malformed source, cannot extract ids.`)
}

/** Widget ids declared in one manifest file's `frontend: { widgets: [...] }`, if present. */
function widgetIdsInFile(dir: string, filename: string): string[] {
  const filePath = join(dir, filename)
  let source: string
  try {
    source = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  try {
    const block = extractArrayBlock(source, 'widgets')
    if (block === null) return []
    return [...block.matchAll(/id:\s*'([a-z0-9-]+\.[a-z0-9-]+)'/g)].map((m) => m[1])
  } catch (err) {
    throw new Error(`${filePath}: ${(err as Error).message}`)
  }
}

/**
 * Every `frontend: { widgets: [...] }` id declared by any module or submodule
 * manifest under `modulesDir` (defaults to the real `src/modules`).
 *
 * Checked files per module/submodule dir: `index.ts` and `manifest.ts`. Both
 * exist as real conventions in this codebase today — `documents/index.ts` and
 * `notifications/index.ts` declare `frontend` inline, while
 * `mission-control/index.ts` spreads `...missionControlManifest` from a
 * separate `manifest.ts` (client-wiki, artifacts, skill-generation,
 * event-store and ops follow the same split). Every submodule
 * (`SubmoduleManifest`, src/core/types.ts:222 — model/submodules/ and
 * communication/submodules/ already exist) follows that second pattern
 * exclusively: e.g. model/submodules/ollama/index.ts only re-exports
 * `ollamaManifest` from ./manifest.ts, which is where the object — and any
 * `frontend.widgets` — actually lives. Scanning only `index.ts` would leave
 * this test blind to a widget declared the way mission-control's own module
 * (and every real submodule) already declares its manifest — Task 11 is
 * expected to add `mission-control.running` there. That defeats the point of
 * the test: it would pass while the wiring is one-sided instead of failing.
 */
function declaredWidgetIds(modulesDir = join(process.cwd(), 'src/modules')): string[] {
  const ids: string[] = []
  let modules: Dirent[]
  try {
    modules = readdirSync(modulesDir, { withFileTypes: true })
  } catch {
    return ids
  }

  for (const mod of modules) {
    if (!mod.isDirectory()) continue
    const moduleDir = join(modulesDir, mod.name)
    ids.push(...widgetIdsInFile(moduleDir, 'index.ts'))
    ids.push(...widgetIdsInFile(moduleDir, 'manifest.ts'))

    const submodulesDir = join(moduleDir, 'submodules')
    let submodules: Dirent[]
    try {
      submodules = readdirSync(submodulesDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const sub of submodules) {
      if (!sub.isDirectory()) continue
      const subDir = join(submodulesDir, sub.name)
      ids.push(...widgetIdsInFile(subDir, 'index.ts'))
      ids.push(...widgetIdsInFile(subDir, 'manifest.ts'))
    }
  }
  return ids
}

describe('widget contract — backend declaration ↔ frontend implementation', () => {
  it('every declared widget has a frontend component', () => {
    const missing = declaredWidgetIds().filter((id) => !WIDGETS[id])
    expect(missing, `declared but not implemented: ${missing.join(', ')}`).toEqual([])
  })

  it('every implemented widget is declared by a module', () => {
    const declared = new Set(declaredWidgetIds())
    const orphans = Object.keys(WIDGETS).filter((id) => !declared.has(id))
    expect(orphans, `implemented but not declared: ${orphans.join(', ')}`).toEqual([])
  })

  it('every widget titleKey resolves in the English bundle', () => {
    const unresolved = Object.values(WIDGETS)
      .map((w) => w.titleKey)
      .filter((key) => !(key in (en as Record<string, string>)))
    expect(unresolved, `missing i18n keys: ${unresolved.join(', ')}`).toEqual([])
  })
})

describe('declaredWidgetIds — submodule visibility', () => {
  it('sees a widget declared on a SubmoduleManifest, in manifest.ts, not index.ts', () => {
    // tests/contracts/fixtures/widgets-submodule/fixture-module/submodules/fixture-sub/
    // mirrors the real shape (model/submodules/ollama): the widget lives in
    // manifest.ts; index.ts is a re-export shim that never mentions "widgets".
    const fixtureDir = join(process.cwd(), 'tests/contracts/fixtures/widgets-submodule')
    expect(declaredWidgetIds(fixtureDir)).toEqual(['fixture-module.example-widget'])
  })
})

describe('declaredWidgetIds — top-level module manifest.ts visibility', () => {
  it('sees a widget declared in manifest.ts, spread into index.ts (mission-control shape)', () => {
    // tests/contracts/fixtures/widgets-manifest/fixture-module/ mirrors the
    // real src/modules/mission-control shape: index.ts spreads
    // `...fixtureManifest` from manifest.ts and never mentions "widgets"
    // itself; the widget lives in manifest.ts.
    const fixtureDir = join(process.cwd(), 'tests/contracts/fixtures/widgets-manifest')
    expect(declaredWidgetIds(fixtureDir)).toEqual(['fixture-module.manifest-widget'])
  })
})

describe('declaredWidgetIds — fails loudly on an unparseable widget declaration', () => {
  it('throws, naming the file, when `widgets:` is not a plain array literal', () => {
    // tests/contracts/fixtures/widgets-unparseable/fixture-module/index.ts
    // builds its widgets via a helper function call — a shape this scraper
    // does not (and, per the plan, should not try to) understand. It must
    // fail the build rather than silently report zero widgets.
    const fixtureDir = join(process.cwd(), 'tests/contracts/fixtures/widgets-unparseable')
    expect(() => declaredWidgetIds(fixtureDir)).toThrow(
      /is not immediately followed by an array literal/,
    )
    expect(() => declaredWidgetIds(fixtureDir)).toThrow(/fixture-module[/\\]index\.ts/)
  })
})

describe('extractArrayBlock — balanced-bracket safety', () => {
  it('does not truncate at a nested array\'s closing bracket', () => {
    const source = `
      export const manifest = {
        frontend: {
          widgets: [
            { id: 'a.first', tags: ['nested', 'array'] },
            { id: 'a.second' },
          ],
        },
      }
    `
    const block = extractArrayBlock(source, 'widgets')
    expect(block).not.toBeNull()
    const ids = [...block!.matchAll(/id:\s*'([a-z0-9-]+\.[a-z0-9-]+)'/g)].map((m) => m[1])
    // A lazy `[\s\S]*?\]` match would have stopped at `['nested', 'array']`'s
    // closing `]` and missed 'a.second' entirely.
    expect(ids).toEqual(['a.first', 'a.second'])
  })
})

describe('extractArrayBlock — comment safety', () => {
  it('does not truncate at a `]` inside a // line comment', () => {
    const source = `
      widgets: [
        { id: 'a.first', titleKey: 'a' },
        // TODO: restore [ the old layout ] later
        { id: 'a.second', titleKey: 'b' },
      ],
    `
    const block = extractArrayBlock(source, 'widgets')
    expect(block).not.toBeNull()
    const ids = [...block!.matchAll(/id:\s*'([a-z0-9-]+\.[a-z0-9-]+)'/g)].map((m) => m[1])
    // Without comment-awareness, the `]` inside the TODO would end the block
    // early and 'a.second' would silently disappear from the scraper's view.
    expect(ids).toEqual(['a.first', 'a.second'])
  })

  it('does not truncate at a `]` inside a /* */ block comment', () => {
    const source = `
      widgets: [
        { id: 'a.first', titleKey: 'a' },
        /* legacy shape: [ { id: 'a.dropped' } ] — removed, keeping for reference */
        { id: 'a.second', titleKey: 'b' },
      ],
    `
    const block = extractArrayBlock(source, 'widgets')
    expect(block).not.toBeNull()
    const ids = [...block!.matchAll(/id:\s*'([a-z0-9-]+\.[a-z0-9-]+)'/g)].map((m) => m[1])
    expect(ids).toEqual(['a.first', 'a.second'])
  })

  it('does not treat "//" inside a string literal as a comment start', () => {
    const source = `
      widgets: [
        { id: 'a.first', titleKey: 'see http://example.com/a]b for details' },
        { id: 'a.second', titleKey: 'b' },
      ],
    `
    const block = extractArrayBlock(source, 'widgets')
    expect(block).not.toBeNull()
    const ids = [...block!.matchAll(/id:\s*'([a-z0-9-]+\.[a-z0-9-]+)'/g)].map((m) => m[1])
    // If "//" inside the titleKey string were read as a comment start, the
    // "]" a few characters later in that same string would end the block
    // early — proving string detection is checked before comment detection.
    expect(ids).toEqual(['a.first', 'a.second'])
  })
})

// --- widget topics must derive from WS_TOPICS, never a hand-written literal ---
//
// Fix round 2 (Task 8): `assertResolvedTopic` in use-widget-data.ts catches an
// unresolvable topic at runtime, but a hand-built string that HAPPENS to look
// resolved (contains a `:`, e.g. a typo'd `'bord:proj-7'`) sails straight
// through that guard, subscribes to a topic nothing ever publishes to, and
// the tile silently never refreshes again — with no error anywhere.
// ws-topics.contract.test.ts already bans a literal *at the subscribe call
// site*; useWidgetData's own subscribe call passes a variable, so it's
// structurally exempt from that scan regardless of how the variable's value
// was built. This closes the gap one step earlier, at the declaration that
// feeds it: every entry in a widget's `refresh.topics` array must be a
// `WS_TOPICS.*` reference (`WS_TOPICS.autonomy`, or a call inside a
// config-derived function, `WS_TOPICS.board(cfg.projectId)`) — neither form
// ever needs a quote, so any quote/backtick found inside the array is proof
// of a hand-written topic name.

const WIDGET_REGISTRY_PATH = join(process.cwd(), 'src/web/src/pages/home/widget-registry.ts')

/**
 * From `openIdx` (pointing at `openChar`), returns the balanced content up to
 * (not including) the matching `closeChar` — comments stripped, strings kept
 * — the same string/comment-aware scanning `extractArrayBlock` above uses,
 * generalised to any bracket pair so it can also balance the WIDGETS `{...}`
 * object and each entry's `topics: [...]` array. `extractArrayBlock` itself
 * is untouched.
 */
function readBalanced(
  source: string,
  openIdx: number,
  openChar: string,
  closeChar: string,
): { content: string; endIdx: number } {
  let out = ''
  let depth = 1
  let inString: '"' | "'" | '`' | null = null
  let inLineComment = false
  let inBlockComment = false
  for (let j = openIdx + 1; j < source.length; j++) {
    const c = source[j]
    const next = source[j + 1]

    if (inLineComment) {
      if (c === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; j++ }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') { j++; if (j < source.length) out += source[j]; continue }
      if (c === inString) inString = null
      continue
    }
    if (c === '/' && next === '/') { inLineComment = true; j++; continue }
    if (c === '/' && next === '*') { inBlockComment = true; j++; continue }
    if (c === '"' || c === "'" || c === '`') { inString = c; out += c; continue }
    if (c === openChar) { depth++; out += c; continue }
    if (c === closeChar) {
      depth--
      if (depth === 0) return { content: out, endIdx: j + 1 }
      out += c
      continue
    }
    out += c
  }
  throw new Error(`"${openChar}" at index ${openIdx} never closes.`)
}

/**
 * Splits object/array literal `content` at commas that sit outside any
 * nested `()`/`[]`/`{}`, string, or comment — i.e. its top-level entries.
 * String/comment-aware for the same reason as `extractArrayBlock` above.
 */
function splitTopLevel(content: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let inString: '"' | "'" | '`' | null = null
  let inLineComment = false
  let inBlockComment = false
  for (let j = 0; j < content.length; j++) {
    const c = content[j]
    const next = content[j + 1]

    if (inLineComment) {
      if (c === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; j++ }
      continue
    }
    if (inString) {
      if (c === '\\') { j++; continue }
      if (c === inString) inString = null
      continue
    }
    if (c === '/' && next === '/') { inLineComment = true; j++; continue }
    if (c === '/' && next === '*') { inBlockComment = true; j++; continue }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue }
    if (c === '{' || c === '[' || c === '(') { depth++; continue }
    if (c === '}' || c === ']' || c === ')') { depth--; continue }
    if (c === ',' && depth === 0) {
      parts.push(content.slice(start, j))
      start = j + 1
      continue
    }
  }
  const last = content.slice(start)
  if (last.trim().length > 0) parts.push(last)
  return parts
}

/**
 * Widget ids whose `refresh.topics` array holds a hand-written string
 * literal instead of deriving every entry from `WS_TOPICS.*`. Returns []
 * when `WIDGETS` isn't a plain object literal at all (nothing to scan yet).
 *
 * Throws, naming the widget, when a `topics:` field isn't followed by an
 * array literal anywhere in that entry (e.g. `topics: buildTopics(cfg)`) —
 * a shape this scanner doesn't understand must fail loudly, not silently
 * report no offenders, exactly like `extractArrayBlock` above.
 */
function widgetsWithLiteralTopics(source: string): { id: string; literal: string }[] {
  const declIdx = source.indexOf('WIDGETS')
  if (declIdx === -1) return []
  const eqIdx = source.indexOf('=', declIdx)
  const openIdx = source.indexOf('{', eqIdx)
  if (eqIdx === -1 || openIdx === -1) return []

  const { content: registryBody } = readBalanced(source, openIdx, '{', '}')
  const offenders: { id: string; literal: string }[] = []

  for (const entry of splitTopLevel(registryBody)) {
    const idMatch = entry.match(/id:\s*'([^']+)'/)
    if (!idMatch) continue // not a `'key': { id: ..., ... }` entry — nothing this scanner understands
    const id = idMatch[1]

    const topicsIdx = entry.indexOf('topics:')
    if (topicsIdx === -1) continue // load-once or ws-topics-free widget — nothing to check

    const bracketIdx = entry.indexOf('[', topicsIdx)
    if (bracketIdx === -1) {
      throw new Error(
        `"${id}"'s topics: is not an array literal (found "${entry
          .slice(topicsIdx, topicsIdx + 40)
          .trim()}…") — this scanner only understands "topics: [...]" or ` +
          `"topics: (cfg) => [...]"; teach it the new shape rather than let a hand-written topic go undetected.`,
      )
    }
    const { content: topicsArray } = readBalanced(entry, bracketIdx, '[', ']')
    const literalMatch = topicsArray.match(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/)
    if (literalMatch) offenders.push({ id, literal: literalMatch[0] })
  }

  return offenders
}

describe('widget contract — refresh.topics must derive from WS_TOPICS', () => {
  it('WIDGETS has no hand-written topic literal', () => {
    const offenders = widgetsWithLiteralTopics(readFileSync(WIDGET_REGISTRY_PATH, 'utf8'))
    expect(
      offenders,
      `hand-written topic literal(s): ${offenders.map((o) => `${o.id}: ${o.literal}`).join(', ')}`,
    ).toEqual([])
  })
})

describe('widgetsWithLiteralTopics — bites on a hand-written topic, spares WS_TOPICS references', () => {
  it('accepts a static WS_TOPICS reference and a config-derived WS_TOPICS call', () => {
    const source = `
      export const WIDGETS: Record<string, WidgetDef> = {
        'a.static': {
          id: 'a.static',
          refresh: { topics: [WS_TOPICS.autonomy], pollMs: 60000 },
        },
        'a.dynamic': {
          id: 'a.dynamic',
          refresh: { topics: (cfg: { projectId: string }) => [WS_TOPICS.board(cfg.projectId)] },
        },
      }
    `
    expect(widgetsWithLiteralTopics(source)).toEqual([])
  })

  it('fails on a hand-written topic literal, naming the widget and the literal', () => {
    const source = `
      export const WIDGETS: Record<string, WidgetDef> = {
        'a.bad': {
          id: 'a.bad',
          refresh: { topics: ['board:proj-7'], pollMs: 60000 },
        },
      }
    `
    expect(widgetsWithLiteralTopics(source)).toEqual([{ id: 'a.bad', literal: "'board:proj-7'" }])
  })

  it('fails on a literal mixed in among otherwise-valid WS_TOPICS entries', () => {
    const source = `
      export const WIDGETS: Record<string, WidgetDef> = {
        'a.mixed': {
          id: 'a.mixed',
          refresh: { topics: [WS_TOPICS.autonomy, 'mission-control'] },
        },
      }
    `
    expect(widgetsWithLiteralTopics(source)).toEqual([{ id: 'a.mixed', literal: "'mission-control'" }])
  })
})

describe('widgetsWithLiteralTopics — fails loudly on an unparseable topics declaration', () => {
  it('throws, naming the widget, when `topics:` is not followed by an array literal', () => {
    const source = `
      export const WIDGETS: Record<string, WidgetDef> = {
        'a.opaque': {
          id: 'a.opaque',
          refresh: { topics: buildTopics(cfg), pollMs: 60000 },
        },
      }
    `
    expect(() => widgetsWithLiteralTopics(source)).toThrow(/a\.opaque.*not an array literal/s)
  })
})
