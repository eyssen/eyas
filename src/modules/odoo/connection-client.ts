// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { connectionSecretName } from '@modules/connections/catalog.js'
import { createOdooClient, type OdooClient } from './client.js'

export interface ConnectionLike {
  id: string
  systemType: string
  config: Record<string, unknown>
}

export interface SecretsLike {
  get(name: string, scope: string, requester?: unknown): Promise<string | null>
}

/**
 * Build an Odoo JSON-RPC client from a Connections-catalog row.
 * Uses the connection-scoped vault secret (`conn-{id}-api-key`), never the
 * caller's global `odoo-api-key` — that would mix two instances.
 */
export async function createOdooClientFromConnection(
  conn: ConnectionLike,
  secrets: SecretsLike,
): Promise<OdooClient | null> {
  if (conn.systemType !== 'odoo') return null
  const url = String(conn.config.url ?? '').trim()
  const db = String(conn.config.db ?? '').trim()
  const username = String(conn.config.username ?? '').trim()
  const vaultName = connectionSecretName(conn.id, 'api-key')
  let apiKey: string | null = null
  try {
    apiKey = await secrets.get(vaultName, 'system', { trusted: true })
  } catch {
    apiKey = null
  }
  if (!url || !db || !username || !apiKey) return createOdooClient(null)
  return createOdooClient({ url, db, username, apiKey })
}
