// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// DB-backed channel pairing — survives restarts (the telegram bot previously
// kept this in an in-memory Map/Set, so approvals were lost on every restart).
// One row per (source, channel): a pending code is reissued only after it
// expires; approve/reject are terminal; pre-approved ids are seeded as approved.

import { sql } from 'drizzle-orm'

export interface PairingRow {
  id: number
  source: string
  channel_id: string
  sender_name: string | null
  code: string | null
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  created_at: string
  expires_at: string | null
  decided_at: string | null
  decided_by: string | null
}

export interface PairingServiceOptions {
  now?: () => Date
  ttlMs?: number
  genCode?: () => string
}

export interface PairingService {
  requestPairing(input: { source: string; channelId: string; senderName?: string }): {
    code: string | null
    status: 'pending' | 'approved'
  }
  isApproved(source: string, channelId: string): boolean
  approve(id: number, by?: string): boolean
  approveByChannel(source: string, channelId: string, by?: string): boolean
  reject(id: number, by?: string): boolean
  listPending(source?: string): PairingRow[]
  list(opts?: { status?: string; limit?: number }): PairingRow[]
  get(id: number): PairingRow | null
  seedApproved(source: string, channelIds: string[]): void
}

const DEFAULT_TTL_MS = 3_600_000 // 1 hour
const iso = (d: Date) => d.toISOString()

/** EYAS-XXXX pairing code (unambiguous alphabet — no O/0/I/1). */
function defaultGenCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'EYAS-'
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  for (let i = 0; i < 4; i++) code += chars[bytes[i] % chars.length]
  return code
}

export function createPairingTables(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS channel_pairings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    sender_name TEXT,
    code TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
    created_at TEXT NOT NULL,
    expires_at TEXT,
    decided_at TEXT,
    decided_by TEXT,
    UNIQUE (source, channel_id)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_channel_pairings_status ON channel_pairings(source, status)`)
}

export function createPairingService(db: any, opts: PairingServiceOptions = {}): PairingService {
  const now = opts.now ?? (() => new Date())
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const genCode = opts.genCode ?? defaultGenCode

  function getByChannel(source: string, channelId: string): PairingRow | null {
    const rows = db.all(
      sql`SELECT * FROM channel_pairings WHERE source=${source} AND channel_id=${channelId}`
    ) as PairingRow[]
    return rows[0] ?? null
  }

  function get(id: number): PairingRow | null {
    const rows = db.all(sql`SELECT * FROM channel_pairings WHERE id=${id}`) as PairingRow[]
    return rows[0] ?? null
  }

  const isExpired = (row: PairingRow) => !!row.expires_at && iso(now()) > row.expires_at

  function expireStale(): void {
    db.run(
      sql`UPDATE channel_pairings SET status='expired'
          WHERE status='pending' AND expires_at IS NOT NULL AND expires_at < ${iso(now())}`
    )
  }

  function requestPairing(input: { source: string; channelId: string; senderName?: string }) {
    const { source, channelId, senderName } = input
    const existing = getByChannel(source, channelId)
    if (existing?.status === 'approved') return { code: null, status: 'approved' as const }
    if (existing?.status === 'pending' && !isExpired(existing)) {
      return { code: existing.code, status: 'pending' as const }
    }

    const code = genCode()
    const createdAt = iso(now())
    const expiresAt = iso(new Date(now().getTime() + ttlMs))
    if (existing) {
      db.run(
        sql`UPDATE channel_pairings SET sender_name=${senderName ?? null}, code=${code}, status='pending',
            created_at=${createdAt}, expires_at=${expiresAt}, decided_at=NULL, decided_by=NULL
            WHERE source=${source} AND channel_id=${channelId}`
      )
    } else {
      db.run(
        sql`INSERT INTO channel_pairings (source, channel_id, sender_name, code, status, created_at, expires_at)
            VALUES (${source}, ${channelId}, ${senderName ?? null}, ${code}, 'pending', ${createdAt}, ${expiresAt})`
      )
    }
    return { code, status: 'pending' as const }
  }

  function isApproved(source: string, channelId: string): boolean {
    return getByChannel(source, channelId)?.status === 'approved'
  }

  function approve(id: number, by?: string): boolean {
    if (!get(id)) return false
    db.run(
      sql`UPDATE channel_pairings SET status='approved', decided_at=${iso(now())}, decided_by=${by ?? null} WHERE id=${id}`
    )
    return true
  }

  function approveByChannel(source: string, channelId: string, by?: string): boolean {
    const row = getByChannel(source, channelId)
    return row ? approve(row.id, by) : false
  }

  function reject(id: number, by?: string): boolean {
    if (!get(id)) return false
    db.run(
      sql`UPDATE channel_pairings SET status='rejected', decided_at=${iso(now())}, decided_by=${by ?? null} WHERE id=${id}`
    )
    return true
  }

  function listPending(source?: string): PairingRow[] {
    expireStale()
    if (source) {
      return db.all(
        sql`SELECT * FROM channel_pairings WHERE source=${source} AND status='pending' ORDER BY created_at DESC`
      ) as PairingRow[]
    }
    return db.all(sql`SELECT * FROM channel_pairings WHERE status='pending' ORDER BY created_at DESC`) as PairingRow[]
  }

  function list(opts2: { status?: string; limit?: number } = {}): PairingRow[] {
    const limit = opts2.limit ?? 200
    if (opts2.status) {
      return db.all(
        sql`SELECT * FROM channel_pairings WHERE status=${opts2.status} ORDER BY id DESC LIMIT ${limit}`
      ) as PairingRow[]
    }
    return db.all(sql`SELECT * FROM channel_pairings ORDER BY id DESC LIMIT ${limit}`) as PairingRow[]
  }

  function seedApproved(source: string, channelIds: string[]): void {
    const createdAt = iso(now())
    for (const channelId of channelIds) {
      db.run(
        sql`INSERT OR IGNORE INTO channel_pairings (source, channel_id, status, created_at, decided_at)
            VALUES (${source}, ${channelId}, 'approved', ${createdAt}, ${createdAt})`
      )
    }
  }

  return { requestPairing, isApproved, approve, approveByChannel, reject, listPending, list, get, seedApproved }
}
