// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Arbitration (spec §6): the ONLY writer of memory_fact, memory_gist,
// memory_entity, their tags, links and source rows. 100 % deterministic:
//   dedup by content hash → link only · same (subject, predicate) with a
//   different object → new row + valid_until / invalidated_by on the old ·
//   tag-inheritance invariant (project / task only when present on ALL
//   sources) · graduated poisoning gate on every fact and on the gist ·
//   trust = min of sources · entity stubs by exact / alias match.
// Runs inside the caller's transaction (extractor.ts, rebuild) and never
// opens its own. The model (Phase 3) only ever changes the candidate.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { allocateRid } from './schema.js'
import { getInstanceId } from './instance.js'
import { nextHlc, sha256Hex } from './ingest.js'
import type { TrustTier } from './ingest-bridge.js'
import { estimateTokens } from '@modules/prompt-wizard/token-budget.js'
import type { ExtractionCandidate } from './extract/deterministic.js'
import { scanForInjection, stripInjectionSentences } from './extract/poison-gate.js'

export interface ArbitrationScope {
  conversationId: string
  projectId: string | null
  projectTypeId: string | null
  /** The L0 rows this candidate was derived from; sourceTrustTiers is index-aligned with it. */
  sourceRawIds: string[]
  sourceTrustTiers: TrustTier[]
}

export interface ArbitrationResult {
  factsInserted: number
  factsSuperseded: number
  factsLinked: number
  gistId: string | null
  rejected: number
  quarantined: number
  tagViolations: number
}

/** Most to least trusted; minTrust() returns the right-most tier present. */
export const TRUST_ORDER: readonly TrustTier[] = ['owner', 'derived', 'ingested', 'peer', 'quarantined']

export function minTrust(tiers: TrustTier[]): TrustTier {
  if (tiers.length === 0) return 'derived'
  let worst = 0
  for (const t of tiers) worst = Math.max(worst, TRUST_ORDER.indexOf(t))
  return TRUST_ORDER[worst]
}

const encoder = new TextEncoder()

/** Local identity of a fact: SHA-256 of `subject|predicate|object`, lowercased. */
export function factContentHash(subject: string, predicate: string, object: string): string {
  return sha256Hex(encoder.encode(`${subject}|${predicate}|${object}`.toLowerCase()))
}

function textHash(text: string): string {
  return sha256Hex(encoder.encode(text))
}

interface SourceRow {
  id: string
  rid: number
  trust: TrustTier
  sourceType: string
  occurredAt: number
  project: Set<string>
  task: Set<string>
}

interface Writer {
  db: EyasDb
  runId: string
  instanceId: string
  now: number
}

interface EntityRef {
  id: string
  canonical: string
}

function loadSources(db: EyasDb, scope: ArbitrationScope): Map<string, SourceRow> {
  const out = new Map<string, SourceRow>()
  scope.sourceRawIds.forEach((id, i) => {
    const row = db.all<{ rid: number; source_type: string; occurred_at: number; trust_tier: TrustTier }>(
      sql`SELECT rid, source_type, occurred_at, trust_tier FROM memory_raw WHERE id = ${id} AND tombstoned = 0`,
    )[0]
    if (!row) return
    const tags = db.all<{ tag_type: string; tag_value: string }>(
      sql`SELECT tag_type, tag_value FROM memory_tag WHERE memory_rid = ${row.rid} AND tag_type IN ('project', 'task')`,
    )
    const source: SourceRow = {
      id, rid: row.rid, trust: scope.sourceTrustTiers[i] ?? row.trust_tier, sourceType: row.source_type,
      occurredAt: row.occurred_at, project: new Set(), task: new Set(),
    }
    for (const t of tags) (t.tag_type === 'project' ? source.project : source.task).add(t.tag_value)
    out.set(id, source)
  })
  return out
}

function tagRow(w: Writer, rid: number, memoryType: 'fact' | 'gist' | 'entity', tagType: string, value: string): void {
  if (!value) return
  w.db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
    VALUES (${rid}, ${memoryType}, ${tagType}, ${value})`)
}

function link(w: Writer, fromType: string, fromId: string, toType: string, toId: string, linkType: string): void {
  w.db.run(sql`INSERT OR IGNORE INTO memory_link (id, from_type, from_id, to_type, to_id, link_type, run_id, created_at)
    VALUES (${generateId()}, ${fromType}, ${fromId}, ${toType}, ${toId}, ${linkType}, ${w.runId}, ${w.now})`)
}

/** Exact or alias match on a live entity, else a stub (no embedding linking in Phase 1). */
function findOrCreateEntity(w: Writer, name: string, type: string): EntityRef {
  // Both sides go through SQLite's lower(), never JavaScript's. SQLite's lower()
  // is ASCII-only, so `lower('ÁRVÍZTŰRŐ')` is `'ÁrvÍztŰrŐ'` while JS gives
  // `'árvíztűrő'`: the two can never meet, and every accented proper noun created
  // a fresh stub on every run — unbounded growth in the product's own languages.
  // json_valid guards the alias branch: json_each THROWS on non-JSON text and,
  // because arbitrate runs inside the caller's transaction, one bad row would roll
  // back every extraction from then on.
  // What this trades away: SQLite's lower() folds neither side's accents, so a
  // name stored lowercase no longer matches a capitalised probe the way JS
  // toLowerCase() made it. That swaps an UNBOUNDED once-per-run duplication for a
  // BOUNDED once-per-spelling one, which is the right direction but is a cost.
  // The durable fix is a stored normalised name column.
  const existing = w.db.all<{ id: string; canonical_name: string }>(sql`SELECT e.id, e.canonical_name FROM memory_entity e
    WHERE e.tombstoned = 0 AND e.merged_into_entity_id IS NULL
      AND (lower(e.canonical_name) = lower(${name})
        OR (json_valid(e.aliases_json) AND EXISTS (SELECT 1 FROM json_each(e.aliases_json) WHERE lower(json_each.value) = lower(${name}))))
    LIMIT 1`)[0]
  if (existing) return { id: existing.id, canonical: existing.canonical_name }
  const id = generateId()
  const rid = allocateRid(w.db, 'entity', id, w.now)
  const hlc = nextHlc(w.now)
  w.db.run(sql`INSERT INTO memory_entity (rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, tombstoned,
      canonical_name, entity_type, aliases_json, merged_into_entity_id)
    VALUES (${rid}, ${id}, ${textHash(`${type}|${name.toLowerCase()}`)}, ${w.instanceId}, ${hlc.physicalMs}, ${hlc.logical}, 1, ${w.now}, 0, ${name}, ${type}, '[]', NULL)`)
  tagRow(w, rid, 'entity', 'layer', 'entity')
  return { id, canonical: name }
}

interface FactOutcome {
  inserted: number
  superseded: number
  linked: number
  rejected: number
  quarantined: number
  tagViolations: number
  insertedIds: string[]
}

function commitFacts(
  w: Writer,
  candidate: ExtractionCandidate,
  scope: ArbitrationScope,
  sources: Map<string, SourceRow>,
  entities: Map<string, EntityRef>,
): FactOutcome {
  const out: FactOutcome = { inserted: 0, superseded: 0, linked: 0, rejected: 0, quarantined: 0, tagViolations: 0, insertedIds: [] }
  for (const fact of candidate.facts) {
    const subject = fact.subject.trim()
    const predicate = fact.predicate.trim()
    const object = fact.object.trim()
    if (!subject || !predicate || !object) continue

    // Tag-inheritance invariant (spec §3, §9): every source must carry the scope's task and project.
    const own = fact.sourceRawIds.map((id) => sources.get(id)).filter((s): s is SourceRow => s !== undefined)
    const provable = own.length > 0 && own.length === fact.sourceRawIds.length
      && own.every((s) => s.task.has(scope.conversationId))
      && (!scope.projectId || own.every((s) => s.project.has(scope.projectId as string)))
    if (!provable) {
      out.tagViolations++
      continue
    }

    // Poisoning gate on the fact text.
    const scan = scanForInjection(`${subject} ${predicate} ${object}`)
    if (scan.level === 'high') {
      out.rejected++
      continue
    }
    let trust = minTrust(own.map((s) => s.trust))
    if (scan.level !== 'none') {
      trust = 'quarantined'
      out.quarantined++
    }

    // Dedup by content hash → link only, no new row.
    const hash = factContentHash(subject, predicate, object)
    // Three predicates, and each closes a measured hole:
    //  - the task tag: unscoped, the same sentence in another project linked to
    //    that project's row, so the fact carried a project tag one of its sources
    //    lacked while this scope got no fact at all;
    //  - `valid_until IS NULL`: without it a re-asserted value attaches to a row
    //    that was already SUPERSEDED and the contradicting row stays live —
    //    measured, `Mon -> Fri -> Mon` left `Fri` as the only live fact while the
    //    `Mon` row's validity ended before a source it now cites. Board facts make
    //    that reachable without contrivance, since title/project/agent are
    //    re-derived on every flush;
    //  - the project tag: a conversation can be MOVED between projects, so the
    //    task tag alone still let a fact keep project P while gaining a source
    //    tagged project Q. The supersede SELECT below already filters
    //    `valid_until`; this is its sibling, and leaving them different is what
    //    hid both gaps.
    const dup = w.db.all<{ id: string }>(sql`SELECT f.id FROM memory_fact f
      WHERE f.content_hash = ${hash} AND f.tombstoned = 0 AND f.archived = 0 AND f.valid_until IS NULL
        AND EXISTS (SELECT 1 FROM memory_tag t WHERE t.memory_rid = f.rid AND t.tag_type = 'task' AND t.tag_value = ${scope.conversationId})
        AND (${scope.projectId} IS NULL OR EXISTS (SELECT 1 FROM memory_tag t2 WHERE t2.memory_rid = f.rid AND t2.tag_type = 'project' AND t2.tag_value = ${scope.projectId}))
      LIMIT 1`)[0]
    if (dup) {
      for (const s of own) {
        link(w, 'raw', s.id, 'fact', dup.id, 'part_of')
        w.db.run(sql`INSERT OR IGNORE INTO memory_fact_source (fact_id, episode_id) VALUES (${dup.id}, ${s.id})`)
      }
      out.linked++
      continue
    }

    // Supersede: same (subject, predicate), a different object, still valid → new row, old closed.
    // Scoped to this task, mirroring commitGist. Unscoped, `deadline is …` in one
    // project closed every other project's `deadline` row: measured over 50
    // projects, 4 980 of 4 980 closures were cross-project and 98 % of the live
    // fact surface was destroyed, because structural subjects are bare keys every
    // project uses. lower() on both sides for the same reason as the entity match.
    const active = w.db.all<{ id: string }>(sql`SELECT f.id FROM memory_fact f
      WHERE lower(f.subject) = lower(${subject}) AND lower(f.predicate) = lower(${predicate})
        AND f.valid_until IS NULL AND f.tombstoned = 0 AND f.archived = 0
        AND EXISTS (SELECT 1 FROM memory_tag t WHERE t.memory_rid = f.rid AND t.tag_type = 'task' AND t.tag_value = ${scope.conversationId})`)
    const id = generateId()
    const rid = allocateRid(w.db, 'fact', id, w.now)
    const factHlc = nextHlc(w.now)
    const validFrom = Math.max(...own.map((s) => s.occurredAt))
    const entity = entities.get(subject.toLowerCase()) ?? null
    w.db.run(sql`INSERT INTO memory_fact (rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, tombstoned,
        subject, predicate, object_text, valid_from, valid_until, invalidated_by_fact_id, confidence, trust_tier, extraction_run_id, entity_id,
        decay_score, presence_tier, archived, facts_pending)
      VALUES (${rid}, ${id}, ${hash}, ${w.instanceId}, ${factHlc.physicalMs}, ${factHlc.logical}, 1, ${w.now}, 0,
        ${subject}, ${predicate}, ${object}, ${validFrom}, NULL, NULL, ${fact.confidenceHint ?? 0.5}, ${trust}, ${w.runId}, ${entity?.id ?? null},
        1.0, 'hot', 0, 1)`)
    for (const old of active) {
      // The closure is a change to a syncable row, so it carries new sync
      // metadata. Without it a peer sees revision 1 on both sides, keeps its own
      // copy, and ends up with two live contradicting rows — the exact failure
      // supersede exists to prevent.
      const closeHlc = nextHlc(w.now)
      w.db.run(sql`UPDATE memory_fact SET valid_until = ${validFrom}, invalidated_by_fact_id = ${id},
        revision = revision + 1, hlc_physical_ms = ${closeHlc.physicalMs}, hlc_logical = ${closeHlc.logical}
        WHERE id = ${old.id}`)
      link(w, 'fact', id, 'fact', old.id, 'supersedes')
      out.superseded++
    }
    for (const s of own) {
      w.db.run(sql`INSERT OR IGNORE INTO memory_fact_source (fact_id, episode_id) VALUES (${id}, ${s.id})`)
      link(w, 'fact', id, 'raw', s.id, 'derived_from')
    }
    if (scope.projectId) tagRow(w, rid, 'fact', 'project', scope.projectId)
    if (scope.projectId && scope.projectTypeId) tagRow(w, rid, 'fact', 'project_type', scope.projectTypeId)
    tagRow(w, rid, 'fact', 'task', scope.conversationId)
    if (entity) tagRow(w, rid, 'fact', 'entity', entity.canonical)
    tagRow(w, rid, 'fact', 'language', candidate.language)
    tagRow(w, rid, 'fact', 'trust_tier', trust)
    tagRow(w, rid, 'fact', 'layer', 'fact')
    for (const sourceType of new Set(own.map((s) => s.sourceType))) tagRow(w, rid, 'fact', 'source_type', sourceType)
    out.inserted++
    out.insertedIds.push(id)
  }
  return out
}

interface GistOutcome {
  gistId: string | null
  rejected: number
  quarantined: number
  tagViolations: number
}

/** The one value of a facet every source shares (spec §9: strict inheritance for project/task), or null. */
function inheritedTag(sources: SourceRow[], facet: 'project' | 'task'): string | null {
  if (sources.length === 0) return null
  let shared: Set<string> = new Set(sources[0][facet])
  for (const s of sources.slice(1)) {
    shared = new Set([...shared].filter((v) => s[facet].has(v)))
    if (shared.size === 0) return null
  }
  return [...shared].sort()[0] ?? null
}

function withheldGist(scope: ArbitrationScope): string {
  return `Task ${scope.conversationId}: ${scope.sourceRawIds.length} captured rows; the gist text was withheld by the poisoning gate.`
}

function commitGist(
  w: Writer,
  candidate: ExtractionCandidate,
  scope: ArbitrationScope,
  sources: SourceRow[],
  factIds: string[],
  entities: Map<string, EntityRef>,
): GistOutcome {
  const out: GistOutcome = { gistId: null, rejected: 0, quarantined: 0, tagViolations: 0 }
  let text = candidate.gist.trim()
  let gistSource: ExtractionCandidate['gistSource'] = candidate.gistSource
  let scan = scanForInjection(text)
  if (scan.level === 'high') {
    // Spec §6: a rejected gist falls back to the heuristic gist. If that trips
    // the gate as well, only its clean sentences survive; if nothing does, a
    // withheld stub keeps the task addressable without carrying the text.
    out.rejected++
    gistSource = 'heuristic'
    const heuristic = (candidate.heuristicGist ?? '').trim()
    text = heuristic && scanForInjection(heuristic).level !== 'high' ? heuristic : stripInjectionSentences(heuristic || candidate.gist)
    if (!text) text = withheldGist(scope)
    scan = scanForInjection(text)
  }
  if (!text) return out
  // Union of the DECLARED tiers and the tiers of the sources actually loaded.
  // commitFacts computes min over the loaded sources; reading only the declared
  // array made a gist more trusted than the facts of the same call whenever the
  // two arrays were misaligned — measured: a quarantined fact and a derived gist
  // from one raw row. `trust = min of sources` is a spec §3 invariant, so it must
  // not depend on a caller keeping two arrays in step. Identical whenever they
  // are aligned, since the union is then a superset of its own subset.
  let trust = minTrust([...scope.sourceTrustTiers, ...sources.map((s) => s.trust)])
  if (scan.level !== 'none') {
    trust = 'quarantined'
    out.quarantined++
  }

  const projectTag = inheritedTag(sources, 'project')
  const taskTag = inheritedTag(sources, 'task')
  if (scope.projectId && projectTag !== scope.projectId) out.tagViolations++
  if (taskTag !== scope.conversationId) out.tagViolations++

  const previous = w.db.all<{ id: string }>(sql`SELECT id FROM memory_gist
    WHERE scope_type = 'task' AND scope_id = ${scope.conversationId} AND is_current = 1 AND tombstoned = 0`)
  const id = generateId()
  const rid = allocateRid(w.db, 'gist', id, w.now)
  const gistHlc = nextHlc(w.now)
  const structured = JSON.stringify({
    topics: candidate.topics,
    language: candidate.language,
    entities: [...entities.values()].map((e) => e.canonical),
    facts_pending: true,
  })
  // consolidation_run_id = the run that wrote the row (extraction here, consolidation in Phase 4).
  w.db.run(sql`INSERT INTO memory_gist (rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, tombstoned,
      scope_type, scope_id, tree_depth, text, structured_json, pinned, trust_tier, token_count, importance_score, gist_source,
      consolidation_run_id, supersedes_gist_id, superseded_by_gist_id, is_current, decay_score, presence_tier, alternate_of_gist_id,
      multi_project, times_retrieved, changelog_json)
    VALUES (${rid}, ${id}, ${textHash(text)}, ${w.instanceId}, ${gistHlc.physicalMs}, ${gistHlc.logical}, 1, ${w.now}, 0,
      'task', ${scope.conversationId}, 0, ${text}, ${structured}, 0, ${trust}, ${estimateTokens(text)}, ${candidate.importance}, ${gistSource},
      ${w.runId}, ${previous[0]?.id ?? null}, NULL, 1, 1.0, 'hot', NULL, 0, 0, NULL)`)
  for (const old of previous) {
    // Same reason as the fact closure in Task 9: this is a change to a syncable
    // row, so it carries new sync metadata. Without it a peer sees revision 1 on
    // both sides, keeps its own copy, and holds two rows both claiming is_current.
    const closeHlc = nextHlc(w.now)
    w.db.run(sql`UPDATE memory_gist SET is_current = 0, superseded_by_gist_id = ${id},
      revision = revision + 1, hlc_physical_ms = ${closeHlc.physicalMs}, hlc_logical = ${closeHlc.logical}
      WHERE id = ${old.id}`)
    link(w, 'gist', id, 'gist', old.id, 'supersedes')
  }
  for (const s of sources) {
    w.db.run(sql`INSERT OR IGNORE INTO memory_gist_source (gist_id, child_type, child_id) VALUES (${id}, 'raw', ${s.id})`)
    link(w, 'gist', id, 'raw', s.id, 'derived_from')
  }
  for (const factId of factIds) {
    w.db.run(sql`INSERT OR IGNORE INTO memory_gist_source (gist_id, child_type, child_id) VALUES (${id}, 'fact', ${factId})`)
  }
  if (projectTag && projectTag === scope.projectId) {
    tagRow(w, rid, 'gist', 'project', projectTag)
    if (scope.projectTypeId) tagRow(w, rid, 'gist', 'project_type', scope.projectTypeId)
  }
  if (taskTag === scope.conversationId) tagRow(w, rid, 'gist', 'task', taskTag)
  for (const e of entities.values()) tagRow(w, rid, 'gist', 'entity', e.canonical)
  for (const topic of candidate.topics) tagRow(w, rid, 'gist', 'topic', topic)
  tagRow(w, rid, 'gist', 'language', candidate.language)
  tagRow(w, rid, 'gist', 'trust_tier', trust)
  tagRow(w, rid, 'gist', 'layer', 'gist')
  for (const sourceType of new Set(sources.map((s) => s.sourceType))) tagRow(w, rid, 'gist', 'source_type', sourceType)
  out.gistId = id
  return out
}

export function arbitrate(db: EyasDb, candidate: ExtractionCandidate, scope: ArbitrationScope, runId: string): ArbitrationResult {
  const w: Writer = { db, runId, instanceId: getInstanceId(db), now: Date.now() }
  const sources = loadSources(db, scope)
  const entities = new Map<string, EntityRef>()
  for (const e of candidate.entities) {
    const name = e.name.trim()
    if (!name || entities.has(name.toLowerCase())) continue
    entities.set(name.toLowerCase(), findOrCreateEntity(w, name, e.type))
  }
  const facts = commitFacts(w, candidate, scope, sources, entities)
  const gist = commitGist(w, candidate, scope, [...sources.values()], facts.insertedIds, entities)
  return {
    factsInserted: facts.inserted,
    factsSuperseded: facts.superseded,
    factsLinked: facts.linked,
    gistId: gist.gistId,
    rejected: facts.rejected + gist.rejected,
    quarantined: facts.quarantined + gist.quarantined,
    tagViolations: facts.tagViolations + gist.tagViolations,
  }
}
