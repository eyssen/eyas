import { describe, it, expect } from 'vitest'
import { ensureChannelReply } from '@modules/communication/reply-guard'
import { createProgressTracker } from '@modules/communication/progress-tracker'
import { computeCardAging, wipStatus } from '@modules/board/card-aging'
import { createPeerRegistry, createPeerTables } from '@modules/communication/submodules/a2a/peers'
import { createTestDb } from '../../helpers/test-db'

describe('channel reply-guard', () => {
  it('passes through real text', () => {
    const r = ensureChannelReply('Hello')
    expect(r?.usedFallback).toBe(false)
    expect(r?.text).toBe('Hello')
  })

  it('fills fallback when empty', () => {
    const r = ensureChannelReply('   ')
    expect(r?.usedFallback).toBe(true)
    expect(r?.text.length).toBeGreaterThan(10)
  })
})

describe('progress tracker', () => {
  it('tracks and takes placeholders', () => {
    const t = createProgressTracker()
    t.track({
      channelType: 'telegram',
      channelId: '1',
      placeholderMessageId: '9',
      inboundMessageId: 'in-1',
      createdAt: Date.now() - 1000,
    })
    const taken = t.take('telegram', '1', 'in-1')
    expect(taken?.placeholderMessageId).toBe('9')
    expect(t.take('telegram', '1', 'in-1')).toBeNull()
  })
})

describe('board aging + wip', () => {
  it('classifies stuck cards', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600_000).toISOString()
    const aging = computeCardAging(eightDaysAgo)!
    expect(aging.level).toBe('stuck')
  })

  it('reports wip over limit', () => {
    expect(wipStatus(6, 5).level).toBe('over')
    expect(wipStatus(4, 5, 80).level).toBe('warn') // 4/5 = 80%
    expect(wipStatus(3, 5, 80).level).toBe('ok')
    expect(wipStatus(3, null).level).toBe('unlimited')
  })
})

describe('federation peers', () => {
  const testDb = createTestDb('a2a-peers')
  it('parses addresses and creates peers', () => {
    const db = testDb.open()
    createPeerTables(db as any)
    const peers = createPeerRegistry(db as any, { systemName: 'local' })
    const p = peers.create({ name: 'Teodor', baseUrl: 'https://teodor.example.com' })
    expect(p.inboundToken.startsWith('eyas_peer_')).toBe(true)
    expect(peers.parseAddress('teodor/backend-dev')).toEqual({ peerId: 'teodor', agentId: 'backend-dev' })
    expect(peers.parseAddress('bad')).toBeNull()
    testDb.cleanup()
  })
})
