// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Telegram approval ping: when a yellow/red tool waits, the paired chat gets a
// message with Approve/Deny. Tapping a button decides the autonomy row so the
// existing resume path can continue. No ticket ingest, no raw tool args.

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createInboundTables } from '@modules/communication/inbound-coordinator.js'
import { createPairingTables, createPairingService } from '@modules/communication/pairing-service.js'
import {
  createApprovalPing,
  parseApprovalCallback,
} from '@modules/communication/approval-ping.js'

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} } as any

function setup() {
  const db = createMemoryDb()
  createInboundTables(db)
  createPairingTables(db)
  const pairing = createPairingService(db)
  const sent: Array<{ chatId: string; text?: string; actions?: { label: string; action: string }[] }> = []
  const decided: Array<{ id: number; status: 'approved' | 'rejected'; actor: string }> = []
  const emitted: Array<{ event: string; payload: unknown }> = []
  const approvals = new Map<number, {
    id: number
    toolName: string | null
    reason: string | null
    conversationId: string | null
    status: string
    inputJson: string | null
  }>()

  const ping = createApprovalPing({
    db,
    logger: noopLogger,
    listApprovedTelegramChats: () =>
      pairing.list({ status: 'approved' }).filter((r) => r.source === 'telegram').map((r) => r.channel_id),
    sendTelegram: async (chatId, content) => {
      sent.push({ chatId, text: content.text, actions: content.actions })
    },
    getApproval: (id) => approvals.get(id) ?? null,
    decide: (id, status, actor) => {
      const row = approvals.get(id)
      if (!row || row.status !== 'pending') return { ok: false, status: row?.status }
      row.status = status
      decided.push({ id, status, actor })
      return { ok: true, status }
    },
    emitResolved: (payload) => {
      emitted.push({ event: 'autonomy:approval-resolved', payload })
    },
  })

  return { db, pairing, sent, decided, emitted, approvals, ping }
}

describe('parseApprovalCallback', () => {
  it('parses approve and deny payloads', () => {
    expect(parseApprovalCallback('appr:42:y')).toEqual({ approvalId: 42, status: 'approved' })
    expect(parseApprovalCallback('appr:7:n')).toEqual({ approvalId: 7, status: 'rejected' })
  })

  it('rejects anything else', () => {
    expect(parseApprovalCallback('appr:x:y')).toBeNull()
    expect(parseApprovalCallback('hello')).toBeNull()
    expect(parseApprovalCallback('')).toBeNull()
  })
})

describe('approval ping', () => {
  it('pings the telegram chat bound to the conversation, not other pairings', async () => {
    const { db, pairing, sent, ping, approvals } = setup()
    pairing.seedApproved('telegram', ['111', '999'])
    db.run(`INSERT INTO channel_conversations (source, channel_id, channel_sender_id, conversation_id, created_at)
            VALUES ('telegram', 'telegram::111', '111', 'conv-a', '2026-08-31T00:00:00.000Z')`)
    approvals.set(1, {
      id: 1, toolName: 'run_command', reason: 'yellow: shell', conversationId: 'conv-a',
      status: 'pending', inputJson: '{"command":"rm -rf /"}',
    })

    await ping.notify({ id: 1, toolName: 'run_command', reason: 'yellow: shell', conversationId: 'conv-a' })

    expect(sent.map((s) => s.chatId)).toEqual(['111'])
    expect(sent[0].text).toContain('run_command')
    expect(sent[0].text).toContain('yellow: shell')
    expect(sent[0].text).not.toContain('rm -rf')
    expect(sent[0].actions?.map((a) => a.action)).toEqual(['appr:1:y', 'appr:1:n'])
  })

  it('falls back to approved telegram pairings when the conversation has no channel mapping', async () => {
    const { pairing, sent, ping } = setup()
    pairing.seedApproved('telegram', ['555'])
    pairing.seedApproved('slack', ['other'])

    await ping.notify({ id: 9, toolName: 'edit_file', reason: 'red: write', conversationId: 'web-conv' })

    expect(sent.map((s) => s.chatId)).toEqual(['555'])
  })

  it('sends nothing when there is no paired telegram chat', async () => {
    const { sent, ping } = setup()
    await ping.notify({ id: 1, toolName: 'edit_file', reason: 'red', conversationId: null })
    expect(sent).toHaveLength(0)
  })

  it('handleCallback approves and emits resolved so the parked run can resume', async () => {
    const { ping, approvals, decided, emitted } = setup()
    approvals.set(3, {
      id: 3, toolName: 'edit_file', reason: 'red', conversationId: 'c1',
      status: 'pending', inputJson: null,
    })

    const result = await ping.handleCallback({ chatId: '111', senderId: '111', data: 'appr:3:y' })
    expect(result.ok).toBe(true)
    expect(decided).toEqual([{ id: 3, status: 'approved', actor: 'telegram:111' }])
    expect(emitted).toEqual([{
      event: 'autonomy:approval-resolved',
      payload: { approvalId: 3, status: 'approved', decidedBy: 'telegram:111' },
    }])
    expect(result.text).toMatch(/approved/i)
  })

  it('handleCallback rejects', async () => {
    const { ping, approvals, decided } = setup()
    approvals.set(4, {
      id: 4, toolName: 'edit_file', reason: 'red', conversationId: 'c1',
      status: 'pending', inputJson: null,
    })
    const result = await ping.handleCallback({ chatId: '111', senderId: '111', data: 'appr:4:n' })
    expect(result.ok).toBe(true)
    expect(decided[0]?.status).toBe('rejected')
    expect(result.text).toMatch(/rejected|denied/i)
  })

  it('a second tap on an already-decided row is a no-op', async () => {
    const { ping, approvals, decided } = setup()
    approvals.set(5, {
      id: 5, toolName: 'edit_file', reason: 'red', conversationId: 'c1',
      status: 'pending', inputJson: null,
    })
    await ping.handleCallback({ chatId: '111', senderId: '111', data: 'appr:5:y' })
    const again = await ping.handleCallback({ chatId: '111', senderId: '111', data: 'appr:5:n' })
    expect(decided).toHaveLength(1)
    expect(again.ok).toBe(false)
  })

  it('ignores unrelated callback data', async () => {
    const { ping, decided } = setup()
    const result = await ping.handleCallback({ chatId: '111', senderId: '111', data: 'menu:open' })
    expect(result.ok).toBe(false)
    expect(decided).toHaveLength(0)
  })
})
