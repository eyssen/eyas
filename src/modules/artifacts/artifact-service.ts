// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type {
  Artifact,
  ArtifactKind,
  ArtifactPayloadMap,
  ArtifactRef,
  ArtifactRefType,
  ArtifactVersion,
} from './types.js'
import { isKnownKind, validatePayload } from './validators/index.js'

export class ArtifactValidationError extends Error {
  constructor(
    public readonly kind: string,
    public readonly issues: unknown,
  ) {
    super(`Artifact payload failed validation for kind "${kind}"`)
    this.name = 'ArtifactValidationError'
  }
}

export class UnknownArtifactKindError extends Error {
  constructor(kind: string) {
    super(`Unknown artifact kind: "${kind}"`)
    this.name = 'UnknownArtifactKindError'
  }
}

function rowToArtifact<K extends ArtifactKind = ArtifactKind>(r: any): Artifact<K> {
  let consumedBy: string[] = []
  try {
    consumedBy = r.consumed_by ? JSON.parse(r.consumed_by) : []
  } catch {
    consumedBy = []
  }
  return {
    id: r.id,
    sessionId: r.session_id ?? null,
    kind: r.kind as K,
    title: r.title,
    currentVersion: Number(r.current_version),
    producedBy: r.produced_by ?? null,
    consumedBy,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

function rowToVersion(r: any): ArtifactVersion {
  let payload: unknown = null
  try {
    payload = r.payload ? JSON.parse(r.payload) : null
  } catch {
    payload = null
  }
  return {
    id: Number(r.id),
    artifactId: r.artifact_id,
    version: Number(r.version),
    payload,
    createdAt: Number(r.created_at),
    createdBy: r.created_by ?? null,
    changeNote: r.change_note ?? null,
  }
}

function rowToRef(r: any): ArtifactRef {
  return {
    fromArtifact: r.from_artifact,
    toArtifact: r.to_artifact,
    refType: r.ref_type as ArtifactRefType,
  }
}

export interface CreateArtifactInput<K extends ArtifactKind = ArtifactKind> {
  sessionId: string | null
  kind: K
  title: string
  payload: ArtifactPayloadMap[K]
  producedBy?: string | null
  changeNote?: string
}

export interface ArtifactService {
  create<K extends ArtifactKind>(input: CreateArtifactInput<K>): Artifact<K>
  update<K extends ArtifactKind>(
    id: string,
    payload: ArtifactPayloadMap[K],
    actor: string | null,
    note?: string,
  ): Artifact<K>
  get(id: string): Artifact | null
  getWithPayload(id: string): Artifact | null
  getLatestVersion(id: string): ArtifactVersion | null
  listVersions(id: string): ArtifactVersion[]
  listByKind(kind: ArtifactKind, sessionId?: string): Artifact[]
  listBySession(sessionId: string): Artifact[]
  markConsumedBy(id: string, agentId: string): void
  link(fromId: string, toId: string, type: ArtifactRefType): void
  backlinks(id: string): Artifact[]
  forwardLinks(id: string): Artifact[]
}

export function createArtifactService(db: EyasDb): ArtifactService {
  function runValidation(kind: ArtifactKind, payload: unknown) {
    const result = validatePayload(kind, payload)
    if (!result.success) {
      throw new ArtifactValidationError(kind, result.error.issues)
    }
    return result.data as unknown
  }

  function mustGet(id: string): Artifact {
    const a = service.get(id)
    if (!a) throw new Error(`Artifact not found: ${id}`)
    return a
  }

  const service: ArtifactService = {
    create<K extends ArtifactKind>(input: CreateArtifactInput<K>): Artifact<K> {
      if (!isKnownKind(input.kind)) {
        throw new UnknownArtifactKindError(input.kind)
      }
      const validated = runValidation(input.kind, input.payload)
      const id = generateId()
      const now = Date.now()
      db.run(sql`INSERT INTO artifacts (
        id, session_id, kind, title, current_version, produced_by, consumed_by, created_at, updated_at
      ) VALUES (
        ${id}, ${input.sessionId ?? null}, ${input.kind}, ${input.title}, 1,
        ${input.producedBy ?? null}, ${'[]'}, ${now}, ${now}
      )`)
      db.run(sql`INSERT INTO artifact_versions (
        artifact_id, version, payload, created_at, created_by, change_note
      ) VALUES (
        ${id}, 1, ${JSON.stringify(validated)}, ${now},
        ${input.producedBy ?? null}, ${input.changeNote ?? null}
      )`)
      const artifact = mustGet(id) as Artifact<K>
      artifact.payload = validated as ArtifactPayloadMap[K]
      return artifact
    },

    update<K extends ArtifactKind>(
      id: string,
      payload: ArtifactPayloadMap[K],
      actor: string | null,
      note?: string,
    ): Artifact<K> {
      const existing = mustGet(id) as Artifact<K>
      const validated = runValidation(existing.kind, payload)
      const nextVersion = existing.currentVersion + 1
      const now = Date.now()
      db.run(sql`INSERT INTO artifact_versions (
        artifact_id, version, payload, created_at, created_by, change_note
      ) VALUES (
        ${id}, ${nextVersion}, ${JSON.stringify(validated)}, ${now},
        ${actor ?? null}, ${note ?? null}
      )`)
      db.run(sql`UPDATE artifacts
        SET current_version = ${nextVersion}, updated_at = ${now}
        WHERE id = ${id}`)
      const updated = mustGet(id) as Artifact<K>
      updated.payload = validated as ArtifactPayloadMap[K]
      return updated
    },

    get(id: string): Artifact | null {
      const rows = (db as any).all(sql`SELECT * FROM artifacts WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToArtifact(rows[0]) : null
    },

    getWithPayload(id: string): Artifact | null {
      const a = service.get(id)
      if (!a) return null
      const latest = service.getLatestVersion(id)
      if (latest) a.payload = latest.payload as any
      return a
    },

    getLatestVersion(id: string): ArtifactVersion | null {
      const rows = (db as any).all(sql`SELECT * FROM artifact_versions
        WHERE artifact_id = ${id}
        ORDER BY version DESC
        LIMIT 1`) as any[]
      return rows.length > 0 ? rowToVersion(rows[0]) : null
    },

    listVersions(id: string): ArtifactVersion[] {
      const rows = (db as any).all(sql`SELECT * FROM artifact_versions
        WHERE artifact_id = ${id}
        ORDER BY version ASC`) as any[]
      return rows.map(rowToVersion)
    },

    listByKind(kind: ArtifactKind, sessionId?: string): Artifact[] {
      const rows = sessionId
        ? ((db as any).all(sql`SELECT * FROM artifacts
          WHERE kind = ${kind} AND session_id = ${sessionId}
          ORDER BY created_at DESC`) as any[])
        : ((db as any).all(sql`SELECT * FROM artifacts
          WHERE kind = ${kind}
          ORDER BY created_at DESC`) as any[])
      return rows.map(rowToArtifact)
    },

    listBySession(sessionId: string): Artifact[] {
      const rows = (db as any).all(sql`SELECT * FROM artifacts
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC`) as any[]
      return rows.map(rowToArtifact)
    },

    markConsumedBy(id: string, agentId: string): void {
      const existing = mustGet(id)
      if (existing.consumedBy.includes(agentId)) return
      const next = [...existing.consumedBy, agentId]
      const now = Date.now()
      db.run(sql`UPDATE artifacts
        SET consumed_by = ${JSON.stringify(next)}, updated_at = ${now}
        WHERE id = ${id}`)
    },

    link(fromId: string, toId: string, type: ArtifactRefType): void {
      mustGet(fromId)
      mustGet(toId)
      if (fromId === toId) {
        throw new Error('Cannot link an artifact to itself')
      }
      db.run(sql`INSERT OR IGNORE INTO artifact_refs (from_artifact, to_artifact, ref_type)
        VALUES (${fromId}, ${toId}, ${type})`)
    },

    backlinks(id: string): Artifact[] {
      const rows = (db as any).all(sql`SELECT a.* FROM artifact_refs r
        JOIN artifacts a ON a.id = r.from_artifact
        WHERE r.to_artifact = ${id}
        ORDER BY a.created_at DESC`) as any[]
      return rows.map(rowToArtifact)
    },

    forwardLinks(id: string): Artifact[] {
      const rows = (db as any).all(sql`SELECT a.* FROM artifact_refs r
        JOIN artifacts a ON a.id = r.to_artifact
        WHERE r.from_artifact = ${id}
        ORDER BY a.created_at DESC`) as any[]
      return rows.map(rowToArtifact)
    },
  }

  return service
}

// Re-export for tests that want to spot-check the low-level row converters.
export const __internals = { rowToArtifact, rowToVersion, rowToRef }
