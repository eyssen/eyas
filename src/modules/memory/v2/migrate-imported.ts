// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One-shot ingest of the live vault + episodic tables into L0, using the same
// writer the capture path uses. Deterministic ULIDs so a re-run is a no-op.
// Spec §14 / §16-7: data-port imports the owner performed are trust_tier=owner.

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { generateIdAt } from '@shared/crypto'
import type { CaptureUnit } from './ingest-bridge.js'
import type { MemoryIngest } from './ingest.js'
import type { VaultService } from '../vault/vault-service.js'

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
}): CaptureUnit {
  const rel = input.relPath.replace(/\\/g, '/')
  const occurredAtMs = toEpochMs(input.occurredAtMs) || 1
  return {
    id: legacyId(occurredAtMs, `legacy:vault_index:${rel}`),
    sourceType: 'document',
    actor: 'owner',
    conversationId: vaultConversationId(rel),
    projectId: input.projectId ?? null,
    projectTypeId: input.projectTypeId ?? null,
    occurredAtMs,
    content: input.content,
    trustTier: 'owner',
    shredPartitionId: `vault:${rel}`,
    meta: { origin: 'vault', path: rel },
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
    const unit = buildVaultDocumentUnit({ relPath: rel, content, occurredAtMs })
    if (alreadyHave(db, unit.id)) {
      out.skipped++
      continue
    }
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

  const episodic = (db as any).all(sql`SELECT id, content, source_type, conversation_id, project_id, valid_from, created_at
    FROM episodic_memories`) as Array<{
    id: string
    content: string
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
