// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { resolve, sep } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { IMPORT_TAGS } from './constants.js'
import { deleteAppliedRows, listApplied, type AppliedKind, type AppliedRow } from './ledger.js'
import { failureReason } from './errors.js'
import { contentSha } from './pipeline/apply.js'
import { legacyBody, splitFrontmatter } from './source-frontmatter.js'

/**
 * Everything rollback is allowed to touch. Each service is optional because a
 * module may be disabled: an item whose service is absent is reported as
 * skipped, never silently counted as removed.
 */
export interface RollbackDeps {
  db: EyasDb
  /** Root the asset guard measures against (A15.2); without it no directory is removed. */
  dataDir?: string
  vault?: {
    delete: (path: string) => void
    /**
     * The note as it stands now, body verbatim. Compared against the digest the
     * ledger recorded, so a note the owner has edited since the import is left
     * alone. Absent, that comparison cannot be made and the tag check decides
     * on its own, exactly as before.
     */
    read?: (path: string) => { content?: string } | null | unknown
    /**
     * The note's bytes exactly as they sit on disk, frontmatter included.
     * Equivalent to `read` for the body since the vault's reader became verbatim;
     * it is kept because it also carries the frontmatter block, which says which
     * pre-amendment body shape a digest recorded before R11.5 was taken over.
     * Absent, the guard falls back to the parsed reader.
     */
    readRaw?: (path: string) => string | null
    write?: (path: string, frontmatter: Record<string, unknown>, body: string) => void
  }
  indexer?: { indexAll: () => number; removeStale: () => void }
  episodic?: { delete: (id: string) => void }
  /** `get` answers with the row's provenance; only `source === 'user'` may be deleted. */
  skills?: { delete: (id: string) => void; get: (id: string) => { id: string; name: string; source: string } | null }
  agents?: { delete: (id: string) => void; get: (id: string) => { id: string; source: string } | null }
  /**
   * Removes one bundled-asset directory. Answers `true` when a directory was
   * there and is now gone, `false` when there was nothing left to remove; the
   * caller re-checks the path (second wall) and throws if it is out of bounds.
   */
  removeAssetDir: (dir: string) => boolean
  readWorkspaceFile: (agentId: string, file: string) => string | null
  writeWorkspaceFile: (agentId: string, file: string, body: string) => Promise<void>
}

export interface RollbackResult {
  removed: Record<AppliedKind, number>
  /**
   * One `kind:ref (reason)` line per item that needs the operator's attention:
   * every item left alone, and every item that WAS removed but only on a
   * best-effort basis (a malformed block, a marker-less section). A line here
   * therefore does not imply the artifact survived — `removed` is the count.
   */
  skipped: string[]
}

const OPEN_MARKER = (id: string): string => `<!-- eyas-import:${id} -->`
const CLOSE_MARKER = (id: string): string => `<!-- /eyas-import:${id} -->`
const ANY_OPEN_MARKER = '<!-- eyas-import:'
const IMPORTED_HEADING = '## Imported: '
/** Exactly what `approveProposal` writes between two sections. */
const SECTION_SEPARATOR = '\n\n---\n\n'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Path comparisons are POSIX: apply builds refs with `/`, the index may hold `\` on Windows. */
function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Cut `[from, to)` out of `body`, taking the separator that joined the block to its neighbour. */
function cutSection(body: string, from: number, to: number): string {
  let start = from
  let end = to
  const followedBySeparator = body.startsWith(SECTION_SEPARATOR, end)
  const precededBySeparator =
    start >= SECTION_SEPARATOR.length &&
    body.startsWith(SECTION_SEPARATOR, start - SECTION_SEPARATOR.length)
  if (precededBySeparator) {
    // The block was introduced by a separator — take it, so what came before
    // ends exactly where it did before the import.
    start -= SECTION_SEPARATOR.length
    // Approve closed the block with a newline; take that too, unless the next
    // block's separator starts there.
    if (!followedBySeparator && body[end] === '\n') end += 1
  } else if (followedBySeparator) {
    // First block in the file: take the separator that follows instead, or the
    // next block would inherit a leading `---`.
    end += SECTION_SEPARATOR.length
  } else if (body[end] === '\n') {
    end += 1
  }
  return joinAcrossCut(body.slice(0, start), body.slice(end))
}

/** True when `text` opens a section of its own, so the join must be a separator. */
function startsSection(text: string): boolean {
  return text.startsWith(IMPORTED_HEADING) || text.startsWith(ANY_OPEN_MARKER)
}

/**
 * Rejoin the two sides of a cut without gluing them into one line. Two blocks
 * that were divided only by a line break leave `seed` and `## Imported: B`
 * meeting directly, and a heading that no longer starts a line can never be
 * matched again — so the next section gets its separator back, and any other
 * text at least gets its line break.
 */
function joinAcrossCut(before: string, after: string): string {
  if (!before || !after) return before + after
  if (before.endsWith('\n') || after.startsWith('\n')) return before + after
  return before + (startsSection(after) ? SECTION_SEPARATOR : '\n') + after
}

/**
 * Where the body of the section beginning at `from` starts: past the section's
 * own `## Imported:` heading, so that heading is never read as the boundary of
 * the section that follows it.
 */
function sectionBodyStart(body: string, from: number): number {
  const ownHeading = body.indexOf(IMPORTED_HEADING, from)
  if (ownHeading < 0) return from
  const separator = body.indexOf(SECTION_SEPARATOR, from)
  // A separator first means this section has no heading of its own and the one
  // found belongs to the next section.
  if (separator >= 0 && separator < ownHeading) return from
  return ownHeading + IMPORTED_HEADING.length
}

/**
 * Where a section ends when there are no markers to trust: at the FIRST
 * `\n\n---\n\n` after it — whatever follows that separator — or at the next
 * import marker / `## Imported:` heading if one comes first, else at the end of
 * the body.
 *
 * The consequence is deliberate. A marker-less section whose own text contains a
 * `---` rule is only partly removed, and the caller says so. The alternative —
 * running on until something that looks like another section turns up — deletes
 * the owner's own writing when their notes follow the import, and over-removal
 * is never acceptable.
 */
function sectionEnd(body: string, from: number): number {
  let end = body.length
  const separator = body.indexOf(SECTION_SEPARATOR, from)
  if (separator >= 0) end = Math.min(end, separator)
  // The match points at the newline in front of the heading; the next section
  // starts on the line after it.
  const heading = body.indexOf(`\n${IMPORTED_HEADING}`, from)
  if (heading >= 0) end = Math.min(end, heading + 1)
  const marker = body.indexOf(ANY_OPEN_MARKER, from)
  if (marker >= 0) end = Math.min(end, marker)
  return end
}

/**
 * Every complete `<!-- eyas-import:x -->` … `<!-- /eyas-import:x -->` span. The
 * title fallback must not reach inside one: a heading quoted in another
 * proposal's body is text, not a section of its own.
 */
function markerBlockRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const opener = /<!-- eyas-import:([^\s>]+) -->/g
  for (let match = opener.exec(body); match; match = opener.exec(body)) {
    const close = CLOSE_MARKER(match[1])
    const closeAt = body.indexOf(close, match.index)
    if (closeAt >= 0) ranges.push([match.index, closeAt + close.length])
  }
  return ranges
}

/** First `## Imported: <title>` on a line of its own, outside every marker block. */
function findHeading(body: string, title: string): number {
  const heading = new RegExp(`^${escapeRegExp(IMPORTED_HEADING)}${escapeRegExp(title)}[ \\t]*$`, 'gm')
  const blocks = markerBlockRanges(body)
  for (let match = heading.exec(body); match; match = heading.exec(body)) {
    if (!blocks.some(([start, end]) => match!.index >= start && match!.index < end)) {
      return match.index
    }
  }
  return -1
}

/**
 * Remove the section an approved proposal appended. The `<!-- eyas-import:<id> -->`
 * markers are authoritative (A15.3); the `## Imported: <title>` heading is only a
 * fallback for a section written before the markers existed, and it is anchored to
 * a line of its own outside every marker block so it can never cut into another
 * proposal's text. A body that carries neither is returned untouched — a
 * hand-edited file is never guessed at.
 *
 * `onIssue` reports a malformed block that was removed on a best-effort basis.
 */
export function stripImportedSection(
  body: string,
  proposalId: string,
  title?: string | null,
  onIssue?: (issue: string) => void,
): string {
  const open = OPEN_MARKER(proposalId)
  const close = CLOSE_MARKER(proposalId)
  const markerStart = body.indexOf(open)
  if (markerStart >= 0) {
    const closeAt = body.indexOf(close, markerStart)
    if (closeAt >= 0) return cutSection(body, markerStart, closeAt + close.length)
    // The closing marker was edited away. Take the section the open marker
    // starts — never the rest of the file — and say that the block was broken.
    onIssue?.('unclosed import marker; removed to the end of its section')
    const from = sectionBodyStart(body, markerStart + open.length)
    return cutSection(body, markerStart, sectionEnd(body, from))
  }
  if (!title) return body
  const headingStart = findHeading(body, title)
  if (headingStart < 0) return body
  // Without markers the end of the section is a guess bounded by the first
  // separator, so the owner is told the removal may have been partial.
  onIssue?.(`markers missing — section may be partially removed: ${title}`)
  return cutSection(body, headingStart, sectionEnd(body, sectionBodyStart(body, headingStart)))
}

/** `vault_index.tags` is a JSON array; a malformed value counts as "no tags". */
function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((t) => String(t)) : []
  } catch {
    return []
  }
}

/**
 * Undo one import, item by item, from the ledger that recorded it. Nothing is
 * inferred: only rows this job wrote are considered, and each one is checked
 * again before it is removed, so an item the owner has since taken ownership of
 * (a note edited after the import, a skill promoted out of `user`, an asset
 * directory moved) survives and is reported instead.
 *
 * A ledger row is deleted only for an item this pass actually dealt with. The
 * rows of refused items stay: they are the last thing linking a surviving
 * artifact to the import that created it.
 */
/**
 * Jobs a rollback is walking right now, in THIS process. The database claim
 * below is the authority; this Set is what makes a second call fail fast and
 * with the right message rather than racing for the same row.
 */
const inFlight = new Set<string>()

/** The phase that marks a claimed job. Not a status: `JobStatus` gains nothing. */
const ROLLING_BACK_PHASE = 'rolling_back'

/** How many rows the last statement touched — portable across both sqlite drivers. */
function changedRows(db: EyasDb): number {
  const rows = db.all(sql`SELECT changes() AS n`) as Array<{ n: number }>
  return Number(rows[0]?.n ?? 0)
}

export async function rollbackJob(deps: RollbackDeps, jobId: string): Promise<RollbackResult> {
  const job = (
    deps.db.all(sql`SELECT status, phase, stats_json FROM data_port_jobs WHERE id = ${jobId}`) as Array<{
      status: string
      phase: string
      stats_json: string
    }>
  )[0]
  if (!job) throw new Error(`Job not found: ${jobId}`)
  if (job.status === 'running' || job.status === 'pending') {
    throw new Error(`Job is ${job.status}; wait for it to finish`)
  }
  // A second pass would find an empty ledger and overwrite the first pass's
  // record with an all-zero one — and that record is the only place the items
  // the guards refused are still named.
  if (job.status === 'rolled_back') throw new Error('Job is already rolled back')
  if (inFlight.has(jobId)) throw new Error('Job is already being rolled back')

  /**
   * Claim the job before touching anything. The status read above is a
   * check-then-act: two calls a few milliseconds apart both passed it, both
   * walked the ledger, and the second one's all-zero record overwrote the
   * first's. One statement decides instead — the loser changes no row and is
   * refused here, before a single artifact is removed.
   */
  deps.db.run(
    sql`UPDATE data_port_jobs SET phase = ${ROLLING_BACK_PHASE}, updated_at = ${new Date().toISOString()}
        WHERE id = ${jobId} AND status IN ('completed', 'failed', 'cancelled')
          AND phase <> ${ROLLING_BACK_PHASE}`,
  )
  if (changedRows(deps.db) !== 1) throw new Error('Job is already being rolled back')
  inFlight.add(jobId)

  try {
    return await runRollback(deps, jobId, job)
  } catch (err) {
    // The claim is not a decision, so a pass that died leaves the job exactly
    // as it found it — otherwise a crashed rollback could never be retried.
    try {
      deps.db.run(
        sql`UPDATE data_port_jobs SET phase = ${job.phase}, updated_at = ${new Date().toISOString()}
            WHERE id = ${jobId} AND phase = ${ROLLING_BACK_PHASE}`,
      )
    } catch {
      /* the throw below is what matters */
    }
    throw err
  } finally {
    inFlight.delete(jobId)
  }
}

async function runRollback(
  deps: RollbackDeps,
  jobId: string,
  job: { status: string; phase: string; stats_json: string },
): Promise<RollbackResult> {

  const removed: Record<AppliedKind, number> = {
    vault: 0,
    episodic: 0,
    skill: 0,
    'skill-assets': 0,
    agent: 0,
    proposal: 0,
  }
  const skipped: string[] = []
  const skip = (kind: AppliedKind, ref: string, reason: string): void => {
    skipped.push(`${kind}:${ref} (${reason})`)
  }

  const jobTag = `${IMPORT_TAGS.jobPrefix}${jobId}`
  const importedAssetRoot = deps.dataDir
    ? resolve(deps.dataDir, 'skills', 'imported') + sep
    : null

  /**
   * A15.5 — the index still has to say the note belongs to this job. Both sides
   * of the comparison are read as POSIX, so a `vault_index` row written on
   * Windows still matches the ref apply built with forward slashes.
   */
  const vaultNoteStillOurs = (posixPath: string): boolean => {
    try {
      const row = (
        deps.db.all(
          sql`SELECT tags FROM vault_index
              WHERE path = ${posixPath} OR replace(path, '\\', '/') = ${posixPath}`,
        ) as Array<{ tags: string | null }>
      )[0]
      return row ? parseTags(row.tags).includes(jobTag) : false
    } catch {
      // No vault index (memory module off, or an older schema): unverifiable,
      // so the note stays.
      return false
    }
  }

  /**
   * A15 / A3 — the note still has to be the note this import wrote. The ledger
   * carries the digest of the body that was written; a note whose body no
   * longer hashes to it is the owner's work now, whatever its tags still say,
   * and an undo may not delete it. A row from before the digest existed has
   * nothing to compare, and the tag check decides on its own as it always did.
   */
  const vaultNoteEdited = (posixPath: string, recorded: string | null): boolean => {
    if (!recorded) return false
    // The raw file first: it is the only reader that can see the note's actual
    // bytes, and a digest recorded under R11.5 is taken over exactly those.
    let raw: string | null = null
    try {
      raw = deps.vault?.readRaw?.(posixPath) ?? null
    } catch {
      raw = null
    }
    if (typeof raw === 'string') {
      const { body: rest, hadFrontmatter } = splitFrontmatter(raw)
      // Every spelling the recorded digest may legitimately have been taken
      // over, newest first:
      //   1. the body verbatim, as R11.5 writes it;
      //   2. without the vault writer's appended newline (its one documented
      //      normalisation);
      //   3. the pre-R11 `legacyBody` shape;
      //   4. the pre-R11 vault digest, which was `sha256(body.trim())` — and
      //      `trim()` differs from `legacyBody` for a body whose first line
      //      begins with whitespace.
      const candidates = [rest, rest.replace(/\n$/, ''), legacyBody(rest, hadFrontmatter), rest.trim()]
      return !candidates.some((c) => contentSha(c) === recorded)
    }
    if (!deps.vault?.read) return false
    let current: unknown
    try {
      current = deps.vault.read(posixPath)
    } catch {
      // Unreadable: nothing can be claimed about it, so it is not "edited".
      return false
    }
    const content = (current as { content?: unknown } | null)?.content
    if (typeof content !== 'string') return false
    // The parsed reader is verbatim too now, so it can answer the same four
    // shapes as the raw one — minus the frontmatter it has already taken off.
    return ![content, content.replace(/\n$/, ''), legacyBody(content, true), content.trim()].some(
      (c) => contentSha(c) === recorded,
    )
  }

  /** Answers whether this row's ledger entry may be dropped, i.e. the item was dealt with. */
  const handleRow = async (row: AppliedRow): Promise<boolean> => {
    const { kind, ref } = row
    if (kind === 'vault') {
      if (!deps.vault) {
        skip(kind, ref, 'memory vault unavailable')
        return false
      }
      const notePath = toPosixPath(ref)
      if (!vaultNoteStillOurs(notePath)) {
        skip(kind, ref, 'modified since import')
        return false
      }
      if (vaultNoteEdited(notePath, row.sha256)) {
        skip(kind, ref, `edited since import: ${notePath}`)
        return false
      }
      deps.vault.delete(notePath)
      removed.vault++
      return true
    }
    if (kind === 'episodic') {
      if (!deps.episodic) {
        skip(kind, ref, 'episodic memory unavailable')
        return false
      }
      deps.episodic.delete(ref)
      removed.episodic++
      return true
    }
    if (kind === 'skill') {
      if (!deps.skills) {
        skip(kind, ref, 'skills unavailable')
        return false
      }
      const skill = deps.skills.get(ref)
      if (!skill) {
        skip(kind, ref, 'already gone')
        return false
      }
      // A15.1 — a bundled or generated row was never this import's to delete.
      if (skill.source !== 'user') {
        skip(kind, ref, 'not user-owned')
        return false
      }
      deps.skills.delete(ref)
      removed.skill++
      return true
    }
    if (kind === 'skill-assets') {
      // A15.2 — the ledger holds the absolute directory apply created. It is
      // removed only from inside the imported-skills root; anything else is a
      // directory this import did not make.
      if (!importedAssetRoot) {
        skip(kind, ref, 'data directory unknown')
        return false
      }
      const dir = resolve(toPosixPath(ref))
      if (!dir.startsWith(importedAssetRoot)) {
        skip(kind, ref, 'outside the imported skills directory')
        return false
      }
      // Nothing there any more is not a removal, but the row has no artifact
      // left to point at either, so it goes.
      if (!deps.removeAssetDir(dir)) {
        skip(kind, ref, `already removed: ${dir}`)
        return true
      }
      removed['skill-assets']++
      return true
    }
    if (kind === 'agent') {
      if (!deps.agents) {
        skip(kind, ref, 'agents unavailable')
        return false
      }
      const agent = deps.agents.get(ref)
      if (!agent) {
        skip(kind, ref, 'already gone')
        return false
      }
      if (agent.source !== 'user') {
        skip(kind, ref, 'not user-owned')
        return false
      }
      deps.agents.delete(ref)
      removed.agent++
      return true
    }
    if (kind === 'proposal') {
      // Scoped to the job: a ledger row may only ever speak for a proposal of
      // its own import.
      const proposal = (
        deps.db.all(
          sql`SELECT agent_id, workspace_file, title, status FROM data_port_proposals
              WHERE job_id = ${jobId} AND id = ${ref}`,
        ) as Array<{ agent_id: string; workspace_file: string; title: string; status: string }>
      )[0]
      if (!proposal) {
        skip(kind, ref, 'already gone')
        return false
      }
      if (proposal.status === 'approved') {
        // `agent_id` may be the project-type sentinel (A15.7); the reader and
        // the writer both resolve it, so the target needs no special case here.
        const current = deps.readWorkspaceFile(proposal.agent_id, proposal.workspace_file)
        if (current !== null) {
          const stripped = stripImportedSection(current, ref, proposal.title, (issue) =>
            skip(kind, ref, issue),
          )
          if (stripped !== current) {
            await deps.writeWorkspaceFile(proposal.agent_id, proposal.workspace_file, stripped)
          }
        }
      }
      deps.db.run(
        sql`UPDATE data_port_proposals SET status = 'rejected', resolved_at = ${new Date().toISOString()}
            WHERE id = ${ref} AND status <> 'rejected'`,
      )
      removed.proposal++
      return true
    }
    return false
  }

  const clearedRows: string[] = []
  for (const row of listApplied(deps.db, jobId)) {
    try {
      if (await handleRow(row)) clearedRows.push(row.id)
    } catch (err) {
      skip(row.kind, row.ref, failureReason(err))
    }
  }

  // Anything still awaiting a decision belongs to an import that no longer
  // exists — it can never be approved into a workspace after this.
  deps.db.run(
    sql`UPDATE data_port_proposals SET status = 'rejected', resolved_at = ${new Date().toISOString()}
        WHERE job_id = ${jobId} AND status = 'pending'`,
  )

  // One rebuild for the whole rollback, and only when a note actually left the
  // vault: removeStale drops the index rows, indexAll refreshes what remains.
  if (removed.vault > 0 && deps.indexer) {
    try {
      deps.indexer.removeStale()
      deps.indexer.indexAll()
    } catch {
      /* the notes are gone either way; a stale index row is not worth failing on */
    }
  }

  // The artifacts are already gone; a ledger that could not be cleared is a
  // record to reconcile, not a reason to report the undo as failed. It is said
  // out loud, though — those rows now name items that no longer exist.
  try {
    deleteAppliedRows(deps.db, clearedRows)
  } catch (err) {
    skipped.push(`ledger clear failed: ${failureReason(err)}`)
  }

  const result: RollbackResult = { removed, skipped }

  // A15.4 — what the rollback did is kept on the job it undid.
  let stats: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(job.stats_json || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stats = parsed
  } catch {
    /* an unreadable stats blob is replaced, not propagated */
  }
  deps.db.run(
    sql`UPDATE data_port_jobs
        SET status = 'rolled_back', phase = 'rolled_back',
            stats_json = ${JSON.stringify({ ...stats, rollback: result })},
            updated_at = ${new Date().toISOString()}
        WHERE id = ${jobId}`,
  )

  return result
}
