// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { RemoteNode, CreateNodeInput, UpdateNodeInput } from './types.js'

export interface NodeRegistry {
  create(input: CreateNodeInput): RemoteNode
  get(id: string): RemoteNode | null
  list(): RemoteNode[]
  update(id: string, input: UpdateNodeInput): RemoteNode
  remove(id: string): void
}

function rowToNode(row: any): RemoteNode {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    connectionType: row.connection_type,
    capabilities: JSON.parse(row.capabilities ?? '[]'),
    status: row.status,
    lastSeen: row.last_seen,
    config: row.config ? JSON.parse(row.config) : null,
    createdAt: row.created_at,
  }
}

export function createNodeRegistry(db: EyasDb): NodeRegistry {
  return {
    create(input) {
      const id = generateId()
      const capabilities = JSON.stringify(input.capabilities ?? [])
      const config = input.config ? JSON.stringify(input.config) : null
      const connectionType = input.connectionType ?? 'ssh'

      db.run(sql`INSERT INTO remote_nodes (id, name, host, connection_type, capabilities, config)
        VALUES (${id}, ${input.name}, ${input.host}, ${connectionType}, ${capabilities}, ${config})`)

      return this.get(id)!
    },

    get(id) {
      const rows = db.all(sql`SELECT * FROM remote_nodes WHERE id = ${id}`) as any[]
      if (rows.length === 0) return null
      return rowToNode(rows[0])
    },

    list() {
      const rows = db.all(sql`SELECT * FROM remote_nodes ORDER BY created_at DESC`) as any[]
      return rows.map(rowToNode)
    },

    update(id, input) {
      const node = this.get(id)
      if (!node) throw new Error(`Node ${id} not found`)

      const name = input.name ?? node.name
      const host = input.host ?? node.host
      const connectionType = input.connectionType ?? node.connectionType
      const capabilities = JSON.stringify(input.capabilities ?? node.capabilities)
      const status = input.status ?? node.status
      const config = input.config ? JSON.stringify(input.config) : (node.config ? JSON.stringify(node.config) : null)
      const lastSeen = input.status === 'online' ? new Date().toISOString() : node.lastSeen

      db.run(sql`UPDATE remote_nodes SET name = ${name}, host = ${host}, connection_type = ${connectionType},
        capabilities = ${capabilities}, status = ${status}, config = ${config}, last_seen = ${lastSeen}
        WHERE id = ${id}`)

      return this.get(id)!
    },

    remove(id) {
      db.run(sql`DELETE FROM remote_nodes WHERE id = ${id}`)
    },
  }
}
