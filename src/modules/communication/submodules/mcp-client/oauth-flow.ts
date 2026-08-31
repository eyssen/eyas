// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import {
  buildAuthorizationUrl,
  discoverAuthServer,
  generatePkce,
  mcpResourceUrl,
} from './oauth.js'

export const MCP_OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

export type McpOAuthPending = { serverId: string; verifier: string; createdAt: number }

const pending = new Map<string, McpOAuthPending>()

export function mcpOAuthCallbackUri(publicBaseUrl: string): string {
  return `${publicBaseUrl.replace(/\/$/, '')}/api/v1/mcp/oauth/callback`
}

/** Media-owned servers return to /media; everything else stays on MCP settings. */
export function mcpOAuthReturnPath(ownedBy: string | null | undefined): string {
  return ownedBy === 'media' ? '/media' : '/mcp-settings'
}

export function insertMcpOAuthPending(
  state: string,
  row: McpOAuthPending,
  db?: { run: (q: unknown) => unknown },
): void {
  pending.set(state, row)
  if (!db) return
  db.run(sql`INSERT INTO mcp_oauth_pending (state, server_id, verifier, created_at)
    VALUES (${state}, ${row.serverId}, ${row.verifier}, ${new Date(row.createdAt).toISOString()})`)
}

export function deleteMcpOAuthPending(
  state: string,
  db?: { run: (q: unknown) => unknown },
): void {
  pending.delete(state)
  if (!db) return
  try {
    db.run(sql`DELETE FROM mcp_oauth_pending WHERE state = ${state}`)
  } catch {
    // table may not exist in unit tests without the communication schema
  }
}

export function lookupMcpOAuthPending(
  state: string,
  db?: { all: (q: unknown) => unknown },
): McpOAuthPending | null {
  const mem = pending.get(state)
  if (mem) return mem
  if (!db) return null
  try {
    const rows = db.all(sql`SELECT * FROM mcp_oauth_pending WHERE state = ${state}`) as Array<{
      state: string
      server_id: string
      verifier: string
      created_at: string
    }>
    const row = rows[0]
    if (!row) return null
    const createdAt = Date.parse(row.created_at)
    return {
      serverId: row.server_id,
      verifier: row.verifier,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    }
  } catch {
    return null
  }
}

export function isMcpOAuthPendingExpired(createdAt: number, now = Date.now()): boolean {
  return now - createdAt > MCP_OAUTH_PENDING_TTL_MS
}

/**
 * PKCE authorize URL for an MCP server. Same helper used by
 * POST /mcp/servers/:id/oauth/start and POST /media/providers/:id/connect.
 */
export async function startMcpOAuth(input: {
  server: { id: string; url: string }
  db?: { run: (q: unknown) => unknown }
  publicBaseUrl: string
}): Promise<{ url: string }> {
  const meta = await discoverAuthServer(input.server.url)
  const { verifier, challenge } = await generatePkce()
  const state = crypto.randomUUID()
  insertMcpOAuthPending(
    state,
    { serverId: input.server.id, verifier, createdAt: Date.now() },
    input.db,
  )
  const url = buildAuthorizationUrl({
    authorizationEndpoint: meta.authorizationEndpoint,
    clientId: meta.clientId,
    redirectUri: mcpOAuthCallbackUri(input.publicBaseUrl),
    challenge,
    state,
    resource: mcpResourceUrl(input.server.url),
  })
  return { url }
}
