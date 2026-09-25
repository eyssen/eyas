// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/note-writer.ts
//
// Turns one captured CandidateNote into a durable vault file: routes it to a
// folder by kind, sanitises it before it ever touches disk, dedups against
// what is already there so repeated capture reinforces one file instead of
// spawning duplicates, and records which conversation wrote or reinforced it
// so a later conversation's memory view can show where a fact came from.
//
// Every note here is model-authored, so its text passes the same poison gate
// arbitration uses (v2/model-write-gate.ts) before anything touches disk, and
// the note carries frontmatter `origin` {by:'capture', provider, model,
// conversationId}: the indexer then stores it as 'derived', never as the
// owner's own words (vault/vault-trust.ts).

import { sql } from 'drizzle-orm'
import { basename } from 'node:path'
import type { EyasDb } from '@core/types'
import type { VaultService } from '../vault/vault-service.js'
import type { VaultIndexer } from '../vault/vault-indexer.js'
import type { VaultFrontmatter, VaultNoteOrigin } from '../types.js'
import type { CandidateNote } from './candidate-schema.js'
import { admitModelAuthoredText } from '../v2/model-write-gate.js'
import { minTrust, TRUST_ORDER } from '../v2/arbitrate.js'
import type { TrustTier } from '../v2/ingest-bridge.js'
import { escapeFtsQuery } from '../schema.js'
// One copy, beside the parser whose explicit `undefined`s make it necessary.
import { omitUndefined } from '../vault/frontmatter.js'

/** A candidate's scope is decided at capture time and travels with the write. */
export interface WriteScope {
  conversationId: string
  /** null when the conversation has no effective project (spec D2). */
  projectId: string | null
  /** null when the conversation's project has no type. */
  projectTypeId?: string | null
  /**
   * The lowest trust of the text the note was extracted from, when it is
   * below 'derived' (a peer's message). Stamped as frontmatter `trust`, which
   * can only lower the note's tier (vault/vault-trust.ts). Such a note never
   * reinforces a note trusted more than it: it is written as its own file.
   */
  trust?: TrustTier
}

export interface WriteOutcome {
  action: 'created' | 'updated' | 'skipped'
  /** The note written or reinforced; '' when nothing was written. */
  path: string
  /** Why a 'skipped' note was not written: the poison gate refused its text. */
  reason?: 'poison_gate'
  /** The gate's detector family (diagnostics only, never the text). */
  pattern?: string
}

/** The model that answered the extraction call, stamped on the note's `origin`. */
export interface NoteAuthor {
  provider?: string | null
  model?: string | null
}

/** frontmatter `origin` for a capture note: only the fields that are known. */
function captureOrigin(scope: WriteScope, author: NoteAuthor | undefined): VaultNoteOrigin {
  const origin: VaultNoteOrigin = { by: 'capture' }
  if (author?.provider) origin.provider = author.provider
  if (author?.model) origin.model = author.model
  if (scope.conversationId) origin.conversationId = scope.conversationId
  return origin
}

export interface NoteWriterDeps {
  db: EyasDb
  vault: VaultService
  indexer: VaultIndexer
  /**
   * Optional: absent in a self-hosted build without the privacy module. When
   * absent, text is written unchanged rather than left for a read-time
   * redaction that would never touch the file on disk or the FTS index built
   * from it.
   */
  privacySanitize?: (text: string) => Promise<string>
}

const MATERIAL_OVERLAP_THRESHOLD = 0.4

/**
 * Lowercase, decompose accents away (NFKD splits "café" into "cafe" + a
 * combining mark, which the non-word collapse below then drops), collapse
 * every run of non-word characters to a single '-', and clip to 60 chars.
 * `basename()` + a literal-'..' rejection is defense in depth on top of that:
 * the title is model output, and the vault write takes a relative path.
 */
function slugify(title: string): string {
  const collapsed = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const clipped = collapsed.slice(0, 60).replace(/^-+|-+$/g, '')
  const safe = basename(clipped || 'note')
  return !safe || safe.includes('..') ? 'note' : safe
}

function folderFor(kind: CandidateNote['kind'], scope: WriteScope): string {
  if (kind === 'feedback') return 'procedural'
  if (kind === 'project') {
    // The schema already refuses a 'project' candidate when the conversation
    // has no effective project (createCandidateBatchSchema's allowProject
    // gate); this is the second lock, for any candidate that reaches the
    // writer some other way.
    if (!scope.projectId) throw new Error('a project note needs scope.projectId')
    return `projects/${scope.projectId}`
  }
  if (kind === 'domain') {
    if (!scope.projectTypeId) throw new Error('a domain note needs scope.projectTypeId')
    return `project-types/${scope.projectTypeId}`
  }
  return 'semantic'
}

function tierFor(folder: string): 'semantic' | 'procedural' {
  return folder === 'procedural' ? 'procedural' : 'semantic'
}

/** The candidate body, plus a feedback note's reason — why it exists and how to apply it. */
function buildBody(candidate: CandidateNote): string {
  if (candidate.kind !== 'feedback') return candidate.body
  const lines = [candidate.body]
  if (candidate.why) lines.push(`**Why:** ${candidate.why}`)
  if (candidate.howToApply) lines.push(`**How to apply:** ${candidate.howToApply}`)
  return lines.join('\n\n')
}

/** Append under a dated bullet rather than replacing, so a reader can see a fact was reinforced rather than invented once. */
function appendHistory(existingContent: string, addition: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const bullet = `- ${today}: ${addition}`
  // `trimEnd` because the vault reader is verbatim (R11.5): the note comes back
  // with the writer's trailing newline, and appending after it would open a
  // blank line before every history bullet. The append lands after the last
  // line of text, which is where it has always landed.
  const body = existingContent.trimEnd()
  if (body.includes('## History')) return `${body}\n${bullet}`
  return `${body}\n\n---\n## History\n\n${bullet}`
}

/**
 * Is this the same note being reinforced, or an unrelated fact that just
 * happens to land on the same slug/title? Word-set overlap rather than exact
 * equality, because a reinforcement usually rephrases ("Answers in
 * Hungarian" -> "Answers in Hungarian, always").
 */
function materiallySame(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const wa = words(a)
  const wb = words(b)
  if (wa.size === 0 || wb.size === 0) return false
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  const union = wa.size + wb.size - shared
  return union > 0 && shared / union >= MATERIAL_OVERLAP_THRESHOLD
}

async function sanitize(text: string, fn?: (t: string) => Promise<string>): Promise<string> {
  return fn ? fn(text) : text
}

export function createNoteWriter(deps: NoteWriterDeps) {
  const { db, vault, indexer, privacySanitize } = deps

  /**
   * A dedup candidate must be the SAME NOTE, not merely a similar-sounding one.
   *
   * Kind and project are the note's identity, so both are matched in SQL rather
   * than left to the word-overlap check. Without that filter a `project`
   * candidate could fuzzy-match a GLOBAL `user` note (one shared title word plus
   * 0.4 summary overlap is enough), rewrite it in place, and — because the
   * update path freezes scope and would leave the `project` frontmatter absent —
   * strand it with a NULL `project_id`: gone from the global index because its
   * kind now says `project`, gone from the project index because it has no
   * project. The run row would read perfectly healthy.
   *
   * A row with NO declared kind is never a match: an undeclared note is a
   * hand-written one, and the extractor rewriting somebody's Obsidian file is
   * the same failure wearing different clothes.
   */
  interface DedupRow { path: string; summary: string | null; trust_tier: string | null }

  /**
   * Whether a lower-trust write may reinforce this note. Appending a peer's
   * words to a note trusted more would launder them into that tier, and
   * lowering the note instead would let a peer demote the owner's facts by
   * restating them. So it may only reinforce a note trusted no more than
   * itself; anything else keeps its own file.
   */
  function mayReinforce(row: DedupRow, scope: WriteScope): boolean {
    if (!scope.trust) return true
    const existing = (TRUST_ORDER as readonly string[]).includes(row.trust_tier ?? '')
      ? row.trust_tier as TrustTier
      : 'owner'
    return TRUST_ORDER.indexOf(existing) >= TRUST_ORDER.indexOf(scope.trust)
  }

  function scopeSql(candidate: CandidateNote, scope: WriteScope) {
    if (candidate.kind === 'project') {
      return sql`vi.kind = ${candidate.kind} AND vi.project_id = ${scope.projectId}`
    }
    if (candidate.kind === 'domain') {
      return sql`vi.kind = ${candidate.kind} AND vi.project_type_id = ${scope.projectTypeId}`
    }
    return sql`vi.kind = ${candidate.kind}`
  }

  function readIndexRowAt(path: string, candidate: CandidateNote, scope: WriteScope): DedupRow | null {
    const rows = (db as any).all(sql`SELECT vi.path AS path, vi.summary AS summary, vi.trust_tier AS trust_tier
      FROM vault_index vi WHERE vi.path = ${path} AND ${scopeSql(candidate, scope)}`) as DedupRow[]
    return rows[0] ?? null
  }

  /** A strong FTS hit on title within the same kind/project, excluding the base path (already checked separately). */
  function findFtsMatch(title: string, excludePath: string, candidate: CandidateNote, scope: WriteScope): DedupRow | null {
    // `title:` alone scopes only the SINGLE term that follows it — with
    // escapeFtsQuery's multi-token output ("deploy" "rule"), that leaves every
    // token after the first unscoped, matching anywhere in the row including
    // content_text. Wrapping the whole token list in parens scopes it as one
    // expression to the title column (escapeFtsQuery already strips '(' / ')'
    // out of each token, so this can't be broken out of).
    const fts = `title:(${escapeFtsQuery(title)})`
    const rows = (db as any).all(sql`
      SELECT vi.path AS path, vi.summary AS summary, vi.trust_tier AS trust_tier
      FROM vault_fts
      JOIN vault_index vi ON vi.rowid = vault_fts.rowid
      WHERE vault_fts MATCH ${fts} AND ${scopeSql(candidate, scope)}
      ORDER BY bm25(vault_fts)
      LIMIT 1
    `) as DedupRow[]
    const hit = rows[0]
    if (!hit || hit.path === excludePath) return null
    return hit
  }

  /** First free `<folder>/<slug>[-N].md` path — used when the base slug is taken by a genuinely different note. */
  function freePath(folder: string, slug: string): string {
    let n = 2
    let candidatePath = `${folder}/${slug}-${n}.md`
    while (vault.exists(candidatePath)) {
      n++
      candidatePath = `${folder}/${slug}-${n}.md`
    }
    return candidatePath
  }

  async function write(candidate: CandidateNote, scope: WriteScope, author?: NoteAuthor): Promise<WriteOutcome> {
    const folder = folderFor(candidate.kind, scope)

    // The TITLE is sanitised too, and before anything derives from it. It is
    // not display-only text: it becomes the slug, and therefore the file NAME
    // on disk, the vault_index row, and an FTS term. Redacting only summary and
    // body left a secret in the path itself, where no read-time redaction
    // reaches it.
    const title = await sanitize(candidate.title, privacySanitize)
    const summary = await sanitize(candidate.summary, privacySanitize)
    const bodyText = await sanitize(buildBody(candidate), privacySanitize)

    // The text that would reach disk, gated like arbitration gates a fact: an
    // instruction-shaped title, summary or body writes nothing at all. The
    // capture run row records the refusal ('poison_gate').
    const verdict = admitModelAuthoredText(title, summary, bodyText)
    if (!verdict.admitted) return { action: 'skipped', path: '', reason: 'poison_gate', pattern: verdict.pattern }
    const origin = captureOrigin(scope, author)

    const slug = slugify(title)
    const basePath = `${folder}/${slug}.md`

    const baseExists = vault.exists(basePath)
    const match = baseExists
      ? readIndexRowAt(basePath, candidate, scope)
      : findFtsMatch(title, basePath, candidate, scope)

    let outcome: WriteOutcome
    const today = new Date().toISOString().slice(0, 10)

    if (match && materiallySame(match.summary ?? '', summary) && mayReinforce(match, scope)) {
      const entry = vault.read(match.path)
      const frontmatter: VaultFrontmatter = {
        ...omitUndefined(entry?.frontmatter ?? {
          title, tags: [], tier: tierFor(folder), links: [], created: today, updated: today,
        }),
        title,
        // A no-op on the normal path — the dedup filter above already proved the
        // match carries this kind. It is kept for the one path where it is not:
        // an index row whose file has gone missing falls back to the default
        // frontmatter above, which has no kind, and a note that loses its kind
        // silently demotes to `reference` in the ranked index.
        kind: candidate.kind,
        summary,
        updated: today,
        // Same reasoning for `project`, and the same filter guarantees this
        // equals what the matched note already carries — so this re-states the
        // frozen scope rather than changing it, and closes the case where a
        // vanished file would have left it absent (NULL project_id, a note
        // reachable from no index at all).
        ...(candidate.kind === 'project' ? { project: scope.projectId! } : {}),
        ...(candidate.kind === 'domain' ? { projectType: scope.projectTypeId! } : {}),
        // The first model writer stays the note's author; a note that had
        // none (an imported note with a kind) now holds model text too.
        origin: entry?.frontmatter.origin ?? origin,
        // Only ever lowered: mayReinforce let this write in because the note
        // is trusted no more than the text being appended.
        ...(scope.trust ? { trust: minTrust([entry?.frontmatter.trust ?? scope.trust, scope.trust]) } : {}),
      }
      const newContent = entry ? appendHistory(entry.content, bodyText) : bodyText
      vault.write(match.path, frontmatter, newContent)
      outcome = { action: 'updated', path: match.path }
    } else {
      const targetPath = baseExists ? freePath(folder, slug) : basePath
      const frontmatter: VaultFrontmatter = {
        title,
        tags: [],
        tier: tierFor(folder),
        links: [],
        created: today,
        updated: today,
        kind: candidate.kind,
        summary,
        ...(candidate.kind === 'project' ? { project: scope.projectId! } : {}),
        ...(candidate.kind === 'domain' ? { projectType: scope.projectTypeId! } : {}),
        origin,
        ...(scope.trust ? { trust: scope.trust } : {}),
      }
      vault.write(targetPath, frontmatter, bodyText)
      outcome = { action: 'created', path: targetPath }
    }

    // A note reinforced in conversation B must appear in B's memory view.
    // INSERT OR IGNORE: the (note_path, owner_module, owner_id) primary key
    // already makes repeat writes from the same conversation idempotent.
    // Before indexing: the capture link is what marks the note model-written,
    // so the indexer stores it as 'derived', not owner (vault/vault-trust.ts).
    db.run(sql`INSERT OR IGNORE INTO memory_note_links (note_path, owner_module, owner_id, source)
      VALUES (${outcome.path}, 'conversations', ${scope.conversationId}, 'capture')`)

    // The only index entry point this codebase has: it hashes and skips
    // unchanged files, so the cost here is a stat per note. It must run now —
    // the next turn's index reads the table, not the disk.
    indexer.indexAll()

    return outcome
  }

  return { write }
}

export type NoteWriter = ReturnType<typeof createNoteWriter>
