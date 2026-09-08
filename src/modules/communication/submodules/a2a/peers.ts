// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Multi-instance peer registry for EYAS↔EYAS federation built on A2A.
// Peers are opt-in; messages to peer agents use address form "peerId/agentId".

import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { createA2AClient } from './client.js'

export interface PeerRecord {
  id: string
  name: string
  baseUrl: string
  /** Token peers must present when calling us. */
  inboundToken: string
  /** Token we present when calling them (may be empty while pairing). */
  outboundToken: string
  shareCapabilities: boolean
  enabled: boolean
  lastSeenAt: string | null
  lastError: string | null
  claimedAgents: Array<{ id: string; name?: string; summary?: string }>
  createdAt: string
  updatedAt: string
}

export interface PeerRegistry {
  list(): PeerRecord[]
  get(id: string): PeerRecord | null
  create(input: { name: string; baseUrl: string; shareCapabilities?: boolean }): PeerRecord
  update(id: string, patch: Partial<{ name: string; baseUrl: string; outboundToken: string; shareCapabilities: boolean; enabled: boolean }>): PeerRecord | null
  rotateInboundToken(id: string): PeerRecord | null
  remove(id: string): boolean
  authenticateInbound(token: string): PeerRecord | null
  parseAddress(to: string): { peerId: string; agentId: string } | null
  sendToPeer(to: string, content: string, fromAgentId: string): Promise<{ ok: boolean; taskId?: string; error?: string }>
  refreshDirectory(id: string): Promise<PeerRecord | null>
}

function rowToPeer(r: any): PeerRecord {
  let claimed: PeerRecord['claimedAgents'] = []
  try { claimed = r.claimed_agents ? JSON.parse(r.claimed_agents) : [] } catch { claimed = [] }
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.base_url,
    inboundToken: r.inbound_token,
    outboundToken: r.outbound_token ?? '',
    shareCapabilities: !!r.share_capabilities,
    enabled: !!r.enabled,
    lastSeenAt: r.last_seen_at,
    lastError: r.last_error,
    claimedAgents: claimed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function newToken(): string {
  return `eyas_peer_${randomBytes(24).toString('base64url')}`
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export function createPeerTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS a2a_peers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    inbound_token TEXT NOT NULL,
    outbound_token TEXT NOT NULL DEFAULT '',
    share_capabilities INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT,
    last_error TEXT,
    claimed_agents TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_peers_inbound ON a2a_peers(inbound_token)`)
}

export function createPeerRegistry(db: EyasDb, opts?: {
  /** Local system name used in federated addressing. */
  systemName?: string
}): PeerRegistry {
  return {
    list() {
      return (db.all(sql`SELECT * FROM a2a_peers ORDER BY name ASC`) as any[]).map(rowToPeer)
    },

    get(id) {
      const rows = db.all(sql`SELECT * FROM a2a_peers WHERE id = ${id}`) as any[]
      return rows[0] ? rowToPeer(rows[0]) : null
    },

    create(input) {
      const id = input.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || randomUUID().slice(0, 8)
      const baseUrl = input.baseUrl.replace(/\/+$/, '')
      const inboundToken = newToken()
      db.run(sql`
        INSERT INTO a2a_peers (id, name, base_url, inbound_token, share_capabilities)
        VALUES (${id}, ${input.name}, ${baseUrl}, ${inboundToken}, ${input.shareCapabilities ? 1 : 0})
      `)
      return this.get(id)!
    },

    update(id, patch) {
      const cur = this.get(id)
      if (!cur) return null
      const name = patch.name ?? cur.name
      const baseUrl = (patch.baseUrl ?? cur.baseUrl).replace(/\/+$/, '')
      const outboundToken = patch.outboundToken ?? cur.outboundToken
      const share = patch.shareCapabilities ?? cur.shareCapabilities
      const enabled = patch.enabled ?? cur.enabled
      db.run(sql`
        UPDATE a2a_peers SET
          name = ${name},
          base_url = ${baseUrl},
          outbound_token = ${outboundToken},
          share_capabilities = ${share ? 1 : 0},
          enabled = ${enabled ? 1 : 0},
          updated_at = datetime('now')
        WHERE id = ${id}
      `)
      return this.get(id)
    },

    rotateInboundToken(id) {
      const token = newToken()
      db.run(sql`
        UPDATE a2a_peers SET inbound_token = ${token}, updated_at = datetime('now')
        WHERE id = ${id}
      `)
      return this.get(id)
    },

    remove(id) {
      const cur = this.get(id)
      if (!cur) return false
      db.run(sql`DELETE FROM a2a_peers WHERE id = ${id}`)
      return true
    },

    authenticateInbound(token) {
      if (!token) return null
      const peers = this.list()
      for (const p of peers) {
        if (p.enabled && safeEqual(p.inboundToken, token)) return p
      }
      return null
    },

    parseAddress(to) {
      const m = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})$/.exec(to.trim())
      if (!m) return null
      return { peerId: m[1]!, agentId: m[2]! }
    },

    async sendToPeer(to, content, fromAgentId) {
      const addr = this.parseAddress(to)
      if (!addr) return { ok: false, error: 'invalid federated address (expected peer/agent)' }
      const peer = this.get(addr.peerId)
      if (!peer || !peer.enabled) return { ok: false, error: 'peer not found or disabled' }
      if (!peer.outboundToken) return { ok: false, error: 'peer unpaired (no outbound token)' }
      try {
        const system = opts?.systemName ?? 'eyas'
        const client = createA2AClient({ bearerToken: peer.outboundToken })
        const description = [
          `<untrusted source="federation:${system}/${fromAgentId}">`,
          content,
          '</untrusted>',
          `\n[federated-to: ${addr.peerId}/${addr.agentId}]`,
        ].join('\n')
        const result = await client.sendTask(peer.baseUrl, description)
        db.run(sql`
          UPDATE a2a_peers SET last_seen_at = datetime('now'), last_error = NULL, updated_at = datetime('now')
          WHERE id = ${peer.id}
        `)
        return { ok: true, taskId: result?.id }
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        db.run(sql`
          UPDATE a2a_peers SET last_error = ${msg.slice(0, 500)}, updated_at = datetime('now')
          WHERE id = ${peer.id}
        `)
        return { ok: false, error: msg }
      }
    },

    async refreshDirectory(id) {
      const peer = this.get(id)
      if (!peer || !peer.outboundToken) return peer
      try {
        const client = createA2AClient({ bearerToken: peer.outboundToken })
        const card = await client.discover(peer.baseUrl)
        const claimed = (card?.skills ?? []).slice(0, 25).map((s: any) => ({
          id: s.id ?? s.name,
          name: s.name,
          summary: s.description,
        }))
        db.run(sql`
          UPDATE a2a_peers SET
            claimed_agents = ${JSON.stringify(claimed)},
            last_seen_at = datetime('now'),
            last_error = NULL,
            updated_at = datetime('now')
          WHERE id = ${id}
        `)
        return this.get(id)
      } catch (err: any) {
        db.run(sql`
          UPDATE a2a_peers SET last_error = ${String(err?.message ?? err).slice(0, 500)}, updated_at = datetime('now')
          WHERE id = ${id}
        `)
        return this.get(id)
      }
    },
  }
}

/** Deterministic short id helper (unused externally, kept for tests). */
export function peerIdFromName(name: string): string {
  return createHash('sha256').update(name).digest('hex').slice(0, 12)
}
