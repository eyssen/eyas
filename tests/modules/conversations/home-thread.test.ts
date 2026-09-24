// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createProductionConversationsDb } from '../../helpers/production-conversations-db'

describe('getOrCreateHomeThread', () => {
  let db: any
  let svc: ReturnType<typeof createConversationService>

  beforeEach(async () => {
    db = await createProductionConversationsDb()
    svc = createConversationService(db)
  })

  it('returns the same home thread for the same user and colleague', () => {
    const a = svc.getOrCreateHomeThread({ userId: 'u1', agentId: 'system-engineer', title: 'Engineer' })
    const b = svc.getOrCreateHomeThread({ userId: 'u1', agentId: 'system-engineer', title: 'Engineer' })
    expect(a.kind).toBe('home')
    expect(a.agentId).toBe('system-engineer')
    expect(b.id).toBe(a.id)
  })

  it('isolates home threads per colleague and per user', () => {
    const eng = svc.getOrCreateHomeThread({ userId: 'u1', agentId: 'system-engineer', title: 'Engineer' })
    const asst = svc.getOrCreateHomeThread({ userId: 'u1', agentId: 'primary-assistant', title: 'Assistant' })
    const other = svc.getOrCreateHomeThread({ userId: 'u2', agentId: 'system-engineer', title: 'Engineer' })
    expect(new Set([eng.id, asst.id, other.id]).size).toBe(3)
  })

  it('marks specialist children as kind=delegation', () => {
    const parent = svc.create({ userId: 'u1', title: 'Parent' })
    const child = svc.createSubConversation({
      title: 'Review',
      goalDescription: 'review it',
      parentConversationId: parent.id,
      agentId: 'code-reviewer',
    })
    expect(child.kind).toBe('delegation')
    expect(svc.create({ userId: 'u1', title: 'Task' }).kind).toBe('task')
  })
})
