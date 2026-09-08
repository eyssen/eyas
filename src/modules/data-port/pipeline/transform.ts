// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { basename } from 'node:path'
import { runCheapModelPass } from '@modules/model/cheap-pass.js'
import type { CheapModelPassContext } from '@modules/model/cheap-pass.js'
import { SECRETS_TAG } from '@modules/memory/memory-index.js'
import { MAX_CHUNK_CHARS } from '../constants.js'
import { isMemoryIndexBasename } from '../memory-index-hooks.js'
import { looksLikeSecrets } from '../scanners/heuristics.js'
import type { IndexEntry } from '../memory-index-hooks.js'
import {
  buildMemoryTransformSystemPrompt,
  buildMemoryTransformUserPrompt,
} from '../prompts/transform-memory.js'
import type { SourceNote } from '../adapters/types.js'
import type { ImportedNoteKind, MemoryTransformResult, SourceProfile } from '../types.js'
import { extractJson } from './parse-json.js'

const NOTE_KINDS = new Set<ImportedNoteKind>(['user', 'feedback', 'domain', 'project', 'reference'])

/** `user` is accepted only when the source declared it; inference never promotes a note to a fact about the owner. */
export function safeImportedKind(raw: unknown, opts: { declared: boolean } = { declared: true }): ImportedNoteKind {
  if (typeof raw !== 'string' || !NOTE_KINDS.has(raw as ImportedNoteKind)) return 'reference'
  if (raw === 'user' && !opts.declared) return 'reference'
  return raw as ImportedNoteKind
}

export interface NormalizeOptions {
  relativePath: string
  sourceProfile: SourceProfile
  /** The index line(s) that pointed at this note, and the index section it sat under. */
  hooks?: IndexEntry | null
  sha256?: string
  mtime?: string
  /** Every path the identical content was found at; recorded when there is more than one. */
  paths?: string[]
  /** Unit inside a container file (one conversation of an export); null for whole files. */
  unit?: string | null
  sourceChanged?: boolean
  /**
   * Slug of the vault file this note will be written to; the runner always passes
   * it. An alias equal to it is redundant and dropped. Absent, NOTHING is dropped
   * — guessing the slug here would silently lose a real alias (a note declaring
   * `name: user_profile` is written to `user-profile.md`, and `user_profile` is
   * exactly the alias that keeps `[[user_profile]]` resolving).
   */
  fileSlug?: string
  /** Entry count of an imported one-line memory index, from `parseMemoryIndex`. */
  indexEntryCount?: number
  /**
   * The adapter that actually read the file — provenance (R11.6). A Grok summary
   * found under an auto-detected `claude-code` job is `grok-cli` here, and that
   * is what `source.adapter` and the `source:` tag say. Defaults to the job's
   * profile.
   */
  adapterId?: SourceProfile
  /**
   * Adapter- and classifier-derived tags the note keeps: `legacy`,
   * `third-party`, `claude-project:<slug>`, `subagent` … They are minted by the
   * importer, so a source file may not declare them (see `RESERVED_TAGS`).
   */
  tags?: string[]
  /**
   * The scan flagged a credential in this file. The note is tagged so recall
   * hides it (R11.4 / D-7); nothing is refused and nothing is redacted.
   */
  containsSecrets?: boolean
  /** Where a dropped source tag is reported. Absent = the note's own record is the only trace. */
  logger?: { warn?: (o: unknown, m?: string) => void }
}

function slugTag(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function basenameWithoutExt(relativePath: string): string {
  return basename(relativePath.replace(/\\/g, '/')).replace(/\.[^.]+$/, '')
}

/**
 * First line of real prose. Headings are structure, not a summary, and neither
 * is a horizontal rule — a body that opens with `---` would otherwise be
 * summarised as "---" in every index that lists it.
 */
function firstLine(body: string): string {
  for (const l of body.split('\n')) {
    const t = l.trim()
    if (!t || /^#{1,6}\s/.test(t) || /^(-{3,}|\*{3,}|_{3,})$/.test(t)) continue
    return t
  }
  return ''
}

/** A file that names itself (frontmatter `title:` or an H1) keeps that name. */
function hasOwnTitle(note: SourceNote): boolean {
  return (typeof note.data.title === 'string' && note.data.title.trim().length > 0) || /^#\s+\S/m.test(note.body)
}

/**
 * The deterministic mapping from one source note to one EYAS memory note.
 * It runs for EVERY import, with or without a model: the body is copied
 * verbatim, and everything the source declared (kind, dates, name, the whole
 * frontmatter object) travels with it.
 */
export function normalizeMemory(note: SourceNote, opts: NormalizeOptions): MemoryTransformResult {
  const kind = note.declaredKind ?? 'reference'
  const hook = opts.hooks?.hooks[0] ?? null

  // A source file may declare any tag it likes — but not one the importer mints
  // and later reads back as fact. `sha:` is the episodic idempotency key, so a
  // note carrying a hand-written one would make the genuine transcript report
  // `unchanged` and never be imported; `import-job:` is read by the rollback
  // guards; `pii:` feeds the review queue. They are dropped here, and the
  // originals survive verbatim in `source.frontmatter` either way.
  const strippedTags: string[] = []
  const tags: string[] = []
  for (const tag of note.tags) {
    if (isImporterOwnedSourceTag(tag)) strippedTags.push(tag)
    else tags.push(tag)
  }
  if (strippedTags.length > 0) {
    opts.logger?.warn?.(
      { path: opts.relativePath, dropped: strippedTags.length, tags: strippedTags.slice(0, 10) },
      'data-port: dropped source tags reserved for import provenance',
    )
  }
  // A section name with no Latin letters or digits (`Проект`) slugs to nothing;
  // a bare `index-section:` would be a tag that says less than no tag at all.
  const sectionSlug = opts.hooks?.section ? slugTag(opts.hooks.section) : ''
  if (sectionSlug) tags.push(`index-section:${sectionSlug}`)
  if (opts.sourceChanged) tags.push('source-changed')
  for (const t of opts.tags ?? []) tags.push(t)
  // A-8 — the AUTHORITATIVE secrets decision, taken over the whole body.
  //
  // The scan may have judged the file from its head alone (a row marked
  // `secrets-scan-head-only`), and a credential sitting past that head would
  // otherwise reach recall untagged, which is exactly what D-7's gate exists to
  // prevent. This runs before `enrichMemory` — which refuses a tagged note
  // outright — so a credential-bearing body is never handed to a model either
  // (A-8b).
  if (opts.containsSecrets || looksLikeSecrets(opts.relativePath, note.body)) tags.push(SECRETS_TAG)

  // The container's own name says nothing about one unit inside it — every
  // conversation of an export would otherwise be aliased `conversations`.
  const aliases = [
    ...new Set([
      note.name,
      ...(opts.unit ? [] : [basenameWithoutExt(opts.relativePath)]),
      note.title,
      ...note.aliases,
    ]),
  ].filter((a): a is string => Boolean(a) && a !== opts.fileSlug)

  // A one-line memory index is imported as one note, not exploded into many, so
  // it is labelled for what it is instead of taking its first hook as a summary.
  const isIndex = isMemoryIndexBasename(opts.relativePath) && typeof opts.indexEntryCount === 'number'

  return {
    skip: false,
    kind,
    title: isIndex && !hasOwnTitle(note) ? 'Memory index (imported)' : note.title,
    body: note.body,
    tags: [...new Set(tags)],
    links: note.links,
    aliases,
    salience: 0.7,
    summary_one_line: isIndex
      ? `Imported one-line memory index (${opts.indexEntryCount} entries)`
      : note.description ?? hook ?? (firstLine(note.body) || note.title),
    created: note.created,
    updated: note.updated,
    source: {
      profile: opts.sourceProfile,
      // R11.6 — which adapter read this file, beside which job profile it ran under.
      adapter: opts.adapterId ?? opts.sourceProfile,
      path: opts.relativePath,
      ...(opts.paths && opts.paths.length > 1 ? { paths: opts.paths } : {}),
      ...(opts.unit ? { unit: opts.unit } : {}),
      name: note.name,
      type: note.declaredKind,
      description: note.description,
      frontmatter: note.data,
      sha256: opts.sha256 ?? null,
      mtime: opts.mtime ?? null,
      indexHooks: opts.hooks?.hooks ?? [],
      indexSection: opts.hooks?.section ?? null,
      // Named, not merely counted: the note itself says which of its declared
      // tags the importer refused to carry.
      ...(strippedTags.length ? { strippedTags } : {}),
    },
  }
}

/** Metadata the optional model pass may suggest. It has no way to reach the body. */
interface MemoryEnrichment {
  kind?: unknown
  summary_one_line?: unknown
  tags?: unknown
  links?: unknown
  salience?: unknown
  pii_risk?: unknown
}

function stringsFrom(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20) : []
}

/**
 * Tags EYAS mints itself: provenance, scoping, idempotency and the PII review
 * queue all read them back as fact, so neither a model nor a source file may
 * forge one and claim a note came from somewhere it did not — or that it has
 * already been imported.
 */
const RESERVED_TAGS = new Set([
  'imported',
  'source-changed',
  // R11.6 provenance the classifier derives from where the file sat, never from
  // what it says about itself: a note under `memory.local-backup-*` is `legacy`,
  // a vendor's own docs are `third-party`. A file that declared either would be
  // claiming a provenance it does not have.
  'legacy',
  'third-party',
])
/**
 * `contains-secrets` is deliberately NOT reserved.
 *
 * A source file that declares it can only HIDE itself from recall, never expose
 * anything, and an Obsidian note hand-tagged that way must keep working; so it
 * is the one importer-read tag a source may declare. The same reasoning governs
 * `stripReservedCapabilities` in apply.ts.
 */
const RESERVED_TAG_PREFIXES = [
  'import-job:', 'source:', 'pii:', 'index-section:', 'session:', 'conflict-with:', 'grok-project:',
  // The idempotency keys. A declared `sha:` would make the genuine row look
  // like an earlier import of itself; `content-sha:` does the same for skills.
  'sha:', 'content-sha:',
]

export function isReservedTag(tag: string): boolean {
  const t = tag.toLowerCase()
  return RESERVED_TAGS.has(t) || RESERVED_TAG_PREFIXES.some((p) => t.startsWith(p))
}

/**
 * The prefix the claiming adapter DERIVES from a path rather than reads out of
 * the file — `grok-cli` turns `.grok/memory/<project>/sessions/…` into
 * `grok-project:<project>` before the note ever reaches this module.
 *
 * It is reserved against a MODEL, which has no business inventing one, but not
 * against the note arriving here: by then the adapter's own tag and the source
 * file's tags are the same array, so stripping the prefix would throw away the
 * project every rooted Grok import is identified by. Nothing reads it back as
 * fact — unlike `sha:` or `import-job:` — so a source file that declares one
 * costs a wrong label and nothing more.
 */
const ADAPTER_DERIVED_PREFIXES = ['grok-project:']

/**
 * What a SOURCE FILE may not declare — the fix-list vocabulary exactly. Narrower
 * than `isReservedTag` by the adapter-derived prefixes above, which are already
 * on the note legitimately when this runs.
 */
export function isImporterOwnedSourceTag(tag: string): boolean {
  const t = tag.toLowerCase()
  return isReservedTag(t) && !ADAPTER_DERIVED_PREFIXES.some((p) => t.startsWith(p))
}

/** One line, and short enough to read in a list. */
function oneLine(s: string): string {
  return s.split('\n')[0]!.trim().slice(0, 140).trim()
}

/**
 * Optional metadata enrichment for notes WITHOUT a declared kind. The model may
 * suggest kind (never `user`), summary, tags and links. It never sees a way to
 * change the body, and it cannot skip a note the user selected.
 */
export async function enrichMemory(
  ctx: CheapModelPassContext,
  note: SourceNote,
  base: MemoryTransformResult,
  opts: { path: string; sourceProfile: SourceProfile },
): Promise<{ result: MemoryTransformResult; enriched: boolean }> {
  if (!ctx?.model?.complete) return { result: base, enriched: false }
  // A-8b — a credential-bearing body never reaches a model, whatever the owner
  // opted into. `normalizeMemory` has already taken the authoritative decision
  // over the whole body, so this gate cannot be bypassed by a head-only scan.
  if (base.tags.includes(SECRETS_TAG)) return { result: base, enriched: false }

  const raw = await runCheapModelPass(ctx, {
    system: buildMemoryTransformSystemPrompt(),
    user: buildMemoryTransformUserPrompt({
      target: 'vault.semantic',
      sourceProfile: opts.sourceProfile,
      path: opts.path,
      title: note.title,
      content: note.body.slice(0, MAX_CHUNK_CHARS),
    }),
    maxTokens: 600,
    temperature: 0.2,
    fallback: '',
  })

  const parsed = extractJson<MemoryEnrichment>(raw)
  if (!parsed || typeof parsed !== 'object') return { result: base, enriched: false }

  const pii = parsed.pii_risk === 'possible' || parsed.pii_risk === 'likely' ? [`pii:${parsed.pii_risk}`] : []
  const summary = typeof parsed.summary_one_line === 'string' ? oneLine(parsed.summary_one_line) : ''
  // The PII tag is ours to write, from the declared risk — not one the model may
  // hand us. `contains-secrets` is filtered here too: a source file may declare
  // it (only ever hiding itself), but a model inventing it would hide a note
  // from recall on a guess.
  const modelTags = stringsFrom(parsed.tags).filter((t) => !isReservedTag(t) && t !== SECRETS_TAG)

  return {
    enriched: true,
    result: {
      ...base,
      // A kind the source declared is a fact, not a guess: inference never
      // overwrites it, whatever the model answers. Only an undeclared note is
      // classified here, which is why `user` is off the table on that path.
      kind: note.declaredKind ?? safeImportedKind(parsed.kind, { declared: false }),
      summary_one_line: summary || base.summary_one_line,
      tags: [...new Set([...base.tags, ...modelTags, ...pii])],
      links: [...new Set([...base.links, ...stringsFrom(parsed.links)])],
      salience: typeof parsed.salience === 'number' ? Math.min(1, Math.max(0, parsed.salience)) : base.salience,
    },
  }
}
