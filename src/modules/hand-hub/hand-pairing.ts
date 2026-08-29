// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { timingSafeEqual } from 'node:crypto'
import { nanoid } from 'nanoid'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

interface PairingEntry {
  userId: string
  expiresAt: number
}

export class HandPairing {
  private codes: Map<string, PairingEntry> = new Map()
  private ttlMs: number
  private db?: EyasDb

  constructor(ttlMs: number = 5 * 60 * 1000, db?: EyasDb) {
    this.ttlMs = ttlMs
    this.db = db
  }

  generateCode(userId: string): string {
    this.cleanup()
    const bytes = new Uint32Array(1)
    crypto.getRandomValues(bytes)
    const code = String(100000 + (bytes[0] % 900000))
    this.codes.set(code, {
      userId,
      expiresAt: Date.now() + this.ttlMs,
    })
    return code
  }

  validateCode(
    code: string,
    handId: string,
    handName: string,
    platform: string,
  ): { handId: string; token: string; userId: string } | null {
    const entry = this.codes.get(code)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.codes.delete(code)
      return null
    }
    this.codes.delete(code)

    const token = nanoid(48)

    // Persist the issued token so the WS handler can authenticate the Hand on
    // connect. Without this the token is unverifiable and any client could
    // register/impersonate a Hand (fail-closed: verifyToken rejects unknown
    // hands). hand_id is UNIQUE — re-pairing rotates the token for that Hand.
    if (this.db) {
      this.db.run(sql`
        INSERT INTO hand_tokens (id, hand_id, user_id, name, platform, token)
        VALUES (${nanoid()}, ${handId}, ${entry.userId}, ${handName}, ${platform}, ${token})
        ON CONFLICT(hand_id) DO UPDATE SET
          user_id = excluded.user_id,
          name = excluded.name,
          platform = excluded.platform,
          token = excluded.token,
          created_at = datetime('now'),
          last_used = NULL
      `)
    }

    return {
      handId,
      token,
      userId: entry.userId,
    }
  }

  /**
   * Verify a pairing token against the persisted hand_tokens row for handId.
   * Fail-closed: returns false when no DB is available, no row matches, or the
   * token does not match (constant-time compare). Bumps last_used on success.
   */
  verifyToken(handId: string, token: unknown): boolean {
    if (!this.db) return false
    if (typeof handId !== 'string' || !handId) return false
    if (typeof token !== 'string' || !token) return false

    const row = this.db.all<{ token: string }>(
      sql`SELECT token FROM hand_tokens WHERE hand_id = ${handId} LIMIT 1`,
    )[0]
    if (!row || typeof row.token !== 'string') return false

    const a = Buffer.from(row.token, 'utf8')
    const b = Buffer.from(token, 'utf8')
    if (a.length !== b.length) return false
    if (!timingSafeEqual(a, b)) return false

    this.db.run(sql`UPDATE hand_tokens SET last_used = datetime('now') WHERE hand_id = ${handId}`)
    return true
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [code, entry] of this.codes.entries()) {
      if (now > entry.expiresAt) {
        this.codes.delete(code)
      }
    }
  }
}
