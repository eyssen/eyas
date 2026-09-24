// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// DB-backed pairing replaces the telegram bot's in-memory Map/Set so approvals
// survive a restart. find-or-create keeps one row per (source, channel); a
// pending code is reissued only after it expires; approve/reject are terminal.

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createPairingTables, createPairingService } from '@modules/communication/pairing-service.js'

function fresh(opts: { ttlMs?: number } = {}) {
  const db = createMemoryDb()
  createPairingTables(db)
  let clock = new Date('2026-06-23T10:00:00.000Z')
  let seq = 0
  const make = () =>
    createPairingService(db, {
      now: () => clock,
      ttlMs: opts.ttlMs ?? 3_600_000,
      genCode: () => `EYAS-CODE${++seq}`,
    })
  return {
    db,
    svc: make(),
    restart: make, // build a fresh service over the same DB
    advanceMs: (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    },
  }
}

describe('pairing service', () => {
  it('requestPairing creates a pending row with a code', () => {
    const { svc } = fresh()
    const r = svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    expect(r).toEqual({ code: 'EYAS-CODE1', status: 'pending' })
    expect(svc.listPending('telegram')).toHaveLength(1)
    expect(svc.isApproved('telegram', 'chat-1')).toBe(false)
  })

  it('reissues the SAME code while the pending request is unexpired', () => {
    const { svc } = fresh()
    svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    const again = svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    expect(again.code).toBe('EYAS-CODE1')
    expect(svc.listPending('telegram')).toHaveLength(1)
  })

  it('issues a NEW code once the pending request has expired', () => {
    const h = fresh({ ttlMs: 1000 })
    h.svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    h.advanceMs(1001)
    const r = h.svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    expect(r.code).toBe('EYAS-CODE2')
  })

  it('approve(id) marks the channel approved and clears it from pending', () => {
    const { svc } = fresh()
    svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    const row = svc.listPending('telegram')[0]
    expect(svc.approve(row.id, 'op')).toBe(true)
    expect(svc.isApproved('telegram', 'chat-1')).toBe(true)
    expect(svc.listPending('telegram')).toHaveLength(0)
  })

  it('approveByChannel approves by (source, channelId) — used by the bot', () => {
    const { svc } = fresh()
    svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    expect(svc.approveByChannel('telegram', 'chat-1', 'op')).toBe(true)
    expect(svc.isApproved('telegram', 'chat-1')).toBe(true)
  })

  it('reject(id) is terminal: not approved, not pending', () => {
    const { svc } = fresh()
    svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    const row = svc.listPending('telegram')[0]
    expect(svc.reject(row.id, 'op')).toBe(true)
    expect(svc.isApproved('telegram', 'chat-1')).toBe(false)
    expect(svc.listPending('telegram')).toHaveLength(0)
  })

  it('approve/reject on an unknown id returns false', () => {
    const { svc } = fresh()
    expect(svc.approve(9999)).toBe(false)
    expect(svc.reject(9999)).toBe(false)
  })

  it('requestPairing on an already-approved channel returns status approved', () => {
    const { svc } = fresh()
    svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    svc.approveByChannel('telegram', 'chat-1')
    const r = svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    expect(r.status).toBe('approved')
  })

  it('seedApproved pre-approves known channel ids', () => {
    const { svc } = fresh()
    svc.seedApproved('telegram', ['admin-1', 'admin-2'])
    expect(svc.isApproved('telegram', 'admin-1')).toBe(true)
    expect(svc.isApproved('telegram', 'admin-2')).toBe(true)
  })

  it('listPending excludes expired pending requests', () => {
    const h = fresh({ ttlMs: 1000 })
    h.svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    h.advanceMs(1001)
    expect(h.svc.listPending('telegram')).toHaveLength(0)
  })

  it('approvals survive a restart (new service instance, same DB)', () => {
    const h = fresh()
    h.svc.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    const row = h.svc.listPending('telegram')[0]
    h.svc.approve(row.id)
    const restarted = h.restart()
    expect(restarted.isApproved('telegram', 'chat-1')).toBe(true)
  })
})
