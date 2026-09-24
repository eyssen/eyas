// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One extraction run per committed L0 flush (spec §6 write path): load the
// conversation's raw rows above the per-conversation watermark, decompress,
// extract → arbitrate → IDF → watermark in ONE transaction, record the run.
// Zero model calls in Phase 1; Phase 3 inserts the optional model pass
// between extractDeterministic and arbitrate.
//
// Never throws, and the qualifications matter. It owns a transaction when it can
// open one and falls back to a SAVEPOINT inside a caller's; either way a failure
// undoes only this function's work, records memory_run(status='failed') and
// leaves L0 and the watermark alone — though on the nested path that run row
// lives inside the caller's transaction too, so a caller that rolls back discards
// the failure record along with everything else. Participating in someone else's
// transaction means their decision is final. If it cannot open a transaction for any
// reason other than the caller already holding one, it writes nothing at all and
// returns 'failed'. And if even the run ledger is unreachable, it returns an
// empty runId rather than throwing — the caller always gets a value.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { zstdDecompress } from '@shared/zstd.js'
import type { RawSourceType, TrustTier } from './ingest-bridge.js'
import { getMemoryMeta, setMemoryMeta } from './schema.js'
import { recordRun, finishRun, type MemoryRunStatus } from './runs.js'
import { findConversationScope } from './scope.js'
import { arbitrate } from './arbitrate.js'
import { extractDeterministic, type ExtractionUnit } from './extract/deterministic.js'
import { updateIdf } from './extract/idf.js'
import { tokenize, stem5, isStopWord, MIN_STEM_CHARS } from './extract/tokenize.js'

export interface ExtractionConfig {
  engine: 'legacy' | 'v2'
  extractInLegacy: boolean
}

export interface ExtractionDeps {
  logger: Logger
  /** Read per call so `config reload` takes effect without a restart. */
  config: () => ExtractionConfig
}

export interface ExtractionOutcome {
  runId: string
  status: MemoryRunStatus
}

export const EXTRACT_WATERMARK_PREFIX = 'extract_wm:'
/** Named savepoint used only when a caller already owns the transaction. */
const EXTRACT_SAVEPOINT = 'p1c_extraction'
const CLOSED_STATUSES = new Set(['done', 'closed', 'completed', 'archived'])

interface RawRow {
  id: string
  source_type: RawSourceType
  occurred_at: number
  trust_tier: TrustTier
  meta_json: string | null
  compressed_blob: Uint8Array
}

/** A raw row with its blob already decompressed. */
interface DecodedRow {
  row: RawRow
  text: string
}

interface Watermark {
  ms: number
  id: string
}

/** Highest occurred_at already extracted for the conversation; 0 when none. */
export function extractionWatermark(db: EyasDb, conversationId: string): number {
  return readWatermark(db, conversationId).ms
}

/**
 * The watermark is `"<occurredAtMs>:<rawId>"`, not a bare number, because
 * `occurred_at` ties are real on the path this plan exists for: executeAgent's
 * closing addMessage can land in the same millisecond as the last LlmResponse.
 * With a bare number and a `>` filter, a same-millisecond row arriving in a
 * LATER flush is never extracted — silently and permanently.
 *
 * A legacy value with no colon (including the `0` default) parses to an empty
 * id, which makes the boundary degrade to `>=` and re-extract that one row
 * rather than lose it. Over-capture is the safe direction and arbitration is
 * idempotent for it: an identical fact dedups to a link, and the gist supersedes.
 */
function readWatermark(db: EyasDb, conversationId: string): Watermark {
  const raw = getMemoryMeta(db, `${EXTRACT_WATERMARK_PREFIX}${conversationId}`)
  if (!raw) return { ms: 0, id: '' }
  const colon = raw.indexOf(':')
  if (colon < 0) return { ms: Number(raw) || 0, id: '' }
  return { ms: Number(raw.slice(0, colon)) || 0, id: raw.slice(colon + 1) }
}

/**
 * L0 rows that are never extracted. 'thinking' (model reasoning) stays in L0
 * only: extracting it would turn a model's own reasoning into facts and gists
 * it is later handed back as memory — a self-reinforcement loop.
 */
const NEVER_EXTRACTED_SQL = sql`('thinking')`

/** The rows to extract: above the watermark, never-extracted types left out (their blobs are not even read). */
function loadRows(db: EyasDb, conversationId: string, after: Watermark): RawRow[] {
  return db.all<RawRow>(sql`SELECT r.id, r.source_type, r.occurred_at, r.trust_tier, r.meta_json, b.compressed_blob
    FROM memory_raw r
    JOIN memory_blob b ON b.content_hash = r.content_hash AND b.shred_partition_id = r.shred_partition_id
    WHERE r.conversation_id = ${conversationId} AND r.tombstoned = 0
      AND r.source_type NOT IN ${NEVER_EXTRACTED_SQL}
      AND (r.occurred_at > ${after.ms} OR (r.occurred_at = ${after.ms} AND r.id > ${after.id}))
    ORDER BY r.occurred_at ASC, r.id ASC`)
}

/**
 * The last row above the watermark of ANY source type, never-extracted ones
 * included — the new watermark. Taking it from loadRows would leave a trailing
 * thinking row above the watermark for good.
 */
function lastRowAbove(db: EyasDb, conversationId: string, after: Watermark): Watermark | null {
  const row = db.all<{ id: string; occurred_at: number }>(sql`SELECT r.id, r.occurred_at
    FROM memory_raw r
    WHERE r.conversation_id = ${conversationId} AND r.tombstoned = 0
      AND (r.occurred_at > ${after.ms} OR (r.occurred_at = ${after.ms} AND r.id > ${after.id}))
    ORDER BY r.occurred_at DESC, r.id DESC
    LIMIT 1`)[0]
  return row ? { ms: row.occurred_at, id: row.id } : null
}

function writeWatermark(db: EyasDb, conversationId: string, mark: Watermark): void {
  setMemoryMeta(db, `${EXTRACT_WATERMARK_PREFIX}${conversationId}`, `${mark.ms}:${mark.id}`)
}

function metaOf(row: RawRow): Record<string, unknown> | null {
  if (!row.meta_json) return null
  try {
    const parsed = JSON.parse(row.meta_json) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Shortest stitched text {@link preferGranularTurns} may strip from the END of a row. */
export const MIN_SUFFIX_STITCH_CHARS = 40

/**
 * Source preference for the multi-turn double capture (open item I3).
 *
 * `executeAgent` accumulates the text of EVERY turn and persists ONE
 * concatenated assistant message through `addMessage`
 * (`meta.origin = 'conversation_messages'`), while `agent-runner` appends one
 * `LlmResponse` per turn (`meta.origin = 'agent_events'`, with `sessionId`).
 * p1b's cross-origin dedup cannot collapse them: at N >= 2 text-bearing turns
 * the two rows have different content and therefore different hashes. So L0
 * legitimately holds N per-turn rows PLUS one row containing all of them.
 *
 * That is over-capture, never loss — but extracting both makes the concatenated
 * synthetic row the gist's "last message", shifts the TF-IDF topic ranking, and
 * inflates importance (measured: messageCount 3 -> 4, decisionMarkers 2 -> 3,
 * importance 0.277 -> 0.336). The IDF table is NOT affected: `documentStems`
 * returns a Set, so a repeated stem cannot raise its df.
 *
 * CLI providers that run the whole agentic loop themselves (Claude Code) have
 * the mirror-image shape. `executeAgent` still accumulates every streamed text
 * block — the narration between tool calls AND the final message — but the
 * provider's single `done.content` is only the SDK's final `result`, so the one
 * `LlmResponse` of that run holds just the final answer. Its stitched text is a
 * SUFFIX of the concatenated row, never a prefix, and extracting both would
 * count the final answer twice.
 *
 * The rule is stitch-and-strip, and it is deliberately fail-open:
 *   - build, per `meta.sessionId`, the concatenation of that session's
 *     `agent_events` assistant texts, in occurred_at order;
 *   - for each `conversation_messages` assistant row, take the LONGEST stitched
 *     string it starts with, and the LONGEST stitched string of at least
 *     {@link MIN_SUFFIX_STITCH_CHARS} characters it ends with (longest, so a
 *     short run's output cannot accidentally match a different run's message);
 *     the longer of the two decides, a tie goes to the prefix;
 *   - prefix, equal length  -> drop the row: every byte is already present;
 *   - strict prefix         -> keep the row with only the tail. That tail is
 *     the failing turn's partial answer, for which no LlmResponse was ever
 *     emitted (`agent/index.ts:618-632`) — the only copy in existence;
 *   - suffix                -> keep the row with only the leading narration,
 *     which no LlmResponse holds either; drop the row when that narration is
 *     blank. Trailing whitespace on either side is ignored for this test only;
 *   - no match, or no stitched text at all -> keep the row unchanged.
 *
 * The suffix floor exists because closings are formulaic ('Done.', 'Let me know
 * if you need anything else.'), so a short stitched text can end a row of a
 * DIFFERENT run by accident, and stripping it there deletes text no other row
 * holds. Below the floor the trade is not worth it: a short final answer
 * counted twice barely moves importance or topics. The prefix test keeps its
 * original, floor-less behaviour.
 *
 * Everything else keeps its row whole because `stitched` is empty for it: the
 * interactive SSE path and channel runs pass no `sessionId`, so `emitEvent`
 * no-ops; God Mode's winner promotion writes into the PARENT conversation; a
 * run that fails on turn 1 emitted no LlmResponse at all. A single-turn run
 * whose rows are byte-identical never even reaches here — p1b's dedup already
 * suppressed the copy at ingest.
 *
 * Accepted over-captures, all fail-open: a turn whose response carried several
 * text blocks joins with '\n' in the event and with nothing in the
 * accumulation, so the prefix test fails and both rows survive; a final answer
 * shorter than the suffix floor survives twice; and if a flush boundary split
 * the per-turn rows from the concatenated row, the earlier batch carries no
 * stitched text for it.
 */
export function preferGranularTurns(decoded: DecodedRow[]): DecodedRow[] {
  const stitched = new Map<string, string>()
  for (const d of decoded) {
    if (d.row.source_type !== 'assistant_message') continue
    const meta = metaOf(d.row)
    if (meta?.origin !== 'agent_events' || typeof meta.sessionId !== 'string') continue
    stitched.set(meta.sessionId, (stitched.get(meta.sessionId) ?? '') + d.text)
  }
  if (stitched.size === 0) return decoded
  const candidates = [...stitched.values()].filter((v) => v.length > 0).sort((a, b) => b.length - a.length)
  const suffixCandidates = candidates
    .map((c) => c.trimEnd())
    .filter((c) => c.length >= MIN_SUFFIX_STITCH_CHARS)
    .sort((a, b) => b.length - a.length)
  const out: DecodedRow[] = []
  for (const d of decoded) {
    const meta = d.row.source_type === 'assistant_message' ? metaOf(d.row) : null
    if (meta?.origin !== 'conversation_messages') {
      out.push(d)
      continue
    }
    const prefix = candidates.find((c) => d.text.startsWith(c))
    const body = d.text.trimEnd()
    const suffix = suffixCandidates.find((c) => body.endsWith(c))
    if (suffix !== undefined && (prefix === undefined || suffix.length > prefix.length)) {
      const narration = body.slice(0, body.length - suffix.length)
      if (narration.trim().length > 0) out.push({ row: d.row, text: narration })
    } else if (prefix === undefined) out.push(d)
    else if (prefix.length < d.text.length) out.push({ row: d.row, text: d.text.slice(prefix.length) })
  }
  return out
}

/** Task outcome for the importance rule: the close trigger, a closed status, or a closed stage. Tolerant of partial schemas. */
function isTaskClosed(db: EyasDb, conversationId: string, reason: string): boolean {
  if (reason === 'close') return true
  try {
    const row = db.all<{ status: string | null; stage_id: string | null }>(sql`SELECT status, stage_id FROM conversations WHERE id = ${conversationId}`)[0]
    if (!row) return false
    if (row.status && CLOSED_STATUSES.has(row.status)) return true
    if (row.stage_id) {
      const stage = db.all<{ is_closed: number | null }>(sql`SELECT is_closed FROM stages WHERE id = ${row.stage_id}`)[0]
      return Number(stage?.is_closed ?? 0) === 1
    }
  } catch {
    /* no board tables in this database: not closed */
  }
  return false
}

/** The IDF "document" of this run: every distinct content stem of the batch. */
function documentStems(units: ExtractionUnit[], lang: string): Set<string> {
  const stems = new Set<string>()
  for (const unit of units) {
    for (const token of tokenize(unit.content)) {
      if (isStopWord(token, lang)) continue
      const stem = stem5(token)
      if (stem.length >= MIN_STEM_CHARS) stems.add(stem)
    }
  }
  return stems
}

/** Every message in an error's cause chain: Drizzle wraps the SQLite text in `.cause`. */
function errorText(err: unknown): string {
  const parts: string[] = []
  let cur: unknown = err
  for (let depth = 0; depth < 5 && cur instanceof Error; depth++) {
    parts.push(cur.message)
    cur = cur.cause
  }
  // A non-Error throw has no chain to walk. Falling back to String(err) keeps the
  // thrown value in stats_json.error, which is the whole point of recording it.
  return parts.length > 0 ? parts.join(' | ') : String(err)
}

/**
 * A `memory_run` row that cannot itself throw. `recordRun` writes to the same
 * database that just failed us, so on a locked or broken connection it fails too —
 * and an unguarded call there is how "never throws" quietly stops being true.
 * An empty `runId` means the ledger could not be written either.
 */
function safeRecordRun(
  db: EyasDb,
  status: MemoryRunStatus,
  conversationId: string,
  statsJson: Record<string, unknown>,
): ExtractionOutcome {
  try {
    return { runId: recordRun(db, { runType: 'extraction', status, conversationId, statsJson }), status }
  } catch {
    return { runId: '', status }
  }
}

/**
 * The board scope a conversation's facts and gist are filed under: the
 * conversation's own project. A source with no conversations row — a vault
 * note ('vault:<path>'), a legacy episodic row — has no board row to ask, so
 * it takes the scope its newest live L0 row was captured with. Without that,
 * every project note's facts became global memory.
 */
export function extractionScope(db: EyasDb, conversationId: string): { projectId: string | null; projectTypeId: string | null } {
  const conv = findConversationScope(db, conversationId)
  if (conv) return { projectId: conv.projectId, projectTypeId: conv.projectTypeId }
  try {
    const row = db.all<{ project_id: string | null; project_type_id: string | null }>(sql`SELECT project_id, project_type_id
      FROM memory_raw WHERE conversation_id = ${conversationId} AND tombstoned = 0
      ORDER BY occurred_at DESC, rid DESC LIMIT 1`)[0]
    return { projectId: row?.project_id ?? null, projectTypeId: row?.project_type_id ?? null }
  } catch {
    return { projectId: null, projectTypeId: null }
  }
}

export function runExtraction(db: EyasDb, conversationId: string, reason: string, deps: ExtractionDeps): ExtractionOutcome {
  const { logger } = deps
  const skip = (why: string, extra: Record<string, unknown> = {}): ExtractionOutcome => {
    return safeRecordRun(db, 'skipped', conversationId, { reason: why, trigger: reason, ...extra })
  }
  const cfg = deps.config()
  if (cfg.engine === 'legacy' && !cfg.extractInLegacy) return skip('engine_legacy')

  // A rebuild (plan p1d) truncates the derived layers (and resets the IDF
  // counter) but leaves the extract_wm:* watermark keys in place: start from zero.
  const watermark: Watermark = reason === 'rebuild' ? { ms: 0, id: '' } : readWatermark(db, conversationId)
  const lastAbove = lastRowAbove(db, conversationId, watermark)
  if (!lastAbove) return skip('nothing_new', { watermark: watermark.ms })
  const rows = loadRows(db, conversationId, watermark)
  if (rows.length === 0) {
    // Only never-extracted rows (thinking) arrived: move past them so later flushes
    // do not re-scan them. A single upsert, atomic with or without a caller's transaction.
    let moved = true
    try {
      writeWatermark(db, conversationId, lastAbove)
    } catch (err) {
      moved = false
      logger.warn({ err, conversationId, trigger: reason }, 'extraction: the watermark could not move past never-extracted rows; they are re-checked on the next flush')
    }
    return skip('nothing_extractable', { watermark_from: watermark.ms, watermark_to: moved ? lastAbove.ms : watermark.ms })
  }

  const decoder = new TextDecoder()
  let units: ExtractionUnit[]
  try {
    const decoded: DecodedRow[] = rows.map((r) => ({
      row: r,
      text: decoder.decode(zstdDecompress(new Uint8Array(r.compressed_blob))),
    }))
    units = preferGranularTurns(decoded).map((d) => ({
      id: d.row.id,
      sourceType: d.row.source_type,
      occurredAtMs: d.row.occurred_at,
      trustTier: d.row.trust_tier,
      content: d.text,
    }))
  } catch (err) {
    logger.error({ err, conversationId }, 'extraction: L0 blobs could not be decompressed (is zstd initialised?)')
    return safeRecordRun(db, 'failed', conversationId, { reason: 'decompress_failed', trigger: reason, error: errorText(err) })
  }

  const scope = extractionScope(db, conversationId)
  const taskClosed = isTaskClosed(db, conversationId, reason)
  // Computed from EVERY row above the watermark, not from `units`: a row
  // preferGranularTurns dropped, or a never-extracted thinking row, must still
  // advance the watermark, or it sits above it forever and re-triggers a run on
  // every later flush.
  const newWatermark: Watermark = lastAbove
  // `occurred_at` is the SOURCE's timestamp, not capture time, so a row can arrive
  // in a later flush already below the watermark — two concurrent agent sessions in
  // one conversation, a backdated channel message, a tool row whose logged time
  // predates the assistant message flushed before it. Those rows are never
  // extracted. L0 keeps them and `reason='rebuild'` re-derives them, so this is
  // recoverable rather than lost, but it is silent, so count it into the run.
  // The count is an UPPER BOUND, not exact: a row enqueued out of order within a
  // single flush can be extracted and still counted here, and a legacy
  // bare-number watermark makes the rid guard vacuous. It is a signal that
  // something was stranded, not a number to reconcile against.
  const strandedBelow = Number(
    (db.all<{ c: number }>(sql`SELECT COUNT(*) AS c FROM memory_raw
      WHERE conversation_id = ${conversationId} AND tombstoned = 0 AND occurred_at < ${watermark.ms}
        AND source_type NOT IN ${NEVER_EXTRACTED_SQL}
        AND rid > (SELECT COALESCE(MAX(i.rid), 0) FROM memory_item i WHERE i.item_type = 'raw' AND i.id = ${watermark.id})`)[0]?.c) || 0,
  )

  // A caller may already hold a transaction — p1d's `rebuildFromL0` is the named
  // one, and a rebuild that truncates the derived layers and re-derives is exactly
  // the code that wraps the lot. `BEGIN IMMEDIATE` throws inside one, which would
  // break this function's "never throws" contract. So detect it and participate
  // rather than own: no BEGIN, no COMMIT, no ROLLBACK. The `began` guard is the
  // same shape ingest.ts uses, and moving the BEGIN inside the try is NOT the fix —
  // the catch would then ROLLBACK the caller's work, which is the p1a data-loss
  // bug ingest.ts documents at length.
  let began = false
  try {
    db.run(sql`BEGIN IMMEDIATE`)
    began = true
  } catch (err) {
    // `BEGIN IMMEDIATE` fails for SQLITE_BUSY exactly as it fails for nesting, and
    // a bare catch cannot tell them apart. Carrying on regardless would run this
    // whole function UN-TRANSACTED: measured on a locked database, an abort partway
    // left 7 facts, a gist, 14 entities and 120 IDF rows behind, where the owned
    // path left zero and there was nothing to roll back. So only the caller's own
    // transaction is a reason to continue; anything else fails closed, before a
    // single derived row is written.
    if (!/within a transaction/i.test(errorText(err))) {
      logger.error({ err, conversationId, trigger: reason }, 'extraction could not open a transaction; nothing was written')
      return safeRecordRun(db, 'failed', conversationId, { reason: 'no_transaction', trigger: reason, error: errorText(err) })
    }
    began = false
  }
  // Nested: a SAVEPOINT gives this function a rollback of its own. Without one, a
  // failure part-way left the derived rows it had already written sitting in the
  // caller's transaction — measured, 10 facts, a gist, 14 entities and 120 IDF
  // rows persisted if the caller then committed. Safe here specifically because
  // nothing in this call writes to a contentless FTS5 table; that combination is
  // what made p1a's capability probe abort its caller's transaction.
  if (!began) {
    try {
      db.run(sql.raw(`SAVEPOINT ${EXTRACT_SAVEPOINT}`))
    } catch (err) {
      // Narrow — a SAVEPOINT inside an open transaction fails only on I/O error,
      // interrupt or OOM — but this line sits on the path the header promises
      // never raises, and without a rollback of our own there is no safe way to
      // continue.
      logger.error({ err, conversationId, trigger: reason }, 'extraction could not open a savepoint; nothing was written')
      return safeRecordRun(db, 'failed', conversationId, { reason: 'no_savepoint', trigger: reason, error: errorText(err) })
    }
  }
  try {
    const runId = recordRun(db, { runType: 'extraction', status: 'failed', conversationId, statsJson: { phase: 'started', trigger: reason } })
    const candidate = extractDeterministic(units, { db, projectId: scope.projectId, taskClosed, conversationId })
    const result = arbitrate(db, candidate, {
      conversationId,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      // BOTH from `units`, never one from `units` and one from `rows`:
      // loadSources zips them by index, and `units` is no longer 1:1 with `rows`.
      sourceRawIds: units.map((u) => u.id),
      sourceTrustTiers: units.map((u) => u.trustTier),
    }, runId)
    updateIdf(db, documentStems(units, candidate.language))
    writeWatermark(db, conversationId, newWatermark)
    const flagged = result.rejected + result.quarantined + result.tagViolations
    const status: MemoryRunStatus = flagged > 0 ? 'partial' : 'ok'
    finishRun(db, runId, {
      status,
      modelUsed: null,
      modelCallsUsed: 0,
      rejectedCandidateCount: result.rejected,
      quarantinedCandidateCount: result.quarantined,
      statsJson: {
        trigger: reason,
        units: units.length,
        rows: rows.length,
        watermark_from: watermark.ms,
        watermark_to: newWatermark.ms,
        rows_below_watermark: strandedBelow,
        gist_id: result.gistId,
        gist_source: candidate.gistSource,
        language: candidate.language,
        importance: candidate.importance,
        facts_inserted: result.factsInserted,
        facts_superseded: result.factsSuperseded,
        facts_linked: result.factsLinked,
        tag_violations: result.tagViolations,
        entities: candidate.entities.length,
        topics: candidate.topics.length,
        facts_pending: true,
      },
    })
    if (began) db.run(sql`COMMIT`)
    else db.run(sql.raw(`RELEASE ${EXTRACT_SAVEPOINT}`))
    logger.debug({ runId, conversationId, status, units: units.length, trigger: reason, owned: began }, 'extraction run finished')
    return { runId, status }
  } catch (err) {
    // Only roll back what we opened. Inside a caller's transaction the failure is
    // theirs to resolve; rolling back here would discard their work too.
    if (began) {
      try { db.run(sql`ROLLBACK`) } catch { /* the transaction is already gone */ }
    } else {
      // Undo exactly our own work and leave the caller's intact.
      try {
        db.run(sql.raw(`ROLLBACK TO ${EXTRACT_SAVEPOINT}`))
        db.run(sql.raw(`RELEASE ${EXTRACT_SAVEPOINT}`))
      } catch { /* the caller's transaction is already gone */ }
    }
    logger.error({ err, conversationId, trigger: reason, owned: began }, 'extraction failed; L0 is untouched and the watermark did not move')
    return safeRecordRun(db, 'failed', conversationId, { trigger: reason, units: units.length, error: errorText(err) })
  }
}
