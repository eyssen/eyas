// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/design-index.ts
//
// One structure for every design, derived — never authored.
//
// A design canvas is tens of kilobytes of markup. Putting it in the prompt is
// wasteful and, past a threshold, impossible; putting a bare list of filenames
// in the prompt is useless, because `Patterns.dc.html` tells an agent nothing
// about whether the answer it needs is in there. Both were tried, and the
// second is what actually shipped: an agent asked for a calculator got five
// file names and no colours.
//
// So the prompt carries an INDEX with a fixed shape: for each artboard, the
// role it plays, what it is called, and the values it actually defines. That is
// enough to answer the common question ("what is the primary colour") with no
// lookup at all, and enough to decide which single artboard to read when it is
// not. The full source is fetched with design_read, one file at a time.
//
// Derived at read time rather than stored. A stored index is a second copy to
// keep in sync, it would travel in exports and confuse the Claude Design
// interop, and parsing a few artboards costs microseconds.

import { isImageName, CANVAS_FILE, type ArtboardEntry } from './canvas-schema.js'
import type { Design } from './types.js'

/**
 * The vocabulary. Deliberately small: an agent has to learn it once and apply
 * it to every design, so more roles would make it worse, not better.
 */
export const ARTBOARD_ROLES = ['tokens', 'typography', 'components', 'patterns', 'page', 'other'] as const
export type ArtboardRole = (typeof ARTBOARD_ROLES)[number]

/** Reusable definitions first: they answer most questions without a lookup. */
const ROLE_ORDER: ArtboardRole[] = ['tokens', 'typography', 'components', 'patterns', 'page', 'other']

/**
 * Role cues, in the six languages the product speaks plus the words designers
 * actually use. Matched against the title first, then the file stem.
 *
 * Two traps, both hit on the first real design this ran against:
 *   - JavaScript's `\b` is defined on ASCII word characters, so `\bűrlap`
 *     never matches "Űrlapelemek" — there is no boundary before a character the
 *     engine does not consider a letter. Hence the Unicode lookbehind.
 *   - Hungarian lengthens the stem vowel in the plural: "minta" is NOT a prefix
 *     of "minták". Cues have to be written to survive that.
 */
const CUE_WORDS: Array<[ArtboardRole, string[]]> = [
  ['tokens', ['token', 'szín', 'szin', 'color', 'colour', 'palette', 'paletta', 'variable', 'változó', 'variablen', 'farbe', 'couleur', 'rItlh']],
  ['typography', ['typo', 'tipográ', 'tipogra', 'type scale', 'font', 'betű', 'betu', 'schrift', 'police', 'ngutlh']],
  ['components', ['component', 'komponens', 'gomb', 'button', 'form', 'űrlap', 'urlap', 'input', 'control', 'element', 'bauteil', 'composant']],
  ['patterns', ['pattern', 'mint[aá]', 'layout', 'elrendez', 'view', 'nézet', 'nezet', 'muster', 'motif', 'screen']],
  ['page', ['page', 'oldal', 'landing', 'overview', 'áttekint', 'attekint', 'seite', 'página', 'pagina', 'home', 'dashboard']],
]

const ROLE_CUES: Array<[ArtboardRole, RegExp]> = CUE_WORDS.map(([role, words]) => [
  role,
  new RegExp(`(?<!\\p{L})(?:${words.join('|')})`, 'iu'),
])

export function classifyArtboard(file: string, title: string | undefined, body: string): ArtboardRole {
  const stem = file.replace(/\.dc\.html$/i, '')
  for (const source of [title, stem]) {
    if (!source) continue
    for (const [role, cue] of ROLE_CUES) if (cue.test(source)) return role
  }
  // Content is the last resort and only for the one role a body can prove.
  if (/--[a-z0-9-]+\s*:/i.test(body) && (body.match(/#[0-9a-f]{6}/gi)?.length ?? 0) > 8) return 'tokens'
  return 'other'
}

export interface ArtboardIndexEntry {
  file: string
  title: string
  role: ArtboardRole
  chars: number
  /** Distinct hex colours, most-used first. */
  colours: string[]
  /** Typeface families named in the artboard. */
  fonts: string[]
  /** The artboard's own headings — its table of contents. */
  headings: string[]
}

export interface DesignIndex {
  artboards: ArtboardIndexEntry[]
  totalChars: number
}

const HEX_RE = /#[0-9a-fA-F]{6}\b/g
const FONT_RE = /font-family\s*:\s*([^;}]+)/gi
const HEADING_RE = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function topColours(body: string, limit = 5): string[] {
  const counts = new Map<string, number>()
  for (const hex of body.match(HEX_RE) ?? []) {
    const key = hex.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([hex]) => hex)
}

function families(body: string, limit = 3): string[] {
  const out: string[] = []
  for (const m of body.matchAll(FONT_RE)) {
    // The first family is the intended one; the rest is the fallback stack.
    const first = m[1].split(',')[0].trim().replace(/^["']|["']$/g, '')
    // System-font aliases are not a typeface choice; reporting them as one
    // makes every artboard look like it picked the same face.
    const GENERIC = /^(system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|BlinkMacSystemFont|inherit|initial|unset|sans-serif|serif|monospace|cursive|fantasy)$/i
    if (first && !GENERIC.test(first) && !out.includes(first)) {
      out.push(first)
    }
    if (out.length >= limit) break
  }
  return out
}

function headings(body: string, limit = 4): string[] {
  const out: string[] = []
  for (const m of body.matchAll(HEADING_RE)) {
    const text = textOf(m[1]).slice(0, 60)
    if (text && !out.includes(text)) out.push(text)
    if (out.length >= limit) break
  }
  return out
}

export function buildDesignIndex(design: Design): DesignIndex {
  const placed = new Map<string, ArtboardEntry>(
    (design.manifest.artboards ?? []).map((a) => [a.file, a]),
  )

  const artboards: ArtboardIndexEntry[] = []
  for (const file of design.artboards) {
    if (file === CANVAS_FILE || isImageName(file)) continue
    const body = design.files[file] ?? ''
    const heads = headings(body)
    const title = placed.get(file)?.title ?? heads[0] ?? file.replace(/\.dc\.html$/i, '')
    artboards.push({
      file,
      title,
      role: classifyArtboard(file, placed.get(file)?.title, body),
      chars: body.length,
      colours: topColours(body),
      fonts: families(body),
      headings: heads,
    })
  }

  artboards.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.file.localeCompare(b.file))
  return { artboards, totalChars: artboards.reduce((sum, a) => sum + a.chars, 0) }
}

function kb(chars: number): string {
  return chars < 1024 ? `${chars} B` : `${(chars / 1024).toFixed(1)} KB`
}

/**
 * The block that reaches the model. Uniform across designs on purpose: an agent
 * that has read one of these knows how to read every other.
 */
/**
 * What each role HOLDS, so the announcement can say what kind of data is there
 * without handing the data over.
 */
const ROLE_CONTENTS: Record<ArtboardRole, string> = {
  tokens: 'colours, spacing, radii',
  typography: 'font families, sizes, weights',
  components: 'buttons, inputs and other control shapes',
  patterns: 'page-level compositions',
  page: 'complete page layouts',
  other: 'unclassified artboards',
}

/** Beyond this the file list stops being an aid and starts being a wall of names. */
const MAX_FILES_PER_ROLE = 4

function byRole(index: DesignIndex): Array<[ArtboardRole, ArtboardIndexEntry[]]> {
  const groups = new Map<ArtboardRole, ArtboardIndexEntry[]>()
  for (const a of index.artboards) {
    const list = groups.get(a.role) ?? []
    list.push(a)
    groups.set(a.role, list)
  }
  // ARTBOARD_ROLES is already ordered most-reusable-first.
  return ARTBOARD_ROLES.filter((r) => groups.has(r)).map((r) => [r, groups.get(r)!])
}

/**
 * The per-turn block: the design is HERE, and this is the KIND of data it
 * holds. No values.
 *
 * The earlier version inlined the palette so the common question needed no
 * lookup. That was compensating for a broken tool path — `design_read` was
 * being dropped from the truncated tool inventory, so the model could not
 * fetch anything and had to be fed. With the inventory fixed, feeding it is
 * just cost: the announcement is paid on EVERY turn, a fetch is paid ONCE.
 * At two turns the fetch is already cheaper, and unlike the announcement it
 * does not grow with the canvas.
 */
export function renderDesignAnnouncement(design: Design, index: DesignIndex): string {
  const lines: string[] = []
  lines.push(`### ${design.title} — design id \`${design.id}\` (v${design.currentVersion}, ${index.artboards.length} artboards)`)
  lines.push('')
  lines.push('Follow this design in anything you produce here. Do not invent styling — fetch what you need before you write.')
  lines.push(`Parts, fetched with \`design_read\` (designId "${design.id}", part "<name>"):`)

  for (const [role, entries] of byRole(index)) {
    const shown = entries.slice(0, MAX_FILES_PER_ROLE).map((a) => a.file)
    const rest = entries.length - shown.length
    const files = rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ')
    lines.push(`- **${role}** — ${ROLE_CONTENTS[role]} · ${files}`)
  }

  lines.push(`For an artboard's markup: \`design_read\` with designId "${design.id}" and file "<name>".`)
  return lines.join('\n')
}

/**
 * What a `part` fetch returns: the derived facts for one role, and nothing
 * from any other. Same derivation as the announcement, so the two can never
 * disagree about what exists.
 */
export function renderDesignPart(design: Design, index: DesignIndex, role: ArtboardRole): string | null {
  const entries = index.artboards.filter((a) => a.role === role)
  if (entries.length === 0) return null

  const lines: string[] = [`${role} — ${entries.length} artboard${entries.length === 1 ? '' : 's'} in "${design.title}"`]
  for (const a of entries) {
    const facts = [
      a.colours.length ? `colours ${a.colours.join(' ')}` : '',
      a.fonts.length ? `type ${a.fonts.join(', ')}` : '',
      a.headings.length > 1 ? `sections: ${a.headings.slice(0, 4).join(' · ')}` : '',
    ].filter(Boolean).join(' — ')
    lines.push(`- **${a.file}** · "${a.title}" · ${kb(a.chars)}${facts ? `\n  ${facts}` : ''}`)
  }
  lines.push(`These are derived values. Read one of these files for the markup: \`design_read\` with file "<name>".`)
  return lines.join('\n')
}
