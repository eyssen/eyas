// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { connectionSecretName, getSystemType } from './catalog.js'
import type {
  Connection,
  ConnectionAdapter,
  ConnectionHealth,
  ConnectionScope,
  ConnectionSource,
  ConnectionStatus,
  CreateConnectionInput,
  ListConnectionsFilter,
  UpdateConnectionInput,
} from './types.js'

export interface SecretsLike {
  get(name: string, scope: string, requester?: unknown): Promise<string | null>
  set(name: string, scope: string, value: string, module?: string, requester?: unknown): Promise<void>
  has?(name: string, scope: string, requester?: unknown): Promise<boolean>
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function rowToConnection(row: any): Connection {
  return {
    id: row.id,
    name: row.name,
    systemType: row.system_type,
    adapter: row.adapter as ConnectionAdapter,
    config: parseJson(row.config, {}),
    secretRefs: parseJson(row.secret_refs, []),
    status: row.status as ConnectionStatus,
    health: {
      lastCheckedAt: row.last_checked_at ?? null,
      lastOkAt: row.last_ok_at ?? null,
      lastError: row.last_error ?? null,
    },
    scope: parseJson(row.scope, {}),
    source: (row.source ?? 'user') as ConnectionSource,
    approvalId: row.approval_id != null ? Number(row.approval_id) : null,
    reason: row.reason ?? null,
    createdBy: row.created_by ?? null,
    approvedAt: row.approved_at ?? null,
    approvedBy: row.approved_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function inScope(conn: Connection, filter: ListConnectionsFilter): boolean {
  if (filter.includePending === false && conn.status === 'pending') return false
  if (filter.systemType && conn.systemType !== filter.systemType) return false
  if (filter.status && conn.status !== filter.status) return false

  const scope = conn.scope ?? {}
  if (scope.default === true || (!scope.agentIds?.length && !scope.projectIds?.length)) {
    // Unscoped / default: visible unless agent/project filter requires match on a restricted list
    if (!filter.agentId && !filter.projectId) return true
    if (scope.default === true) return true
    if (!scope.agentIds?.length && !scope.projectIds?.length) return true
  }

  if (filter.agentId && scope.agentIds?.length) {
    if (!scope.agentIds.includes(filter.agentId)) return false
  }
  if (filter.projectId && scope.projectIds?.length) {
    if (!scope.projectIds.includes(filter.projectId)) return false
  }
  return true
}

export interface ConnectionsService {
  list(filter?: ListConnectionsFilter): Connection[]
  get(id: string): Connection | null
  create(input: CreateConnectionInput, opts?: { secrets?: SecretsLike }): Promise<Connection>
  update(id: string, input: UpdateConnectionInput, opts?: { secrets?: SecretsLike }): Promise<Connection>
  remove(id: string): boolean
  /** Mark pending → unknown (ready for test). */
  approve(id: string, approvedBy?: string, approvalId?: number | null): Connection
  reject(id: string): boolean
  setApprovalId(id: string, approvalId: number): Connection
  setHealth(id: string, health: Partial<ConnectionHealth> & { status: ConnectionStatus }): Connection
  resolveSecrets(conn: Connection, secrets: SecretsLike): Promise<Record<string, string>>
}

export function createConnectionsService(db: EyasDb): ConnectionsService {
  return {
    list(filter = {}) {
      const rows = db.all(sql`SELECT * FROM connections ORDER BY updated_at DESC`) as any[]
      return rows.map(rowToConnection).filter((c) => inScope(c, filter))
    },

    get(id) {
      const rows = db.all(sql`SELECT * FROM connections WHERE id = ${id}`) as any[]
      if (!rows[0]) return null
      return rowToConnection(rows[0])
    },

    async create(input, opts) {
      const catalog = getSystemType(input.systemType)
      if (!catalog) {
        throw new Error(`Unknown system type: ${input.systemType}`)
      }
      const name = input.name?.trim()
      if (!name) throw new Error('name is required')

      const id = generateId()
      const adapter = input.adapter ?? catalog.adapter
      const config = input.config ?? {}
      const scope = input.scope ?? { default: true }
      const source = input.source ?? 'user'
      const pending = input.pending === true || source === 'agent'
      const status: ConnectionStatus = pending ? 'pending' : 'unknown'
      const now = new Date().toISOString()

      // Build secret refs: explicit + from secrets map keys + catalog fields present
      const secretRefs = new Set<string>(input.secretRefs ?? [])
      const secretsMap = input.secrets ?? {}

      if (opts?.secrets && Object.keys(secretsMap).length > 0) {
        for (const [field, value] of Object.entries(secretsMap)) {
          if (!value) continue
          const vaultName = connectionSecretName(id, field)
          await opts.secrets.set(vaultName, 'system', value, 'connections')
          secretRefs.add(vaultName)
        }
      } else if (input.secretRefs?.length) {
        for (const ref of input.secretRefs) secretRefs.add(ref)
      }

      db.run(sql`
        INSERT INTO connections (
          id, name, system_type, adapter, config, secret_refs, status,
          scope, source, reason, created_by, created_at, updated_at
        ) VALUES (
          ${id},
          ${name},
          ${input.systemType},
          ${adapter},
          ${JSON.stringify(config)},
          ${JSON.stringify([...secretRefs])},
          ${status},
          ${JSON.stringify(scope)},
          ${source},
          ${input.reason ?? null},
          ${input.createdBy ?? null},
          ${now},
          ${now}
        )
      `)

      return this.get(id)!
    },

    async update(id, input, opts) {
      const existing = this.get(id)
      if (!existing) throw new Error(`Connection ${id} not found`)

      const name = input.name?.trim() ?? existing.name
      const config = input.config ?? existing.config
      const scope = input.scope ?? existing.scope
      const status = input.status ?? existing.status
      const reason = input.reason !== undefined ? input.reason : existing.reason
      let secretRefs = [...existing.secretRefs]

      if (input.secretRefs) {
        secretRefs = [...input.secretRefs]
      }

      if (opts?.secrets && input.secrets) {
        for (const [field, value] of Object.entries(input.secrets)) {
          if (!value) continue
          const vaultName = connectionSecretName(id, field)
          await opts.secrets.set(vaultName, 'system', value, 'connections')
          if (!secretRefs.includes(vaultName)) secretRefs.push(vaultName)
        }
      }

      const now = new Date().toISOString()
      db.run(sql`
        UPDATE connections SET
          name = ${name},
          config = ${JSON.stringify(config)},
          secret_refs = ${JSON.stringify(secretRefs)},
          status = ${status},
          scope = ${JSON.stringify(scope)},
          reason = ${reason},
          updated_at = ${now}
        WHERE id = ${id}
      `)

      return this.get(id)!
    },

    remove(id) {
      const existing = this.get(id)
      if (!existing) return false
      db.run(sql`DELETE FROM connections WHERE id = ${id}`)
      return true
    },

    approve(id, approvedBy, approvalId) {
      const existing = this.get(id)
      if (!existing) throw new Error(`Connection ${id} not found`)
      if (existing.status !== 'pending') {
        // Idempotent: already approved
        return existing
      }
      const now = new Date().toISOString()
      const aid = approvalId ?? existing.approvalId
      db.run(sql`
        UPDATE connections SET
          status = 'unknown',
          approved_at = ${now},
          approved_by = ${approvedBy ?? null},
          approval_id = ${aid},
          updated_at = ${now}
        WHERE id = ${id}
      `)
      return this.get(id)!
    },

    reject(id) {
      const existing = this.get(id)
      if (!existing) return false
      db.run(sql`DELETE FROM connections WHERE id = ${id}`)
      return true
    },

    setApprovalId(id, approvalId) {
      const existing = this.get(id)
      if (!existing) throw new Error(`Connection ${id} not found`)
      const now = new Date().toISOString()
      db.run(sql`
        UPDATE connections SET approval_id = ${approvalId}, updated_at = ${now}
        WHERE id = ${id}
      `)
      return this.get(id)!
    },

    setHealth(id, health) {
      const existing = this.get(id)
      if (!existing) throw new Error(`Connection ${id} not found`)
      const now = new Date().toISOString()
      const lastChecked = health.lastCheckedAt ?? now
      const lastOk = health.status === 'connected' ? (health.lastOkAt ?? now) : existing.health.lastOkAt
      const lastError = health.lastError ?? null
      db.run(sql`
        UPDATE connections SET
          status = ${health.status},
          last_checked_at = ${lastChecked},
          last_ok_at = ${lastOk},
          last_error = ${lastError},
          updated_at = ${now}
        WHERE id = ${id}
      `)
      return this.get(id)!
    },

    async resolveSecrets(conn, secrets) {
      const out: Record<string, string> = {}
      for (const ref of conn.secretRefs) {
        try {
          const v = await secrets.get(ref, 'system', { trusted: true })
          if (v) out[ref] = v
        } catch {
          // skip missing
        }
      }
      // Also map short field names from catalog pattern
      const catalog = getSystemType(conn.systemType)
      if (catalog) {
        for (const field of catalog.secretFields) {
          const vaultName = connectionSecretName(conn.id, field.name)
          if (out[vaultName]) {
            out[field.name] = out[vaultName]
          } else {
            try {
              const v = await secrets.get(vaultName, 'system', { trusted: true })
              if (v) {
                out[vaultName] = v
                out[field.name] = v
              }
            } catch { /* */ }
          }
        }
      }
      return out
    },
  }
}
