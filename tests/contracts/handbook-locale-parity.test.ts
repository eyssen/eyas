// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { HEADING_ID_SUFFIX, applyHeadingId, remarkHeadingIds } from '../../packages/docs/remark-heading-ids.mjs'
import type { HeadingIdNode } from '../../packages/docs/remark-heading-ids.mjs'

/**
 * Handbook locale parity — the one handbook parity test. English is the
 * source language (packages/docs/PAGE_TEMPLATE.md); the other five locales
 * are translations with the same structure.
 *
 * For each page in PARITY_PAGES, the six locales must have:
 *   - the same heading-level sequence (## / ### / #### …, in order);
 *   - the same explicit anchors at the same positions: a heading with an
 *     explicit id (`## Heading {#id}` — see packages/docs/remark-heading-ids.mjs
 *     — or `<h2 id="id">`) in one locale carries the same id in every other,
 *     and it equals the English heading's anchor (its explicit id, or the slug
 *     of its English text);
 *   - no explicit id used twice on the page;
 *   - an explicit id in the `{#id}` suffix form, which keeps the heading in
 *     the page's "On this page" table of contents. A raw `<hN id>` is only
 *     for an id containing `--`, which the typographic pass (it runs before
 *     the heading-id plugin) would turn into a dash;
 *   - with `explicitIds`: an explicit id on every heading of every translation;
 *   - with `tableRows`: the same number of Markdown table rows (a glossary
 *     entry added in one language only fails).
 *
 * Links: every `/docs/<lang>/<page>/#anchor` link anywhere in the handbook,
 * and every in-page `#anchor` link, must point at an anchor that exists on
 * that locale's page; every help-map.json hash into a listed page must exist
 * in all six locales.
 *
 * Page owners append their page to PARITY_PAGES once its six locales are
 * consolidated.
 */

const DOCS_ROOT = join(process.cwd(), 'packages/docs/src/content/docs')
const HELP_MAP_PATH = join(process.cwd(), 'packages/docs/help-map.json')
const LOCALES = ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const
type Locale = (typeof LOCALES)[number]
const REFERENCE: Locale = 'en'

interface ParityOptions {
  /** Every translated heading carries an explicit English anchor. */
  explicitIds?: boolean
  /** Every locale has the same number of Markdown table rows. */
  tableRows?: boolean
}

interface ParityPage extends ParityOptions {
  /** Path under packages/docs/src/content/docs/<locale>/. */
  page: string
}

/** Pages whose six locales share one heading structure. */
const PARITY_PAGES: readonly ParityPage[] = [
  { page: 'ai/providers.md', tableRows: true },
  { page: 'reference/architecture.md', explicitIds: true, tableRows: true },
  // Two short tables of the English page are prose in some translations.
  { page: 'knowledge/memory.md', explicitIds: true },
  { page: 'deploy/configuration.md', explicitIds: true, tableRows: true },
  { page: 'reference/glossary.md', tableRows: true },
  { page: 'admin/security-privacy.md', tableRows: true },
  { page: 'communication/channels.md', tableRows: true },
  { page: 'automation/opencode.md', tableRows: true },
  { page: 'daily/conversations.md', tableRows: true },
]
const PARITY_PAGE_PATHS = PARITY_PAGES.map((p) => p.page)

// ─── Parsing ───────────────────────────────────

interface Heading {
  level: number
  /** Visible text, markup stripped. */
  text: string
  /** `{#id}` suffix or `<hN id="…">`, when present. */
  explicitId: string | null
  /** Written as a raw `<hN>` rather than a Markdown `#` heading. */
  html: boolean
  /** The id the built page gives the heading: the explicit one, else the slug of its text. */
  anchor: string
  line: number
}

/** github-slugger's algorithm (what Astro uses for heading ids), with its duplicate counter. */
function createSlugger(): (text: string) => string {
  const occurrences = new Map<string, number>()
  return (value: string) => {
    const original = value
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
      .replace(/ /g, '-')
    let result = original
    while (occurrences.has(result)) {
      const next = (occurrences.get(original) ?? 0) + 1
      occurrences.set(original, next)
      result = `${original}-${next}`
    }
    occurrences.set(result, 0)
    return result
  }
}

/** The text a heading's slug is computed from: inline markup and HTML tags removed, entities decoded. */
function plainText(markdown: string): string {
  return markdown
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/** The lines of a Markdown page outside its frontmatter and code fences, with their line numbers. */
function bodyLines(markdown: string): Array<{ text: string; line: number }> {
  const lines = markdown.split(/\r?\n/)
  const out: Array<{ text: string; line: number }> = []
  let inFrontmatter = lines[0]?.trim() === '---'
  let fence: string | null = null
  lines.forEach((raw, index) => {
    if (index === 0 && inFrontmatter) return
    if (inFrontmatter) {
      if (raw.trim() === '---') inFrontmatter = false
      return
    }
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(raw)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = null
      return
    }
    if (fence === null) out.push({ text: raw, line: index + 1 })
  })
  return out
}

/** Every heading of a Markdown page, outside frontmatter and code fences. */
function parseHeadings(markdown: string): Heading[] {
  const slug = createSlugger()
  const out: Heading[] = []
  for (const { text: raw, line } of bodyLines(markdown)) {
    const md = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw)
    if (md) {
      let body = md[2]
      let explicitId: string | null = null
      const suffix = HEADING_ID_SUFFIX.exec(body)
      if (suffix) {
        explicitId = suffix[1]
        body = body.slice(0, suffix.index)
      }
      const text = plainText(body)
      out.push({ level: md[1].length, text, explicitId, html: false, anchor: explicitId ?? slug(text), line })
      continue
    }
    const html = /^\s{0,3}<h([1-6])\b([^>]*)>(.*?)<\/h\1>\s*$/i.exec(raw)
    if (html) {
      const id = /\bid\s*=\s*"([^"]+)"/.exec(html[2])?.[1] ?? null
      const text = plainText(html[3])
      out.push({ level: Number(html[1]), text, explicitId: id, html: true, anchor: id ?? slug(text), line })
    }
  }
  return out
}

/** Markdown table rows (header and separator included), outside code fences. */
function countTableRows(markdown: string): number {
  return bodyLines(markdown).filter(({ text }) => /^\s*\|/.test(text)).length
}

/** Every id a built page exposes: heading anchors plus explicit `id="…"` attributes. */
function anchorsOf(markdown: string): Set<string> {
  const ids = new Set(parseHeadings(markdown).map((h) => h.anchor))
  for (const match of markdown.matchAll(/\bid\s*=\s*"([^"]+)"/g)) ids.add(match[1])
  return ids
}

// ─── Checks (pure, so the fixtures below exercise them too) ────────────────

/** Structural differences between one page's locales, measured against the reference locale. */
function compareLocales(pages: Partial<Record<Locale, string>>, opts: ParityOptions = {}): string[] {
  const issues: string[] = []
  const reference = pages[REFERENCE]
  if (reference === undefined) return [`missing ${REFERENCE} page`]
  const ref = parseHeadings(reference)
  const refRows = countTableRows(reference)

  for (const locale of LOCALES) {
    const markdown = pages[locale]
    if (markdown === undefined) {
      issues.push(`${locale}: page missing`)
      continue
    }
    const headings = parseHeadings(markdown)

    const seen = new Set<string>()
    for (const h of headings) {
      if (h.text.includes('{#')) issues.push(`${locale}:${h.line}: "{#…}" is not at the end of the heading, so it renders as text`)
      if (h.explicitId) {
        if (seen.has(h.explicitId)) issues.push(`${locale}:${h.line}: explicit id "${h.explicitId}" used twice`)
        seen.add(h.explicitId)
      }
      if (h.html && h.explicitId && !h.explicitId.includes('--')) {
        issues.push(`${locale}:${h.line}: raw <h${h.level} id="${h.explicitId}"> leaves the table of contents; write "${'#'.repeat(h.level)} ${h.text} {#${h.explicitId}}"`)
      }
    }
    if (locale === REFERENCE) continue

    if (opts.tableRows) {
      const rows = countTableRows(markdown)
      if (rows !== refRows) issues.push(`${locale}: ${rows} table rows, ${REFERENCE} has ${refRows}`)
    }

    const refLevels = ref.map((h) => h.level).join(',')
    const levels = headings.map((h) => h.level).join(',')
    if (refLevels !== levels) {
      issues.push(`${locale}: heading levels [${levels}] differ from ${REFERENCE} [${refLevels}]`)
      continue
    }
    ref.forEach((r, i) => {
      const h = headings[i]
      if (r.explicitId && h.explicitId !== r.explicitId) {
        issues.push(`${locale}:${h.line}: heading "${h.text}" must carry {#${r.explicitId}} like ${REFERENCE} "${r.text}" (has ${h.explicitId ? `{#${h.explicitId}}` : 'none'})`)
      } else if (h.explicitId && h.explicitId !== r.anchor) {
        issues.push(`${locale}:${h.line}: heading "${h.text}" has {#${h.explicitId}} but ${REFERENCE} "${r.text}" is #${r.anchor}`)
      } else if (opts.explicitIds && !h.explicitId) {
        issues.push(`${locale}:${h.line}: heading "${h.text}" needs {#${r.anchor}}`)
      }
    })
  }
  return issues
}

interface Link {
  source: string
  line: number
  locale: string
  page: string
  anchor: string
}

/** Anchor links in one handbook file: absolute `/docs/<lang>/<page>/#x` and in-page `#x`. */
function linksIn(sourceRel: string, markdown: string): Link[] {
  const out: Link[] = []
  const [sourceLocale, ...rest] = sourceRel.split('/')
  const sourcePage = rest.join('/')
  for (const { text, line } of bodyLines(markdown)) {
    for (const m of text.matchAll(/\]\(\/docs\/([a-z]{2,3})\/([^)#\s]*?)\/?#([^)\s]+)\)/g)) {
      out.push({ source: sourceRel, line, locale: m[1], page: `${m[2]}.md`, anchor: m[3] })
    }
    for (const m of text.matchAll(/\]\(#([^)\s]+)\)/g)) {
      out.push({ source: sourceRel, line, locale: sourceLocale, page: sourcePage, anchor: m[1] })
    }
  }
  return out
}

/** Links (into `pages`, or into any page when `pages` is omitted) whose anchor that locale's page does not have. */
function brokenAnchors(links: readonly Link[], read: (locale: string, page: string) => string | null, pages?: readonly string[]): string[] {
  const broken: string[] = []
  const cache = new Map<string, Set<string> | null>()
  for (const link of links) {
    if (pages && !pages.includes(link.page)) continue
    const key = `${link.locale}/${link.page}`
    if (!cache.has(key)) {
      const markdown = read(link.locale, link.page)
      cache.set(key, markdown === null ? null : anchorsOf(markdown))
    }
    const anchors = cache.get(key)
    if (!anchors) broken.push(`${link.source}:${link.line}: /docs/${link.locale}/${link.page.replace(/\.md$/, '')}/ does not exist`)
    else if (!anchors.has(link.anchor)) broken.push(`${link.source}:${link.line}: #${link.anchor} is not an anchor of ${key}`)
  }
  return broken
}

// ─── Handbook I/O ─────────────────────────────────

/** A page by its link path: `<page>.md`, `<page>.mdx` or `<page>/index.md(x)`. */
function readPage(locale: string, page: string): string | null {
  const base = page.replace(/\.mdx?$/, '')
  for (const candidate of [`${base}.md`, `${base}.mdx`, `${base}/index.md`, `${base}/index.mdx`]) {
    const file = join(DOCS_ROOT, locale, candidate)
    if (existsSync(file)) return readFileSync(file, 'utf8')
  }
  return null
}

function handbookFiles(dir: string = DOCS_ROOT): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...handbookFiles(full))
    else if (/\.mdx?$/.test(entry.name)) out.push(relative(DOCS_ROOT, full).split(sep).join('/'))
  }
  return out
}

// ─── Tests ─────────────────────────────────────

describe('handbook locale parity', () => {
  it('lists at least one page, and every listed page exists in all six locales', () => {
    expect(PARITY_PAGES.length).toBeGreaterThan(0)
    for (const { page } of PARITY_PAGES) {
      for (const locale of LOCALES) {
        expect(readPage(locale, page), `${locale}/${page}`).not.toBeNull()
      }
    }
  })

  for (const { page, ...opts } of PARITY_PAGES) {
    it(`${page}: the six locales share heading levels and explicit anchors${opts.tableRows ? ' and table rows' : ''}`, () => {
      const pages: Partial<Record<Locale, string>> = {}
      for (const locale of LOCALES) {
        const markdown = readPage(locale, page)
        if (markdown !== null) pages[locale] = markdown
      }
      expect(compareLocales(pages, opts)).toEqual([])
    })
  }

  it('every anchor link in the handbook points at an existing anchor of its target page', () => {
    const links = handbookFiles().flatMap((rel) => linksIn(rel, readFileSync(join(DOCS_ROOT, rel), 'utf8')))
    expect(links.length).toBeGreaterThan(0)
    expect(brokenAnchors(links, readPage)).toEqual([])
  })

  it('every help-map hash into a listed page exists in all six locales', () => {
    const helpMap = JSON.parse(readFileSync(HELP_MAP_PATH, 'utf8')) as { entries: Record<string, { path: string; hash?: string | null }> }
    const problems: string[] = []
    for (const [id, entry] of Object.entries(helpMap.entries)) {
      const page = `${entry.path.replace(/^\/+|\/+$/g, '')}.md`
      if (!entry.hash || !PARITY_PAGE_PATHS.includes(page)) continue
      for (const locale of LOCALES) {
        const markdown = readPage(locale, page)
        if (markdown === null || !anchorsOf(markdown).has(entry.hash)) problems.push(`${id}: #${entry.hash} missing in ${locale}/${page}`)
      }
    }
    expect(problems).toEqual([])
  })
})

describe('handbook locale parity — the checks themselves', () => {
  const en = [
    '---',
    'title: Page',
    '---',
    '## When to use it',
    '## Features',
    '### Built-in providers {#built-in-providers}',
    '```md',
    '## not a heading',
    '| not | a row |',
    '```',
    '### Context window',
    '### Tool results — and why',
    '| a | b |',
    '|---|---|',
  ].join('\n')
  const translated = (lines: string[]) => ['---', 'title: Seite', '---', ...lines].join('\n')
  const good = translated([
    '## Wann du es brauchst {#when-to-use-it}',
    '## Funktionen {#features}',
    '### Eingebaute Anbieter {#built-in-providers}',
    '### Kontextfenster {#context-window}',
    '<h3 id="tool-results--and-why">Tool-Ergebnisse — und warum</h3>',
    '| a | b |',
    '|---|---|',
  ])
  const all = (other: string) => Object.fromEntries(LOCALES.map((l) => [l, l === 'en' ? en : other])) as Record<Locale, string>

  it('(+) accepts matching levels, ids and rows; an explicit id may equal the English slug; raw HTML only for an id with --', () => {
    expect(compareLocales(all(good), { explicitIds: true, tableRows: true })).toEqual([])
  })

  it('(−) fails a locale with a missing heading', () => {
    const missing = good.replace('### Kontextfenster {#context-window}\n', '')
    expect(compareLocales(all(missing)).join('\n')).toMatch(/heading levels/)
  })

  it('(−) fails a locale with a differing or absent explicit id', () => {
    const differing = good.replace('{#built-in-providers}', '{#eingebaute-anbieter}')
    expect(compareLocales(all(differing)).join('\n')).toMatch(/must carry \{#built-in-providers\}/)
    const wrongSlug = good.replace('{#context-window}', '{#kontextfenster}')
    expect(compareLocales(all(wrongSlug)).join('\n')).toMatch(/but en "Context window" is #context-window/)
  })

  it('(−) on an explicitIds page, a translated heading without an id fails; elsewhere it passes', () => {
    const bare = good.replace('## Funktionen {#features}', '## Funktionen')
    expect(compareLocales(all(bare), { explicitIds: true })).toContain('hu:5: heading "Funktionen" needs {#features}')
    expect(compareLocales(all(bare))).toEqual([])
  })

  it('(−) a raw <hN id> without -- in its id fails: it would leave the table of contents', () => {
    const raw = good.replace('## Funktionen {#features}', '<h2 id="features">Funktionen</h2>')
    expect(compareLocales(all(raw)).join('\n')).toMatch(/raw <h2 id="features"> leaves the table of contents; write "## Funktionen \{#features\}"/)
  })

  it('(−) on a tableRows page, a locale with a row more or less fails', () => {
    const extra = `${good}\n| c | d |`
    expect(compareLocales(all(extra), { tableRows: true })).toContain('hu: 3 table rows, en has 2')
    expect(compareLocales(all(extra))).toEqual([])
  })

  it('(−) fails a "{#id}" that is not at the end of the heading, and an id used twice', () => {
    const misplaced = good.replace('### Kontextfenster {#context-window}', '### Kontext {#context-window} fenster')
    expect(compareLocales(all(misplaced)).join('\n')).toMatch(/renders as text/)
    const twice = en.replace('### Context window', '### Context window {#built-in-providers}')
    expect(compareLocales({ ...all(good), en: twice }).join('\n')).toMatch(/used twice/)
  })

  it('(+/−) reports a link to an anchor the target locale does not have, on any page, and ignores links in code', () => {
    const links = linksIn('de/daily/conversations.md', [
      'See [x](/docs/de/ai/providers/#effort-by-provider) and [y](/docs/de/ai/providers/#context-window).',
      '```md',
      '[z](/docs/de/ai/providers/#not-checked-in-code)',
      '```',
      '[w](/docs/de/ai/prompts/#prompt-coach-durable-layers)',
    ].join('\n'))
    const read = (locale: string, page: string) =>
      locale === 'de' && page === 'ai/providers.md' ? good : locale === 'de' && page === 'ai/prompts.md' ? '<h2 id="prompt-coach">Prompt-Coach</h2>' : null
    expect(brokenAnchors(links, read)).toEqual([
      'de/daily/conversations.md:1: #effort-by-provider is not an anchor of de/ai/providers.md',
      'de/daily/conversations.md:5: #prompt-coach-durable-layers is not an anchor of de/ai/prompts.md',
    ])
    expect(brokenAnchors(links, read, ['ai/providers.md'])).toEqual([
      'de/daily/conversations.md:1: #effort-by-provider is not an anchor of de/ai/providers.md',
    ])
  })

  it('the build plugin turns a "{#id}" suffix into the heading id and strips it from the text', () => {
    const heading: HeadingIdNode = { type: 'heading', children: [{ type: 'inlineCode', value: 'doctor' }, { type: 'text', value: ' checks {#what-doctor-checks}' }] }
    const tree: HeadingIdNode = { type: 'root', children: [heading, { type: 'heading', children: [{ type: 'text', value: 'Plain' }] }] }
    remarkHeadingIds()(tree)
    expect(heading.data?.hProperties?.id).toBe('what-doctor-checks')
    expect(heading.children?.[1]?.value).toBe(' checks')
    const plain = tree.children?.[1]
    expect(plain?.data).toBeUndefined()
    expect(applyHeadingId({ type: 'heading', children: [{ type: 'text', value: 'No id here' }] })).toBeNull()
  })
})
