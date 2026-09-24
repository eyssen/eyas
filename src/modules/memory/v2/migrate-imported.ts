// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One-shot ingest of the live vault + episodic tables into L0, using the same
// writer the capture path uses. Deterministic ULIDs so a re-run is a no-op.
// Spec §14 / §16-7: data-port imports the owner performed are trust_tier=owner.
// A vault note carries the trust and the project scope its vault_index row
// holds (vault/vault-trust.ts, the indexer's folder rule): a note a model
// wrote is 'derived', and a project note stays in its project instead of
// becoming global memory.
// A note or episodic row tagged contains-secrets becomes a unit with
// `secrets`, so its L0 row — and everything later derived from it — carries
// the secrets marker (d1.ts) and stays out of recall by default.

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { generateIdAt } from '@shared/crypto'
import type { CaptureUnit, TrustTier } from './ingest-bridge.js'
import type { MemoryIngest } from './ingest.js'
import type { VaultService } from '../vault/vault-service.js'
import { parseVaultFile } from '../vault/frontmatter.js'
import { deriveVaultTrust, noteHasCaptureLink } from '../vault/vault-trust.js'
import { hasSecretsTag, SECRETS_TAG } from '../memory-index.js'
import { effectiveProjectId } from '../types.js'

export function vaultConversationId(relPath: string): string {
  return `vault:${relPath.replace(/\\/g, '/')}`
}

function legacyRandom(seed: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(seed).digest().subarray(0, 10))
}

export function legacyId(ms: number, seed: string): string {
  const t = Number.isInteger(ms) && ms >= 0 ? Math.min(ms, 2 ** 48 - 1) : 0
  return generateIdAt(t, legacyRandom(seed))
}

export function toEpochMs(value: string | number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e11 ? Math.round(value * 1000) : Math.round(value)
  if (typeof value !== 'string' || !value.trim()) return 0
  let s = value.trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = `${s.replace(' ', 'T')}Z`
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = `${s}T00:00:00Z`
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? 0 : ms
}

export function buildVaultDocumentUnit(input: {
  relPath: string
  content: string
  occurredAtMs: number
  projectId?: string | null
  projectTypeId?: string | null
  /** The note's stored trust (vault_index.trust_tier); default 'owner'. */
  trust?: TrustTier
  /** The note is tagged contains-secrets (see vaultNoteHoldsSecrets). */
  secrets?: boolean
}): CaptureUnit {
  const rel = input.relPath.replace(/\\/g, '/')
  const occurredAtMs = toEpochMs(input.occurredAtMs) || 1
  const trust = input.trust ?? 'owner'
  return {
    id: legacyId(occurredAtMs, `legacy:vault_index:${rel}`),
    sourceType: 'document',
    // The owner's own note, or one an EYAS writer (a model) authored.
    actor: trust === 'owner' ? 'owner' : 'vault',
    conversationId: vaultConversationId(rel),
    projectId: input.projectId ?? null,
    projectTypeId: input.projectTypeId ?? null,
    occurredAtMs,
    content: input.content,
    trustTier: trust,
    shredPartitionId: `vault:${rel}`,
    meta: { origin: 'vault', path: rel },
    secrets: input.secrets === true,
  }
}

/** What L0 records about a vault note besides its text. */
export interface VaultNoteProvenance {
  trust: TrustTier
  projectId: string | null
  projectTypeId: string | null
}

/**
 * A note's provenance as the indexer stored it (trust, project, project
 * type). A note the indexer has not reached yet is judged by its own
 * frontmatter and capture link, the same derivation the indexer runs; only
 * the folder rule (which needs the board) is then missing.
 */
export function vaultNoteProvenance(db: EyasDb, relPath: string, content: string): VaultNoteProvenance {
  const rel = relPath.replace(/\\/g, '/')
  try {
    const row = (db as any).all(sql`SELECT trust_tier, project_id, project_type_id FROM vault_index WHERE path = ${rel}`)[0] as {
      trust_tier: string | null
      project_id: string | null
      project_type_id: string | null
    } | undefined
    if (row?.trust_tier) {
      return {
        trust: row.trust_tier as TrustTier,
        projectId: effectiveProjectId(row.project_id ?? null),
        projectTypeId: row.project_type_id ?? null,
      }
    }
  } catch {
    /* no vault_index (or no trust column) on this database: the frontmatter decides */
  }
  try {
    const fm = parseVaultFile(content).frontmatter
    return {
      trust: deriveVaultTrust({ frontmatter: fm, captureLinked: noteHasCaptureLink(db, rel) }),
      projectId: effectiveProjectId(fm.project ?? null),
      projectTypeId: fm.projectType ?? null,
    }
  } catch {
    // Unparseable frontmatter declares nothing; the capture link still counts.
    return { trust: noteHasCaptureLink(db, rel) ? 'derived' : 'owner', projectId: null, projectTypeId: null }
  }
}

/**
 * Whether a vault note holds credentials: its vault_index row or its own
 * frontmatter carries contains-secrets. Either one is enough (fail closed), so
 * a note the indexer has not reached yet is still judged by its frontmatter.
 */
export function vaultNoteHoldsSecrets(db: EyasDb, relPath: string, content: string): boolean {
  const rel = relPath.replace(/\\/g, '/')
  try {
    const row = (db as any).all(sql`SELECT tags FROM vault_index WHERE path = ${rel}`)[0] as { tags: string | null } | undefined
    if (hasSecretsTag(row?.tags)) return true
  } catch {
    /* no vault_index on this database: the frontmatter decides */
  }
  try {
    return parseVaultFile(content).frontmatter.tags.includes(SECRETS_TAG)
  } catch {
    return false // unparseable frontmatter carries no tags
  }
}

function alreadyHave(db: EyasDb, id: string): boolean {
  return ((db as any).all(sql`SELECT 1 AS ok FROM memory_item WHERE id = ${id} LIMIT 1`) as Array<{ ok: number }>).length > 0
}

export interface MigrateImportedDeps {
  db: EyasDb
  ingest: MemoryIngest
  vault: VaultService
  logger?: Logger
}

export interface MigrateImportedResult {
  vault: number
  episodic: number
  skipped: number
}

async function flushBatch(ingest: MemoryIngest, units: CaptureUnit[]): Promise<void> {
  if (units.length === 0) return
  for (const unit of units) ingest.enqueue(unit)
  ingest.flushAll('manual')
  await new Promise<void>((r) => setTimeout(r, 0))
}

export async function migrateImportedIntoL0(deps: MigrateImportedDeps): Promise<MigrateImportedResult> {
  const { db, ingest, vault } = deps
  const out: MigrateImportedResult = { vault: 0, episodic: 0, skipped: 0 }
  const base = vault.getBasePath()
  const BATCH = 8
  let batch: CaptureUnit[] = []

  for (const rel of vault.listFiles()) {
    const full = join(base, rel)
    let content: string
    let occurredAtMs: number
    try {
      content = readFileSync(full, 'utf-8')
      occurredAtMs = Math.round(statSync(full).mtimeMs)
    } catch (err) {
      deps.logger?.warn?.({ err, path: rel }, 'L0 migrate: vault file unreadable')
      continue
    }
    const probe = buildVaultDocumentUnit({ relPath: rel, content, occurredAtMs })
    if (alreadyHave(db, probe.id)) {
      out.skipped++
      continue
    }
    const unit = buildVaultDocumentUnit({
      relPath: rel,
      content,
      occurredAtMs,
      ...vaultNoteProvenance(db, rel, content),
      secrets: vaultNoteHoldsSecrets(db, rel, content),
    })
    batch.push(unit)
    out.vault++
    if (batch.length >= BATCH) {
      await flushBatch(ingest, batch)
      batch = []
      if (out.vault % 64 === 0) deps.logger?.info?.({ vault: out.vault, skipped: out.skipped }, 'L0 migrate: vault progress')
    }
  }
  await flushBatch(ingest, batch)
  batch = []

  const episodic = (db as any).all(sql`SELECT id, content, source_type, conversation_id, project_id, valid_from, created_at, tags
    FROM episodic_memories`) as Array<{
    id: string
    content: string
    tags: string | null
    source_type: string
    conversation_id: string | null
    project_id: string | null
    valid_from: string
    created_at: string
  }>
  for (const row of episodic) {
    const occurredAtMs = toEpochMs(row.valid_from) || toEpochMs(row.created_at) || 1
    const conversationId = row.conversation_id || `legacy-episodic:${row.id}`
    const unit: CaptureUnit = {
      id: legacyId(occurredAtMs, `legacy:episodic_memories:${row.id}`),
      sourceType: 'legacy_episodic',
      actor: 'owner',
      conversationId,
      projectId: row.project_id ?? null,
      projectTypeId: null,
      occurredAtMs,
      content: row.content,
      trustTier: 'owner',
      shredPartitionId: conversationId,
      meta: { origin: 'episodic', episodicId: row.id, sourceType: row.source_type },
      secrets: hasSecretsTag(row.tags),
    }
    if (alreadyHave(db, unit.id)) {
      out.skipped++
      continue
    }
    batch.push(unit)
    out.episodic++
    if (batch.length >= BATCH) {
      await flushBatch(ingest, batch)
      batch = []
      if (out.episodic % 64 === 0) deps.logger?.info?.({ episodic: out.episodic, skipped: out.skipped }, 'L0 migrate: episodic progress')
    }
  }
  await flushBatch(ingest, batch)
  return out
}
