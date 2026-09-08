// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { parsePersonaMarkdown } from '@modules/agent/persona-import.js'
import type { CreateAgentInput } from '@modules/agent/types.js'
import { SECRETS_TAG } from '@modules/memory/memory-index.js'
import { OWN_SKILLS_CATEGORY, IMPORT_TAGS } from '../constants.js'
import type { AppliedKind } from '../ledger.js'
import { failureReason } from '../errors.js'
import { isMemoryIndexBasename } from '../memory-index-hooks.js'
import { looksLikeSecrets } from '../scanners/heuristics.js'
import { legacyBody } from '../source-frontmatter.js'
import { assembleSkillContent, assembleSkillContentLegacy, sortAssetsByPath } from '../skill-package.js'
import { safeImportedKind } from './transform.js'
import type {
  CandidateTarget,
  ImportedNoteKind,
  MemoryTransformResult,
  ReasonCode,
  SkillAsset,
  SkillTransformResult,
  SourceProfile,
} from '../types.js'

/** What an already-stored item looks like to the idempotency check. */
export interface StoredEpisodic {
  id: string
  /** `import:<jobId>` for a row an import wrote; `null` when the row predates the column. */
  sourceId?: string | null
  /** The row's own tags, so a stored row missing `contains-secrets` can be re-tagged (A-8b). */
  tags?: string[]
}

export interface ApplyDeps {
  episodic?: {
    create: (input: {
      content: string
      sourceType: 'system' | 'extraction' | 'user' | 'conversation'
      sourceId?: string
      tags?: string[]
      validFrom?: string
      /** The importer always passes `false`: no embedding, hence no model call, on the import path. */
      embed?: boolean
    }) => { id: string }
    /** Looks an already-imported row up by its content digest, so a re-run is a no-op. */
    findImported?: (sha: string) => StoredEpisodic | null
    /**
     * Rewrites an already-imported row in place: the verbatim body, its `sha:`
     * tag replaced by `sha`, and `addTags` merged into whatever the row already
     * carries.
     *
     * Two callers, one operation. A-24: a row found only through the lossy
     * legacy digest holds pre-amendment bytes, so the verbatim ones are stamped
     * over it rather than left stale for ever. A-8b: a row that is byte-identical
     * but missing `contains-secrets` is re-tagged instead of being reported
     * `unchanged` with the flag lost. Absent, apply degrades to `unchanged` —
     * never to a duplicate.
     */
    restamp?: (id: string, input: { content: string; sha: string; addTags: string[] }) => void
  }
  vault?: {
    write: (path: string, frontmatter: Record<string, unknown>, content: string) => void
    exists: (path: string) => boolean
    /**
     * The note as it stands, body verbatim (R11.5) — so the identity check below
     * can be byte-exact. `frontmatter` travels with it so an already-stored note
     * can be re-stamped or re-tagged without losing what it declared.
     */
    read?: (path: string) => { content: string; frontmatter?: Record<string, unknown> } | null
  }
  indexer?: { indexAll: () => number }
  skills?: {
    create: (input: {
      name: string
      description?: string
      category?: string
      triggerPatterns?: string[]
      capabilities?: string[]
      content: string
      skillType?: 'knowledge' | 'tool' | 'integration'
    }) => { id: string }
    /** The newest user skill of that name, so a re-import is recognised instead of duplicated. */
    findByName?: (name: string) => { id: string; content: string; capabilities?: string[] } | null
    /**
     * ANY earlier import whose assembled body hashes the same, looked up by the
     * `content-sha:` capability tag. Catches a package that came back under a
     * different name, which a name lookup alone would import twice.
     * `capabilities` comes back so the hit's import job and its secrets tag can
     * be read off it.
     */
    findByContentSha?: (sha: string) => { id: string; capabilities?: string[] } | null
    /**
     * The skill twin of `episodic.restamp`: the assembled body, its
     * `content-sha:` capability replaced by `sha`, and `addCapabilities` merged
     * in. Used for the A-24 re-stamp of a package found only by its legacy
     * digest and for the A-8b/A-14 late `contains-secrets` tag.
     */
    restamp?: (id: string, input: { content: string; sha: string; addCapabilities: string[] }) => void
    /** Writes bundled files to disk; returns the absolute directory. */
    writeAssets?: (dirName: string, assets: SkillAsset[]) => string
  }
  agents?: {
    /**
     * `source` is informational here — rollback checks provenance through its own
     * deps. `tags` carries the import job of an already-stored persona.
     */
    get: (id: string) => { id: string; systemPrompt: string; source: string; tags?: string[] } | null
    create: (input: CreateAgentInput) => { id: string }
  }
  createProposal: (input: {
    jobId: string
    agentId: string
    workspaceFile: string
    title: string
    proposedBody: string
    existingBody: string | null
  }) => string
  /**
   * A proposal for the same workspace file whose proposed body hashes the same
   * and is still waiting for a decision. Re-importing an unapproved rule file
   * must not stack a second identical card on the owner's queue.
   */
  findPendingProposal?: (input: {
    agentId: string
    workspaceFile: string
    /**
     * The proposed body as it would be created now. The comparison is made on
     * the deps side through `legacyBody`, so a card written before R11.5 — when
     * the body was trimmed on the way in — is still recognised (P-13).
     */
    proposedBody: string
    /** The card's own stored body, so `unchanged` can report the digest of what is actually there. */
  }) => { id: string; jobId?: string | null; proposedBody?: string | null } | null
  /**
   * Whether a scope id a source file declared is one this instance actually
   * knows. An id from someone else's install would otherwise file the note into
   * a folder nothing ever reads.
   */
  scopeExists?: {
    project?: (id: string) => boolean
    projectType?: (id: string) => boolean
  }
  /**
   * Whether the ledger already records this kind/ref as an import's own work.
   * The second half of the provenance test below `isImportersOwn` makes, for the
   * case where the owner has stripped an imported item's tags but the ledger
   * still remembers writing it. Absent, the tags decide alone.
   */
  wasImported?: (kind: AppliedKind, ref: string) => boolean
  /** Whether a tool id is registered here; unknown names never reach an imported agent. */
  toolRegistry?: { has: (name: string) => boolean }
  readWorkspaceFile?: (agentId: string, file: string) => string | null
  resolveDefaultAgentId: () => string | null
  logger?: { info?: (o: unknown, m?: string) => void; warn?: (o: unknown, m?: string) => void }
}

export type ApplyResult =
  /** `sha256` is the digest of what was written — present for EVERY kind (R11.6). */
  | { status: 'applied'; kind: string; ref: string; assetsDir?: string; sha256: string; assetsSha256?: string }
  /**
   * `sha256`: the digest the hit was matched on — the verbatim one when it
   * matched, else the legacy one the stored bytes actually hash to. The runner
   * records it when it adopts the row (R11.6: a digest for every ledger row),
   * so an adopted row is never written with `null`.
   */
  | {
      status: 'unchanged'
      ref: string
      assetsDir?: string
      reasonCode?: ReasonCode
      importJobId?: string | null
      sha256: string
      assetsSha256?: string
    }
  | { status: 'proposal'; proposalId: string; workspaceFile: string; sha256: string }
  /**
   * `reason` / `error` are English, for the log. `reasonCode` is the machine
   * code the importer counts and the UI translates — always one of
   * `REASON_CODES` (types.ts), which is also what the locale files are checked
   * against. It is what a caller must read: deriving a code from the prose
   * would break silently the day one of these sentences is reworded.
   */
  | { status: 'skipped'; reason: string; reasonCode?: ReasonCode }
  | { status: 'error'; error: string; reasonCode?: ReasonCode }

/**
 * sha256 over the text exactly as written — no trim (R11.5). This is the
 * identity of an imported item: two bodies that differ only in whitespace are
 * two different bodies, and the ledger says which one is on disk.
 */
export function contentSha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * The pre-amendment digest(s) of one body (P-13). `splitFrontmatter` used to
 * drop leading blank lines only when the file HAD a frontmatter block, so
 * `hadFrontmatter` picks the branch the source file actually took — the runner
 * reads it off the `SourceNote`. It is unknown only for a body no frontmatter
 * reader produced (a rendered transcript, say), and then both branches are
 * tried, because guessing wrong would miss the already-imported row and
 * duplicate it — the one outcome R11.8 exists to prevent.
 *
 * Never the verbatim digest, and never a duplicate: the caller tries the
 * verbatim one FIRST and only falls through to these (A-24).
 */
export function legacyContentShas(body: string, hadFrontmatter?: boolean): string[] {
  const variants =
    hadFrontmatter === undefined
      ? [legacyBody(body, true), legacyBody(body, false)]
      : [legacyBody(body, hadFrontmatter)]
  const out: string[] = []
  for (const variant of variants) {
    if (variant === body) continue
    const sha = contentSha(variant)
    if (!out.includes(sha)) out.push(sha)
  }
  return out
}

/**
 * @deprecated The pre-amendment name for the vault digest, when it was taken
 * over the TRIMMED body. It is `contentSha` now — verbatim, no trim — and this
 * alias exists only so a caller written against the old name still compiles.
 * Use `contentSha`.
 */
export const noteBodySha = contentSha

/**
 * Provenance every applied item carries (R11.6): the adapter that actually read
 * the file, and — only when they differ — the job profile it ran under. A Grok
 * summary found by an auto-detected `claude-code` job is `source:grok-cli` plus
 * `source-profile:claude-code`, so neither fact is lost.
 */
function baseTags(sourceProfile: SourceProfile, jobId: string, adapterId?: SourceProfile | null): string[] {
  const adapter = adapterId ?? sourceProfile
  return [
    IMPORT_TAGS.imported,
    `${IMPORT_TAGS.sourcePrefix}${adapter}`,
    `${IMPORT_TAGS.jobPrefix}${jobId}`,
    ...(adapter !== sourceProfile ? [`source-profile:${sourceProfile}`] : []),
  ]
}

/** The job an already-stored item was imported by, read off its own tags. */
function jobOf(tags: readonly string[] | undefined | null): string | null {
  const hit = (tags ?? []).find((t) => t.startsWith(IMPORT_TAGS.jobPrefix))
  return hit ? hit.slice(IMPORT_TAGS.jobPrefix.length) : null
}

/** `import:<jobId>` → `<jobId>`; anything else is not an import's own row. */
const IMPORT_SOURCE_PREFIX = 'import:'
function jobOfSourceId(sourceId: string | null | undefined): string | null {
  return sourceId?.startsWith(IMPORT_SOURCE_PREFIX) ? sourceId.slice(IMPORT_SOURCE_PREFIX.length) : null
}

/**
 * Every profile this importer can run under. `SourceProfile` is a type-only
 * union, so the runtime copy lives here — with both drift directions closed at
 * compile time: `satisfies` refuses an entry the union does not have, and
 * `UnlistedSourceProfile` below refuses a union member this list forgets.
 */
const SOURCE_PROFILE_LIST = [
  'auto',
  'claude-code',
  'grok-cli',
  'cursor',
  'codex',
  'gemini-cli',
  'windsurf',
  'copilot',
  'obsidian',
  'chat-export',
  'eyas-export',
  'generic-md',
] as const satisfies readonly SourceProfile[]

/** `never` while the list above is complete; a new profile makes it that profile's name. */
export type UnlistedSourceProfile = Exclude<SourceProfile, (typeof SOURCE_PROFILE_LIST)[number]>
/**
 * Fails the build the day a `SourceProfile` is added to the union and not to the
 * list above: the type resolves to `false` and `true` is not assignable to it.
 *
 * The tuple wrapper matters — a bare `UnlistedSourceProfile extends never` would
 * distribute over the union and answer `true` for an empty one either way. So
 * does the assignment: an empty array annotated with the type would compile
 * clean, because `[]` is assignable to every array type.
 */
export const SOURCE_PROFILE_LIST_IS_COMPLETE: [UnlistedSourceProfile] extends [never] ? true : false = true

const SOURCE_PROFILES: ReadonlySet<string> = new Set<string>(SOURCE_PROFILE_LIST)

/**
 * The `source:` frontmatter block the importer writes on every note it creates
 * (`normalizeMemory`), recognised as EYAS import provenance — and only that.
 *
 * The witness is a KNOWN profile, nothing else. `parseVaultFile` surfaces any
 * mapping under `source:`, and a note is free to carry one of its own: a `path`
 * is a key anybody's exporter writes, and a `profile` naming another tool says
 * the note came from somewhere else, not from here. Reading either as ours would
 * rewrite the owner's file — the precise failure A-39 exists to prevent.
 *
 * Every note this importer has ever written sets `source.profile` from the
 * closed list above, before R11 as well as after (`profile: opts.sourceProfile`),
 * so nothing that is genuinely ours is missed.
 */
function hasImportSourceBlock(frontmatter: Record<string, unknown> | null | undefined): boolean {
  const source = frontmatter?.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false
  const block = source as Record<string, unknown>
  return [block.profile, block.adapter].some((v) => typeof v === 'string' && SOURCE_PROFILES.has(v))
}

/**
 * Whether an item that is already stored is one an IMPORT created.
 *
 * This is what keeps memory sovereignty intact under A-24 / A-39. A legacy-digest
 * match proves two bodies are the same modulo surrounding whitespace — it does
 * not prove the stored item is this importer's to rewrite. A note, skill or row
 * the OWNER wrote by hand can match that loosely, and re-stamping it would be a
 * silent write to their own words: the plan's Global Constraints say an import
 * never modifies an existing row, and A-24 sanctions the re-stamp only for a row
 * an import wrote.
 *
 * THREE independent witnesses, any one of which is enough, because an item can
 * lose any single one of them and still be ours:
 *
 *   1. the item's own provenance tags or capabilities — a source file can never
 *      mint these (`isImporterOwnedSourceTag`, `stripReservedCapabilities`), so
 *      one being present means the importer put it there;
 *   2. the `source:` frontmatter block, which every imported note carries and
 *      which survives a tag the owner has edited away;
 *   3. the ledger row an earlier import left for that ref, which survives both.
 *
 * Widening what counts as OURS is the whole point: it never widens what may be
 * overwritten. An item with no witness at all is still someone else's, and takes
 * the collision path untouched.
 */
function isImportersOwn(
  deps: ApplyDeps,
  kind: AppliedKind,
  ref: string,
  witness: {
    tags?: readonly string[] | null
    /** A skill's capabilities: any RESERVED one is importer-minted by construction. */
    capabilities?: readonly string[] | null
    frontmatter?: Record<string, unknown> | null
  },
): boolean {
  const declared = (witness.tags ?? []).some(
    (t) => t === IMPORT_TAGS.imported || t.startsWith(IMPORT_TAGS.jobPrefix),
  )
  if (declared) return true
  // `content-sha:` and nothing else. The importer's OWN create path strips every
  // reserved capability, but the skills module's API does not — `skills/routes.ts`
  // passes `capabilities` through unfiltered — so a skill the owner made through
  // the UI may legitimately carry `source:`, `source-changed` or `conflict-with:`,
  // and reading any of those as ours would rewrite their skill. A 64-character
  // digest of an assembled body is the one capability nobody mints by hand, and
  // it is also the one that actually says an import assembled this body.
  if ((witness.capabilities ?? []).some((c) => isContentShaCapability(c))) return true
  if (hasImportSourceBlock(witness.frontmatter)) return true
  try {
    return deps.wasImported?.(kind, ref) ?? false
  } catch {
    // An unreadable ledger may not promote someone else's note to ours.
    return false
  }
}

function workspaceFileForTarget(target: CandidateTarget): string | null {
  switch (target) {
    case 'workspace.agents':
      return 'AGENTS.md'
    case 'workspace.soul':
      return 'SOUL.md'
    case 'workspace.identity':
      return 'IDENTITY.md'
    case 'workspace.tools':
      return 'TOOLS.md'
    case 'workspace.memory':
      return 'MEMORY.md'
    // Not an agent file: the writer routes this id to `project_types.prompt`.
    case 'prompt.project-type':
      return 'project-type:general'
    default:
      return null
  }
}

/**
 * One path segment, and never one the filesystem reads as a traversal: an id
 * that sanitises down to nothing (`..`, `.`) is treated as no scope at all
 * rather than becoming `projects/..`.
 */
function safeFolderSegment(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 60)
    .replace(/[.\-]+$/g, '')
}

/** Same rule as the capture note-writer: feedback is procedural, scoped notes live in their folder. */
export function folderForKind(
  kind: ImportedNoteKind,
  scope: { projectId?: string | null; projectTypeId?: string | null } = {},
): string {
  if (kind === 'feedback') return 'procedural'
  if (kind === 'project') {
    const id = safeFolderSegment(scope.projectId ?? '')
    if (id) return `projects/${id}`
  }
  if (kind === 'domain') {
    const id = safeFolderSegment(scope.projectTypeId ?? '')
    if (id) return `project-types/${id}`
  }
  return 'semantic'
}

/**
 * Unicode-aware: a Hungarian or Japanese file name keeps its letters, so the slug
 * stays the name the other notes link to. NFC first, because the same name arrives
 * decomposed from a macOS filesystem and composed from an archive.
 */
function sanitizeSegment(raw: string, max: number): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
  // Clipped by code point, not by UTF-16 unit: half a surrogate pair is not a file name.
  return Array.from(cleaned).slice(0, max).join('').replace(/[.\-]+$/g, '')
}

/** The source file name IS the slug: every `[[old_slug]]` in every other note keeps resolving. */
export function slugFromSource(relativePath: string, _title: string, unit: string | null): string {
  const stem = basename(relativePath.replace(/\\/g, '/')).replace(
    /\.(md|markdown|txt|mdc|json|jsonl|sqlite)$/i,
    '',
  )
  const safe = sanitizeSegment(unit ? `${stem}-${unit}` : stem, 80)
  if (safe) return safe
  // Deterministic, so re-importing the same file lands on the same note rather
  // than a fresh random one. `_title` is deliberately unused: two notes can share
  // a title, and a title changes between runs while the path does not.
  return `note-${createHash('sha256').update(relativePath).digest('hex').slice(0, 12)}`
}

/** Folders that only say "memory lives here" — they never name WHICH memory. */
const GENERIC_MEMORY_FOLDERS = new Set(['memory', 'ai-memory', 'semantic', 'procedural', 'vault', 'notes'])

/** Folders that hold assistants or projects rather than being one. */
const CONTAINER_FOLDERS = new Set([
  '.claude',
  '.grok',
  '.agents',
  '.cursor',
  '.codex',
  'projects',
  'documents',
  'data',
])

/**
 * A tree has one root index, and every other `MEMORY.md` is named after the
 * nearest ancestor that actually identifies it. Grok writes one index per
 * project directly under the project folder (`.grok/memory/<proj>/MEMORY.md`),
 * Claude Code one folder deeper (`.claude/projects/<proj>/memory/MEMORY.md`);
 * naming both after their parent would collapse every Claude project onto a
 * single `memory` note.
 */
function indexSlug(sourceProfile: SourceProfile, relativePath: string): string {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  parts.pop()
  const parent = parts.pop() ?? ''
  const grandparent = parts.pop() ?? ''
  const stem = `memory-index-${sourceProfile}`

  let disambiguator = ''
  if (parent && !GENERIC_MEMORY_FOLDERS.has(parent.toLowerCase())) {
    disambiguator = parent
  } else if (grandparent && !CONTAINER_FOLDERS.has(grandparent.toLowerCase())) {
    disambiguator = grandparent
  }

  const suffix = sanitizeSegment(disambiguator, 40)
  return suffix ? `${stem}-${suffix}` : stem
}

/**
 * Process-wide, because the point is one line in the log, not one per imported
 * note: a runner that forgets `vault.read` would otherwise say it thousands of times.
 */
let warnedMissingVaultRead = false

/**
 * How far a `-2`, `-3`, … collision walk goes before giving up. A store that
 * answered every id would otherwise spin the import forever; a thousand
 * siblings of one slug is already a broken import, not a busy one.
 */
export const MAX_COLLISION_WALK = 1000
const WALK_EXHAUSTED = 'id collision walk exhausted'

function vaultPathAt(folder: string, slug: string, n: number): string {
  return n <= 1 ? `${folder}/${slug}.md` : `${folder}/${slug}-${n}.md`
}

/** `null` when the whole capped chain is taken — the caller reports the error. */
export function freeVaultPath(
  vault: { exists: (p: string) => boolean },
  folder: string,
  slug: string,
): string | null {
  let n = 1
  while (n <= MAX_COLLISION_WALK && vault.exists(vaultPathAt(folder, slug, n))) n++
  return n > MAX_COLLISION_WALK ? null : vaultPathAt(folder, slug, n)
}

/**
 * Walk a `<base>`, `<base>-2`, `<base>-3` … chain looking for the item this
 * import already wrote, and note where a new one would go.
 *
 * A free slot does NOT end the chain on its own. An earlier import's `-2` may
 * have been deleted while its `-3` survives, and stopping at the gap would hide
 * that `-3` from the identity check — every re-import would then add another
 * sibling of a note that is already there. Two empty slots in a row do end it:
 * one gap is a deleted sibling, two is the end of the chain.
 *
 * `probe` answers whether a slot is taken, and — for a taken slot — whether it
 * IS this item. The first such hit wins; `free` is the first empty slot seen,
 * or `null` when the whole capped chain is occupied.
 */
export function walkCollisionChain<T>(
  nameAt: (n: number) => string,
  probe: (name: string) => { taken: boolean; hit?: T },
): { hit?: T; free: string | null } {
  let free: string | null = null
  let consecutiveFree = 0
  for (let n = 1; n <= MAX_COLLISION_WALK; n++) {
    const name = nameAt(n)
    const result = probe(name)
    if (result.taken) {
      consecutiveFree = 0
      if (result.hit !== undefined) return { hit: result.hit, free }
      continue
    }
    if (free === null) free = name
    if (++consecutiveFree >= 2) break
  }
  return { free }
}

export async function applyMemoryItem(
  deps: ApplyDeps,
  input: {
    jobId: string
    sourceProfile: SourceProfile
    /** The adapter that read the file, when it is not the job's own profile (R11.6). */
    adapterId?: SourceProfile | null
    target: CandidateTarget
    transformed: MemoryTransformResult
    relativePath?: string
    unit?: string | null
    sessionId?: string | null
    sessionDate?: string | null
    /** What the row is — `transcript`, `session-summary`, `session-artifact` — kept as a tag. */
    kindTag?: string | null
    /** One ordered part of a rendered session too large for a single row (P-5). */
    part?: { n: number; of: number } | null
    /**
     * Whether the source file carried a leading frontmatter block
     * (`SourceNote.hadFrontmatter`). It picks the right pre-amendment body shape
     * for the P-13 fallback digest. Absent for a body no frontmatter reader
     * produced, and then both shapes are tried.
     */
    hadFrontmatter?: boolean
    scope?: { projectId?: string | null; projectTypeId?: string | null }
  },
): Promise<ApplyResult> {
  const t = input.transformed
  if (t.skip || !t.body.trim()) return { status: 'skipped', reason: 'empty body', reasonCode: 'empty' }

  const rel = input.relativePath ?? ''
  const isIndex = isMemoryIndexBasename(rel)
  const tags = [
    ...new Set(
      [
        ...baseTags(input.sourceProfile, input.jobId, input.adapterId),
        ...t.tags,
        ...(isIndex ? ['index'] : []),
        ...(input.sessionId ? [`session:${input.sessionId}`] : []),
        ...(input.kindTag ? [input.kindTag] : []),
        ...(input.part ? [`session-part:${input.part.n}/${input.part.of}`] : []),
      ]
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ]
  // The tag `normalizeMemory` already decided over the whole body (A-8). Read
  // back rather than recomputed: the body may be a rendered container unit whose
  // own turns the adapter judged (A-16), and a second pass over a 256 MiB
  // transcript would buy nothing.
  const flagged = tags.includes(SECRETS_TAG)

  try {
    if (input.target === 'episodic') {
      if (!deps.episodic) return { status: 'skipped', reason: 'episodic service unavailable', reasonCode: 'service-unavailable' }
      // The row carries the digest of what was imported, so a second run of the
      // same job recognises its own work instead of duplicating the transcript.
      // The VERBATIM digest is asked for first and the pre-amendment ones only
      // on a miss (A-24): the legacy digest is many-to-one, so consulting it
      // first could match a row a byte-exact comparison would have separated.
      const sha = contentSha(t.body)
      let matched = sha
      let already = deps.episodic.findImported?.(sha) ?? null
      if (!already) {
        for (const legacySha of legacyContentShas(t.body, input.hadFrontmatter)) {
          const hit = deps.episodic.findImported?.(legacySha)
          if (hit) {
            already = hit
            matched = legacySha
            break
          }
        }
      }
      if (already) {
        // A-24: a legacy-digest hit means "the same item", never "the stored
        // bytes are current" — the verbatim ones are stamped over it. A-8b: a
        // byte-identical row that is missing the secrets tag is re-tagged rather
        // than reported `unchanged` with the flag lost. Without a re-stamp the
        // result degrades to `unchanged`, never to a duplicate.
        // Only a row an import wrote may be rewritten (memory sovereignty).
        // `findImported` is import-scoped on both its branches, so this is a
        // guard rather than a live case — but a guard is what stops the next
        // widening of that lookup from silently overwriting the owner's row.
        const ours = isImportersOwn(deps, 'episodic', already.id, {
          tags: [
            ...(already.tags ?? []),
            ...(jobOfSourceId(already.sourceId) ? [IMPORT_TAGS.imported] : []),
          ],
        })
        const stale = matched !== sha && ours
        const untagged = flagged && !(already.tags ?? []).includes(SECRETS_TAG)
        if ((stale || untagged) && deps.episodic.restamp) {
          deps.episodic.restamp(already.id, { content: t.body, sha, addTags: tags })
          return { status: 'applied', kind: 'episodic', ref: already.id, sha256: sha }
        }
        return {
          status: 'unchanged',
          ref: already.id,
          importJobId: jobOfSourceId(already.sourceId),
          sha256: matched,
        }
      }
      const mem = deps.episodic.create({
        content: t.body,
        sourceType: 'system',
        sourceId: `import:${input.jobId}`,
        tags: [...tags, `sha:${sha}`],
        ...(input.sessionDate ? { validFrom: input.sessionDate } : {}),
        // No model call on the import path: the row is embedded later, by the
        // ordinary background pass, never by the importer.
        embed: false,
      })
      return { status: 'applied', kind: 'episodic', ref: mem.id, sha256: sha }
    }

    if (input.target === 'vault.semantic' || input.target === 'vault.procedural') {
      if (!deps.vault) return { status: 'skipped', reason: 'vault service unavailable', reasonCode: 'service-unavailable' }
      const vault = deps.vault
      const kind = safeImportedKind(t.kind)
      // A scope id the source declared is honoured only when THIS instance
      // knows it. An id from someone else's install would file the note under
      // `projects/<their id>/`, where nothing here would ever recall it; it is
      // kept as a tag instead, and in `source.frontmatter` verbatim, so the
      // owner can still see what the file asked for. Without a resolver the
      // declaration is trusted, as it was before.
      const declaredScope = input.scope ?? {}
      const scope: { projectId?: string | null; projectTypeId?: string | null } = {}
      if (declaredScope.projectId) {
        if (deps.scopeExists?.project?.(declaredScope.projectId) ?? true) {
          scope.projectId = declaredScope.projectId
        } else {
          tags.push(`declared-project:${declaredScope.projectId}`)
        }
      }
      if (declaredScope.projectTypeId) {
        if (deps.scopeExists?.projectType?.(declaredScope.projectTypeId) ?? true) {
          scope.projectTypeId = declaredScope.projectTypeId
        } else {
          tags.push(`declared-project-type:${declaredScope.projectTypeId}`)
        }
      }
      const folder =
        input.target === 'vault.procedural' ? 'procedural' : folderForKind(kind, scope)
      const tier = folder === 'procedural' ? 'procedural' : 'semantic'
      const slug = isIndex ? indexSlug(input.sourceProfile, rel) : slugFromSource(rel, t.title, input.unit ?? null)

      if (!vault.read && !warnedMissingVaultRead) {
        warnedMissingVaultRead = true
        deps.logger?.warn?.(
          { jobId: input.jobId },
          'vault.read is unavailable: re-imported notes cannot be recognised and will be written as conflict siblings',
        )
      }

      // Walk the whole collision chain before writing: an earlier run may have
      // parked this very body on a `-2` sibling, and re-importing must find it
      // rather than add a `-3`.
      const basePath = vaultPathAt(folder, slug, 1)
      const body = t.body
      // The vault reader is verbatim, so identity here is byte equality — with
      // the writer's single appended newline tolerated, because adding it is the
      // writer's own documented normalisation and not an edit (R11.5).
      //
      // A note that matches only through `legacyBody` is the same note holding
      // pre-amendment bytes: leading and trailing whitespace collapse there, so
      // the match proves identity and not freshness. If an IMPORT wrote it, it is
      // re-stamped rather than reported unchanged (A-24) — otherwise a
      // whitespace-only edit to an imported note would be ignored for ever.
      //
      // If nothing says an import wrote it, it is not this item at all: a note
      // the owner typed can differ from a source file by nothing but a blank
      // line, and rewriting it would be a silent write to their own words. Such
      // a note is left exactly as it is and treated as an ordinary collision —
      // the walk moves on and this item lands on a `-2` sibling that says what it
      // collided with.
      const sameBytes = (stored: string): boolean => stored === body || stored === `${body}\n`
      const identity = legacyBody(body, true)
      const walk = walkCollisionChain<{
        path: string
        tags: string[]
        frontmatter: Record<string, unknown>
        stale: boolean
      }>(
        (n) => vaultPathAt(folder, slug, n),
        (candidate) => {
          if (!vault.exists(candidate)) return { taken: false }
          const read = vault.read?.(candidate)
          if (!read) return { taken: true }
          const exact = sameBytes(read.content)
          if (!exact && legacyBody(read.content, true) !== identity) return { taken: true }
          const frontmatter = read.frontmatter ?? {}
          const storedTags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : []
          if (!exact && !isImportersOwn(deps, 'vault', candidate, { tags: storedTags, frontmatter })) {
            return { taken: true }
          }
          return { taken: true, hit: { path: candidate, tags: storedTags, frontmatter, stale: !exact } }
        },
      )
      const today = new Date().toISOString().slice(0, 10)
      const summary = t.summary_one_line.trim()
      /** The frontmatter this import would write. `tags` is filled in per branch. */
      const frontmatterOf = (noteTags: string[]): Record<string, unknown> => ({
        title: t.title,
        tags: noteTags,
        tier,
        kind,
        ...(summary ? { summary } : {}),
        links: t.links,
        ...(t.aliases.length ? { aliases: t.aliases } : {}),
        created: t.created ?? today,
        updated: t.updated ?? today,
        source: t.source,
        ...(scope.projectId ? { project: scope.projectId } : {}),
        ...(scope.projectTypeId ? { projectType: scope.projectTypeId } : {}),
      })

      if (walk.hit) {
        // Two reasons to write over a note that is already here, and both keep
        // its path, its slug and its own frontmatter — what the note declares
        // wins over what this run would have written, so nothing is duplicated
        // and no metadata is lost:
        //   A-24, `stale`  — the bytes are the pre-amendment ones; the verbatim
        //                    body is stamped over them.
        //   A-8b, untagged — the full-body recompute now says the note holds a
        //                    credential and the stored note does not say so.
        const untagged = flagged && !walk.hit.tags.includes(SECRETS_TAG)
        if (walk.hit.stale || untagged) {
          const merged = {
            ...frontmatterOf(tags),
            ...walk.hit.frontmatter,
            tags: [...new Set([...walk.hit.tags, ...(flagged ? [SECRETS_TAG] : [])])],
          }
          vault.write(walk.hit.path, merged, body)
          return { status: 'applied', kind: `vault.${tier}`, ref: walk.hit.path, sha256: contentSha(body) }
        }
        return {
          status: 'unchanged',
          ref: walk.hit.path,
          importJobId: jobOf(walk.hit.tags),
          sha256: contentSha(body),
        }
      }
      const path = walk.free
      if (!path) return { status: 'error', error: WALK_EXHAUSTED, reasonCode: 'error' }
      if (path !== basePath) tags.push(`conflict-with:${basePath}`)

      vault.write(path, frontmatterOf(tags), body)
      // The digest travels into the ledger, so a rollback can tell an untouched
      // import from a note the owner has edited since.
      return { status: 'applied', kind: `vault.${tier}`, ref: path, sha256: contentSha(body) }
    }

    return { status: 'skipped', reason: `unsupported memory target: ${input.target}`, reasonCode: 'unsupported-target' }
  } catch (err) {
    return { status: 'error', error: failureReason(err), reasonCode: 'error' }
  }
}

/**
 * One path segment for a skill: never a traversal, never empty. Same rule as
 * `safeFolderSegment`, but a skill name may legitimately carry dots.
 */
function safeSkillSegment(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[.\-]+|[.\-]+$/g, '')
      .slice(0, 60)
      .replace(/[.\-]+$/g, '') || 'skill'
  )
}

/**
 * The bundled files live in their own directory, named after the skill and a
 * digest of the WHOLE package — the SKILL.md and every file travelling with it.
 * Two different packages that sanitise to the same name never share a folder,
 * re-importing the same package lands on the same one, and editing a bundled
 * script without touching SKILL.md gets its own directory instead of
 * overwriting the previous import's files in place.
 *
 * `assets` must already be the safe, sorted list that will actually be written:
 * the name identifies what lands on disk, not what the archive declared.
 */
function assetDirName(t: SkillTransformResult, safeName: string, assets: SkillAsset[]): string {
  return `${safeName}-${packageDigest(t, assets).slice(0, 8)}`
}

/**
 * The digest of the WHOLE package — the SKILL.md and every file travelling with
 * it. It names the asset directory (above) and is what the ledger records under
 * kind `skill-assets`, so the two can never say different things about the same
 * import (R11.6).
 *
 * `assets` must already be the safe, sorted list that will actually be written:
 * the digest identifies what lands on disk, not what the archive declared.
 */
export function packageDigest(t: SkillTransformResult, assets: SkillAsset[]): string {
  const h = createHash('sha256')
  h.update(t.rawSha256 ?? createHash('sha256').update(`${t.sourcePath}\n${t.content}`).digest('hex'))
  for (const a of assets) {
    h.update(a.relPath)
    h.update('\0')
    // The file's digest rather than its bytes: fixed-length, so the pre-image
    // stays unambiguous even for a binary asset whose content contains a NUL,
    // and a digest the scanner already computed need not be recomputed.
    h.update(a.sha256 ?? createHash('sha256').update(a.content).digest('hex'))
    h.update('\0')
  }
  return h.digest('hex')
}

/**
 * A bundled file may only land INSIDE its own asset directory. The package came
 * from outside — an archive, someone else's machine — and `writeAssets` joins
 * these names onto a real directory, so a `..` segment, a rooted path or a
 * Windows separator (which `join` would not split on POSIX) is a write outside
 * the import area. Such an entry is dropped, never sanitised: a renamed file is
 * not the file the skill body refers to.
 */
/**
 * Tags the importer owns, and a source file must never be able to forge. A
 * package declares its own `capabilities` / `tags` in frontmatter, and a
 * `capabilities LIKE 'content-sha:<sha>'` lookup cannot tell a declared tag
 * from a computed one — so without this filter a crafted package could
 * pre-claim another package's digest and make the genuine import report
 * `unchanged`, which is exactly the silent skip this wave exists to prevent.
 * Compared case-insensitively, because SQLite `LIKE` is.
 */
const RESERVED_CAPABILITY_PREFIXES = [
  'content-sha:',
  'conflict-with:',
  'skipped-unsafe-asset:',
  // Reserved too, or a package could declare `…:0` and mask its own strip count.
  'skipped-reserved-capability:',
  IMPORT_TAGS.sourcePrefix,
  IMPORT_TAGS.jobPrefix,
]
const RESERVED_CAPABILITIES = new Set<string>([IMPORT_TAGS.imported, 'source-changed'])
// `contains-secrets` is NOT reserved, for the same reason it is not in
// transform.ts's list: declaring it can only HIDE the package from recall, never
// expose anything, so a package that hand-tags itself keeps working.

/**
 * The digest capability the importer computes over an assembled skill body. It is
 * reserved against a package (below) and it is the ONE capability
 * `isImportersOwn` accepts as proof a stored skill is the importer's: 64 hex
 * characters nobody types by accident.
 *
 * Case-SENSITIVE, unlike the refusal test below. `createHash().digest('hex')`
 * only ever produces lowercase, so an uppercase spelling was not written by this
 * importer — and a witness that accepted it would hand someone else's skill to
 * the re-stamp. The refusal side stays case-insensitive on purpose: refusing a
 * forged label costs a package nothing, accepting one costs it its identity.
 */
export function isContentShaCapability(capability: string): boolean {
  return /^content-sha:[0-9a-f]{64}$/.test(capability.trim())
}

/**
 * What a PACKAGE may not declare. Broader than the provenance witness above on
 * purpose: refusing a forged tag costs a package one label, while accepting a
 * forged one would let it claim another package's identity.
 */
export function isReservedCapability(capability: string): boolean {
  const v = capability.trim().toLowerCase()
  return RESERVED_CAPABILITIES.has(v) || RESERVED_CAPABILITY_PREFIXES.some((prefix) => v.startsWith(prefix))
}

export function stripReservedCapabilities(declared: string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = []
  const dropped: string[] = []
  for (const c of declared) {
    if (isReservedCapability(c)) dropped.push(c)
    else kept.push(c)
  }
  return { kept, dropped }
}

export function isSafeAssetPath(relPath: string): boolean {
  if (typeof relPath !== 'string') return false
  const p = relPath.trim()
  if (!p || p.includes('\\') || p.includes('\0')) return false
  // Rooted on POSIX. A colon ANYWHERE, not only a leading drive letter: it also
  // spells an NTFS alternate data stream (`notes.txt:hidden`), and no legitimate
  // bundled file is named with one.
  if (p.startsWith('/') || p.includes(':')) return false
  // `.` and empty segments are noise that a join collapses — only `..` escapes,
  // so a legitimate `./scripts/a.py` is kept rather than silently dropped.
  const segments = p.split('/').filter((s) => s !== '' && s !== '.')
  return segments.length > 0 && segments.every((s) => s !== '..')
}

/**
 * Brings an already-stored skill up to date without duplicating it: the verbatim
 * body over pre-amendment bytes (A-24) and/or the `contains-secrets` capability
 * the full-body recompute now demands (A-8b / A-14).
 *
 * Answers whether anything was written. `false` when there is nothing to do —
 * and when the host wired no `restamp`, in which case the caller reports
 * `unchanged` rather than importing a second copy.
 */
function restampSkill(
  deps: ApplyDeps,
  stored: { id: string; capabilities?: string[] },
  input: { content: string; sha: string; stale: boolean; flagged: boolean },
): boolean {
  const untagged = input.flagged && !(stored.capabilities ?? []).includes(SECRETS_TAG)
  if (!input.stale && !untagged) return false
  if (!deps.skills?.restamp) return false
  deps.skills.restamp(stored.id, {
    content: input.content,
    sha: input.sha,
    addCapabilities: input.flagged ? [SECRETS_TAG] : [],
  })
  return true
}

export async function applySkillItem(
  deps: ApplyDeps,
  input: {
    jobId: string
    sourceProfile: SourceProfile
    /** The adapter that read the package, when it is not the job's own profile (R11.6). */
    adapterId?: SourceProfile | null
    transformed: SkillTransformResult
    /** The source file changed since a previous import of the same path. */
    sourceChanged?: boolean
  },
): Promise<ApplyResult> {
  if (!deps.skills) return { status: 'skipped', reason: 'skills service unavailable', reasonCode: 'service-unavailable' }
  const skills = deps.skills
  const t = input.transformed
  try {
    const safeName = safeSkillSegment(t.name)
    const declaredAssets: SkillAsset[] = t.assets ?? []
    // Validated BEFORE the writer sees them, and before the body inlines them:
    // an entry that would escape the asset directory is not written anywhere.
    const assets: SkillAsset[] = []
    const unsafePaths: string[] = []
    for (const asset of declaredAssets) {
      // The TRIMMED path is what is validated, so it is also what is written and
      // inlined: otherwise `" scripts/a.py"` passes the checks and then lands on
      // disk, and in the body heading, with its leading space.
      const relPath = typeof asset.relPath === 'string' ? asset.relPath.trim() : ''
      if (isSafeAssetPath(relPath)) assets.push(relPath === asset.relPath ? asset : { ...asset, relPath })
      else unsafePaths.push(asset.relPath)
    }
    const unsafeAssets = unsafePaths.length
    if (unsafeAssets > 0) {
      deps.logger?.warn?.(
        { jobId: input.jobId, skill: t.name, skipped: unsafeAssets, paths: unsafePaths.slice(0, 10) },
        'skill package: dropped bundled files whose path escapes the asset directory',
      )
    }
    // One byte-wise order for the digest, the disk and the body, so the result
    // does not depend on the order the scanner happened to walk the directory in.
    const sorted = sortAssetsByPath(assets)
    // Assets go to disk first: the body has to name the directory they landed in,
    // and a package with no writer still imports — just inlined only.
    const assetsDir = sorted.length && skills.writeAssets
      ? skills.writeAssets(assetDirName(t, safeName, sorted), sorted)
      : null
    // Files the SCANNER refused (too large, possible secrets) are named in the
    // body beside the ones that did travel: a package short a file has to say so
    // where the agent reading the skill will see it (A7.8).
    const notBundled = t.notBundled ?? []
    const content = assembleSkillContent(t.content, sorted, assetsDir, notBundled)
    // Over the body exactly as stored, so anyone holding the skill can recompute
    // the digest from it without knowing to trim first.
    const sha = contentSha(content)
    // What a package imported BEFORE R11.5 hashes to: the same files assembled
    // the pre-amendment way (P-13). Consulted only after the verbatim digest
    // misses (A-24).
    const legacySha = contentSha(assembleSkillContentLegacy(t.content, sorted, assetsDir, notBundled))
    const digest = packageDigest(t, sorted)
    const assetsRef = assetsDir ? { assetsDir } : {}
    // A-8 / A-14 — the authoritative secrets decision for a package.
    //
    // Three sources, first hit wins, so the common case costs nothing: the
    // scanner's own flag; the assembled body; then each bundled file on its own.
    // The last of those is what makes this independently authoritative — the
    // assembled body inlines a text asset only up to `MAX_INLINE_ASSET_CHARS`
    // and never inlines a binary one at all, so a credential in either tail is
    // invisible to a pass over the body alone.
    const flagged =
      Boolean(t.containsSecrets) ||
      looksLikeSecrets(t.sourcePath, content) ||
      sorted.some(
        (a) =>
          a.containsSecrets === true ||
          looksLikeSecrets(
            a.relPath,
            Buffer.isBuffer(a.content) ? a.content.toString('utf8') : a.content,
          ),
      )

    // Any earlier import of this exact body wins, whatever it was called then:
    // a package that came back under a new name is still the same skill.
    // Re-writing the assets above was a no-op — same digest, same directory,
    // same bytes — so returning here leaves nothing half-applied.
    let matched = sha
    let priorImport = skills.findByContentSha?.(sha) ?? null
    if (!priorImport) {
      const legacyHit = skills.findByContentSha?.(legacySha) ?? null
      if (legacyHit) {
        priorImport = legacyHit
        matched = legacySha
      }
    }
    if (priorImport) {
      const restamped = restampSkill(deps, priorImport, {
        content,
        sha,
        stale:
          matched !== sha &&
          isImportersOwn(deps, 'skill', priorImport.id, { capabilities: priorImport.capabilities }),
        flagged,
      })
      if (restamped) return { status: 'applied', kind: 'skill', ref: priorImport.id, sha256: sha, assetsSha256: digest, ...assetsRef }
      return {
        status: 'unchanged',
        ref: priorImport.id,
        importJobId: jobOf(priorImport.capabilities),
        sha256: matched,
        assetsSha256: digest,
        ...assetsRef,
      }
    }

    // Same name, same assembled body: this exact skill is already here. Kept
    // for the conflict tag below, and as the only check a caller that wires no
    // content lookup still gets. Compared through `legacyBody`, so a package
    // stored before R11.5 is still recognised as itself.
    // `findByName` answers with the newest USER-owned skill of that name, which
    // may well be one the owner wrote themselves. A body that differs from it
    // only in surrounding whitespace is NOT this package: rewriting it would be
    // a silent write to the owner's own skill, so it falls through to the create
    // path below and lands beside it with a `conflict-with:` capability.
    const existing = skills.findByName?.(t.name) ?? null
    const existingIsOurs = existing
      ? isImportersOwn(deps, 'skill', existing.id, { capabilities: existing.capabilities })
      : false
    if (
      existing &&
      legacyBody(existing.content, true) === legacyBody(content, true) &&
      (existing.content === content || existingIsOurs)
    ) {
      const restamped = restampSkill(deps, existing, {
        content,
        sha,
        stale: existing.content !== content,
        flagged,
      })
      // The files are on disk either way, so the caller is told where.
      if (restamped) return { status: 'applied', kind: 'skill', ref: existing.id, sha256: sha, assetsSha256: digest, ...assetsRef }
      return {
        status: 'unchanged',
        ref: existing.id,
        importJobId: jobOf(existing.capabilities),
        // The digest of what is actually stored, which is the pre-amendment
        // body when this hit came through the tolerant comparison above.
        sha256: contentSha(existing.content),
        assetsSha256: digest,
        ...assetsRef,
      }
    }

    // Dropping a declared tag is a decision about the operator's file, so it is
    // reported the same way a dropped asset is — visible, not just filtered.
    const { kept: declaredCapabilities, dropped: reservedCapabilities } = stripReservedCapabilities(
      t.capabilities,
    )
    if (reservedCapabilities.length > 0) {
      deps.logger?.warn?.(
        {
          jobId: input.jobId,
          skill: t.name,
          skipped: reservedCapabilities.length,
          capabilities: reservedCapabilities.slice(0, 10),
        },
        'skill package: dropped declared capabilities reserved for import provenance',
      )
    }

    const skill = skills.create({
      name: t.name,
      description: t.description,
      category: `${OWN_SKILLS_CATEGORY}/${safeName}`,
      triggerPatterns: t.trigger_patterns,
      capabilities: [
        ...new Set([
          // The source file's own declarations, minus anything it could use to
          // impersonate the importer's provenance.
          ...declaredCapabilities,
          ...baseTags(input.sourceProfile, input.jobId, input.adapterId),
          // What a later import looks itself up by.
          `content-sha:${sha}`,
          // R11.4 — the package is stored in full; recall is what hides it.
          ...(flagged ? [SECRETS_TAG] : []),
          ...(input.sourceChanged ? ['source-changed'] : []),
          // COUNTS BOTH CAUSES: a bundled path that escaped the asset
          // directory (refused here) and a file the scanner would not bundle at
          // all — too large, or possible secrets. The name says only the first;
          // what the operator needs from the number is how many files this
          // package is short, and the `### Not bundled` section in the body
          // names them one by one.
          ...(unsafeAssets + notBundled.length > 0
            ? [`skipped-unsafe-asset:${unsafeAssets + notBundled.length}`]
            : []),
          ...(reservedCapabilities.length > 0
            ? [`skipped-reserved-capability:${reservedCapabilities.length}`]
            : []),
          // The incumbent is left alone; the operator decides which one survives.
          ...(existing ? [`conflict-with:${existing.id}`] : []),
        ]),
      ],
      content,
      skillType: t.skill_type,
    })
    // Two digests, because the ledger records two rows: the skill body and, when
    // files travelled with it, the package that named the asset directory.
    return { status: 'applied', kind: 'skill', ref: skill.id, sha256: sha, assetsSha256: digest, ...assetsRef }
  } catch (err) {
    return { status: 'error', error: failureReason(err), reasonCode: 'error' }
  }
}

/** One path component's worth of id; a filesystem caps a single component. */
const MAX_AGENT_ID_CHARS = 60

/**
 * An agent id becomes a filesystem path, and every workspace helper throws on
 * anything outside `/^[a-z0-9_-]+$/i` (`prompt-wizard/workspace-paths.ts`), so a
 * persona called "Alpha Reviewer 2.0" — or a file called `My Reviewer.md` —
 * cannot carry that string into the id. The original text survives untouched as
 * the agent's display `name`.
 */
function safeAgentId(raw: string, relativePath: string): string {
  const id = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    // A whole paragraph pasted into `name:` is still a directory name on disk,
    // and filesystems cap a single component. Trimmed again after the cut,
    // because the 60th character can land inside a separator.
    .slice(0, MAX_AGENT_ID_CHARS)
    .replace(/-+$/g, '')
  if (id) return id
  // A name of nothing but punctuation still has to land somewhere, and on the
  // same id every time the same file is imported.
  return `persona-${createHash('sha256').update(relativePath).digest('hex').slice(0, 8)}`
}

/**
 * The persona's own frontmatter, kept on the agent row. Serialising it here
 * rather than at the registry keeps the shape one thing the importer decides:
 * a value that cannot be serialised (a cycle a YAML anchor built) costs the
 * provenance copy, never the import.
 */
function personaConfig(frontmatter: Record<string, unknown>, sourcePath: string): string | undefined {
  try {
    return JSON.stringify({ import: { sourcePath, sourceFrontmatter: frontmatter } })
  } catch {
    return undefined
  }
}

/**
 * A markdown persona (`.claude/agents/*.md` and its siblings) becomes an EYAS
 * agent. Imported personas are always `specialist` and `source: 'user'`: they
 * are the operator's own, they never join the addressable primary/team roster
 * on their own, and a later product update never overwrites them.
 */
export async function applyPersonaItem(
  deps: ApplyDeps,
  input: {
    jobId: string
    sourceProfile: SourceProfile
    /** The adapter that read the persona, when it is not the job's own profile (R11.6). */
    adapterId?: SourceProfile | null
    relativePath: string
    raw: string
    /** The source file changed since a previous import of the same path. */
    sourceChanged?: boolean
    /** The scan flagged a credential in the persona file (R11.4). */
    containsSecrets?: boolean
  },
): Promise<ApplyResult> {
  if (!deps.agents) return { status: 'skipped', reason: 'agent registry unavailable', reasonCode: 'service-unavailable' }
  const agents = deps.agents
  // `foo.agent.md` and `foo.md` are the same persona named `foo`.
  const stem = basename(input.relativePath.replace(/\\/g, '/')).replace(/\.(agent\.)?md$/i, '')
  // Tool names are checked against THIS instance's registry when one is wired:
  // a name that is not a tool here must not be handed to the agent as if it
  // were, or the agent runs with a list the runner filters down to nothing.
  const p = parsePersonaMarkdown(input.raw, stem, {
    ...(deps.toolRegistry ? { isKnownTool: (name: string) => deps.toolRegistry!.has(name) } : {}),
  })
  if (!p) return { status: 'skipped', reason: 'no frontmatter — not a persona', reasonCode: 'not-a-persona' }

  const baseId = safeAgentId(p.id, input.relativePath)

  try {
    // Walk the WHOLE chain, not just the base id. An earlier run may have parked
    // this exact prompt on a `-2` sibling — because the base id was already held
    // by an unrelated agent — and asking only for the first FREE id would then
    // add a `-3` on every rescan, forever. Same shape as the memory collision
    // walk in `applyMemoryItem`.
    const prompt = p.systemPrompt.trim()
    // The digest of the prompt as stored, so the ledger carries one for an agent
    // too (R11.6).
    const promptSha = contentSha(p.systemPrompt)
    const walk = walkCollisionChain<{ id: string; tags: string[]; storedPrompt: string }>(
      (n) => (n === 1 ? baseId : `${baseId}-${n}`),
      (candidate) => {
        const row = agents.get(candidate)
        if (!row) return { taken: false }
        return row.systemPrompt.trim() === prompt
          ? { taken: true, hit: { id: candidate, tags: row.tags ?? [], storedPrompt: row.systemPrompt } }
          : { taken: true }
      },
    )
    if (walk.hit) {
      return {
        status: 'unchanged',
        ref: walk.hit.id,
        importJobId: jobOf(walk.hit.tags),
        // The digest the hit was matched on: the prompt as STORED. The compare
        // above is tolerant (both sides trimmed), so the stored bytes need not be
        // the ones in hand, and the ledger must record what is actually there.
        sha256: contentSha(walk.hit.storedPrompt),
      }
    }
    const id = walk.free
    if (!id) return { status: 'error', error: WALK_EXHAUSTED, reasonCode: 'error' }

    if (p.unknownTools.length > 0) {
      deps.logger?.warn?.(
        { jobId: input.jobId, persona: baseId, unknownTools: p.unknownTools },
        'persona import: tool names with no EYAS equivalent were dropped; they are kept as claude-tool: tags',
      )
    }

    const tags = [
      ...baseTags(input.sourceProfile, input.jobId, input.adapterId),
      ...(input.sourceChanged ? ['source-changed'] : []),
      // A-8 — the authoritative decision, over the whole persona file rather
      // than the head the scan saw. Stored in full; recall is what hides it.
      ...(input.containsSecrets || looksLikeSecrets(input.relativePath, input.raw) ? [SECRETS_TAG] : []),
      // EVERY declared name, not only the unmapped ones: the original
      // declaration outlives any later change to the tool map, so the operator
      // can always see what the file actually asked for.
      ...p.originalTools.map((name) => `claude-tool:${name}`),
      // The incumbent is left alone; the operator decides which one survives.
      ...(id === baseId ? [] : [`conflict-with:${baseId}`]),
    ]

    const created = agents.create({
      id,
      name: p.name,
      role: p.role,
      description: p.description,
      goal: p.goal,
      backstory: '',
      systemPrompt: p.systemPrompt,
      capabilities: p.capabilities,
      // An empty list already means "the registry's default toolset" — it is
      // not a tool-less agent, so nothing is injected here.
      tools: p.tools ?? [],
      constraints: [],
      tier: 'specialist',
      agentType: p.agentType,
      source: 'user',
      enabled: true,
      tags: [...new Set(tags)],
      // Not a single word of the source is dropped: every frontmatter key the
      // agent row has no column for — `model`, `color`, `permissionMode` and
      // whatever the next assistant invents — is kept verbatim here.
      config: personaConfig(p.frontmatter, input.relativePath),
    })
    return { status: 'applied', kind: 'agent', ref: created.id, sha256: promptSha }
  } catch (err) {
    return { status: 'error', error: failureReason(err), reasonCode: 'error' }
  }
}

/** Workspace changes are always proposals — never direct merge. */
export async function applyWorkspaceProposal(
  deps: ApplyDeps,
  input: {
    jobId: string
    target: CandidateTarget
    title: string
    body: string
    /** Where the rules came from; carried into the title so the owner sees provenance. */
    sourcePath: string
    /** Leading YAML block of the source, kept verbatim above the body. */
    frontmatterYaml: string | null
    /** What the rule applies to (Cursor `globs`, Copilot `applyTo`), for the header. */
    scope?: string | null
    /** The source changed since an earlier import of it, flagged in the title. */
    sourceChanged?: boolean
    /** The scan flagged a credential in the rule file (R11.4); said in the title. */
    containsSecrets?: boolean
  },
): Promise<ApplyResult> {
  const file = workspaceFileForTarget(input.target)
  if (!file) return { status: 'skipped', reason: `not a workspace target: ${input.target}`, reasonCode: 'unsupported-target' }

  // The project-type prompt belongs to no agent: '-' marks the row as
  // workspace-wide, and the writer routes that file id to `project_types.prompt`.
  const agentId = input.target === 'prompt.project-type' ? '-' : deps.resolveDefaultAgentId()
  if (!agentId) return { status: 'skipped', reason: 'no agent available for workspace proposal', reasonCode: 'no-agent' }

  try {
    const existing = deps.readWorkspaceFile?.(agentId, file) ?? null
    // Frontmatter is never dropped: it rides along as a fenced block so the
    // owner can see what the source declared before approving the append.
    // Captured as it stands, not trimmed: the block the owner approves is the
    // block the source declared, byte for byte (R11.5).
    const proposed = input.frontmatterYaml
      ? '```yaml\n' + input.frontmatterYaml + '\n```\n\n' + input.body
      : input.body
    // A rule that declares what it applies to says so in the header it lands
    // under (A4.2), so the owner reads the scope before approving the append.
    const scope = typeof input.scope === 'string' ? input.scope.trim() : ''
    // A-8 — the authoritative decision, over the whole rule file.
    const flagged = input.containsSecrets || looksLikeSecrets(input.sourcePath, proposed)
    const title =
      `${input.title} (${input.sourcePath}${scope ? `; applies to: ${scope}` : ''})` +
      (input.sourceChanged ? ' [source-changed]' : '') +
      // The owner is about to append this to an agent's own instructions, so the
      // card says up front that it carries a credential.
      (flagged ? ` [${SECRETS_TAG}]` : '')

    // The same file imported twice before anyone answered the first card is one
    // decision, not two: the pending proposal already carries this exact body.
    const duplicate = deps.findPendingProposal?.({ agentId, workspaceFile: file, proposedBody: proposed })
    if (duplicate) {
      return {
        status: 'unchanged',
        ref: duplicate.id,
        reasonCode: 'unchanged',
        importJobId: duplicate.jobId ?? null,
        // The digest the hit was matched on: the card as STORED. The compare is
        // tolerant (`legacyBody` on both sides), so a card written before R11.5
        // holds trimmed bytes and the ledger must say so rather than claim the
        // digest of the body this run would have proposed.
        sha256: contentSha(duplicate.proposedBody ?? proposed),
      }
    }

    const proposalId = deps.createProposal({
      jobId: input.jobId,
      agentId,
      workspaceFile: file,
      title,
      proposedBody: proposed,
      existingBody: existing,
    })
    return { status: 'proposal', proposalId, workspaceFile: file, sha256: contentSha(proposed) }
  } catch (err) {
    return { status: 'error', error: failureReason(err), reasonCode: 'error' }
  }
}
